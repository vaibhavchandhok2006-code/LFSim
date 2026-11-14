// Autosave: small settings in localStorage, the track image in IndexedDB.
// Project files bundle everything into one JSON for export/import.

import { DEFAULT_PROFILE, RobotProfile } from '../sim/profile';
import { DEFAULT_SETTINGS, SettingsParams } from '../brain/settings';
import { DEFAULT_FLAGS, SimFlags } from '../sim/simulation';
import { Disturbances, Wiring } from '../worker/protocol';
import { SAMPLE_WIRING } from '../brain/sampleFirmware';
import type { RunSummary } from './run';

export interface CodeSetup {
  source: string;        // original firmware (for the side-by-side view)
  sourceLang: string;    // e.g. "Arduino C++ (ESP32)"
  translated: string;    // LFSim firmware JavaScript
  notes: string;         // translation notes from the skill
  wiring: Wiring;
}

export interface TrackSetup {
  presetId: 'roborun' | 'custom';
  custom: { width_m: number; height_m: number; lineWidth_cm: number; maxRobotL_mm: number; maxRobotW_mm: number };
  imageName: string;
  normaliseWidth: boolean;
  swapStartFinish: boolean;
  poseOverride: { x: number; y: number; theta: number } | null;
}

export interface AppSettings {
  profile: RobotProfile;
  settings: SettingsParams;
  flags: SimFlags;
  offLine_cm: number;
  track: TrackSetup;
  brainMode: 'settings' | 'code';
  code: CodeSetup;
  disturbances: Disturbances;
  theme: 'light' | 'dark';
}

export const DEFAULT_TRACK_SETUP: TrackSetup = {
  presetId: 'roborun',
  custom: { width_m: 2.5, height_m: 2.5, lineWidth_cm: 3.8, maxRobotL_mm: 250, maxRobotW_mm: 250 },
  imageName: 'roborun-sample.png',
  normaliseWidth: true,
  swapStartFinish: false,
  poseOverride: null,
};

export const DEFAULTS: AppSettings = {
  profile: DEFAULT_PROFILE,
  settings: DEFAULT_SETTINGS,
  flags: DEFAULT_FLAGS,
  offLine_cm: 4,
  track: DEFAULT_TRACK_SETUP,
  brainMode: 'settings',
  code: { source: '', sourceLang: '', translated: '', notes: '', wiring: SAMPLE_WIRING },
  disturbances: { lighting: { on: false, strength: 0.5 }, bumps: { on: false, strength: 0.5 }, seed: 7 },
  theme: 'light',
};

const KEY = 'lfsim.settings.v1';

// Deep-merge saved values over defaults so new fields added in later versions get defaults.
function merge<T>(base: T, saved: unknown): T {
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved) || base === null || typeof base !== 'object') {
    return (saved === undefined ? base : (saved as T));
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    out[k] = k in out ? merge(out[k], v) : v;
  }
  return out as T;
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? merge(DEFAULTS, JSON.parse(raw)) : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(s: AppSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: keep running */ }
}

// ---- IndexedDB for the track image ----
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('lfsim', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTrackImage(blob: Blob): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction('files', 'readwrite');
      tx.objectStore('files').put(blob, 'trackImage');
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  } catch { /* ignore */ }
}

export async function loadTrackImage(): Promise<Blob | null> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const req = d.transaction('files').objectStore('files').get('trackImage');
      req.onsuccess = () => res((req.result as Blob) ?? null);
      req.onerror = () => res(null);
    });
  } catch { return null; }
}

// ---- Project file ----
export interface ProjectFile {
  lfsim: 'project';
  version: 1;
  settings: AppSettings;
  trackImage: string | null; // data URL
  runs: RunSummary[];
  memory: Record<string, unknown> | null;
}

export interface TrackFile {
  lfsim: 'track';
  version: 1;
  setup: TrackSetup;
  image: string; // data URL
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(b); });
}

