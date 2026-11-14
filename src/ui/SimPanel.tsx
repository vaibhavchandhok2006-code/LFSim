import { SimFlags } from '../sim/simulation';
import { Disturbances } from '../worker/protocol';
import { Group, NumField, Toggle } from './Field';
import { RunData } from './run';
import { ViewOptions } from './Viewport';

interface Props {
  flags: SimFlags;
  onFlags: (f: SimFlags) => void;
  dist: Disturbances;
  onDist: (d: Disturbances) => void;
  view: ViewOptions;
  onView: (v: ViewOptions) => void;
  run: RunData | null;
  t: number;
  memoryAvailable: boolean;
  onMemoryRun: () => void;
  onClearMemory: () => void;
  isMemoryAlgo: boolean;
  codeMode: boolean;
}

const fmt = (v: number | null, unit = 's') => (v === null ? '—' : `${v.toFixed(2)} ${unit}`);

export function SimPanel({ flags, onFlags, dist, onDist, view, onView, run, t, memoryAvailable, onMemoryRun, onClearMemory, isMemoryAlgo, codeMode }: Props) {
  const f = (k: keyof SimFlags) => (v: boolean) => onFlags({ ...flags, [k]: v });
  const vw = (k: keyof ViewOptions) => (v: boolean) => onView({ ...view, [k]: v });
  const r = run?.at(t);
  const ended = run && run.endTime !== null && t >= run.endTime - 1e-6;
  const status = !run ? 'Not run yet'
    : run.status === 'error' ? `Error: ${run.error}`
    : r?.aborted ? 'Aborted: re-entered the start square'
    : r?.finish != null ? 'Reached the finish'
    : ended ? 'Did not finish' : 'Running';
  return (
    <div className="panel-scroll">
      <Group title="Run result">
        <p className={`status-line ${r?.finish != null ? 'ok' : run?.status === 'error' || r?.aborted || ended ? 'bad' : ''}`}>{status}</p>
        <dl className="result">
          <dt>Run time</dt><dd>{fmt(r?.runTime ?? null)}</dd>
          <dt>Off the line</dt><dd>{r ? `${r.offLine} time${r.offLine === 1 ? '' : 's'}` : '—'}</dd>
          <dt>Time score</dt><dd>{fmt(r?.score ?? null)}</dd>
          <dt>Code saw the finish</dt><dd>{r ? (r.codeStopped ? 'Yes, and stopped' : 'No') : '—'}</dd>
          <dt>Junction decisions</dt><dd>{r ? r.decisions : '—'}</dd>
          <dt>Dead ends</dt><dd>{r ? r.deadEnds : '—'}</dd>
          <dt>Distance</dt><dd>{r ? `${r.distance.toFixed(2)} m` : '—'}</dd>
        </dl>
        <p className="hint">Time score = run time + (off-line count ÷ 20) × run time, as in the Robo-Run rules.</p>
        {isMemoryAlgo && (
          <div className="memory-box">
            <p className="group-text">{memoryAvailable ? 'Memory from the last full run is saved. Run 2 will use it.' : 'Finish one run to save its memory (path or map) for a faster run 2.'}</p>
            <div className="row-buttons left">
              <button className="primary" disabled={!memoryAvailable} onClick={onMemoryRun}>Run again with memory</button>
              <button disabled={!memoryAvailable} onClick={onClearMemory}>Forget memory</button>
            </div>
          </div>
        )}
      </Group>

      {run && run.decisions.length > 0 && (
        <Group title="Junction decisions">
          <ol className="decisions">
            {run.decisions.filter((d) => d.t <= t + 1e-9).slice(-60).reverse().map((d, i) => (
              <li key={i}>
                <span className={`chip k-${d.kind}`}>{d.kind === 'finish' ? 'F' : d.kind}</span>
                <span className="ev-t">{d.t.toFixed(2)} s</span>
                <span className="dec-main">{d.kind === 'finish' ? 'Finish' : `Branches ${d.branches_deg.map((b) => `${b > 0 ? '+' : ''}${b}°`).join(' ') || 'none'} → ${d.kind === 'B' ? 'back' : `${d.chosen_deg}°`}`}<span className="dec-sub">({d.x.toFixed(2)}, {d.y.toFixed(2)}) m · sensors {d.pattern} · {d.note}</span></span>
              </li>
            ))}
          </ol>
        </Group>
      )}

      {codeMode && (
        <Group title="Serial console">
          <pre className="console" aria-live="off">{run ? run.console.filter((c) => c.t <= t).slice(-200).map((c) => `[${c.t.toFixed(3)}] ${c.text}`).join('\n') || 'No output yet.' : 'No output yet.'}</pre>
        </Group>
      )}

      <Group title="Real-world effects" note="On by default at realistic levels. Turn one off to see if it causes a problem.">
        <Toggle label="Sensor noise" checked={flags.noise} onChange={f('noise')} />
        <Toggle label="Sensor-to-sensor differences" checked={flags.mismatch} onChange={f('mismatch')} />
        <Toggle label="Motor mismatch" checked={flags.motorMismatch} onChange={f('motorMismatch')} />
        <Toggle label="Battery sag" checked={flags.batterySag} onChange={f('batterySag')} />
        <Toggle label="Limited tyre grip (skids)" checked={flags.grip} onChange={f('grip')} />
      </Group>

      <Group title="Disturbances" note="Off by default. Use them to test whether your settings cope with a real venue.">
        <Toggle label="Uneven lighting" checked={dist.lighting.on} onChange={(v) => onDist({ ...dist, lighting: { ...dist.lighting, on: v } })} />
        <NumField label="Lighting strength" unit="%" min={0} max={100} step={10} value={Math.round(dist.lighting.strength * 100)} onChange={(v) => onDist({ ...dist, lighting: { ...dist.lighting, strength: v / 100 } })} hint="100% shifts readings by up to a quarter of the white-to-black range." />
        <Toggle label="Mat folds and bumps" checked={dist.bumps.on} onChange={(v) => onDist({ ...dist, bumps: { ...dist.bumps, on: v } })} />
        <NumField label="Bump height" unit="%" min={0} max={100} step={10} value={Math.round(dist.bumps.strength * 100)} onChange={(v) => onDist({ ...dist, bumps: { ...dist.bumps, strength: v / 100 } })} hint="100% lifts the sensors 6 mm at a fold's crest. Folds are shaded on the track." />
        <NumField label="Pattern seed" min={1} step={1} value={dist.seed} onChange={(v) => onDist({ ...dist, seed: Math.round(v) })} hint="Change it for a different lighting and fold pattern." />
      </Group>

      <Group title="View">
        <Toggle label="Follow the robot" checked={view.follow} onChange={vw('follow')} />
        <Toggle label="Path trail, coloured by speed" checked={view.trail} onChange={vw('trail')} />
        <Toggle label="Junction decision markers" checked={view.decisions} onChange={vw('decisions')} />
        <Toggle label="Ideal shortest path (faint)" checked={view.ideal} onChange={vw('ideal')} hint="From the track's junction graph. The robot never sees it." />
        <Toggle label="Sensor spots on the floor" checked={view.spots} onChange={vw('spots')} />
        <Toggle label="25 cm grid" checked={view.grid} onChange={vw('grid')} />
      </Group>

      <Group title="Event log">
        {run && run.events.length > 0 ? (
          <ol className="events">
            {run.events.filter((e) => e.t <= t + 1e-9).slice(-40).map((e, i) => (
              <li key={i} className={`ev-${e.kind}`}><span className="ev-t">{e.t.toFixed(2)} s</span>{e.text}</li>
            ))}
          </ol>
        ) : <p className="group-text">Events appear here once the robot starts moving.</p>}
      </Group>
    </div>
  );
}
