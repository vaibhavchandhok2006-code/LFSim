import { SimFlags, Simulation } from '../sim/simulation';
import { Group, Toggle } from './Field';
import { ViewOptions } from './Viewport';

interface Props {
  flags: SimFlags;
  onFlags: (f: SimFlags) => void;
  view: ViewOptions;
  onView: (v: ViewOptions) => void;
  sim: Simulation | null;
}

const fmt = (t: number | null) => (t === null ? '—' : `${t.toFixed(2)} s`);

export function SimPanel({ flags, onFlags, view, onView, sim }: Props) {
  const f = (k: keyof SimFlags) => (v: boolean) => onFlags({ ...flags, [k]: v });
  const vw = (k: keyof ViewOptions) => (v: boolean) => onView({ ...view, [k]: v });
  const finishedByCode = sim?.events.some((e) => e.kind === 'brain-finished') ?? false;
  return (
    <div className="panel-scroll">
      <Group title="Run result">
        <dl className="result">
          <dt>Run time</dt><dd>{fmt(sim?.runTime() ?? null)}</dd>
          <dt>Off the line</dt><dd>{sim ? `${sim.offLineCount} time${sim.offLineCount === 1 ? '' : 's'}` : '—'}</dd>
          <dt>Time score</dt><dd>{fmt(sim?.score() ?? null)}</dd>
          <dt>Reached finish</dt><dd>{sim?.finishTime != null ? 'Yes' : 'Not yet'}</dd>
          <dt>Code saw the finish</dt><dd>{finishedByCode ? 'Yes, and stopped' : 'No'}</dd>
          <dt>Distance</dt><dd>{sim ? `${sim.distance.toFixed(2)} m` : '—'}</dd>
        </dl>
        <p className="hint">Time score = run time + (off-line count ÷ 20) × run time, as in the Robo-Run rules.</p>
      </Group>

      <Group title="Real-world effects" note="On by default at realistic levels. Turn one off to see if it causes a problem.">
        <Toggle label="Sensor noise" checked={flags.noise} onChange={f('noise')} />
        <Toggle label="Sensor-to-sensor differences" checked={flags.mismatch} onChange={f('mismatch')} />
        <Toggle label="Motor mismatch" checked={flags.motorMismatch} onChange={f('motorMismatch')} />
        <Toggle label="Battery sag" checked={flags.batterySag} onChange={f('batterySag')} />
        <Toggle label="Limited tyre grip (skids)" checked={flags.grip} onChange={f('grip')} />
      </Group>

      <Group title="View">
        <Toggle label="Follow the robot" checked={view.follow} onChange={vw('follow')} />
        <Toggle label="Path trail, coloured by speed" checked={view.trail} onChange={vw('trail')} />
        <Toggle label="Sensor spots on the floor" checked={view.spots} onChange={vw('spots')} />
        <Toggle label="25 cm grid" checked={view.grid} onChange={vw('grid')} />
      </Group>

      <Group title="Event log">
        {sim && sim.events.length > 0 ? (
          <ol className="events">
            {sim.events.slice(-40).map((e, i) => (
              <li key={i} className={`ev-${e.kind}`}><span className="ev-t">{e.t.toFixed(2)} s</span>{e.text}</li>
            ))}
          </ol>
        ) : <p className="group-text">Events appear here once the robot starts moving.</p>}
      </Group>
    </div>
  );
}
