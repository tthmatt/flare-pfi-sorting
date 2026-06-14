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


def test_parse_sort_request_requires_paths():
    with pytest.raises(ValueError, match="drone images"):
        parse_sort_request({"input_dir": "", "output_dir": "/tmp/out"})


def test_render_page_contains_no_command_line_workflow():
    html = render_page()

    assert "Drone Image Sorter" in html
    assert "Sort inspection images" in html
    assert "no command line needed" in html
    assert "Preview only" in html


def test_react_preview_includes_every_group_file():
    source = Path("web-app/src/App.jsx").read_text()

    assert "group.files.map((item) => ({ ...item, groupName: group.name }))" in source
    assert "group.files.slice(0, 6)" not in source
    assert ")).slice(0, 18)" not in source
