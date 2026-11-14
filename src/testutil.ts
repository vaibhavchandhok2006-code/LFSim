// Test helpers (Node only): load the sample Robo-Run track from public/samples.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { processTrack, rgbaToGray, startPoseFor } from './track/importTrack';
import { PRESETS, Track } from './track/track';
import { DEFAULT_PROFILE } from './sim/profile';

let cached: Track | null = null;

export function loadSampleTrack(): Track {
  if (cached) return cached;
  const png = PNG.sync.read(readFileSync(new URL('../public/samples/roborun-sample.png', import.meta.url)));
  const gray = rgbaToGray(new Uint8ClampedArray(png.data));
  const { track } = processTrack(gray, png.width, png.height, PRESETS[0], { imageName: 'roborun-sample.png' });
  track.startPose = startPoseFor(track, DEFAULT_PROFILE.axleFromFront_mm / 1000);
  cached = track;
  return track;
}
