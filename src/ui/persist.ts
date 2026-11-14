// Autosave: small settings in localStorage, the track image in IndexedDB.
// Project files bundle everything into one JSON for export/import.

import { DEFAULT_PROFILE, RobotProfile } from '../sim/profile';
import { DEFAULT_SETTINGS, SettingsParams } from '../brain/settings';
import { DEFAULT_FLAGS, SimFlags } from '../sim/simulation';

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

export function parseImport(text: string): { kind: 'project' | 'robot'; value: ProjectFile | RobotProfile } {
  const j = JSON.parse(text);
  if (j && j.lfsim === 'project') return { kind: 'project', value: j as ProjectFile };
  if (j && j.version === 1 && typeof j.wheelbase_mm === 'number') return { kind: 'robot', value: merge(DEFAULT_PROFILE, j) };
  throw new Error('This file is not an LFSim project (.lfsim.json) or robot profile (.robot.json).');
}
