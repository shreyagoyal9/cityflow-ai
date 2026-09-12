"""
City-wide departure-time optimisation with Google OR-Tools (CP-SAT).

THE PROBLEM THIS SOLVES, AND WHY A SOLVER IS NEEDED FOR IT
Recommending a quieter departure time to one person is easy: look at the curve,
pick the dip. Doing it for everybody at once is a different problem, because the
moment you tell ten thousand people that 08:45 is quiet, 08:45 stops being
quiet. Greedy per-person advice does not smooth a peak — it relocates it, which
is the exact failure mode CityFlow AI exists to avoid.

Stated properly, this is a multi-agent scheduling problem: assign every flexible
trip to one departure slot from the set that person actually agreed to, so that
the busiest slot in the day is as quiet as possible, while asking as few people
as possible to change their routine. That is a minimax objective with a
secondary cost, which is exactly what CP-SAT is built for.

THE MODEL
  Variables   x[i][s] ∈ {0,1}   trip i departs in slot s
  Constraint  Σ_s x[i][s] = 1            every trip departs exactly once
  Constraint  x[i][s] = 0 for s ∉ allowed(i)   never propose a time they refused
  Derived     load[s] = baseline[s] + Σ_i weight[i]·x[i][s]
  Derived     peak    = max_s load[s]
  Objective   minimise  peak_weight·peak + disruption_weight·Σ_i |shift_i|

WHAT THE TWO WEIGHTS MEAN IN PRACTICE
`peak_weight` alone would produce a perfectly flat curve by moving everyone to
the edge of their window — technically optimal, socially absurd. The disruption
term is what keeps the answer humane: a person is only moved when moving them
actually buys peak reduction. Raising `disruption_weight` moves fewer people
further; raising `peak_weight` moves more people less. Both are configurable per
city because that trade-off is a policy decision, not an engineering one.

FAIRNESS
Every trip carries the same disruption cost per minute moved, so the solver has
no incentive to repeatedly inconvenience the same flexible people while leaving
others untouched. People who declared no flexibility have a single allowed slot
and are therefore structurally immovable — the model cannot override consent
even if doing so would produce a better objective.
"""

from __future__ import annotations

import logging
import time

from ortools.sat.python import cp_model

from app.schemas import Assignment, Commuter, OptimizeRequest, OptimizeResponse

logger = logging.getLogger(__name__)

SLOT_MINUTES = 15
SLOTS_PER_DAY = (24 * 60) // SLOT_MINUTES

# CP-SAT is an integer solver. Weights and loads are floats, so everything is
# scaled to integers by this factor and scaled back on the way out. 100 gives
# two decimal places of vehicle weight, which is far finer than the input.
SCALE = 100


def _slot_index(minutes: int) -> int:
    return minutes // SLOT_MINUTES


def _usable_slots(commuter: Commuter) -> list[int]:
    """
    The slots this trip may actually be assigned to.

    Filters the person's stated window down to what also arrives on time, then
    falls back to their usual slot if nothing survives — never to an arbitrary
    slot, and never to nothing at all.
    """
    slots = sorted({s for s in commuter.allowed_slots if 0 <= s < 24 * 60})

    if commuter.latest_feasible_slot is not None:
        feasible = [s for s in slots if s <= commuter.latest_feasible_slot]
        if feasible:
            slots = feasible

    return slots or [commuter.usual_slot]


