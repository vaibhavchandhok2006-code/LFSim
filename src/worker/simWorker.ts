/// <reference lib="webworker" />
// The simulation worker: one worker per run. Runs the engine ahead of playback in chunks.
import { Engine } from './engine';
import { ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;
let engine: Engine | null = null;
let busy: Promise<void> = Promise.resolve();

// Names firmware must never reach. Removing them only from the global object is not enough: firmware can recover the
// global (e.g. via a Function constructor) and find them again on WorkerGlobalScope.prototype and friends, so they are
// removed from every object on the global's prototype chain. Dynamic import() cannot be removed from JavaScript; the
// page's Content-Security-Policy (inherited by this blob-URL worker) blocks it for any other origin.
const NETWORK_AND_STORAGE = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts', 'indexedDB',
  'caches', 'Worker', 'SharedWorker', 'BroadcastChannel', 'Request', 'Response', 'Headers', 'navigator', 'location',
  'RTCPeerConnection', 'WebSocketStream', 'cookieStore', 'storage'];

function lockDown() {
  let o: object | null = self;
  while (o && o !== Object.prototype) {
    for (const k of NETWORK_AND_STORAGE) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      try { Object.defineProperty(o, k, { value: undefined, configurable: false, writable: false }); } catch { /* ignore */ }
      try { delete (o as Record<string, unknown>)[k]; } catch { /* ignore */ }
    }
    o = Object.getPrototypeOf(o);
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
