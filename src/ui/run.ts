import simWorkerUrl from '../worker/simWorker.ts?worker&url';
// Main-thread side of a run: owns the worker, stores the recorded frames, and answers "what was true at time t".

import { DecisionEvent, SimEvent } from '../sim/simulation';
import { F, FramesMsg, FromWorker, StartMsg } from '../worker/protocol';

export interface RunSummary {
  id: number;
  label: string;
  algorithm: string;
  robot: string;
  track: string;
  memoryRun: boolean;
  reachedFinish: boolean;
  codeStopped: boolean;
  runTime_s: number | null;
  score_s: number | null;
  distance_m: number;
  decisions: number;
  deadEnds: number;
  offLine: number;
  status: string;
  path: [number, number][]; // downsampled axle path, m
  settingsNote: string;
}

export class RunData {
  stride = 0;
  private buf = new Float32Array(0);
  count = 0;
  private dist = new Float64Array(0); // cumulative distance at each frame
  states: string[] = [];
  events: SimEvent[] = [];
  decisions: DecisionEvent[] = [];
  console: { t: number; text: string }[] = [];
  computedTime = 0;
  status: FramesMsg['status'] = 'running';
  error: string | undefined;
  memory: Record<string, unknown> | undefined;
  endTime: number | null = null; // set when the run is over (finish, stop, error)
  frameHz = 500;

  append(m: FramesMsg) {
    this.stride = m.stride;
    this.frameHz = m.idealHz;
    const n = m.frames.length / m.stride;
    if (n) {
      if ((this.count + n) * this.stride > this.buf.length) {
        const nb = new Float32Array(Math.max((this.count + n) * this.stride, this.buf.length * 2, 4096 * this.stride));
        nb.set(this.buf.subarray(0, this.count * this.stride));
        this.buf = nb;
        const nd = new Float64Array(nb.length / this.stride);
        nd.set(this.dist.subarray(0, this.count));
        this.dist = nd;
      }
      this.buf.set(m.frames, this.count * this.stride);
      for (let i = this.count; i < this.count + n; i += 1) {
        if (i === 0) { this.dist[0] = 0; continue; }
        const dx = this.get(i, F.x) - this.get(i - 1, F.x), dy = this.get(i, F.y) - this.get(i - 1, F.y);
        this.dist[i] = this.dist[i - 1] + Math.hypot(dx, dy);
      }
      this.count += n;
    }
    this.states = m.states;
    this.events.push(...m.events);
    this.decisions.push(...m.decisions);
    this.console.push(...m.console);
    this.computedTime = m.time;
    this.status = m.status;
    this.error = m.error;
    if (m.memory) this.memory = m.memory;
    if (m.status !== 'running' && this.endTime === null) this.endTime = Math.max(m.time, this.count ? this.get(this.count - 1, F.t) : 0);
  }

  get(i: number, field: number): number { return this.buf[i * this.stride + field]; }
  frame(i: number): Float32Array { return this.buf.subarray(i * this.stride, (i + 1) * this.stride); }
  sensors(i: number, n: number): number[] { return Array.from(this.buf.subarray(i * this.stride + this.stride - n, (i + 1) * this.stride)); }
  distanceAt(i: number) { return this.dist[i] ?? 0; }

  // Index of the last frame at or before t.
  indexAt(t: number): number {
    let lo = 0, hi = this.count - 1;
    if (hi < 0) return -1;
    if (t <= this.get(0, F.t)) return 0;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.get(mid, F.t) <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }
  lastTime(): number { return this.count ? this.get(this.count - 1, F.t) : 0; }

