import { processTrack, rgbaToGray, startPoseFor } from '../track/importTrack';
import { PRESETS, Track, TrackPreset } from '../track/track';
import { RobotProfile } from '../sim/profile';
import { TrackSetup } from './persist';

export function presetFor(setup: TrackSetup): TrackPreset {
  if (setup.presetId === 'roborun') return PRESETS[0];
  return { ...PRESETS[1], ...setup.custom };
}

export async function buildTrack(image: Blob, setup: TrackSetup, profile: RobotProfile): Promise<{ track: Track; messages: string[] }> {
  const bmp = await createImageBitmap(image);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const gray = rgbaToGray(data);
  const { track, report } = processTrack(gray, c.width, c.height, presetFor(setup), {
    normaliseWidth: setup.normaliseWidth,
    imageName: setup.imageName,
  });
  if (setup.swapStartFinish && track.finish) {
    const s = track.start; track.start = track.finish; track.finish = s;
  }
  track.startPose = setup.poseOverride ?? startPoseFor(track, profile.axleFromFront_mm / 1000);
  return { track, messages: report.messages };
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