export async function dataUrlToBlob(u: string): Promise<Blob> {
  return (await fetch(u)).blob();
}

export function download(name: string, data: Blob | string, type = 'application/json') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const MAX_IMPORT_BYTES = 40 * 1024 * 1024;

function isObj(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// Check every number in `v` that also exists in `base` is a finite number (recursive). Returns the first bad path.
function badNumbers(base: unknown, v: unknown, path = ''): string | null {
  if (typeof base === 'number') return typeof v === 'number' && Number.isFinite(v) ? null : path || '(value)';
  if (isObj(base) && isObj(v)) {
    for (const k of Object.keys(base)) if (k in v) { const r = badNumbers(base[k], v[k], path ? `${path}.${k}` : k); if (r) return r; }
  }
  return null;
}

function checkImage(u: unknown): string {
  if (typeof u !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(u)) throw new Error('The embedded track image is not a PNG, JPEG or WebP data URL.');
  return u;
}

export type Imported =
  | { kind: 'project'; value: ProjectFile }
  | { kind: 'robot'; value: RobotProfile; code: Partial<CodeSetup> | null }
  | { kind: 'track'; value: TrackFile };

// Imported files are untrusted: check the type, version, sizes and every number before using them.
export function parseImport(text: string): Imported {
  if (text.length > MAX_IMPORT_BYTES) throw new Error('That file is too large (over 40 MB).');
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!isObj(j)) throw new Error('That file is not an LFSim file.');
  if (j.lfsim === 'project') {
    if (j.version !== 1) throw new Error(`Project file version ${String(j.version)} is not supported (expected 1).`);
    if (!isObj(j.settings)) throw new Error('The project file has no settings.');
    const settings = merge(DEFAULTS, j.settings);
    const bad = badNumbers(DEFAULTS, settings);
    if (bad) throw new Error(`The project file has an invalid number at ${bad}.`);
    const runs = Array.isArray(j.runs) ? (j.runs as RunSummary[]).filter((r) => isObj(r) && typeof r.label === 'string').slice(0, 200) : [];
    return { kind: 'project', value: { lfsim: 'project', version: 1, settings, trackImage: j.trackImage ? checkImage(j.trackImage) : null, runs, memory: isObj(j.memory) ? j.memory : null } };
  }
  if (j.lfsim === 'track') {
    if (j.version !== 1) throw new Error(`Track file version ${String(j.version)} is not supported (expected 1).`);
    const setup = merge(DEFAULT_TRACK_SETUP, j.setup);
    const bad = badNumbers(DEFAULT_TRACK_SETUP, setup);
    if (bad) throw new Error(`The track file has an invalid number at ${bad}.`);
    return { kind: 'track', value: { lfsim: 'track', version: 1, setup, image: checkImage(j.image) } };
  }
  if (j.version === 1 && typeof j.wheelbase_mm === 'number') {
    const { firmware, ...rest } = j as Record<string, unknown> & { firmware?: unknown };
    const value = merge(DEFAULT_PROFILE, rest);
    const bad = badNumbers(DEFAULT_PROFILE, value);
    if (bad) throw new Error(`The robot file has an invalid number at ${bad}.`);
    if (value.sensor.channels < 2 || value.sensor.channels > 32) throw new Error('The robot file must have 2 to 32 sensor channels.');
    let code: Partial<CodeSetup> | null = null;
    if (isObj(firmware)) {
      code = {};
      for (const k of ['source', 'sourceLang', 'translated', 'notes'] as const) if (typeof firmware[k] === 'string') code[k] = firmware[k] as string;
      if (isObj(firmware.wiring)) code.wiring = merge(SAMPLE_WIRING, firmware.wiring);
    }
    return { kind: 'robot', value, code };
  }
  throw new Error('This file is not an LFSim project (.lfsim.json), robot (.robot.json) or track (.track.json).');
}
