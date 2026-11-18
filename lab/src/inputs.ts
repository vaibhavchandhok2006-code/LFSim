// Read the inputs of a headless run: a project file (everything, as saved from the website), or a track plus an
// optional robot file. Files are untrusted and go through the same checks as in the website.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULTS, DEFAULT_TRACK_SETUP, checkCorners, parseImport, type AppSettings, type TrackSetup } from '../../src/ui/persist';
import { buildTrackFromRgba } from '../../src/track/buildTrack';
import type { StartMsg } from '../../src/worker/protocol';
import type { Algorithm } from '../../src/brain/settings';
import { decodeDataUrl, decodeImage, type Decoded } from './image';

export interface InputOptions {
  project?: string;      // .lfsim.json
  track?: string;        // .png or .track.json
  robot?: string;        // .robot.json
  mode?: 'settings' | 'code';
  algorithm?: Algorithm;
  seed?: number;
  memory?: string;       // JSON file with the robot's memory (EEPROM/NVS) from an earlier run
  corners?: string;      // angled photo: "x1,y1,x2,y2,x3,y3,x4,y4" in % of the image (TL, TR, BR, BL)
}

const readText = (p: string) => {
  const st = fs.statSync(p);
  if (st.size > 40 * 1024 * 1024) throw new Error(`${p}: file too large.`);
  return fs.readFileSync(p, 'utf8');
};

export interface Loaded { start: Omit<StartMsg, 'type' | 'runId'>; app: AppSettings; messages: string[] }

export function loadInputs(o: InputOptions): Loaded {
  let app: AppSettings = structuredClone(DEFAULTS);
  let setup: TrackSetup = structuredClone(DEFAULT_TRACK_SETUP);
  let image: Decoded | null = null;
  let memory: Record<string, unknown> = {};

  if (o.project) {
    const imp = parseImport(readText(o.project));
    if (imp.kind !== 'project') throw new Error(`${o.project} is not an LFSim project file.`);
    app = imp.value.settings;
    setup = app.track;
    if (imp.value.trackImage) image = decodeDataUrl(imp.value.trackImage, `${o.project} track image`);
  }
  if (o.track) {
    if (o.track.toLowerCase().endsWith('.json')) {
      const imp = parseImport(readText(o.track));
      if (imp.kind !== 'track') throw new Error(`${o.track} is not an LFSim track file.`);
      setup = imp.value.setup;
      image = decodeDataUrl(imp.value.image, `${o.track} image`);
    } else {
      image = decodeImage(fs.readFileSync(o.track), o.track);
      setup = { ...setup, imageName: path.basename(o.track), poseOverride: null };
    }
  }
  if (!image) throw new Error('No track image: give --project with an embedded image, or --track.');
  if (o.corners !== undefined) {
    const v = o.corners.split(',').map(Number);
    if (v.length !== 8) throw new Error('--corners needs 8 numbers: x1,y1,x2,y2,x3,y3,x4,y4 (in % of the image; top-left, top-right, bottom-right, bottom-left).');
    setup = { ...setup, corners: checkCorners([[v[0], v[1]], [v[2], v[3]], [v[4], v[5]], [v[6], v[7]]]) };
  }
  if (o.robot) {
    const imp = parseImport(readText(o.robot));
    if (imp.kind !== 'robot') throw new Error(`${o.robot} is not an LFSim robot file.`);
    app.profile = imp.value;
    if (imp.code) { app.code = { ...app.code, ...imp.code }; if (imp.code.translated?.trim()) app.brainMode = 'code'; }
  }
  if (o.mode) app.brainMode = o.mode;
  if (o.algorithm) app.settings = { ...app.settings, algorithm: o.algorithm };
  if (o.seed !== undefined) app.disturbances = { ...app.disturbances, seed: o.seed };
  if (o.memory) {
    const m = JSON.parse(readText(o.memory));
    if (typeof m !== 'object' || m === null || Array.isArray(m)) throw new Error(`${o.memory}: memory must be a JSON object.`);
    memory = m;
  }
  if (app.brainMode === 'code' && !app.code.translated.trim()) throw new Error('Code mode needs translated firmware (a robot file from the lfsim-robot skill).');

  // As the website: the track is built without the pose override, then the saved pose (if any) is applied.
  const { track, messages } = buildTrackFromRgba(image.rgba, image.width, image.height, { ...setup, poseOverride: null }, app.profile);
  if (setup.poseOverride) track.startPose = setup.poseOverride;
  app.track = setup;
  return {
    app, messages,
    start: {
      track, profile: app.profile,
      brain: app.brainMode === 'settings' ? { mode: 'settings', settings: app.settings } : { mode: 'code', code: app.code.translated, wiring: app.code.wiring },
      flags: app.flags, disturbances: app.disturbances, offLine_cm: app.offLine_cm, memory,
    },
  };
}
