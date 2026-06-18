"""Local web interface for the drone inspection image sorter.

The server binds to localhost by default and uses only Python's standard
library. It is designed as a friendly wrapper around the same sorting engine
used by the command-line interface.
"""

from __future__ import annotations

from dataclasses import dataclass
from html import escape
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Literal, cast
from urllib.parse import parse_qs
import argparse
import threading
import webbrowser

from .sorter import ImageAction, SortOptions, SortResult, sort_images

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


@dataclass(frozen=True)
class WebSortRequest:
    """Validated form input submitted from the web UI."""

    input_dir: Path
    output_dir: Path
    action: ImageAction
    tolerance: float
    marker_policy: Literal["new-folder", "same-folder"]
    recursive: bool
    dry_run: bool
    folder_prefix: str
    skip_markers: bool

    def to_options(self) -> SortOptions:
        return SortOptions(
            input_dir=self.input_dir,
            output_dir=self.output_dir,
            action=self.action,
            tolerance=self.tolerance,
            marker_policy=self.marker_policy,
            recursive=self.recursive,
            dry_run=self.dry_run,
            folder_prefix=self.folder_prefix,
            skip_markers=self.skip_markers,
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pfi-sort-web",
        description="Start a local browser-based GUI for sorting drone inspection images.",
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"Host to bind. Default: {DEFAULT_HOST}.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port to bind. Default: {DEFAULT_PORT}.")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically open the browser.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    serve(host=args.host, port=args.port, open_browser=not args.no_browser)
    return 0


def serve(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, open_browser: bool = True) -> None:
    """Run the local web application until interrupted."""

    server = ThreadingHTTPServer((host, port), SorterRequestHandler)
    url = f"http://{host}:{server.server_port}/"
    if open_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    print(f"PFI image sorter web GUI running at {url}")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping web GUI.")
    finally:
        server.server_close()


