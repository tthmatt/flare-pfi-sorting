from pathlib import Path

import pytest

from pfi_sorter.web import parse_sort_request, render_page


def test_parse_sort_request_converts_form_values():
    request = parse_sort_request(
        {
            "input_dir": "~/drone-images",
            "output_dir": "~/sorted-images",
            "action": "move",
            "tolerance": "1.5",
            "marker_policy": "same-folder",
            "recursive": "on",
            "dry_run": "on",
            "folder_prefix": "roof",
            "skip_markers": "on",
            "infer_altitude_turns": "on",
            "altitude_tolerance": "0.8",
        }
    )

    assert request.input_dir == Path("~/drone-images").expanduser()
    assert request.output_dir == Path("~/sorted-images").expanduser()
    assert request.action == "move"
    assert request.tolerance == 1.5
    assert request.marker_policy == "same-folder"
    assert request.recursive is True
    assert request.dry_run is True
    assert request.folder_prefix == "roof"
    assert request.skip_markers is True
    assert request.infer_altitude_turns is True
    assert request.altitude_tolerance == 0.8


def test_parse_sort_request_requires_paths():
    with pytest.raises(ValueError, match="drone images"):
        parse_sort_request({"input_dir": "", "output_dir": "/tmp/out"})


def test_render_page_contains_no_command_line_workflow():
    html = render_page()

    assert "Drone Image Sorter" in html
    assert "Sort inspection images" in html
    assert "no command line needed" in html
    assert "Preview only" in html
    assert "skip_markers" in html
    assert "infer_altitude_turns" in html


def test_react_preview_includes_every_group_file():
    source = Path("web-app/src/App.jsx").read_text()

    assert "group.files.map((item) => ({ ...item, groupName: group.name }))" in source
    assert "group.files.slice(0, 6)" not in source
    assert ")).slice(0, 18)" not in source


def test_react_app_can_skip_marker_images_from_output():
    source = Path("web-app/src/App.jsx").read_text()

    assert "skipMarkers: false" in source
    assert "checked={settings.skipMarkers}" in source
    assert "settings.skipMarkers && isMarker" in source
    assert "const pitchStartsFolder = pitchStarts[index]" in source
    assert "altitude-reversal" in source
    assert "skippedMarkerCount += 1" in source
    assert "Skip pitched-down marker photos in output" in source


def test_react_app_removes_csv_report_by_default_with_option_to_keep_it():
    source = Path("web-app/src/App.jsx").read_text()

    assert "removeCsvReport: true" in source
    assert "checked={settings.removeCsvReport}" in source
    assert "Remove CSV report from sorted ZIP" in source


def test_react_app_records_folder_start_reasons_and_altitude_fallback():
    source = Path("web-app/src/App.jsx").read_text()

    assert "RELATIVE_ALTITUDE_PATTERNS" in source
    assert "ALTITUDE_FALLBACK_PATTERNS" in source
    assert "inferAltitudeTurns: false" in source
    assert "altitudeDirection" in source
    assert "startReason" in source
    assert "altitude-reversal" in source
    assert "makeZip(groups, settings.keepFolderPaths, !settings.removeCsvReport)" in source
    assert "if (includeCsvReport)" in source


def test_react_marker_pitch_accepts_positive_and_negative_90():
    source = Path("web-app/src/App.jsx").read_text()

    assert "Math.abs(Math.abs(pitch) - Math.abs(markerPitch)) <= tolerance" in source


def test_react_altitude_inference_requires_sustained_reversal():
    source = Path("web-app/src/App.jsx").read_text()

    assert "runSteps >= settings.altitudeMinSteps" in source
    assert "previousRunSpan >= settings.altitudeMinSpan" in source
    assert "candidateSteps >= settings.altitudeMinSteps" in source
    assert "candidateSpan >= settings.altitudeMinSpan" in source
    assert "settings.inferAltitudeTurns ? 'capture' : settings.sortBy" in source
