// Dev tool (run from the repo root): npx tsx lab/tools/try-maze.ts tune-0001,tune-0002 run|session "DEFINE=v,..." out-dir
// Writes <id>.csv (path), <id>.serial.txt (run) or <id>.session.txt (session). Plot: python3 lab/tools/plot_run.py <id> out.png --flip
// Dev harness: run the maze firmware on track-set tracks (single runs or sessions), dump serial + path.
import fs from 'node:fs';
import { buildFirmware, NativeFirmwareBrain } from '../src/native';
import { loadTrackSet, loadSetTrack } from '../src/tracksets';
import { loadInputs } from '../src/inputs';
import { runSession } from '../src/session';
import { loadCompetition } from '../src/competition';
import { ALL_ON, VARIATIONS, disturbancesFor } from '../src/variations';
import { parseWiring } from '../src/firmwareSpec';
import { Engine } from '../../src/worker/engine';

const [ids, mode = 'run', defs = '', out = '/tmp/mz/out'] = process.argv.slice(2);
const D = new URL('../firmware/examples/maze/main/', import.meta.url).pathname;
const SET = new URL('../tracksets/rr-2027', import.meta.url).pathname;
const exe = buildFirmware([D + 'main.c', D + 'hw.c', D + 'maze_map.c'], { defines: ['CONFIG_FREERTOS_HZ=1000', ...defs.split(',').filter(Boolean)] }).exe;
const wiring = parseWiring(fs.readFileSync(D + 'wiring.json', 'utf8'));
const { start } = loadInputs({ track: 'public/samples/roborun-sample.png', robot: 'lab/examples/rmi-test-rig.robot.json' });
const m = loadTrackSet(SET);
const first = { presses: [{ gpio: 4, at_s: 0.3 }, { gpio: 4, at_s: 3.8 }, { gpio: 4, at_s: 4.3 }], sweep: { from_s: 0.5, to_s: 3.6 } };
const each = { presses: [{ gpio: 4, at_s: 0.3 }] };
fs.mkdirSync(out, { recursive: true });
const summary: unknown[] = [];
for (const id of ids.split(',')) {
  const entry = m.entries.find((e) => e.id === id)!;
  const track = loadSetTrack(SET, entry, start.profile.axleFromFront_mm);
  const t0 = Date.now();
  if (mode === 'run') {
    const lines: string[] = [];
    const msg = { type: 'start' as const, runId: 1, ...start, track, flags: ALL_ON, memory: {}, brain: { mode: 'code' as const, code: '', wiring }, operator: first };
    const e = new Engine(msg, { record: true, firmware: (mm) => { const b = new NativeFirmwareBrain(exe, wiring, mm.profile, first); return b; } });
    const s = e.sim;
    let end = 'time';
    while (s.time < Number(process.env.SECS ?? 245)) {
      await e.advance(s.time + 0.1); const d = e.drain();
      for (const c of (d as { console?: { t: number; text: string }[] }).console ?? []) lines.push(`${c.t.toFixed(2)} ${c.text}`);
      const ev = s.events.find((x) => x.kind === 'finish' || x.kind === 'start-reentry' || x.kind === 'left-mat');
      if (ev) { end = ev.kind; break; }
      if (e.status !== 'running') { end = e.status + ' ' + (e.error ?? ''); break; }
    }
    fs.writeFileSync(`${out}/${id}.csv`, e.csv(Infinity));
    fs.writeFileSync(`${out}/${id}.serial.txt`, lines.join('\n'));
    e.dispose();
    summary.push({ id, end, t: +s.time.toFixed(1), dist: +s.distance.toFixed(1), wall: Date.now() - t0 });
  } else {
    const slog: string[] = [];
    const r = await runSession({ competition: loadCompetition(), seed: entry.seed, plan: { explore: { name: 'explore', settings: {} }, memory: [{ name: 'm0', settings: {} }, { name: 'm1', settings: {}, levels: [{ gpio: 21, level: 1 }] }], dry_s: 300, giveUp_s: Number(process.env.GIVEUP ?? 600) },
      checkpoints: entry.checkpoints, base: { ...start, track, flags: ALL_ON, memory: {}, disturbances: disturbancesFor(VARIATIONS[0], entry.seed) },
      firmware: { exe, wiring, operator: { first, each } }, onConsole: (k, t, x) => slog.push(`${k} ${t.toFixed(2)} ${x}`) });
    fs.writeFileSync(`${out}/${id}.session.txt`, slog.join('\n'));
    summary.push({ id, finished: r.finished, official: r.officialTime_s, first: r.firstFinish_s, runs: r.runs.map((x) => `${x.period[0]}:${x.end}@${x.elapsed_s}`).join(' '), wall: Date.now() - t0 });
  }
  console.log(JSON.stringify(summary[summary.length - 1]));
}