class SorterRequestHandler(BaseHTTPRequestHandler):
    """HTTP handler serving the form and running sort jobs."""

    server_version = "PFISorterWeb/0.1"

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path != "/":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self._send_html(render_page())

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path != "/sort":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        try:
            form = self._read_form()
            request = parse_sort_request(form)
            result = sort_images(request.to_options())
            self._send_html(render_page(result=result, values=form, success=True))
        except Exception as exc:  # The UI should show validation/sort errors instead of crashing the server.
            self._send_html(render_page(error=str(exc), values=self._last_form_values()), status=HTTPStatus.BAD_REQUEST)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")

    def _read_form(self) -> dict[str, str]:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        parsed = parse_qs(body, keep_blank_values=True)
        values = {key: value[-1] for key, value in parsed.items()}
        self._form_values = values
        return values

    def _last_form_values(self) -> dict[str, str]:
        return getattr(self, "_form_values", {})

    def _send_html(self, html: str, status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def parse_sort_request(form: dict[str, str]) -> WebSortRequest:
    """Convert submitted form values into a validated sort request."""

    input_text = form.get("input_dir", "").strip()
    output_text = form.get("output_dir", "").strip()
    if not input_text:
        raise ValueError("Choose the folder that contains your drone images.")
    if not output_text:
        raise ValueError("Choose where the sorted folders should be created.")
    input_dir = Path(input_text).expanduser()
    output_dir = Path(output_text).expanduser()

    action = form.get("action", "copy")
    if action not in {"copy", "move"}:
        raise ValueError("Choose either copy or move.")

    marker_policy = form.get("marker_policy", "new-folder")
    if marker_policy not in {"new-folder", "same-folder"}:
        raise ValueError("Choose a valid marker placement option.")

    try:
        tolerance = float(form.get("tolerance", "2.0"))
    except ValueError as exc:
        raise ValueError("Pitch tolerance must be a number of degrees.") from exc

    folder_prefix = form.get("folder_prefix", "inspection_run").strip() or "inspection_run"
    return WebSortRequest(
        input_dir=input_dir,
        output_dir=output_dir,
        action=cast(ImageAction, action),
        tolerance=tolerance,
        marker_policy=cast(Literal["new-folder", "same-folder"], marker_policy),
        recursive=form.get("recursive") == "on",
        dry_run=form.get("dry_run") == "on",
        folder_prefix=folder_prefix,
        skip_markers=form.get("skip_markers") == "on",
    )


def render_page(
    result: SortResult | None = None,
    values: dict[str, str] | None = None,
    error: str | None = None,
    success: bool = False,
) -> str:
    """Render the single-page web UI."""

    values = values or {}
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PFI Drone Image Sorter</title>
  <style>
    :root {{ color-scheme: light; --bg: #f4f7fb; --card: #ffffff; --ink: #172033; --muted: #5d6980; --brand: #2357d9; --brand-dark: #183f9e; --ok: #0f7b45; --bad: #b42318; --line: #dce3ef; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: linear-gradient(135deg, #edf3ff 0%, var(--bg) 45%, #f8fbff 100%); color: var(--ink); }}
    header {{ padding: 48px 24px 28px; text-align: center; }}
    header p {{ color: var(--muted); font-size: 1.1rem; margin: 10px auto 0; max-width: 760px; }}
    h1 {{ margin: 0; font-size: clamp(2rem, 4vw, 3.4rem); letter-spacing: -0.04em; }}
    main {{ max-width: 1120px; margin: 0 auto 56px; padding: 0 24px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; }}
    .card {{ background: rgba(255,255,255,0.94); border: 1px solid var(--line); border-radius: 24px; box-shadow: 0 18px 50px rgba(30, 51, 89, 0.10); padding: 26px; }}
    .grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }}
    label {{ display: block; font-weight: 700; margin-bottom: 8px; }}
    .hint {{ color: var(--muted); font-size: 0.92rem; margin-top: 7px; }}
    input[type="text"], input[type="number"], select {{ width: 100%; border: 1px solid #cbd5e1; border-radius: 14px; padding: 13px 14px; font: inherit; background: white; }}
    input:focus, select:focus {{ outline: 3px solid rgba(35,87,217,0.18); border-color: var(--brand); }}
    .options {{ display: grid; gap: 12px; margin-top: 8px; }}
    .check {{ display: flex; align-items: flex-start; gap: 10px; background: #f8fbff; border: 1px solid var(--line); border-radius: 14px; padding: 13px; }}
    .check input {{ margin-top: 3px; }}
    button {{ border: 0; border-radius: 16px; background: var(--brand); color: white; cursor: pointer; font-size: 1.05rem; font-weight: 800; padding: 15px 22px; box-shadow: 0 12px 22px rgba(35,87,217,0.25); }}
    button:hover {{ background: var(--brand-dark); }}
    .actions {{ align-items: end; display: flex; gap: 14px; margin-top: 20px; }}
    .pill {{ display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 12px; font-weight: 800; }}
    .success {{ background: #ecfdf3; color: var(--ok); }}
    .error {{ background: #fff1f0; color: var(--bad); }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 0.94rem; }}
    th, td {{ border-bottom: 1px solid var(--line); padding: 11px 8px; text-align: left; vertical-align: top; }}
    th {{ color: var(--muted); font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; }}
    .path {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }}
    .steps {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }}
    .step {{ background: #f8fbff; border: 1px solid var(--line); border-radius: 18px; padding: 16px; }}
    .step strong {{ display: block; margin-bottom: 6px; }}
    @media (max-width: 760px) {{ .grid, .steps {{ grid-template-columns: 1fr; }} header {{ padding-top: 30px; }} }}
  </style>
</head>
<body>
  <header>
    <h1>Drone Image Sorter</h1>
    <p>Sort building-inspection photos into folders automatically. Enter your image folder, choose where the sorted folders should go, and click one button — no command line needed.</p>
  </header>
  <main>
    <section class="card">
      <div class="steps">
        <div class="step"><strong>1. Pick source</strong><span class="hint">The folder with the original drone images.</span></div>
        <div class="step"><strong>2. Pick destination</strong><span class="hint">Where inspection_run folders will be created.</span></div>
        <div class="step"><strong>3. Sort</strong><span class="hint">A new folder starts at each ±90° pitch marker.</span></div>
      </div>
    </section>

    <section class="card">
      <form method="post" action="/sort">
        <div class="grid">
          <div>
            <label for="input_dir">Drone image folder</label>
            <input id="input_dir" name="input_dir" type="text" required placeholder="/Users/alex/Inspection Photos" value="{_value(values, 'input_dir')}">
            <div class="hint">Paste or type the full folder path that contains JPG, TIFF, PNG, or DNG images.</div>
          </div>
          <div>
            <label for="output_dir">Sorted output folder</label>
            <input id="output_dir" name="output_dir" type="text" required placeholder="/Users/alex/Sorted Inspection" value="{_value(values, 'output_dir')}">
            <div class="hint">The app creates folders like inspection_run_001, inspection_run_002, and so on.</div>
          </div>
          <div>
            <label for="action">File handling</label>
            <select id="action" name="action">
              {_option('copy', 'Copy files (recommended)', values.get('action', 'copy'))}
              {_option('move', 'Move files', values.get('action', 'copy'))}
            </select>
          </div>
          <div>
            <label for="tolerance">Pitch tolerance in degrees</label>
            <input id="tolerance" name="tolerance" type="number" step="0.1" min="0" value="{_value(values, 'tolerance', '2.0')}">
            <div class="hint">Default is 2°, so 88° to 92° counts as pitched down.</div>
          </div>
          <div>
            <label for="folder_prefix">Folder name prefix</label>
            <input id="folder_prefix" name="folder_prefix" type="text" value="{_value(values, 'folder_prefix', 'inspection_run')}">
          </div>
          <div>
            <label for="marker_policy">Pitched-down marker placement</label>
            <select id="marker_policy" name="marker_policy">
              {_option('new-folder', 'Marker starts the new folder', values.get('marker_policy', 'new-folder'))}
              {_option('same-folder', 'Marker stays in current folder', values.get('marker_policy', 'new-folder'))}
            </select>
          </div>
        </div>
        <div class="options">
          <label class="check"><input type="checkbox" name="recursive" {_checked(values, 'recursive')}> <span><strong>Include subfolders</strong><br><span class="hint">Scan nested folders under the source folder.</span></span></label>
          <label class="check"><input type="checkbox" name="dry_run" {_checked(values, 'dry_run')}> <span><strong>Preview only</strong><br><span class="hint">Show what would happen without copying or moving any files.</span></span></label>
          <label class="check"><input type="checkbox" name="skip_markers" {_checked(values, 'skip_markers')}> <span><strong>Remove pitched-down marker photos from output</strong><br><span class="hint">They still split folders, but they will not be copied or moved into the sorted folders.</span></span></label>
        </div>
        <div class="actions">
          <button type="submit">Sort inspection images</button>
        </div>
      </form>
    </section>
    {_render_message(error, success)}
    {_render_result(result)}
  </main>
</body>
</html>"""


def _value(values: dict[str, str], key: str, default: str = "") -> str:
    return escape(values.get(key, default), quote=True)


def _option(value: str, label: str, selected: str) -> str:
    selected_attr = " selected" if value == selected else ""
    return f'<option value="{escape(value, quote=True)}"{selected_attr}>{escape(label)}</option>'


def _checked(values: dict[str, str], key: str) -> str:
    return "checked" if values.get(key) == "on" else ""


def _render_message(error: str | None, success: bool) -> str:
    if error:
        return f'<section class="card"><span class="pill error">Could not sort images</span><p>{escape(error)}</p></section>'
    if success:
        return '<section class="card"><span class="pill success">Sorting complete</span><p>Your image folder organization is ready.</p></section>'
    return ""


def _render_result(result: SortResult | None) -> str:
    if result is None:
        return ""
    if not result.images:
        if result.skipped:
            return (
                '<section class="card"><h2>Results</h2>'
                f'<p>Skipped {len(result.skipped)} pitched-down marker image(s). No output files were created.</p>'
                '</section>'
            )
        return '<section class="card"><h2>Results</h2><p>No supported images were found in the selected folder.</p></section>'

    rows = []
    for image in result.images:
        marker = "Starts folder" if image.starts_new_folder else ""
        pitch = "Unknown" if image.pitch is None else f"{image.pitch:.2f}°"
        rows.append(
            "<tr>"
            f"<td>{escape(marker)}</td>"
            f"<td>{escape(pitch)}</td>"
            f"<td class=\"path\">{escape(str(image.source))}</td>"
            f"<td class=\"path\">{escape(str(image.destination))}</td>"
            "</tr>"
        )

    skipped_note = ""
    if result.skipped:
        skipped_note = f" Skipped {len(result.skipped)} pitched-down marker image(s)."

    return (
        '<section class="card">'
        '<h2>Results</h2>'
        f'<p>Processed {len(result.images)} images into {result.folder_count} folders.{skipped_note}</p>'
        '<table><thead><tr><th>Marker</th><th>Pitch</th><th>Source</th><th>Destination</th></tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table>'
        '</section>'
    )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