  // Results as they stood at time t.
  at(t: number) {
    const upto = <T extends { t: number }>(a: T[]) => a.filter((e) => e.t <= t + 1e-9);
    // The operator putting the robot back on the start (before the run) restarts timing and counting, as in the simulator.
    const all = upto(this.events);
    const placed = all.filter((e) => e.kind === 'placed').pop();
    const ev = placed ? all.filter((e) => e.t >= placed.t) : all;
    const start = ev.find((e) => e.kind === 'start')?.t ?? null;
    const finish = ev.find((e) => e.kind === 'finish')?.t ?? null;
    const off = ev.filter((e) => e.kind === 'offline').length;
    const runTime = start === null ? null : (finish ?? t) - start;
    const dec = upto(this.decisions).filter((d) => d.kind !== 'finish');
    return {
      start, finish, offLine: off, runTime,
      score: runTime === null ? null : runTime + (off / 20) * runTime,
      codeStopped: ev.some((e) => e.kind === 'brain-finished'),
      codeStoppedElsewhere: ev.some((e) => e.kind === 'code-stopped'),
      startReentries: ev.filter((e) => e.kind === 'start-reentry').length,
      decisions: dec.length,
      deadEnds: dec.filter((d) => d.kind === 'B').length,
      distance: this.distanceAt(Math.max(0, this.indexAt(t))),
    };
  }

  path(t: number, maxPts = 600): [number, number][] {
    const end = this.indexAt(t);
    if (end < 0) return [];
    const step = Math.max(1, Math.floor(end / maxPts));
    const out: [number, number][] = [];
    for (let i = 0; i <= end; i += step) out.push([this.get(i, F.x), this.get(i, F.y)]);
    out.push([this.get(end, F.x), this.get(end, F.y)]);
    return out;
  }
}

// Owns one worker for one run.
export class RunController {
  readonly data = new RunData();
  private worker: Worker;
  private pending = false;
  private requestedAt = 0;
  private csvWaiters: ((s: string) => void)[] = [];
  onUpdate: () => void = () => {};
  readonly runId: number;

  constructor(start: Omit<StartMsg, 'type' | 'runId'>) {
    this.runId = Math.floor(Math.random() * 1e9);
    // The worker starts from a blob: URL so it inherits this page's Content-Security-Policy (a worker loaded from its
    // own URL would not, on a host that sends no CSP header). The policy blocks firmware from loading remote code.
    const entry = new URL(simWorkerUrl, location.href).href;
    const blob = new Blob([`import ${JSON.stringify(entry)};`], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    this.worker = new Worker(blobUrl, { type: 'module' });
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.runId !== this.runId) return;
      if (m.type === 'csv') { this.csvWaiters.shift()?.(m.csv); return; }
      this.pending = false;
      this.data.append(m);
      this.onUpdate();
    };
    this.worker.onerror = (e) => { e.preventDefault?.(); this.fail(e.message ? `Simulation worker error: ${e.message}` : 'The simulation worker could not load. This happens when LFSim was updated while the page was open: reload the page (your work is autosaved).'); };
    this.worker.postMessage({ type: 'start', runId: this.runId, ...start } satisfies StartMsg);
  }

  private fail(msg: string) {
    this.data.status = 'error'; this.data.error = msg;
    if (this.data.endTime === null) this.data.endTime = this.data.lastTime();
    this.pending = false;
    this.worker.terminate();
    this.onUpdate();
  }

  // Keep the simulation computed a little ahead of playback.
  ensureAhead(playT: number) {
    const d = this.data;
    if (d.status !== 'running') return;
    if (this.pending) {
      // Watchdog: firmware that never yields (no delay, no loop() return) freezes the worker.
      if (performance.now() - this.requestedAt > 4000) this.fail('The firmware ran 4 s of real time without returning from loop() or calling delay(). Add a delay or let loop() return.');
      return;
    }
    if (d.computedTime >= playT + 1.0) return;
    this.pending = true;
    this.requestedAt = performance.now();
    this.worker.postMessage({ type: 'advance', runId: this.runId, until: Math.max(d.computedTime, playT) + 2 });
  }

  stop(at: number) {
    const d = this.data;
    if (d.status === 'running') {
      d.status = 'stopped';
      d.endTime = at;
      d.events.push({ t: at, kind: 'log', text: 'Stopped by the user — did not finish', x: 0, y: 0 });
      this.worker.postMessage({ type: 'stop', runId: this.runId, at });
    }
  }

  csv(until: number): Promise<string> {
    return new Promise((res) => { this.csvWaiters.push(res); this.worker.postMessage({ type: 'csv', runId: this.runId, until }); });
  }

  dispose() { this.worker.terminate(); }
}
