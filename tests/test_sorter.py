from pathlib import Path

from pfi_sorter.sorter import SortOptions, read_altitude, read_pitch_degrees, sort_images


def write_image(
    path: Path,
    pitch: float | None = None,
    date: str | None = None,
    altitude: float | None = None,
    absolute_altitude: float | None = None,
) -> None:
    metadata = []
    if pitch is not None:
        metadata.append(f'drone-dji:GimbalPitchDegree="{pitch}"')
    if date is not None:
        metadata.append(f'exif:DateTimeOriginal="{date}"')
    if absolute_altitude is not None:
        metadata.append(f'drone-dji:AbsoluteAltitude="{absolute_altitude}"')
    if altitude is not None:
        metadata.append(f'drone-dji:RelativeAltitude="{altitude}"')
    xmp = "<x:xmpmeta " + " ".join(metadata) + "></x:xmpmeta>"
    path.write_bytes(b"\xff\xd8\xff\xe1" + xmp.encode("utf-8") + b"\xff\xd9")


def test_read_pitch_degrees_from_dji_xmp(tmp_path):
    image = tmp_path / "roof.jpg"
    write_image(image, pitch=-89.8)

    assert read_pitch_degrees(image) == -89.8


def test_read_altitude_from_dji_xmp(tmp_path):
    image = tmp_path / "height.jpg"
    write_image(image, altitude=42.5)

    assert read_altitude(image) == 42.5


def test_sort_images_starts_new_folder_on_pitched_down_images(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    write_image(input_dir / "001.jpg", pitch=-10, date="2026:01:01 10:00:01")
    write_image(input_dir / "002.jpg", pitch=-90, date="2026:01:01 10:00:02")
    write_image(input_dir / "003.jpg", pitch=-20, date="2026:01:01 10:00:03")
    write_image(input_dir / "004.jpg", pitch=90, date="2026:01:01 10:00:04")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir))

    assert result.folder_count == 3
    assert (output_dir / "inspection_run_001" / "001.jpg").exists()
    assert (output_dir / "inspection_run_002" / "002.jpg").exists()
    assert (output_dir / "inspection_run_002" / "003.jpg").exists()
    assert (output_dir / "inspection_run_003" / "004.jpg").exists()


def test_consecutive_pitched_down_images_only_start_one_new_folder(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    write_image(input_dir / "001.jpg", pitch=-10, date="2026:01:01 10:00:01")
    write_image(input_dir / "002.jpg", pitch=-90, date="2026:01:01 10:00:02")
    write_image(input_dir / "003.jpg", pitch=-89, date="2026:01:01 10:00:03")
    write_image(input_dir / "004.jpg", pitch=-20, date="2026:01:01 10:00:04")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, infer_altitude_turns=True))

    assert result.folder_count == 2
    assert (output_dir / "inspection_run_001" / "001.jpg").exists()
    assert (output_dir / "inspection_run_002" / "002.jpg").exists()
    assert (output_dir / "inspection_run_002" / "003.jpg").exists()
    assert (output_dir / "inspection_run_002" / "004.jpg").exists()
    assert not (output_dir / "inspection_run_003").exists()


def test_sort_images_can_skip_pitched_down_marker_images(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    write_image(input_dir / "001.jpg", pitch=-10, date="2026:01:01 10:00:01")
    write_image(input_dir / "002.jpg", pitch=-90, date="2026:01:01 10:00:02")
    write_image(input_dir / "003.jpg", pitch=-20, date="2026:01:01 10:00:03")
    write_image(input_dir / "004.jpg", pitch=90, date="2026:01:01 10:00:04")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, skip_markers=True))

    assert result.folder_count == 2
    assert result.skipped == [input_dir / "002.jpg", input_dir / "004.jpg"]
    assert (output_dir / "inspection_run_001" / "001.jpg").exists()
    assert not (output_dir / "inspection_run_002" / "002.jpg").exists()
    assert (output_dir / "inspection_run_002" / "003.jpg").exists()
    assert not (output_dir / "inspection_run_003" / "004.jpg").exists()


