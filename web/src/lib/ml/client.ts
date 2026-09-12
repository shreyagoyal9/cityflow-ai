import type { CityCode } from "@/lib/cities";

/**
 * Client for the Python ML service (`/ml`).
 *
 * ============================ THE ONE RULE ==================================
 * THIS SERVICE IS OPTIONAL AND MUST NEVER BE ABLE TO BREAK THE PRODUCT.
 *
 * The ML service runs Prophet, XGBoost and OR-Tools — none of which run on
 * Vercel's serverless runtime, so it is deployed separately, usually on a free
 * tier that sleeps after inactivity. A free container that sleeps is a container
 * that will be asleep the first time somebody demonstrates this project.
 *
 * So every function here returns a RESULT OBJECT rather than throwing: either
 * the model's answer, or `null` with a reason. The caller falls back to the
 * TypeScript demand model in `lib/demand/`, and the UI says which one produced
 * the numbers on screen. Recommendations degrade in quality; they never
 * disappear, and they never silently pretend to be something they are not.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  Configuration                                                              */
/* -------------------------------------------------------------------------- */

/** Base URL of the ML service. Empty means "not configured" — a valid state. */
const ML_URL = (process.env.ML_SERVICE_URL ?? "").replace(/\/+$/, "");

/** Shared secret sent as X-CityFlow-Key. */
const ML_KEY = process.env.ML_SERVICE_KEY ?? "";

/**
 * How long to wait before giving up and using the local model.
 *
 * Deliberately short. A sleeping free-tier container can take 30 seconds to
 * wake, and a user staring at a spinner for 30 seconds has already decided the
 * product is broken. Better to answer in two seconds with the simpler model.
 * The first request wakes the container, so the *next* page load gets the real
 * thing — which is why this is a timeout and not a circuit breaker.
 */
const TIMEOUT_MS = Number(process.env.ML_SERVICE_TIMEOUT_MS ?? 2500);

export function isMlConfigured(): boolean {
  return ML_URL.length > 0;
}

/* -------------------------------------------------------------------------- */
/*  Result type                                                                */
/* -------------------------------------------------------------------------- */

export type MlResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: MlFailureReason; detail: string };

export type MlFailureReason =
  | "not_configured"
  | "timeout"
  | "unreachable"
  | "unauthorised"
  | "rejected"
  | "server_error"
  | "bad_response";

/** A short sentence safe to show an administrator. Never shown to commuters. */
export function describeFailure(reason: MlFailureReason): string {
  switch (reason) {
    case "not_configured":
      return "The ML service is not configured, so the built-in demand model was used.";
    case "timeout":
      return "The ML service did not respond in time, so the built-in demand model was used. If it is hosted on a free tier it may have been asleep — the next request usually succeeds.";
    case "unreachable":
      return "The ML service could not be reached, so the built-in demand model was used.";
    case "unauthorised":
      return "The ML service rejected our key. Check ML_SERVICE_KEY matches CITYFLOW_API_KEY.";
    case "rejected":
      return "The ML service rejected the request. This is a bug in how we built it, not a service outage.";
    case "server_error":
      return "The ML service failed while computing. The built-in demand model was used instead.";
    case "bad_response":
      return "The ML service returned something we could not read, so the built-in demand model was used.";
  }
}

/* -------------------------------------------------------------------------- */
/*  Transport                                                                  */
/* -------------------------------------------------------------------------- */

