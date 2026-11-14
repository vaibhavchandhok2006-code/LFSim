/// <reference lib="webworker" />
// The simulation worker: one worker per run. Runs the engine ahead of playback in chunks.
import { Engine } from './engine';
import { ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;
let engine: Engine | null = null;
let busy: Promise<void> = Promise.resolve();

function lockDown() {
  // Firmware runs in this worker: remove network and storage APIs before any firmware is compiled.
  const g = self as unknown as Record<string, unknown>;
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'Worker', 'SharedWorker', 'BroadcastChannel']) {
    try { Object.defineProperty(g, k, { value: undefined, configurable: false, writable: false }); } catch { /* ignore */ }
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  busy = busy.then(async () => {
    if (m.type === 'start') {
      if (m.brain.mode === 'code') lockDown();
      engine = new Engine(m);
      self.postMessage(engine.drain());
      return;
    }
    if (!engine || engine.runId !== m.runId) return;
    if (m.type === 'advance') {
      await engine.advance(m.until);
      const out = engine.drain();
      self.postMessage(out, [out.frames.buffer]);
    } else if (m.type === 'stop') {
      engine.stopAt(m.at);
      self.postMessage(engine.drain());
    } else if (m.type === 'csv') {
      self.postMessage({ type: 'csv', runId: m.runId, csv: engine.csv(m.until) });
    }
  });
};