def optimize(request: OptimizeRequest, settings) -> OptimizeResponse:
    started = time.perf_counter()
    notes: list[str] = []

    peak_weight = request.peak_weight if request.peak_weight is not None else settings.peak_weight
    disruption_weight = (
        request.disruption_weight
        if request.disruption_weight is not None
        else settings.disruption_weight
    )

    commuters = request.commuters

    # Immovable load, padded or trimmed to exactly one day. This is in vehicle
    # units, matching `Commuter.weight` — see the note on the field itself.
    baseline = list(request.baseline) + [0] * max(0, SLOTS_PER_DAY - len(request.baseline))
    baseline = baseline[:SLOTS_PER_DAY]

    # ---------------------------------------------------------------- 1. Model
    model = cp_model.CpModel()

    # x[i][slot_index] — only created for slots the person allows, which keeps
    # the model small: a typical commuter has 3-9 usable slots, not 96.
    x: list[dict[int, cp_model.IntVar]] = []
    usable: list[list[int]] = []

    for i, commuter in enumerate(commuters):
        slots = _usable_slots(commuter)
        usable.append(slots)
        row = {_slot_index(s): model.NewBoolVar(f"x_{i}_{s}") for s in slots}
        x.append(row)
        model.AddExactlyOne(row.values())

    # ------------------------------------------------------- 2. Load per slot
    load_terms: list[list[tuple[cp_model.IntVar, int]]] = [[] for _ in range(SLOTS_PER_DAY)]
    for i, commuter in enumerate(commuters):
        weight = int(round(commuter.weight * SCALE))
        for slot_index, var in x[i].items():
            load_terms[slot_index].append((var, weight))

    max_possible = sum(int(round(c.weight * SCALE)) for c in commuters) + max(baseline, default=0) * SCALE

    load_vars: list[cp_model.IntVar] = []
    overflow_vars: list[cp_model.IntVar] = []

    for s in range(SLOTS_PER_DAY):
        load = model.NewIntVar(0, max_possible, f"load_{s}")
        model.Add(
            load
            == baseline[s] * SCALE + sum(var * weight for var, weight in load_terms[s])
        )
        load_vars.append(load)

        # A stated road capacity, when the city has given us one.
        #
        # Modelled as a SOFT constraint on purpose. A hard ceiling makes the
        # model infeasible the moment demand genuinely exceeds the road, and an
        # infeasible model returns nothing at all — which is a far worse answer
        # for a city than "here is the flattest schedule your roads allow, and
        # these slots still go over". The overflow is heavily penalised below,
        # so the solver avoids it wherever it can.
        if request.slot_capacity is not None:
            ceiling = int(round(request.slot_capacity * SCALE))
            over = model.NewIntVar(0, max_possible, f"over_{s}")
            model.Add(over >= load - ceiling)
            overflow_vars.append(over)

    # --------------------------------------------------------------- 3. Peak
    peak = model.NewIntVar(0, max_possible, "peak")
    model.AddMaxEquality(peak, load_vars)

    # ---------------------------------------------------------- 4. Disruption
    # Cost in minutes moved, per trip. Linear in the size of the shift, so two
    # people moved 15 minutes costs the same as one moved 30 — which is the
    # fairness property we want.
    disruption_terms = []
    for i, commuter in enumerate(commuters):
        for slot in usable[i]:
            shift = abs(slot - commuter.usual_slot)
            if shift:
                disruption_terms.append(x[i][_slot_index(slot)] * shift)

    # Everything below is assembled as a single integer linear expression.
    #
    # NOTE ON UNITS: `peak` is in scaled vehicles and the disruption terms are in
    # minutes, so the disruption coefficient converts minutes into the same
    # scaled-vehicle currency before the two are added. Doing that conversion in
    # the coefficient — a plain Python integer — rather than on the expression
    # matters: CP-SAT expressions support multiplication by an integer but not
    # floor division, so `sum(terms) // SLOT_MINUTES` raises at model-build time.
    objective = peak_weight * peak

    if disruption_terms:
        minutes_to_scaled_vehicles = max(1, (disruption_weight * SCALE) // SLOT_MINUTES)
        objective += minutes_to_scaled_vehicles * sum(disruption_terms)

    if overflow_vars:
        # Going over a stated road capacity is worse than a tall peak that stays
        # under it, so overflow carries several times the peak's weight.
        objective += (peak_weight * 5) * sum(overflow_vars)

    model.Minimize(objective)

    # --------------------------------------------------------------- 5. Solve
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(settings.solver_timeout_seconds)
    # Parallel search finds good solutions markedly faster on this model shape.
    solver.parameters.num_search_workers = 4

    status = solver.Solve(model)
    status_name = solver.StatusName(status)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Everyone keeps their usual time. Returning that honestly is far better
        # than returning an arbitrary assignment the solver never endorsed.
        notes.append(
            f"The solver returned {status_name}, so no departure changes are being proposed. "
            "Everyone keeps their usual time."
        )
        before = _load_curve(commuters, baseline)
        return OptimizeResponse(
            city_code=request.city_code,
            target_date=request.target_date,
            assignments=[
                Assignment(
                    ref=c.ref,
                    usual_slot=c.usual_slot,
                    assigned_slot=c.usual_slot,
                    shift_minutes=0,
                )
                for c in commuters
            ],
            load_before=before,
            load_after=before,
            peak_before=max(before),
            peak_after=max(before),
            peak_reduction_percent=0.0,
            moved_count=0,
            unchanged_count=len(commuters),
            mean_shift_minutes=0.0,
            solver_status=status_name,
            solve_seconds=round(time.perf_counter() - started, 3),
            time_limited=False,
            notes=notes,
        )

    # -------------------------------------------------------------- 6. Read it
    assignments: list[Assignment] = []
    after_counts = [0.0] * SLOTS_PER_DAY

    for i, commuter in enumerate(commuters):
        chosen = commuter.usual_slot
        for slot in usable[i]:
            if solver.Value(x[i][_slot_index(slot)]):
                chosen = slot
                break

        after_counts[_slot_index(chosen)] += commuter.weight
        assignments.append(
            Assignment(
                ref=commuter.ref,
                usual_slot=commuter.usual_slot,
                assigned_slot=chosen,
                shift_minutes=chosen - commuter.usual_slot,
            )
        )

    before = _load_curve(commuters, baseline)
    after = [round(baseline[s] + after_counts[s], 2) for s in range(SLOTS_PER_DAY)]

    peak_before = max(before)
    peak_after = max(after)
    reduction = 0.0 if peak_before <= 0 else (peak_before - peak_after) / peak_before * 100

    moved = [a for a in assignments if a.shift_minutes != 0]
    mean_shift = (
        sum(abs(a.shift_minutes) for a in moved) / len(moved) if moved else 0.0
    )

    time_limited = status == cp_model.FEASIBLE
    if time_limited:
        notes.append(
            f"The solver reached its {settings.solver_timeout_seconds:.0f}s limit and returned the "
            "best schedule it had found. A longer limit may find a slightly better one."
        )

    notes.append(
        f"{len(moved)} of {len(commuters)} trips were asked to move, by "
        f"{mean_shift:.0f} minutes on average. The rest keep their usual time."
    )

    return OptimizeResponse(
        city_code=request.city_code,
        target_date=request.target_date,
        assignments=assignments,
        load_before=before,
        load_after=after,
        peak_before=round(peak_before, 2),
        peak_after=round(peak_after, 2),
        peak_reduction_percent=round(reduction, 2),
        moved_count=len(moved),
        unchanged_count=len(commuters) - len(moved),
        mean_shift_minutes=round(mean_shift, 1),
        solver_status=status_name,
        solve_seconds=round(time.perf_counter() - started, 3),
        time_limited=time_limited,
        notes=notes,
    )


def _load_curve(commuters: list[Commuter], baseline: list[int]) -> list[float]:
    """Vehicle load per slot if everyone departs at their usual time."""
    curve = [float(b) for b in baseline]
    for commuter in commuters:
        curve[_slot_index(commuter.usual_slot)] += commuter.weight
    return [round(v, 2) for v in curve]
