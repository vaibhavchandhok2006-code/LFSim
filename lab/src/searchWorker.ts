// Worker thread: runs search jobs sent by the main thread.
import { parentPort } from 'node:worker_threads';
import { runSearchJob, type SearchJob } from './searchJob';

parentPort!.on('message', async (j: SearchJob) => { parentPort!.postMessage(await runSearchJob(j)); });
