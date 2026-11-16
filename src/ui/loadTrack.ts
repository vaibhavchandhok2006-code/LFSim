import { Track } from '../track/track';
import { RobotProfile } from '../sim/profile';
import { TrackSetup } from './persist';
import { buildTrackFromRgba } from '../track/buildTrack';
export { presetFor } from '../track/buildTrack';

export async function buildTrack(image: Blob, setup: TrackSetup, profile: RobotProfile): Promise<{ track: Track; messages: string[]; size: { w: number; h: number } }> {
  const bmp = await createImageBitmap(image);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const { track, messages } = buildTrackFromRgba(data, c.width, c.height, setup, profile);
  return { track, messages, size: { w: c.width, h: c.height } };
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
