import { useEffect, useMemo, useRef, useState } from 'react';
import { canPreviewInBrowser, getDisplayPath, getFileName } from './files.js';
import { downloadBlob } from './reports.js';
import { buildReviewQueue, changeMarker, mergeGroup, moveBoundary } from './workspace.js';
import { Icon } from './ui.jsx';

const number = (value, unit) => Number.isFinite(value) ? `${value.toFixed(1)}${unit}` : 'Unavailable';

export function SessionPanel({ workspace, disabled, onImported, onError }) {
  const input = useRef(null);
  return <section className="panel session-panel" aria-label="Saved review">
    <div><h2><Icon name="history" /> Saved review</h2><p role="status" className="section-description">{workspace.restoring ? 'Matching the selected photos to saved reviews…' : workspace.saveStatus}</p></div>
    <div className="button-row">
      <button className="secondary" disabled={disabled || !workspace.payload} onClick={() => downloadBlob(new Blob([JSON.stringify(workspace.payload, null, 2)], { type: 'application/json' }), 'pfi-review.json')}>Download review backup</button>
      <button className="secondary" disabled={disabled || !workspace.manifest} onClick={() => input.current.click()}>Restore backup</button>
      <input ref={input} className="hidden-input" type="file" accept=".json" aria-label="Restore review backup" onChange={async (event) => {
        const file = event.target.files[0]; event.target.value = ''; if (!file) return;
        try { await workspace.importSession(file); onImported(); } catch (error) { onError(error.message); }
      }} />
    </div>
    {workspace.recent.length > 0 && <details><summary>Recent reviews ({workspace.recent.length})</summary><ul className="saved-list">{workspace.recent.map((session) => <li key={session.manifest.id}><strong>{session.flightName || 'Unnamed inspection'}</strong> · {session.manifest.files.length} photos · {session.updatedAt ? new Date(session.updatedAt).toLocaleString() : 'Saved'}<span>Reselect the same complete folder to resume.</span></li>)}</ul></details>}
  </section>;
}

