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
    assert "const startsNewFolder = isMarker && !previousWasMarker" in source
    assert "skippedMarkerCount += 1" in source
    assert "Skip pitched-down marker photos in output" in source


def test_react_app_removes_csv_report_by_default_with_option_to_keep_it():
    source = Path("web-app/src/App.jsx").read_text()

    assert "removeCsvReport: true" in source
    assert "checked={settings.removeCsvReport}" in source
    assert "Remove CSV report from sorted ZIP" in source
    assert "makeZip(groups, settings.keepFolderPaths, !settings.removeCsvReport)" in source
    assert "if (includeCsvReport)" in source


def test_react_app_displays_version_and_changelog():
    source = Path("web-app/src/App.jsx").read_text()

    assert "import packageInfo from '../package.json'" in source
    assert "const APP_VERSION = packageInfo.version" in source
    assert "CHANGELOG_ITEMS" in source
    assert "Version v{APP_VERSION}" in source
    assert "Changelog" in source
