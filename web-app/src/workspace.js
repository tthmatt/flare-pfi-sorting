import { getDisplayPath, safePathPart } from './files.js';

export const emptyEdits = () => ({ markers: {}, joins: {}, names: {}, dismissed: {}, resolved: {} });

export function fileIdentity(file) {
  return JSON.stringify([getDisplayPath(file), file.size, file.lastModified ?? 0]);
}

export function indexFiles(files) {
  const counts = new Map();
  return new Map(files.map((file) => {
    const identity = fileIdentity(file);
    const occurrence = counts.get(identity) ?? 0;
    counts.set(identity, occurrence + 1);
    return [file, `${identity}#${occurrence}`];
  }));
}

export function historyReducer(state, action) {
  if (action.type === 'reset') return { past: [], present: action.value ?? emptyEdits(), future: [] };
  if (action.type === 'undo') return state.past.length
    ? { past: state.past.slice(0, -1), present: state.past.at(-1), future: [state.present, ...state.future] } : state;
  if (action.type === 'redo') return state.future.length
    ? { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) } : state;
  const next = typeof action.value === 'function' ? action.value(state.present) : action.value;
  if (JSON.stringify(next) === JSON.stringify(state.present)) return state;
  return { past: [...state.past.slice(-49), state.present], present: next, future: [] };
}

export function applyEdits(analyses, ids, edits) {
  return analyses.map((item) => ({ ...item, markerOverride: edits.markers[ids.get(item.file)] ?? 'auto',
    boundaryOverride: edits.joins[ids.get(item.file)] ? 'join' : undefined }));
}

export function nameGroups(groups, ids, names) {
  const used = new Set();
  return groups.map((group) => {
    const id = ids.get(group.boundaryFile ?? group.files[0].file);
    const base = safePathPart(names[id] || group.name).slice(0, 100);
    let name = base; let suffix = 2;
    while (used.has(name.toLowerCase())) name = `${base}_${suffix++}`;
    used.add(name.toLowerCase());
    return { ...group, id, name };
  });
}

export function changeMarker(edits, id, mode) {
  const markers = { ...edits.markers }; const joins = { ...edits.joins };
  if (mode === 'auto') delete markers[id]; else markers[id] = mode;
  delete joins[id];
  return { ...edits, markers, joins, resolved: {} };
}

// Suppress starts independently of marker classification. In particular a
// skipped pitch marker remains excluded when its two neighbouring groups merge.
export function mergeGroup(edits, groupIndex, groups, ordered, ids) {
  if (groupIndex < 1 || !groups[groupIndex]) return edits;
  const previousEnd = ordered.findIndex((item) => item.file === groups[groupIndex - 1].files.at(-1).file);
  const nextStart = ordered.findIndex((item) => item.file === groups[groupIndex].files[0].file);
  if (previousEnd < 0 || nextStart <= previousEnd) return edits;
  const joins = { ...edits.joins };
  ordered.slice(previousEnd + 1, nextStart + 1).forEach((item) => { joins[ids.get(item.file)] = true; });
  return { ...edits, joins, resolved: {} };
}

export function moveBoundary(edits, groupIndex, delta, groups, ordered, ids) {
  if (groupIndex < 1 || ![-1, 1].includes(delta)) return edits;
  const previous = groups[groupIndex - 1]; const current = groups[groupIndex];
  if (!current || (delta < 0 ? previous.files.length : current.files.length) < 2) return edits;
  const target = delta < 0 ? previous.files.at(-1) : current.files[1];
  const targetId = ids.get(target.file);
  const merged = mergeGroup(edits, groupIndex, groups, ordered, ids);
  const split = changeMarker(merged, targetId, 'split');
  const names = { ...split.names };
  if (names[current.id]) { names[targetId] = names[current.id]; delete names[current.id]; }
  return { ...split, names };
}

export function planSignature(groups, ids) {
  return JSON.stringify(groups.map((group) => group.files.map((item) => ids.get(item.file))));
}

export function buildReviewQueue(records, groups, visual, ids, edits) {
  const entries = [];
  const add = (file, type, message, detail = '') => {
    const id = `${type}:${ids.get(file)}:${detail}`;
    entries.push({ id, file, type, message, resolved: Boolean(edits.resolved[id]) });
  };
  for (const item of records) {
    const missing = [...(item.warnings ?? [])];
    if (!Number.isFinite(item.gimbalYaw)) missing.push('missing-camera-heading');
    if (missing.length || item.error) add(item.file, 'metadata', item.error || `Check metadata: ${missing.join(', ').replaceAll('missing-', '')}`, missing.join('|'));
  }
  for (const group of groups) {
    if (group.files.length <= 2) add(group.files[0].file, 'short-folder', `${group.name} contains ${group.files.length} photo${group.files.length === 1 ? '' : 's'}. Confirm this is a complete pass.`, `${group.id}:${group.files.length}`);
  }
  for (const proposal of visual?.proposals ?? []) {
    const id = ids.get(proposal.file);
    if (!edits.dismissed[id] && edits.markers[id] !== 'split' && !edits.joins[id]) {
      add(proposal.file, 'suggestion', proposal.visual.supported ? 'Unresolved pass suggestion with image support.' : 'Unresolved pass suggestion; image check inconclusive.');
    }
  }
  for (const item of visual?.reviewCandidates ?? []) {
    const file = records[item.boundaryIndex]?.file;
    if (file && !edits.dismissed[ids.get(file)] && edits.markers[ids.get(file)] !== 'split' && !edits.joins[ids.get(file)]) {
      add(file, 'inconclusive', item.reason === 'not-checked' ? 'Candidate was outside the 200-pair analysis limit.' : 'Potential camera sweep has inconclusive image evidence.', item.reason);
    }
  }
  return entries;
}