def test_skip_pitched_down_markers_does_not_create_empty_numbered_folders(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    write_image(input_dir / "001.jpg", pitch=-90, date="2026:01:01 10:00:01")
    write_image(input_dir / "002.jpg", pitch=-89, date="2026:01:01 10:00:02")
    write_image(input_dir / "003.jpg", pitch=-20, date="2026:01:01 10:00:03")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, skip_markers=True))

    assert result.folder_count == 1
    assert result.skipped == [input_dir / "001.jpg", input_dir / "002.jpg"]
    assert (output_dir / "inspection_run_001" / "003.jpg").exists()
    assert not (output_dir / "inspection_run_002").exists()


def test_dry_run_does_not_create_output(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    write_image(input_dir / "001.jpg", pitch=-90)

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, dry_run=True))

    assert len(result.images) == 1
    assert not output_dir.exists()


def test_altitude_reversal_starts_folder_when_pitch_marker_is_missing(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    write_image(input_dir / "001.jpg", pitch=-10, altitude=10, date="2026:01:01 10:00:01")
    write_image(input_dir / "002.jpg", pitch=-10, altitude=20, date="2026:01:01 10:00:02")
    write_image(input_dir / "003.jpg", pitch=-10, altitude=30, date="2026:01:01 10:00:03")
    write_image(input_dir / "004.jpg", pitch=-10, altitude=28, date="2026:01:01 10:00:04")
    write_image(input_dir / "005.jpg", pitch=-10, altitude=18, date="2026:01:01 10:00:05")
    write_image(input_dir / "006.jpg", pitch=-10, altitude=8, date="2026:01:01 10:00:06")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, infer_altitude_turns=True))

    assert result.folder_count == 2
    assert result.images[0].start_reason == "first-image"
    assert result.images[3].starts_new_folder is True
    assert result.images[3].start_reason == "altitude-reversal"
    assert (output_dir / "inspection_run_001" / "003.jpg").exists()
    assert (output_dir / "inspection_run_002" / "004.jpg").exists()


def test_pitched_down_marker_is_primary_over_altitude_reversal(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    write_image(input_dir / "001.jpg", pitch=-10, altitude=10, date="2026:01:01 10:00:01")
    write_image(input_dir / "002.jpg", pitch=-10, altitude=20, date="2026:01:01 10:00:02")
    write_image(input_dir / "003.jpg", pitch=-90, altitude=18, date="2026:01:01 10:00:03")
    write_image(input_dir / "004.jpg", pitch=-10, altitude=8, date="2026:01:01 10:00:04")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, infer_altitude_turns=True))

    assert result.folder_count == 2
    assert result.images[2].start_reason == "pitched-down"
    assert result.images[3].starts_new_folder is False


def test_relative_altitude_is_preferred_over_absolute_altitude(tmp_path):
    image = tmp_path / "height.jpg"
    write_image(image, altitude=12.5, absolute_altitude=99.0)

    assert read_altitude(image) == 12.5


def test_altitude_inference_disabled_does_not_create_altitude_folders(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    for index, altitude in enumerate([10, 18, 26, 34, 28, 20, 12], start=1):
        write_image(input_dir / f"{index:03d}.jpg", pitch=-10, altitude=altitude, date=f"2026:01:01 10:00:{index:02d}")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir))

    assert result.folder_count == 1
    assert all(image.start_reason != "altitude-reversal" for image in result.images)


def test_climb_marker_horizontal_descent_does_not_duplicate_altitude_folder(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    data = [
        (-10, 10), (-10, 18), (-10, 26), (-90, 34),
        (-10, 34.2), (-10, 34.0), (-10, 28), (-10, 20), (-10, 12),
    ]
    for index, (pitch, altitude) in enumerate(data, start=1):
        write_image(input_dir / f"{index:03d}.jpg", pitch=pitch, altitude=altitude, date=f"2026:01:01 10:00:{index:02d}")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, infer_altitude_turns=True))

    assert result.folder_count == 2
    assert [image.start_reason for image in result.images if image.starts_new_folder] == ["pitched-down"]