async function post<T>(path: string, body: unknown): Promise<MlResult<T>> {
  if (!isMlConfigured()) {
    return { ok: false, reason: "not_configured", detail: "ML_SERVICE_URL is not set." };
  }

  // AbortController is what actually enforces the timeout. Without it a hung
  // connection holds a serverless function open until the platform kills it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${ML_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ML_KEY ? { "X-CityFlow-Key": ML_KEY } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      // Never cached by Next.js: the optimiser's answer depends on who has
      // confirmed a plan in the last minute, and a stale schedule is worse than
      // a slow one.
      cache: "no-store",
    });

    if (response.status === 401) {
      return { ok: false, reason: "unauthorised", detail: "The ML service rejected our key." };
    }
    if (response.status === 422 || response.status === 413) {
      const text = await response.text().catch(() => "");
      return { ok: false, reason: "rejected", detail: text.slice(0, 300) };
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: "server_error",
        detail: `The ML service returned HTTP ${response.status}.`,
      };
    }

    try {
      return { ok: true, data: (await response.json()) as T };
    } catch {
      return { ok: false, reason: "bad_response", detail: "The response was not valid JSON." };
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? "timeout" : "unreachable",
      detail: aborted
        ? `No response within ${TIMEOUT_MS}ms.`
        : error instanceof Error
          ? error.message
          : "Unknown network error.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/*  Forecast                                                                   */
/* -------------------------------------------------------------------------- */

export interface MlForecastSlot {
  slot_minutes: number;
  demand_index: number;
  lower: number;
  upper: number;
}

export interface MlForecast {
  city_code: string;
  target_date: string;
  slots: MlForecastSlot[];
  method: "prophet_xgboost" | "prophet_only" | "seasonal_prior";
  observations_used: number;
  confidence: number;
  notes: string[];
}

export interface ForecastArgs {
  cityCode: CityCode;
  /** YYYY-MM-DD */
  targetDate: string;
  cityPressure: number;
  observed?: Array<{ date: string; slot_minutes: number; trips: number }>;
  precipitationMm?: number | null;
  events?: Array<{ start_minutes: number; end_minutes: number; demand_impact: number }>;
}

export async function fetchForecast(args: ForecastArgs): Promise<MlResult<MlForecast>> {
  return post<MlForecast>("/forecast", {
    city_code: args.cityCode,
    target_date: args.targetDate,
    city_pressure: args.cityPressure,
    observed: args.observed ?? [],
    precipitation_mm: args.precipitationMm ?? null,
    events: args.events ?? [],
  });
}

/** How the UI describes where a forecast came from. */
export const FORECAST_METHOD_LABEL: Record<MlForecast["method"], string> = {
  prophet_xgboost: "Prophet + XGBoost, fitted on recorded demand",
  prophet_only: "Prophet, fitted on recorded demand",
  seasonal_prior: "Seasonal prior — not yet fitted on recorded demand",
};

/* -------------------------------------------------------------------------- */
/*  Optimise                                                                   */
/* -------------------------------------------------------------------------- */

export interface MlCommuter {
  ref: string;
  usual_slot: number;
  allowed_slots: number[];
  weight: number;
  latest_feasible_slot?: number | null;
}

export interface MlAssignment {
  ref: string;
  usual_slot: number;
  assigned_slot: number;
  shift_minutes: number;
}

export interface MlOptimisation {
  city_code: string;
  target_date: string;
  assignments: MlAssignment[];
  load_before: number[];
  load_after: number[];
  peak_before: number;
  peak_after: number;
  peak_reduction_percent: number;
  moved_count: number;
  unchanged_count: number;
  mean_shift_minutes: number;
  solver_status: string;
  solve_seconds: number;
  time_limited: boolean;
  notes: string[];
}

export interface OptimiseArgs {
  cityCode: CityCode;
  targetDate: string;
  commuters: MlCommuter[];
  /** Immovable load per slot, in VEHICLE units. See indexToVehicleLoad below. */
  baseline?: number[];
  slotCapacity?: number | null;
  peakWeight?: number;
  disruptionWeight?: number;
}

export async function fetchOptimisation(
  args: OptimiseArgs
): Promise<MlResult<MlOptimisation>> {
  return post<MlOptimisation>("/optimize", {
    city_code: args.cityCode,
    target_date: args.targetDate,
    commuters: args.commuters,
    baseline: args.baseline ?? [],
    slot_capacity: args.slotCapacity ?? null,
    peak_weight: args.peakWeight ?? null,
    disruption_weight: args.disruptionWeight ?? null,
  });
}

/**
 * Converts a 0-100 demand index into the vehicle units the optimiser works in.
 *
 * WHY THIS FUNCTION EXISTS AT ALL
 * The optimiser sums the immovable baseline with the movable commuters, so the
 * two must be in the same units. The demand index is not — it is a 0-100 scale
 * describing pressure, while a commuter's weight is roughly "one vehicle".
 * Sending the raw index would weigh the curve against the people on different
 * scales, and produce a schedule that looks optimal and is not. Because the bug
 * is silent, the conversion lives in one named place rather than inline at a
 * call site where the next person will not notice it is needed.
 *
 * @param referenceVehicles Vehicles represented by an index of 100 for this
 *   city. Derived from the number of trips the system actually holds, so the
 *   scale grows with real adoption instead of being a magic number.
 */
export function indexToVehicleLoad(
  demandIndex: number[],
  referenceVehicles: number
): number[] {
  const scale = referenceVehicles / 100;
  return demandIndex.map((index) => Math.max(0, Math.round(index * scale)));
}

/* -------------------------------------------------------------------------- */
/*  Health                                                                     */
/* -------------------------------------------------------------------------- */

export interface MlHealth {
  status: string;
  service: string;
  environment: string;
  cache: string;
}

/**
 * Used by the Admin Portal's system-status page, so an administrator can tell
 * at a glance whether recommendations are currently coming from the full model
 * or the fallback.
 */
export async function fetchHealth(): Promise<MlResult<MlHealth>> {
  if (!isMlConfigured()) {
    return { ok: false, reason: "not_configured", detail: "ML_SERVICE_URL is not set." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${ML_URL}/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: "server_error",
        detail: `Health check returned HTTP ${response.status}.`,
      };
    }
    return { ok: true, data: (await response.json()) as MlHealth };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? "timeout" : "unreachable",
      detail: aborted ? `No response within ${TIMEOUT_MS}ms.` : "Could not reach the service.",
    };
  } finally {
    clearTimeout(timer);
  }
}
