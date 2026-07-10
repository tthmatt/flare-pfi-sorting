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

ALTITUDE_PATTERNS = [
    re.compile(rb"(?:drone-dji:)?(?:AbsoluteAltitude|RelativeAltitude)\s*=\s*['\"](?P<value>[-+]?\d+(?:\.\d+)?)['\"]", re.I),
    re.compile(rb"(?:exif:)?GPSAltitude\s*=\s*['\"](?P<value>[-+]?\d+(?:\.\d+)?)['\"]", re.I),
    re.compile(rb"<(?:[^:>]+:)?(?:AbsoluteAltitude|RelativeAltitude|GPSAltitude)>\s*(?P<value>[-+]?\d+(?:\.\d+)?)\s*</", re.I),
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
    altitude_tolerance: float = 1.0


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
    for pattern in ALTITUDE_PATTERNS:
        match = pattern.search(data)
        if not match:
            continue
        try:
            return float(match.group("value"))
        except ValueError:
            return None
    return None


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
    if not options.input_dir.exists() or not options.input_dir.is_dir():
        raise FileNotFoundError(f"Input directory does not exist: {options.input_dir}")

    result = SortResult()
    images = discover_images(options.input_dir, options.recursive)
    run_number = 0
    pending_new_folder = False
    previous_was_marker = False
    previous_altitude: float | None = None
    previous_altitude_direction = 0

    for source in images:
        pitch = read_pitch_degrees(source)
        altitude = read_altitude(source)
        is_marker = _is_downward_pitch(pitch, options.tolerance)
        altitude_direction = _altitude_direction(previous_altitude, altitude, options.altitude_tolerance)
        altitude_reversal = (
            not is_marker
            and not previous_was_marker
            and altitude_direction != 0
            and previous_altitude_direction != 0
            and altitude_direction != previous_altitude_direction
        )
        starts_new_folder = (is_marker and not previous_was_marker) or altitude_reversal
        start_reason: FolderStartReason | None = None
        if starts_new_folder:
            start_reason = "pitched-down" if is_marker else "altitude-reversal"

        if is_marker and options.skip_markers:
            result.skipped.append(source)
            if starts_new_folder and result.images:
                pending_new_folder = True
            previous_was_marker = True
            continue

        if pending_new_folder:
            run_number += 1
            pending_new_folder = False
        elif run_number == 0 or (starts_new_folder and options.marker_policy == "new-folder"):
            run_number += 1
        elif starts_new_folder and options.marker_policy == "same-folder":
            # The marker closes the current folder; the next image starts a new one.
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

        if starts_new_folder and options.marker_policy == "same-folder":
            run_number += 1

        previous_was_marker = is_marker
        if altitude_direction != 0:
            previous_altitude_direction = altitude_direction
        if altitude is not None:
            previous_altitude = altitude

    return result


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
