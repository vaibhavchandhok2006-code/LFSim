import { processTrack, rgbaToGray, startPoseFor } from '../track/importTrack';
import { PRESETS, Track, TrackPreset } from '../track/track';
import { RobotProfile } from '../sim/profile';
import { TrackSetup } from './persist';

export function presetFor(setup: TrackSetup): TrackPreset {
  if (setup.presetId === 'roborun') return PRESETS[0];
  return { ...PRESETS[1], ...setup.custom };
}

export async function buildTrack(image: Blob, setup: TrackSetup, profile: RobotProfile): Promise<{ track: Track; messages: string[]; size: { w: number; h: number } }> {
  const bmp = await createImageBitmap(image);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const gray = rgbaToGray(data);
  const cr = setup.crop ?? { left_pct: 0, top_pct: 0, right_pct: 0, bottom_pct: 0 };
  const clampPct = (v: number) => Math.max(0, Math.min(45, Number.isFinite(v) ? v : 0));
  const x0 = Math.round((c.width * clampPct(cr.left_pct)) / 100), x1 = Math.round(c.width * (1 - clampPct(cr.right_pct) / 100));
  const y0 = Math.round((c.height * clampPct(cr.top_pct)) / 100), y1 = Math.round(c.height * (1 - clampPct(cr.bottom_pct) / 100));
  const cropped = x0 > 0 || y0 > 0 || x1 < c.width || y1 < c.height;
  const { track, report } = processTrack(gray, c.width, c.height, presetFor(setup), {
    crop: cropped ? { x0, y0, x1, y1 } : undefined,
    normaliseWidth: setup.normaliseWidth,
    imageName: setup.imageName,
  });
  if (setup.swapStartFinish && track.finish) {
    const s = track.start; track.start = track.finish; track.finish = s;
  }
  track.startPose = setup.poseOverride ?? startPoseFor(track, profile.axleFromFront_mm / 1000);
  return { track, messages: report.messages, size: { w: c.width, h: c.height } };
}

// Render the darkness map into a canvas once; the viewport scales it.
export function trackBitmap(t: Track): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = t.w; c.height = t.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(t.w, t.h);
  for (let i = 0; i < t.w * t.h; i += 1) {
    const v = 250 - Math.round(t.dark[i] * 228);
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
