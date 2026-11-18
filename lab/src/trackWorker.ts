// Worker thread: generates tracks for a track set.
import { parentPort } from 'node:worker_threads';
import { makeOne, type TrackJob } from './tracksets';

parentPort!.on('message', (m: { i: number; job: TrackJob }) => {
  try { parentPort!.postMessage({ i: m.i, entry: makeOne(m.job) }); }
  catch (e) { parentPort!.postMessage({ i: m.i, error: (e as Error).message }); }
});
