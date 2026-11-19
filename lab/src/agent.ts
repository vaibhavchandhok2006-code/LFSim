// The algorithm agent (Phase 5): Claude Code improves the maze firmware in rounds. Each round the runner measures the
// current version on tuning tracks, lets Claude Code make one change, checks the source for anything unsafe, measures
// again and keeps the change only if it is better (more finishes, or as many and faster). Every 5 rounds the best
// version is also checked on held-out tracks it never saw.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadSpace, runSearch } from './search';
import { checkUntrusted } from './native';

export interface AgentOptions {
  rounds: number; tracks: number; heldTracks: number; workers?: number; model?: string; outDir: string;
  spaceFile: string; claude?: string; log: (s: string) => void;
}

const FIRMWARE = 'lab/firmware/examples/maze/main';

async function measure(spaceFile: string, part: 'tune' | 'held', n: number, outDir: string, workers?: number) {
  const sp = loadSpace(spaceFile);
  const one = { ...sp, params: {}, rounds: [n], samples: 1, part };
  const r = await runSearch(one, outDir, { workers });
  const b = r.board[0];
  return { finished: b?.finished ?? 0, tried: b?.tried ?? 0, meanTime: b?.meanTime ?? null };
}
const better = (a: { finished: number; meanTime: number | null }, b: { finished: number; meanTime: number | null }) =>
  a.finished > b.finished || (a.finished === b.finished && a.finished > 0 && (a.meanTime ?? 1e9) < (b.meanTime ?? 1e9) - 2);

function git(args: string[]) { return spawnSync('git', args, { encoding: 'utf8' }); }

export async function runAgent(o: AgentOptions): Promise<void> {
  fs.mkdirSync(o.outDir, { recursive: true });
  const state = 'lab/agent/state.md';
  if (!fs.existsSync(state)) fs.writeFileSync(state, '# Algorithm agent — state\n\n');
  const prompt = fs.readFileSync('lab/agent/ALGORITHM_AGENT.md', 'utf8');
  const claude = o.claude ?? 'claude';
  let best = await measure(o.spaceFile, 'tune', o.tracks, path.join(o.outDir, 'r0'), o.workers);
  o.log(`round 0 (current version): ${best.finished}/${best.tried} finished, mean ${best.meanTime ?? '—'} s\n`);
  fs.appendFileSync(state, `- start: ${best.finished}/${best.tried} tuning tracks finished, mean ${best.meanTime ?? '—'} s\n`);
  for (let i = 1; i <= o.rounds; i += 1) {
    const before = git(['stash', 'create']).stdout.trim(); // snapshot, in case the round must be undone
    const args = ['-p', `${prompt}\n\nThis is round ${i}. Current score: ${best.finished}/${best.tried} tuning tracks finished, mean ${best.meanTime ?? '—'} s.`,
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read', 'Edit', 'Write', 'Grep', 'Glob',
      'Bash(npx tsx lab/tools/try-maze.ts:*)', 'Bash(python3 lab/tools/plot_run.py:*)', 'Bash(python3 lab/tools/junction_matches.py:*)',
      'Bash(gcc -fsyntax-only:*)', 'Bash(grep:*)', 'Bash(tail:*)', 'Bash(head:*)',
      ...(o.model ? ['--model', o.model] : [])];
    o.log(`round ${i}: Claude Code is working…\n`);
    const r = spawnSync(claude, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60 * 1000 });
    fs.writeFileSync(path.join(o.outDir, `round-${i}.txt`), (r.stdout ?? '') + (r.stderr ?? ''));
    if (r.error) throw new Error(`Could not run Claude Code (${claude}): ${r.error.message}`);
    const sources = fs.readdirSync(FIRMWARE).filter((f) => /\.[ch]$/.test(f)).map((f) => path.join(FIRMWARE, f));
    const unsafe = checkUntrusted(sources);
    let score = { finished: -1, tried: 0, meanTime: null as number | null };
    if (unsafe.length) o.log(`  refused: ${unsafe.join('; ')}\n`);
    else {
      try { score = await measure(o.spaceFile, 'tune', o.tracks, path.join(o.outDir, `r${i}`), o.workers); }
      catch (e) { o.log(`  did not build or run: ${(e as Error).message.slice(0, 300)}\n`); }
    }
    const kept = !unsafe.length && score.finished >= 0 && better(score, best);
    if (kept) {
      best = score;
      git(['add', FIRMWARE, state]);
      git(['commit', '-q', '-m', `agent round ${i}: ${score.finished}/${score.tried} finished, mean ${score.meanTime ?? '—'} s`]);
    } else {
      git(['checkout', '--', FIRMWARE]);
      if (before) git(['checkout', before, '--', FIRMWARE]);
    }
    fs.appendFileSync(state, `- round ${i}: ${score.finished}/${score.tried} (${kept ? 'kept' : 'undone'})\n`);
    o.log(`  ${score.finished}/${score.tried} finished, mean ${score.meanTime ?? '—'} s — ${kept ? 'kept' : 'undone'}\n`);
    if (i % 5 === 0 || i === o.rounds) {
      const h = await measure(o.spaceFile, 'held', o.heldTracks, path.join(o.outDir, `held-${i}`), o.workers);
      o.log(`  held-out check: ${h.finished}/${h.tried} finished, mean ${h.meanTime ?? '—'} s\n`);
      fs.appendFileSync(state, `- held-out after round ${i}: ${h.finished}/${h.tried}\n`);
    }
  }
}