def test_climb_slight_descent_correction_continues_without_folder(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    for index, altitude in enumerate([10, 18, 17.5, 26, 34], start=1):
        write_image(input_dir / f"{index:03d}.jpg", pitch=-10, altitude=altitude, date=f"2026:01:01 10:00:{index:02d}")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, infer_altitude_turns=True))

    assert result.folder_count == 1


def test_climb_horizontal_sustained_descent_without_marker_creates_one_inferred_folder(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    for index, altitude in enumerate([10, 18, 26, 34, 34.2, 34.1, 28, 20, 12], start=1):
        write_image(input_dir / f"{index:03d}.jpg", pitch=-10, altitude=altitude, date=f"2026:01:01 10:00:{index:02d}")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, infer_altitude_turns=True))

    assert result.folder_count == 2
    inferred = [image for image in result.images if image.start_reason == "altitude-reversal"]
    assert len(inferred) == 1
    assert inferred[0].source.name == "007.jpg"


def test_skipped_marker_preserves_pitched_down_reason_on_first_included_photo(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    data = [(-10, 10), (-10, 18), (-90, 26), (-10, 26.1), (-10, 20), (-10, 12)]
    for index, (pitch, altitude) in enumerate(data, start=1):
        write_image(input_dir / f"{index:03d}.jpg", pitch=pitch, altitude=altitude, date=f"2026:01:01 10:00:{index:02d}")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, skip_markers=True, infer_altitude_turns=True))

    assert result.folder_count == 2
    assert result.images[2].source.name == "004.jpg"
    assert result.images[2].starts_new_folder is True
    assert result.images[2].start_reason == "pitched-down"


def test_altitude_reversal_ignores_marker_policy_same_folder(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    for index, altitude in enumerate([10, 18, 26, 34, 28, 20, 12], start=1):
        write_image(input_dir / f"{index:03d}.jpg", pitch=-10, altitude=altitude, date=f"2026:01:01 10:00:{index:02d}")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, marker_policy="same-folder", infer_altitude_turns=True))

    inferred = [image for image in result.images if image.start_reason == "altitude-reversal"]
    assert len(inferred) == 1
    assert inferred[0].source.name == "005.jpg"
    assert inferred[0].destination.parent.name == "inspection_run_002"


def test_altitude_analysis_uses_capture_time_before_filename_order(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    chronological = [
        ("z.jpg", 10), ("y.jpg", 18), ("x.jpg", 26), ("w.jpg", 34),
        ("a.jpg", 28), ("b.jpg", 20), ("c.jpg", 12),
    ]
    for index, (name, altitude) in enumerate(chronological, start=1):
        write_image(input_dir / name, pitch=-10, altitude=altitude, date=f"2026:01:01 10:00:{index:02d}")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, infer_altitude_turns=True))

    inferred = [image for image in result.images if image.start_reason == "altitude-reversal"]
    assert len(inferred) == 1
    assert inferred[0].source.name == "a.jpg"


def test_skipped_leading_marker_preserves_pitched_down_reason_on_first_included_photo(tmp_path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    write_image(input_dir / "001.jpg", pitch=-90, altitude=30, date="2026:01:01 10:00:01")
    write_image(input_dir / "002.jpg", pitch=-10, altitude=30.1, date="2026:01:01 10:00:02")
    write_image(input_dir / "003.jpg", pitch=-10, altitude=24, date="2026:01:01 10:00:03")

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir, skip_markers=True, infer_altitude_turns=True))

    assert result.folder_count == 1
    assert result.images[0].source.name == "002.jpg"
    assert result.images[0].start_reason == "pitched-down"
