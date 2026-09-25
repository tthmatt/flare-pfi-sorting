import { useEffect, useRef, useState } from 'react';
import { BENCHMARK_KEY, benchmarkKey, evaluateFlight, labelPlan, mergeBenchmarks, summarizeBenchmarks, validateBenchmarks } from './benchmark.js';
import { planSignature } from './workspace.js';
import { downloadBlob } from './reports.js';
import { getFileName } from './files.js';
import { Icon } from './ui.jsx';

const percent = (value) => value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;

export function BenchmarkPanel({ groups, records, workspace, settings, appVersion, disabled, onBusy, chronological }) {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('No accuracy claim is made until you label and evaluate complete flights.');
  const [confirmedPlan, setConfirmedPlan] = useState(null);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [evaluatedPlan, setEvaluatedPlan] = useState(null);
  const controller = useRef(null); const input = useRef(null);
  const signature = planSignature(groups, workspace.ids);
  const confirmed = confirmedPlan === signature;
  useEffect(() => {
    try { const saved = localStorage.getItem(BENCHMARK_KEY); if (saved) setRows(validateBenchmarks(JSON.parse(saved))); }
    catch { setMessage('Saved benchmark results are unavailable. You can import a previous JSON export.'); }
    return () => controller.current?.abort();
  }, []);
  function keep(next) {
    setRows(next);
    try { localStorage.setItem(BENCHMARK_KEY, JSON.stringify(next)); }
    catch { setMessage('Results are available for this session, but could not save locally. Export benchmark JSON before closing.'); }
  }
  async function run() {
    if (!confirmed || !chronological) return;
    const abort = new AbortController(); controller.current = abort; setRunning(true); onBusy(true); setLastResult(null);
    try {
      const result = await evaluateFlight({ records, settings, labels: labelPlan(groups, records, workspace.ids),
        ids: workspace.ids, manifest: workspace.manifest, flightName: workspace.flightName, drone: workspace.drone,
        appVersion, signal: abort.signal, onProgress: (done, total) => setMessage(`Evaluating uncorrected detector: ${done} / ${total} image checks…`) });
      setLastResult(result);
      setEvaluatedPlan(signature);
      setMessage('Complete-flight result recorded. Re-evaluating the same flight and detector settings replaces its earlier result.');
      keep(mergeBenchmarks(rows, [result]));
    } catch (error) { setMessage(error.name === 'AbortError' ? 'Benchmark cancelled; no partial result was saved.' : error.message); }
    finally { controller.current = null; setRunning(false); onBusy(false); }
  }
  const byId = new Map(records.map((item) => [workspace.ids.get(item.file), item.file]));
  return <details className="panel benchmark-panel"><summary><Icon name="chart" /> Detection accuracy · complete flights</summary>
    <p className="section-description">Review every folder in one complete flight, then confirm the plan as your labels. Evaluation reruns the detector without your manual corrections. The first pass is implicit; all later starts must match the exact first inspection photo.</p>
    <div className="benchmark-fields"><label>Flight name<input type="text" maxLength={100} value={workspace.flightName} disabled={disabled} placeholder="Building A · flight 01" onChange={(event) => workspace.setFlightName(event.target.value)} /></label><label>Drone model<input type="text" maxLength={100} value={workspace.drone} disabled={disabled} placeholder="DJI Mavic 2" onChange={(event) => workspace.setDrone(event.target.value)} /></label></div>
    <label className="check-row"><input type="checkbox" checked={confirmed} disabled={disabled || !groups.length || !chronological} onChange={(event) => setConfirmedPlan(event.target.checked ? signature : null)} /><span>I checked the complete flight and every folder boundary. Use this plan as the confirmed labels.<small>Changing folder membership requires confirmation again. Use capture-time order for evaluation.</small></span></label>
    <div className="button-row"><button disabled={disabled || !confirmed || !workspace.manifest || !workspace.flightName.trim() || !workspace.drone.trim()} onClick={run}>Evaluate complete flight</button>{running && <button className="secondary" onClick={() => controller.current?.abort()}>Cancel benchmark</button>}<button className="secondary" disabled={!rows.length} onClick={() => downloadBlob(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }), 'pfi-flight-benchmarks.json')}>Export benchmark JSON</button><button className="secondary" disabled={disabled} onClick={() => input.current.click()}>Import benchmark JSON</button></div>
    <input ref={input} className="hidden-input" type="file" accept=".json" aria-label="Import benchmark JSON" onChange={async (event) => {
      const file = event.target.files[0]; event.target.value = ''; if (!file) return;
      try { if (file.size > 4 * 1024 * 1024) throw new Error('Benchmark file exceeds 4 MiB.'); const incoming = validateBenchmarks(JSON.parse(await file.text())); setMessage(`Imported ${incoming.length} complete-flight results.`); keep(mergeBenchmarks(rows, incoming)); }
      catch (error) { setMessage(error.message); }
    }} />
    <p className="benchmark-status" role="status">{message}</p>
    {lastResult && <div className="benchmark-result"><strong>{lastResult.scores.correct} correct · {lastResult.scores.missed.length} missed · {lastResult.scores.extra.length} incorrect splits</strong><p>Precision {percent(lastResult.scores.precision)} · Recall {percent(lastResult.scores.recall)}</p>
      {signature !== evaluatedPlan && <p>The folder plan has changed since this result. Confirm and evaluate again to update it.</p>}
      {['missed', 'extra'].map((kind) => lastResult.scores[kind].length > 0 && <div key={kind}><span>{kind === 'missed' ? 'Missed boundaries' : 'Incorrect splits'}:</span><div className="button-row">{lastResult.scores[kind].map((id) => <button className="secondary" key={id} disabled={!byId.has(id)} onClick={() => { workspace.setActiveId(id); document.getElementById('boundary-review')?.scrollIntoView({ block: 'start' }); }}>{byId.has(id) ? getFileName(byId.get(id)) : 'Photo unavailable'}</button>)}</div></div>)}
    </div>}
    {rows.length > 0 && <>
      <div className="benchmark-table"><table><caption>Totals grouped by drone, detector version and settings</caption><thead><tr><th>Drone / detector</th><th>Flights</th><th>Missed</th><th>Incorrect splits</th><th>Precision</th><th>Recall</th></tr></thead><tbody>{summarizeBenchmarks(rows).map((row) => <tr key={row.key}><td>{row.drone}<small>{row.detectorVersion}</small></td><td>{row.flights}</td><td>{row.missed}</td><td>{row.extra}</td><td>{percent(row.precision)}</td><td>{percent(row.recall)}</td></tr>)}</tbody></table></div>
      <details><summary>Saved flight results ({rows.length})</summary><div className="saved-benchmarks">{rows.map((row) => <div key={benchmarkKey(row)}><span><strong>{row.flightName}</strong> · {row.drone} · {row.photoCount} photos<br />{row.scores.missed.length} missed / {row.scores.extra.length} incorrect splits</span><button className="secondary" disabled={disabled} onClick={() => keep(rows.filter((r) => benchmarkKey(r) !== benchmarkKey(row)))}>Remove result</button></div>)}</div></details>
    </>}
    <p className="field-note">Precision is the share of proposed starts that were correct. Recall is the share of confirmed starts found. N/A means there is no denominator. These results describe your labelled flights, not an overall accuracy guarantee. JSON exports include filenames and labels, not photos or GPS coordinates.</p>
  </details>;
}
