// Turn a decoded image (RGBA) plus the Track tab's setup into a Track. Shared by the website (canvas decode) and the
// command line (PNG decode), so both build exactly the same track from the same pixels.
import { processTrack, rgbaToGray, startPoseFor } from './importTrack';
import { PRESETS, Track, TrackPreset } from './track';
import type { RobotProfile } from '../sim/profile';
import type { TrackSetup } from '../ui/persist';
import { MAP_RES } from './importTrack';
import { warpGray, type Quad } from './warp';

export function presetFor(setup: TrackSetup): TrackPreset {
  if (setup.presetId === 'roborun') return PRESETS[0];
  if (setup.presetId === 'roborun-2027') return PRESETS[2];
  return { ...PRESETS[1], ...setup.custom };
}

export function buildTrackFromRgba(rgba: Uint8ClampedArray, width: number, height: number, setup: TrackSetup, profile: RobotProfile): { track: Track; messages: string[] } {
  let gray = rgbaToGray(rgba);
  const preset = presetFor(setup);
  // Angled photo: flatten the marked mat to top-down first (at the map's 2 mm/px); the crop is then not used.
  if (setup.corners && setup.corners.length === 4) {
    const q = setup.corners.map(([x, y]) => [(x / 100) * width, (y / 100) * height]) as Quad;
    const W = Math.round(preset.width_m / MAP_RES), H = Math.round(preset.height_m / MAP_RES);
    gray = warpGray(gray, width, height, q, W, H);
    const { track, report } = processTrack(gray, W, H, preset, { normaliseWidth: setup.normaliseWidth, imageName: setup.imageName });
    if (setup.swapStartFinish && track.finish) { const s = track.start; track.start = track.finish; track.finish = s; }
    track.startPose = setup.poseOverride ?? startPoseFor(track, profile.axleFromFront_mm / 1000);
    return { track, messages: ['Perspective corrected from the four marked corners.', ...report.messages] };
  }
  const cr = setup.crop ?? { left_pct: 0, top_pct: 0, right_pct: 0, bottom_pct: 0 };
  const clampPct = (v: number) => Math.max(0, Math.min(45, Number.isFinite(v) ? v : 0));
  const x0 = Math.round((width * clampPct(cr.left_pct)) / 100), x1 = Math.round(width * (1 - clampPct(cr.right_pct) / 100));
  const y0 = Math.round((height * clampPct(cr.top_pct)) / 100), y1 = Math.round(height * (1 - clampPct(cr.bottom_pct) / 100));
  const cropped = x0 > 0 || y0 > 0 || x1 < width || y1 < height;
  const { track, report } = processTrack(gray, width, height, preset, {
    crop: cropped ? { x0, y0, x1, y1 } : undefined,
    normaliseWidth: setup.normaliseWidth,
    imageName: setup.imageName,
  });
  if (setup.swapStartFinish && track.finish) {
    const s = track.start; track.start = track.finish; track.finish = s;
  }
  track.startPose = setup.poseOverride ?? startPoseFor(track, profile.axleFromFront_mm / 1000);
  return { track, messages: report.messages };
}
