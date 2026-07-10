from pathlib import Path

from pfi_sorter.sorter import SortOptions, read_pitch_degrees, sort_images


def write_image(path: Path, pitch: float | None = None, date: str | None = None) -> None:
    metadata = []
    if pitch is not None:
        metadata.append(f'drone-dji:GimbalPitchDegree="{pitch}"')
    if date is not None:
        metadata.append(f'exif:DateTimeOriginal="{date}"')
    xmp = "<x:xmpmeta " + " ".join(metadata) + "></x:xmpmeta>"
    path.write_bytes(b"\xff\xd8\xff\xe1" + xmp.encode("utf-8") + b"\xff\xd9")


def test_read_pitch_degrees_from_dji_xmp(tmp_path):
    image = tmp_path / "roof.jpg"
    write_image(image, pitch=-89.8)

    assert read_pitch_degrees(image) == -89.8


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

    result = sort_images(SortOptions(input_dir=input_dir, output_dir=output_dir))

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
