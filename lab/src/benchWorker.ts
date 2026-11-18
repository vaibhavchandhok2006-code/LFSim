// Worker thread: runs benchmark jobs sent by the main thread.
import { parentPort } from 'node:worker_threads';
import { runJob, type Job } from './benchJob';

parentPort!.on('message', async (j: Job) => { parentPort!.postMessage(await runJob(j)); });
