import { RunSummary } from './run';

export const RUN_COLORS = ['#2457C5', '#C2410C', '#1F6B47', '#7C3AED', '#0E7490', '#BE185D', '#4D7C0F', '#92400E'];

interface Props {
  runs: RunSummary[];
  selected: number[];
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onRename: (id: number, label: string) => void;
}

const f = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d));

export function ComparePanel({ runs, selected, onToggle, onDelete, onRename }: Props) {
  if (!runs.length) {
    return (
      <div className="panel-scroll">
        <p className="panel-note">No saved runs yet. Every run you finish or stop is saved here automatically, so you can compare algorithms and settings side by side.</p>
      </div>
    );
  }
  const best = Math.min(...runs.filter((r) => r.score_s !== null && r.reachedFinish).map((r) => r.score_s!));
  return (
    <div className="panel-scroll compare">
      <p className="panel-note">Tick runs to overlay their paths on the track. The fastest finishing score is marked.</p>
      <div className="table-wrap">
        <table className="cmp">
          <thead>
            <tr><th scope="col">Show</th><th scope="col">Run</th><th scope="col">Finish</th><th scope="col">Time s</th><th scope="col">Score s</th><th scope="col">Off</th><th scope="col">Dist m</th><th scope="col">Dec.</th><th scope="col">Dead ends</th><th scope="col"><span className="sr">Delete</span></th></tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const i = selected.indexOf(r.id);
              return (
                <tr key={r.id} className={r.score_s === best && r.reachedFinish ? 'best' : ''}>
                  <td><input type="checkbox" aria-label={`Show ${r.label}`} checked={i >= 0} onChange={() => onToggle(r.id)} />{i >= 0 && <span className="sw-dot" style={{ background: RUN_COLORS[i % RUN_COLORS.length] }} />}</td>
                  <td>
                    <input className="run-label" aria-label="Run name" value={r.label} onChange={(e) => onRename(r.id, e.target.value)} />
                    <span className="run-sub">{r.settingsNote}</span>
                  </td>
                  <td>{r.reachedFinish ? (r.codeStopped ? 'Yes' : 'Yes, no stop') : r.status}</td>
                  <td>{f(r.runTime_s)}</td>
                  <td>{f(r.score_s)}</td>
                  <td>{r.offLine}</td>
                  <td>{r.distance_m.toFixed(1)}</td>
                  <td>{r.decisions}</td>
                  <td>{r.deadEnds}</td>
                  <td><button className="icon" aria-label={`Delete ${r.label}`} onClick={() => onDelete(r.id)}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