function LocalPhoto({ file }) {
  const [url, setUrl] = useState(null); const [error, setError] = useState(false);
  useEffect(() => {
    setError(false); if (!file || !canPreviewInBrowser(file)) { setUrl(null); return; }
    const source = URL.createObjectURL(file); setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);
  return url && !error ? <img src={url} alt={getFileName(file)} draggable="false" loading="lazy" onError={() => setError(true)} />
    : <span className="image-unavailable">Preview unavailable for this image</span>;
}

export function FolderManager({ groups, records, workspace, onSelect, onExport, disabled, chronological }) {
  const [chosen, setChosen] = useState(new Set());
  const selected = groups.filter((group) => chosen.has(group.id));
  const merge = (index) => workspace.edit((edits) => mergeGroup(edits, index, groups, records, workspace.ids));
  return <>
    <div className="folder-actions"><span>{selected.length} selected</span><button className="secondary" disabled={disabled || !selected.length} onClick={() => onExport(selected)}>Download selected folders</button>
      {!chronological && <span className="field-note">Switch to capture-time order to merge or move boundaries.</span>}</div>
    <div className="table-wrap folder-manager" role="region" aria-label="Manage output folders" tabIndex={0}>
      <table><thead><tr><th><input type="checkbox" aria-label="Select all output folders" checked={groups.length > 0 && selected.length === groups.length} onChange={(event) => setChosen(event.target.checked ? new Set(groups.map((g) => g.id)) : new Set())} /></th><th>Folder name</th><th>Photos / first & last</th><th>Actions</th></tr></thead>
        <tbody>{groups.map((group, index) => <tr key={group.id}>
          <td><input type="checkbox" aria-label={`Select ${group.name}`} checked={chosen.has(group.id)} onChange={(event) => setChosen((current) => { const next = new Set(current); if (event.target.checked) next.add(group.id); else next.delete(group.id); return next; })} /></td>
          <td><form className="rename-form" onSubmit={(event) => { event.preventDefault(); const name = new FormData(event.currentTarget).get('name').trim(); if (name) workspace.edit((edits) => ({ ...edits, names: { ...edits.names, [group.id]: name } })); }}>
            <input key={group.name} name="name" type="text" aria-label={`Rename ${group.name}`} defaultValue={group.name} maxLength={100} required disabled={disabled} /><button className="secondary" disabled={disabled}>Rename</button>
          </form></td>
          <td className="folder-range"><strong>{group.files.length} photos</strong><span>{getFileName(group.files[0].file)}</span><span>to {getFileName(group.files.at(-1).file)}</span></td>
          <td><div className="button-row"><button className="secondary" onClick={() => onSelect(group)}>Review</button><button className="secondary" disabled={disabled || !index || !chronological} onClick={() => merge(index)}>Merge with previous</button></div></td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="folder-name-hint">Folder names are made safe for ZIP export. Duplicate names receive a number suffix.</p>
  </>;
}

export function ReviewWorkspace({ records, groups, workspace, visual, disabled, chronological, onCaptureOrder }) {
  const root = useRef(null);
  const { ids, edits } = workspace;
  const index = Math.max(0, records.findIndex((item) => ids.get(item.file) === workspace.activeId));
  const active = records[index];
  const placements = useMemo(() => new Map(groups.flatMap((group, gi) => group.files.map((item, fi) => [item.file, { group, gi, start: fi === 0 }]))), [groups]);
  const currentPlacement = placements.get(active?.file);
  const [queueFilter, setQueueFilter] = useState('all');
  const [showResolved, setShowResolved] = useState(false);
  const queue = useMemo(() => buildReviewQueue(records, groups, visual, ids, edits), [records, groups, visual, ids, edits]);
  const pending = queue.filter((entry) => !entry.resolved);
  const visibleQueue = queue.filter((entry) => (showResolved || !entry.resolved) && (queueFilter === 'all' || entry.type === queueFilter));
  const [queueLimit, setQueueLimit] = useState(30);
  const choose = (i) => { if (records[i]) workspace.setActiveId(ids.get(records[i].file)); };
  const split = () => { if (active && chronological && index > 0 && !disabled) workspace.edit((state) => changeMarker(state, ids.get(active.file), 'split')); };
  const merge = () => { if (currentPlacement?.gi > 0 && chronological && !disabled) workspace.edit((state) => mergeGroup(state, currentPlacement.gi, groups, records, ids)); };
  const shift = (delta) => {
    const gi = currentPlacement?.gi;
    if (!gi) return;
    const target = delta < 0 ? groups[gi - 1].files.at(-1) : groups[gi].files[1];
    workspace.edit((state) => moveBoundary(state, gi, delta, groups, records, ids));
    if (target) workspace.setActiveId(ids.get(target.file));
  };
  useEffect(() => {
    const strip = root.current?.querySelector('.filmstrip');
    const card = strip?.querySelector('[aria-pressed="true"]');
    if (card) strip.scrollLeft += card.getBoundingClientRect().left - strip.getBoundingClientRect().left - strip.clientWidth / 2 + card.clientWidth / 2;
  }, [index]);
  if (!active) return null;
  const start = Math.max(0, Math.min(index - 10, records.length - 21));
  const window = records.slice(start, start + 21);
  return <section className="panel review-workspace" id="boundary-review" ref={root} aria-label="Boundary review workspace" tabIndex={-1} onKeyDown={(event) => {
    if (disabled || event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) workspace.redo(); else workspace.undo(); }
    else if (event.ctrlKey || event.metaKey || event.altKey) return;
    else if (event.key === 'ArrowLeft') { event.preventDefault(); choose(index - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); choose(index + 1); }
    else if (event.key.toLowerCase() === 's') { event.preventDefault(); split(); }
    else if (event.key.toLowerCase() === 'm') { event.preventDefault(); merge(); }
  }}>
    <div className="panel-heading"><div><h2><Icon name="scan" /> Timeline & pass editing</h2><p className="section-description">Select a photo in the timeline to split, merge or move a folder boundary.</p></div>
      <div className="button-row"><button className="secondary" disabled={disabled || !workspace.canUndo} onClick={workspace.undo}>Undo</button><button className="secondary" disabled={disabled || !workspace.canRedo} onClick={workspace.redo}>Redo</button></div></div>
    {!chronological && <div className="order-notice"><span>The timeline follows capture time. Switch the folder plan to the same order before editing here.</span><button className="secondary" onClick={onCaptureOrder} disabled={disabled}>Use capture-time order</button></div>}
    <div className="timeline-toolbar">
      <div className="button-row"><button className="secondary" disabled={!index} onClick={() => choose(index - 1)}>← Previous</button><span>{index + 1} / {records.length}</span><button className="secondary" disabled={index === records.length - 1} onClick={() => choose(index + 1)}>Next →</button></div>
      <div className="timeline-selection" aria-live="polite"><strong>{getFileName(active.file)}</strong><span>{currentPlacement ? `${currentPlacement.group.name}${currentPlacement.start ? ' · Folder start' : ''}` : 'Skipped marker'}</span></div>
    </div>
    <div className="decision-toolbar">
      <button disabled={disabled || !chronological || !index || currentPlacement?.start} onClick={split}>Split before this photo</button>
      <button className="secondary" disabled={disabled || !chronological || !currentPlacement?.gi} onClick={merge}>Merge this pass with previous</button>
      <button className="secondary" disabled={disabled || !chronological || !currentPlacement?.gi || groups[currentPlacement.gi - 1]?.files.length < 2} onClick={() => shift(-1)}>Boundary one photo earlier</button>
      <button className="secondary" disabled={disabled || !chronological || !currentPlacement?.gi || currentPlacement.group.files.length < 2} onClick={() => shift(1)}>Boundary one photo later</button>
      <label>Photo decision<select aria-label="Timeline photo decision" value={edits.markers[ids.get(active.file)] ?? 'auto'} disabled={disabled || !chronological} onChange={(event) => workspace.edit((state) => changeMarker(state, ids.get(active.file), event.target.value))}><option value="auto">Automatic</option><option value="split">Start folder here (keep photo)</option><option value="marker">Start folder here (marker)</option><option value="normal">Keep in current folder (inspection photo)</option></select></label>
    </div>
    <p className="keyboard-guide">Inside this workspace: ← → browse · S split · M merge · Ctrl/⌘ Z undo · Ctrl/⌘ Shift Z redo.</p>
    <div className="timeline-heading"><h3>Capture-time timeline</h3><label><span className="sr-only">Jump to photo</span><select value={index} onChange={(event) => choose(Number(event.target.value))}>{records.map((item, i) => <option key={ids.get(item.file)} value={i}>{i + 1}. {getDisplayPath(item.file)}</option>)}</select></label></div>
    <div className="filmstrip" role="group" aria-label="Photo timeline">{window.map((item, offset) => {
      const placement = placements.get(item.file); const i = start + offset;
      return <button type="button" key={ids.get(item.file)} className={`film-frame ${placement?.start ? 'film-boundary' : ''}`} aria-pressed={i === index} aria-label={`Timeline ${getFileName(item.file)}${placement?.start ? ', folder start' : !placement ? ', skipped' : ''}`} onClick={() => choose(i)}>
        <span className="film-label">{placement?.start ? `PASS ${placement.gi + 1} START` : !placement ? 'SKIPPED MARKER' : `PASS ${placement.gi + 1}`}</span><LocalPhoto file={item.file} /><strong>{getFileName(item.file)}</strong><small>{i + 1} · {number(item.altitude, ' m')}</small>
      </button>;
    })}</div>
    <div className="timeline-paging"><button className="secondary" disabled={!start} onClick={() => choose(Math.max(0, index - 20))}>← Earlier 20</button><span>Showing {start + 1}–{Math.min(start + 21, records.length)} of {records.length}</span><button className="secondary" disabled={start + 21 >= records.length} onClick={() => choose(Math.min(records.length - 1, index + 20))}>Later 20 →</button></div>
    <details className="review-queue" open><summary>Needs review · {pending.length} remaining</summary>
      <div className="queue-toolbar"><label>Issue type<select value={queueFilter} onChange={(event) => { setQueueFilter(event.target.value); setQueueLimit(30); }}><option value="all">All issues</option><option value="suggestion">Pass suggestions</option><option value="inconclusive">Inconclusive / unchecked</option><option value="metadata">Missing metadata</option><option value="short-folder">Short folders</option></select></label><label className="check-row"><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />Show reviewed issues</label>
        <button className="secondary" disabled={!pending.length} onClick={() => { const current = pending.findIndex((entry) => entry.file === active.file); const next = pending[(current + 1) % pending.length]; workspace.setActiveId(ids.get(next.file)); }}>Next issue</button></div>
      {!visibleQueue.length && <p className="empty-state">No issues in this view. Review the full flight too; the detector can miss boundaries.</p>}
      <div className="queue-list">{visibleQueue.slice(0, queueLimit).map((entry) => <div className={`queue-item ${entry.resolved ? 'issue-resolved' : ''}`} key={entry.id}>
        <button className="queue-file secondary" onClick={() => workspace.setActiveId(ids.get(entry.file))}>{getFileName(entry.file)}</button><p>{entry.message}</p><button className="secondary" disabled={disabled} onClick={() => workspace.edit((state) => ({ ...state, resolved: { ...state.resolved, [entry.id]: !entry.resolved } }))}>{entry.resolved ? 'Reopen issue' : 'Mark reviewed'}</button>
      </div>)}</div>{visibleQueue.length > queueLimit && <button className="secondary" onClick={() => setQueueLimit((limit) => limit + 30)}>Show next 30 issues</button>}
    </details>
  </section>;
}
