"""Core drone image sorting logic.

The sorter is intentionally dependency-free so it can run on inspection laptops
without first installing image-processing packages. It reads common DJI/Autel
XMP pitch fields embedded in JPEG/PNG/TIFF files and falls back to conservative
regular-expression searches over the first bytes of the image when metadata is
stored in a vendor-specific block.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import re
import shutil
from typing import Literal

ImageAction = Literal["copy", "move"]
FolderStartReason = Literal["first-image", "pitched-down", "altitude-reversal"]

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".png",
    ".dng",
}

PITCH_PATTERNS = [
    # DJI and many other drone vendors write these values in XMP attributes.
    re.compile(rb"(?:drone-dji:)?GimbalPitchDegree\s*=\s*['\"](?P<value>[-+]?\d+(?:\.\d+)?)['\"]", re.I),
    re.compile(rb"(?:drone-dji:)?CameraPitchDegree\s*=\s*['\"](?P<value>[-+]?\d+(?:\.\d+)?)['\"]", re.I),
    re.compile(rb"(?:Camera|Gimbal)Pitch\s*=\s*['\"](?P<value>[-+]?\d+(?:\.\d+)?)['\"]", re.I),
    # Some tools serialize metadata as XML elements instead of attributes.
    re.compile(rb"<(?:[^:>]+:)?(?:GimbalPitchDegree|CameraPitchDegree|CameraPitch)>\s*(?P<value>[-+]?\d+(?:\.\d+)?)\s*</", re.I),
]

RELATIVE_ALTITUDE_PATTERNS = [
    re.compile(rb"(?:drone-dji:)?RelativeAltitude\s*=\s*['\"](?P<value>[-+]?\d+(?:\.\d+)?)['\"]", re.I),
    re.compile(rb"<(?:[^:>]+:)?RelativeAltitude>\s*(?P<value>[-+]?\d+(?:\.\d+)?)\s*</", re.I),
]

ALTITUDE_FALLBACK_PATTERNS = [
    re.compile(rb"(?:drone-dji:)?AbsoluteAltitude\s*=\s*['\"](?P<value>[-+]?\d+(?:\.\d+)?)['\"]", re.I),
    re.compile(rb"<(?:[^:>]+:)?AbsoluteAltitude>\s*(?P<value>[-+]?\d+(?:\.\d+)?)\s*</", re.I),
    re.compile(rb"(?:exif:)?GPSAltitude\s*=\s*['\"](?P<value>[-+]?\d+(?:\.\d+)?)['\"]", re.I),
    re.compile(rb"<(?:[^:>]+:)?GPSAltitude>\s*(?P<value>[-+]?\d+(?:\.\d+)?)\s*</", re.I),
]

DATETIME_PATTERNS = [
    re.compile(rb"(?:exif:)?DateTimeOriginal\s*=\s*['\"](?P<value>[^'\"]+)['\"]", re.I),
    re.compile(rb"<(?:[^:>]+:)?DateTimeOriginal>\s*(?P<value>[^<]+)\s*</", re.I),
    re.compile(rb"(?:xmp:)?CreateDate\s*=\s*['\"](?P<value>[^'\"]+)['\"]", re.I),
]


@dataclass(frozen=True)
class SortOptions:
    """Options controlling how images are grouped and written."""

    input_dir: Path
    output_dir: Path
    action: ImageAction = "copy"
    tolerance: float = 2.0
    marker_policy: Literal["new-folder", "same-folder"] = "new-folder"
    recursive: bool = False
    dry_run: bool = False
    folder_prefix: str = "inspection_run"
    skip_markers: bool = False
    infer_altitude_turns: bool = False
    altitude_tolerance: float = 0.75
    altitude_min_steps: int = 2
    altitude_min_span: float = 5.0
    altitude_marker_suppression: int = 2


@dataclass
class SortedImage:
    """A single image placement decision."""

    source: Path
    destination: Path
    pitch: float | None
    starts_new_folder: bool
    altitude: float | None = None
    start_reason: FolderStartReason | None = None


@dataclass
class SortResult:
    """Summary of a completed sort operation."""

    images: list[SortedImage] = field(default_factory=list)
    skipped: list[Path] = field(default_factory=list)

    @property
    def folder_count(self) -> int:
        return len({image.destination.parent for image in self.images})


def discover_images(input_dir: Path, recursive: bool = False) -> list[Path]:
    """Return supported images sorted by capture time when available."""

    globber = input_dir.rglob("*") if recursive else input_dir.iterdir()
    images = [path for path in globber if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS]
    return sorted(images, key=lambda path: (read_capture_datetime(path) or datetime.max, path.name.lower()))


def read_pitch_degrees(path: Path) -> float | None:
    """Extract camera/gimbal pitch in degrees from common embedded metadata."""

    data = _read_metadata_window(path)
    for pattern in PITCH_PATTERNS:
        match = pattern.search(data)
        if not match:
            continue
        try:
            return float(match.group("value"))
        except ValueError:
            return None
    return None


def read_altitude(path: Path) -> float | None:
    """Extract drone altitude/height from common embedded metadata."""

    data = _read_metadata_window(path)
    relative = _first_float_match(data, RELATIVE_ALTITUDE_PATTERNS)
    if relative is not None:
        return relative
    return _first_float_match(data, ALTITUDE_FALLBACK_PATTERNS)


def read_capture_datetime(path: Path) -> datetime | None:
    """Extract a capture timestamp from XMP-style metadata when present."""

    data = _read_metadata_window(path)
    for pattern in DATETIME_PATTERNS:
        match = pattern.search(data)
        if not match:
            continue
        raw = match.group("value").decode("utf-8", errors="ignore").strip()
        parsed = _parse_datetime(raw)
        if parsed is not None:
            return parsed
    return None


def sort_images(options: SortOptions) -> SortResult:
    """Sort images into inspection run folders.

    A new run starts each time an image pitch is detected as approximately
    straight down (absolute pitch near 90 degrees). With the default
    ``marker_policy``, that marker image is placed in the newly-created run.
    Set ``skip_markers`` to keep using pitched-down images as split markers
    without writing those marker images to the output folders.
    """

    if options.action not in {"copy", "move"}:
        raise ValueError("action must be 'copy' or 'move'")
    if options.tolerance < 0:
        raise ValueError("tolerance must be zero or greater")
    if options.altitude_tolerance < 0:
        raise ValueError("altitude_tolerance must be zero or greater")
    if options.altitude_min_steps < 1:
        raise ValueError("altitude_min_steps must be at least one")
    if options.altitude_min_span < 0:
        raise ValueError("altitude_min_span must be zero or greater")
    if options.altitude_marker_suppression < 0:
        raise ValueError("altitude_marker_suppression must be zero or greater")
    if not options.input_dir.exists() or not options.input_dir.is_dir():
        raise FileNotFoundError(f"Input directory does not exist: {options.input_dir}")

    result = SortResult()
    images = discover_images(options.input_dir, options.recursive)
    pitches = [read_pitch_degrees(source) for source in images]
    altitudes = [read_altitude(source) for source in images]
    pitch_starts = [_is_downward_pitch(pitch, options.tolerance) for pitch in pitches]
    for index in range(1, len(pitch_starts)):
        if pitch_starts[index] and pitch_starts[index - 1]:
            pitch_starts[index] = False
    altitude_starts = (
        _infer_altitude_reversal_starts(altitudes, pitch_starts, options)
        if options.infer_altitude_turns
        else set()
    )

    run_number = 0
    pending_new_folder = False
    pending_start_reason: FolderStartReason | None = None

    for index, source in enumerate(images):
        pitch = pitches[index]
        altitude = altitudes[index]
        pitch_starts_folder = pitch_starts[index]
        altitude_starts_folder = index in altitude_starts
        starts_new_folder = pitch_starts_folder or altitude_starts_folder
        start_reason: FolderStartReason | None = None
        if pitch_starts_folder:
            start_reason = "pitched-down"
        elif altitude_starts_folder:
            start_reason = "altitude-reversal"

        is_marker = _is_downward_pitch(pitch, options.tolerance)
        if is_marker and options.skip_markers:
            result.skipped.append(source)
            if pitch_starts_folder:
                pending_new_folder = True
                pending_start_reason = "pitched-down"
            continue

        if pending_new_folder:
            run_number += 1
            pending_new_folder = False
            start_reason = pending_start_reason
            starts_new_folder = True
            pending_start_reason = None
        elif run_number == 0 or altitude_starts_folder or (pitch_starts_folder and options.marker_policy == "new-folder"):
            run_number += 1
        elif pitch_starts_folder and options.marker_policy == "same-folder":
            # The pitched-down marker closes the current folder; the next image starts a new one.
            pass

        if run_number == 0:
            run_number = 1

        destination_folder = options.output_dir / f"{options.folder_prefix}_{run_number:03d}"
        destination = _unique_destination(destination_folder / source.name, options.dry_run)
        if start_reason is None and len(result.images) == 0:
            start_reason = "first-image"
        result.images.append(SortedImage(source, destination, pitch, starts_new_folder, altitude, start_reason))

        if not options.dry_run:
            destination_folder.mkdir(parents=True, exist_ok=True)
            if options.action == "copy":
                shutil.copy2(source, destination)
            else:
                shutil.move(str(source), str(destination))

        if pitch_starts_folder and options.marker_policy == "same-folder":
            run_number += 1

    return result


def _infer_altitude_reversal_starts(
    altitudes: list[float | None],
    pitch_starts: list[bool],
    options: SortOptions,
) -> set[int]:
    starts: set[int] = set()
    previous_altitude: float | None = None
    run_direction = 0
    run_steps = 0
    run_start_altitude: float | None = None
    candidate_direction = 0
    candidate_steps = 0
    candidate_start_index: int | None = None
    candidate_start_altitude: float | None = None
    suppress_normals = 0

    for index, altitude in enumerate(altitudes):
        if pitch_starts[index]:
            previous_altitude = altitude
            run_direction = 0
            run_steps = 0
            run_start_altitude = None
            candidate_direction = 0
            candidate_steps = 0
            candidate_start_index = None
            candidate_start_altitude = None
            suppress_normals = options.altitude_marker_suppression
            continue

        if suppress_normals > 0:
            if altitude is not None:
                previous_altitude = altitude
            suppress_normals -= 1
            continue

        direction = _altitude_direction(previous_altitude, altitude, options.altitude_tolerance)
        if altitude is None:
            continue
        if previous_altitude is None or direction == 0:
            previous_altitude = altitude
            continue

        if run_direction == 0:
            run_direction = direction
            run_steps = 1
            run_start_altitude = previous_altitude
        elif direction == run_direction:
            run_steps += 1
            candidate_direction = 0
            candidate_steps = 0
            candidate_start_index = None
            candidate_start_altitude = None
        else:
            previous_run_span = 0.0 if run_start_altitude is None else abs(previous_altitude - run_start_altitude)
            previous_run_is_sustained = (
                run_steps >= options.altitude_min_steps
                and previous_run_span >= options.altitude_min_span
            )
            if not previous_run_is_sustained:
                run_direction = direction
                run_steps = 1
                run_start_altitude = previous_altitude
            elif candidate_direction != direction:
                candidate_direction = direction
                candidate_steps = 1
                candidate_start_index = index
                candidate_start_altitude = previous_altitude
            else:
                candidate_steps += 1

            if candidate_direction == direction and candidate_start_altitude is not None:
                candidate_span = abs(altitude - candidate_start_altitude)
                if candidate_steps >= options.altitude_min_steps and candidate_span >= options.altitude_min_span:
                    if candidate_start_index is not None:
                        starts.add(candidate_start_index)
                    run_direction = candidate_direction
                    run_steps = candidate_steps
                    run_start_altitude = candidate_start_altitude
                    candidate_direction = 0
                    candidate_steps = 0
                    candidate_start_index = None
                    candidate_start_altitude = None

        previous_altitude = altitude

    return starts


def _altitude_direction(previous: float | None, current: float | None, tolerance: float) -> int:
    if previous is None or current is None:
        return 0
    delta = current - previous
    if abs(delta) <= tolerance:
        return 0
    return 1 if delta > 0 else -1


def _is_downward_pitch(pitch: float | None, tolerance: float) -> bool:
    if pitch is None:
        return False
    return abs(abs(pitch) - 90.0) <= tolerance


def _read_metadata_window(path: Path, limit: int = 512_000) -> bytes:
    with path.open("rb") as handle:
        return handle.read(limit)


def _first_float_match(data: bytes, patterns: list[re.Pattern[bytes]]) -> float | None:
    for pattern in patterns:
        match = pattern.search(data)
        if not match:
            continue
        try:
            return float(match.group("value"))
        except ValueError:
            return None
    return None


def _parse_datetime(raw: str) -> datetime | None:
    candidates = [
        raw,
        raw.replace("Z", "+00:00"),
        raw.replace(":", "-", 2),  # EXIF uses YYYY:MM:DD HH:MM:SS.
    ]
    formats = [
        "%Y:%m:%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%z",
    ]
    for candidate in candidates:
        try:
            return datetime.fromisoformat(candidate)
        except ValueError:
            pass
        for fmt in formats:
            try:
                return datetime.strptime(candidate, fmt)
            except ValueError:
                continue
    return None


def _unique_destination(destination: Path, dry_run: bool) -> Path:
    if dry_run or not destination.exists():
        return destination

    stem = destination.stem
    suffix = destination.suffix
    parent = destination.parent
    counter = 2
    while True:
        candidate = parent / f"{stem}_{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1
