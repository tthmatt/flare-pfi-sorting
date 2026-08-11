"""Conservative, read-only GPS turn proposals.

The functions in this module never alter grouping decisions.  Coordinates are
used only for distance calculations and are deliberately absent from results.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt
from statistics import median
from typing import Any, Mapping, Sequence


DEFAULT_GPS_OPTIONS = {
    "gpsWindowSize": 3,
    "gpsMinDisplacementMeters": 4.0,
    "gpsMaxClusterRadiusMeters": 3.0,
    "gpsMinSignalRatio": 2.0,
    "gpsMaxGapSeconds": 30.0,
}


def _get(record: Any, key: str) -> Any:
    if isinstance(record, Mapping):
        return record.get(key)
    return getattr(record, key, None)


def _time_ms(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.timestamp() * 1000
    if isinstance(value, (int, float)):
        return float(value)
    return None


def haversine_meters(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Return great-circle distance in metres."""
    lat1, lon1, lat2, lon2 = map(radians, (*a, *b))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    value = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * 6_371_000 * asin(sqrt(value))


def _cluster(points: list[tuple[float, float]]) -> tuple[tuple[float, float], float]:
    centre = (median(point[0] for point in points), median(point[1] for point in points))
    return centre, max(haversine_meters(centre, point) for point in points)


def _runs(records: Sequence[Any], tolerance: float) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    current = None
    for index in range(1, len(records)):
        previous, item = records[index - 1], records[index]
        source = _get(item, "altitudeSource") or _get(item, "altitude_source")
        previous_source = _get(previous, "altitudeSource") or _get(previous, "altitude_source")
        a, b = _get(previous, "altitude"), _get(item, "altitude")
        direction = 0 if a is None or b is None or source not in {"relative", "absolute"} or source != previous_source else (1 if b - a > tolerance else -1 if a - b > tolerance else 0)
        if direction and current and current["direction"] == direction and current["source"] == source and current["end"] == index - 1:
            current["end"] = index
            current["steps"] += 1
        elif direction:
            current = {"start": index - 1, "end": index, "steps": 1, "direction": direction, "source": source}
            runs.append(current)
        else:
            current = None
    return runs


def analyze_gps_turns(records: Sequence[Any], settings: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Return proposals and aggregate rejection reasons for ordered records."""
    options = dict(DEFAULT_GPS_OPTIONS)
    options.update(settings or {})
    tolerance = float(options.get("altitudeTolerance", 0.75))
    min_steps = int(options.get("altitudeMinSteps", 2))
    min_span = float(options.get("altitudeMinSpan", 5.0))
    suppression = int(options.get("altitudeMarkerSuppression", 2))
    marker_pitch = float(options.get("markerPitch", -90))
    pitch_tolerance = float(options.get("tolerance", 2.0))
    reasons: Counter[str] = Counter()
    proposals: list[dict[str, Any]] = []
    runs = _runs(records, tolerance)
    sustained = [run for run in runs if run["steps"] >= min_steps and abs(_get(records[run["end"]], "altitude") - _get(records[run["start"]], "altitude")) >= min_span]
    if len(sustained) < 2:
        reasons["insufficient-altitude"] += 1
    for prior, nxt in zip(sustained, sustained[1:]):
        if prior["direction"] == nxt["direction"]:
            reasons["same-direction"] += 1
            continue
        if prior["source"] != nxt["source"] or prior["end"] >= nxt["start"]:
            reasons["inconsistent-altitude-source"] += 1
            continue
        boundary = nxt["start"]
        lo, hi = max(0, boundary - suppression), min(len(records), boundary + suppression + 1)
        if any((pitch := _get(record, "pitch")) is not None and abs(abs(pitch) - abs(marker_pitch)) <= pitch_tolerance for record in records[lo:hi]):
            reasons["nearby-pitched-down-marker"] += 1
            continue
        window = int(options["gpsWindowSize"])
        prior_indices = [i for i in range(prior["start"], prior["end"] + 1) if _get(records[i], "latitude") is not None and _get(records[i], "longitude") is not None][-window:]
        next_indices = [i for i in range(nxt["start"], nxt["end"] + 1) if _get(records[i], "latitude") is not None and _get(records[i], "longitude") is not None][:window]
        if len(prior_indices) < window or len(next_indices) < window:
            reasons["insufficient-gps"] += 1
            continue
        evidence_indices = list(range(prior["start"], nxt["end"] + 1))
        times = [_time_ms(_get(records[i], "captureTime") or _get(records[i], "capture_datetime") or _get(records[i], "captureDate")) for i in evidence_indices]
        if any(value is None for value in times):
            reasons["missing-time"] += 1
            continue
        gaps = [(times[i] - times[i - 1]) / 1000 for i in range(1, len(times))]
        if any(gap <= 0 for gap in gaps):
            reasons["non-increasing-time"] += 1
            continue
        maximum_gap = max(gaps, default=0.0)
        if maximum_gap > float(options["gpsMaxGapSeconds"]):
            reasons["excessive-time-gap"] += 1
            continue
        prior_points = [(_get(records[i], "latitude"), _get(records[i], "longitude")) for i in prior_indices]
        next_points = [(_get(records[i], "latitude"), _get(records[i], "longitude")) for i in next_indices]
        prior_centre, prior_radius = _cluster(prior_points)
        next_centre, next_radius = _cluster(next_points)
        if max(prior_radius, next_radius) > float(options["gpsMaxClusterRadiusMeters"]):
            reasons["noisy-gps-cluster"] += 1
            continue
        displacement = haversine_meters(prior_centre, next_centre)
        threshold = max(float(options["gpsMinDisplacementMeters"]), float(options["gpsMinSignalRatio"]) * max(prior_radius, next_radius, 0.5))
        if displacement < threshold:
            reasons["insufficient-displacement"] += 1
            continue
        filename = lambda i: str(_get(records[i], "fileName") or _get(records[i], "filename") or getattr(_get(records[i], "file"), "name", ""))
        detected = max(nxt["end"], next_indices[-1])
        proposals.append({
            "boundaryIndex": boundary, "detectedAtIndex": detected, "boundaryFile": filename(boundary),
            "reason": "gps-horizontal-turn", "status": "proposed", "evidence": {
                "priorDirection": "up" if prior["direction"] > 0 else "down", "nextDirection": "up" if nxt["direction"] > 0 else "down",
                "priorAltitudeSpanM": abs(_get(records[prior["end"]], "altitude") - _get(records[prior["start"]], "altitude")),
                "nextAltitudeSpanM": abs(_get(records[nxt["end"]], "altitude") - _get(records[nxt["start"]], "altitude")),
                "gpsDisplacementM": displacement, "priorClusterRadiusM": prior_radius, "nextClusterRadiusM": next_radius,
                "priorGpsSamples": len(prior_indices), "nextGpsSamples": len(next_indices), "maximumTimeGapSeconds": maximum_gap,
            }
        })
    return {"proposals": proposals, "reasonCounts": dict(reasons)}


def propose_gps_turns(records: Sequence[Any], settings: Mapping[str, Any] | None = None) -> list[dict[str, Any]]:
    """Return JSON-compatible GPS proposals without mutating ``records``."""
    return analyze_gps_turns(records, settings)["proposals"]
