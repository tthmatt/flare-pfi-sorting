"""Command-line interface for the drone inspection image sorter."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

from .sorter import SortOptions, sort_images


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pfi-sort",
        description=(
            "Sort drone building-inspection images into new folders whenever "
            "embedded EXIF/XMP camera pitch is detected as straight down."
        ),
    )
    parser.add_argument("input_dir", type=Path, help="Directory containing drone images.")
    parser.add_argument("output_dir", type=Path, help="Directory where sorted run folders will be created.")
    parser.add_argument(
        "--move",
        action="store_true",
        help="Move files instead of copying them. The default is to copy.",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=2.0,
        help="Allowed degrees away from 90 for pitched-down detection. Default: 2.0.",
    )
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Scan input_dir recursively for supported image extensions.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen without copying or moving files.",
    )
    parser.add_argument(
        "--folder-prefix",
        default="inspection_run",
        help="Prefix for created folders. Default: inspection_run.",
    )
    parser.add_argument(
        "--marker-policy",
        choices=["new-folder", "same-folder"],
        default="new-folder",
        help=(
            "Place the pitched-down marker image in the new folder (default) "
            "or keep it in the current folder and start the next file in a new folder."
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    options = SortOptions(
        input_dir=args.input_dir,
        output_dir=args.output_dir,
        action="move" if args.move else "copy",
        tolerance=args.tolerance,
        marker_policy=args.marker_policy,
        recursive=args.recursive,
        dry_run=args.dry_run,
        folder_prefix=args.folder_prefix,
    )

    try:
        result = sort_images(options)
    except (FileNotFoundError, ValueError) as exc:
        parser.error(str(exc))
        return 2

    if not result.images:
        print("No supported images found.")
        return 0

    for image in result.images:
        marker = "START" if image.starts_new_folder else "     "
        pitch = "unknown" if image.pitch is None else f"{image.pitch:.2f}°"
        print(f"{marker} pitch={pitch} {image.source} -> {image.destination}")

    action = "Would process" if args.dry_run else "Processed"
    print(f"{action} {len(result.images)} images into {result.folder_count} folders.")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
