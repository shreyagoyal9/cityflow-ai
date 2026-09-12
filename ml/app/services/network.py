"""
Corridor modelling with NetworkX.

WHAT THIS IS FOR
Demand smoothing at the level of "the whole city at 08:45" is a blunt
instrument. Two trips departing in the same slot only compete for road if they
actually share road. This module builds a small graph of the city's zones and
the corridors between them, so the optimiser can be told which trips genuinely
collide and which merely happen to leave at the same minute.

HONEST LIMITATION
The graph is built from the zone adjacency the caller supplies, not from a
routed OpenStreetMap network. It therefore knows that two zones are connected;
it does not know by which road, how many lanes it has, or where the junction
backs up. That is a real limitation and the reason corridor load is reported as
a relative pressure figure rather than a vehicles-per-hour claim. Replacing this
with a routed network is a change to `build_graph` alone — everything
downstream reads through `corridor_pressure`.
"""

from __future__ import annotations

import networkx as nx


def build_graph(edges: list[tuple[str, str, float]]) -> nx.Graph:
    """
    Build the zone graph.

    `edges` is (zone_a, zone_b, capacity), where capacity is a relative number
    of vehicles the corridor comfortably carries per 15-minute slot.
    """
    graph = nx.Graph()
    for a, b, capacity in edges:
        graph.add_edge(a, b, capacity=max(capacity, 1.0))
    return graph


def corridor_pressure(
    graph: nx.Graph,
    trips: list[tuple[str, str, float]],
) -> dict[tuple[str, str], float]:
    """
    Spread each trip's weight across the shortest path between its zones and
    return load / capacity for every corridor it touches.

    A value above 1.0 means the corridor is carrying more than it comfortably
    holds in that slot — which is the thing worth moving people away from, and
    is invisible if you only look at city-wide totals.
    """
    load: dict[tuple[str, str], float] = {}

    for origin, destination, weight in trips:
        if origin not in graph or destination not in graph:
            # An unknown zone is not an error: a person may travel somewhere the
            # graph has no entry for. Their trip simply contributes no corridor
            # pressure rather than being silently attributed to the wrong road.
            continue
        try:
            path = nx.shortest_path(graph, origin, destination)
        except nx.NetworkXNoPath:
            continue

        for a, b in zip(path, path[1:]):
            key = (a, b) if a < b else (b, a)
            load[key] = load.get(key, 0.0) + weight

    return {
        key: total / graph[key[0]][key[1]]["capacity"]
        for key, total in load.items()
    }


def most_vulnerable(pressure: dict[tuple[str, str], float], limit: int = 5):
    """The corridors closest to saturation, worst first."""
    ranked = sorted(pressure.items(), key=lambda kv: kv[1], reverse=True)
    return [
        {"from_zone": a, "to_zone": b, "pressure": round(value, 3)}
        for (a, b), value in ranked[:limit]
    ]
