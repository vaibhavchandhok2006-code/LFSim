// Native firmware in the loop: the user's C firmware is compiled with GCC against LFSim's hardware shim
// (lab/firmware/shim) and run as its own process. Each hardware call arrives as one line on the process's stdout and is
// run through the same hardware model as LFSim's Code mode (src/brain/firmware.ts), so time, sensors, motors and
// buttons behave exactly as there. The firmware only reaches the simulator through this pipe.
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { FirmwareBrain } from '../../src/brain/firmware';
import type { RobotProfile } from '../../src/sim/profile';
import type { OperatorScript, Wiring } from '../../src/worker/protocol';

const SHIM = new URL('../firmware/shim/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CACHE = path.join(new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '.cache', 'firmware');

export interface BuildResult { exe: string; cached: boolean; log: string }

// Compile firmware sources (.c files; headers next to them are found) into a simulator executable. Rebuilds only when
// a source, the shim or the options change.
export function buildFirmware(sources: string[], opts: { cc?: string; defines?: string[] } = {}): BuildResult {
  if (!sources.length) throw new Error('No firmware source files given.');
  for (const s of sources) {
    if (!fs.existsSync(s)) throw new Error(`Firmware file not found: ${s}`);
    if (!/\.(c|cpp|cc)$/i.test(s)) throw new Error(`${s}: firmware sources must be .c files (Arduino .ino arrives later in Phase 2).`);
    if (fs.statSync(s).size > 2_000_000) throw new Error(`${s}: source file too large.`);
  }
  const cc = opts.cc ?? process.env.LFSIM_CC ?? 'gcc';
  const defines = opts.defines ?? [];
  const h = createHash('sha256');
  for (const f of [...sources, path.join(SHIM, 'shim.c'), ...fs.readdirSync(path.join(SHIM, 'include'), { recursive: true }).map((x) => path.join(SHIM, 'include', String(x))).filter((x) => fs.statSync(x).isFile()).sort()]) {
    h.update(f); h.update(fs.readFileSync(f));
  }
  for (const s of sources) for (const x of fs.readdirSync(path.dirname(s))) if (/\.h$/i.test(x)) { h.update(x); h.update(fs.readFileSync(path.join(path.dirname(s), x))); }
  h.update(JSON.stringify({ cc, defines }));
  const dir = path.join(CACHE, h.digest('hex').slice(0, 16));
  const exe = path.join(dir, os.platform() === 'win32' ? 'firmware.exe' : 'firmware');
  if (fs.existsSync(exe)) return { exe, cached: true, log: '' };
  fs.mkdirSync(dir, { recursive: true });
  const args = [
    // -Wno-format: int64_t is 'long' on a 64-bit PC but 'long long' on the ESP32, so %lld is right for the chip.
    '-O2', '-std=gnu11', '-ffp-contract=off', '-Wall', '-Wno-format', '-Wno-unused-function', '-Wno-unused-variable', '-Wno-unused-but-set-variable',
    '-I', path.join(SHIM, 'include'), ...[...new Set(sources.map((s) => path.dirname(path.resolve(s))))].flatMap((d) => ['-I', d]),
    '-include', 'lfsim_shim.h', ...defines.map((d) => `-D${d}`),
    ...sources, path.join(SHIM, 'shim.c'), '-lm', '-o', exe,
  ];
  const r = spawnSync(cc, args, { encoding: 'utf8' });
  if (r.error) throw new Error(`Could not run the C compiler "${cc}" (${r.error.message}). Install GCC (Windows: MSYS2, see lab/docs/WINDOWS_SETUP.md) or set LFSIM_CC.`);
  const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) throw new Error(`The firmware did not compile:\n${log.trim()}`);
  return { exe, cached: false, log };
}

// The firmware brain for a native executable: the same hardware model as Code mode, fed by the process's calls.
export class NativeFirmwareBrain extends FirmwareBrain {
  override readonly name = 'Native firmware';
  private child: ChildProcessWithoutNullStreams | null = null;
  private stderr = '';

  constructor(private readonly exe: string, wiring: Wiring, profile: RobotProfile, operator: OperatorScript | null = null) {
    super('', wiring, profile, operator);
  }

  protected override compile() {
    return { app_main: () => this.pump() };
  }

  override dispose(): void {
    if (this.child && this.child.exitCode === null) this.child.kill();
    this.child = null;
  }

  private async pump(): Promise<void> {
    const api = this.api() as Record<string, unknown>;
    const child = spawn(this.exe, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stderr.on('data', (d: Buffer) => { this.stderr = (this.stderr + d.toString()).slice(-4000); });
    child.stdin.on('error', () => {}); // the firmware may exit while we write
    const rl = readline.createInterface({ input: child.stdout });
    const lines: string[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    rl.on('line', (l) => { lines.push(l); if (wake) { const w = wake; wake = null; w(); } });
    rl.on('close', () => { ended = true; if (wake) { const w = wake; wake = null; w(); } });
    const exited = new Promise<number | null>((res) => child.on('exit', (code) => res(code)));
    const handles: unknown[] = [null];
    const conv = (x: unknown): unknown => {
      if (x && typeof x === 'object' && !Array.isArray(x)) {
        const o = x as Record<string, unknown>;
        if (typeof o.h === 'number') return handles[o.h];
        if (typeof o.cb === 'number') { const k = o.cb; return () => { child.stdin.write(`I ${k}\n`); }; }
      }
      return x;
    };
    const num = (v: unknown): number => {
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (v && typeof v === 'object') { handles.push(v); return handles.length - 1; }
      return 0;
    };
    try {
      for (;;) {
        if (!lines.length) {
          if (ended) {
            const code = await exited;
            throw new Error(`The firmware process stopped (exit code ${code})${this.stderr ? `: ${this.stderr.trim().slice(-500)}` : ''}.`);
          }
          await new Promise<void>((r) => { wake = r; });
          continue;
        }
        const line = lines.shift()!;
        let m: { f: string; a: unknown[]; r: number; o: number };
        try { m = JSON.parse(line); } catch { throw new Error(`Unreadable message from the firmware: ${line.slice(0, 120)}`); }
        if (m.f === '__print') { (api.printf as (f: string, ...a: unknown[]) => void)('%s', m.a[0]); continue; }
        if (m.f === '__log') { const fn = api[`ESP_LOG${m.a[0]}`] as ((t: string, f: string, ...a: unknown[]) => void) | undefined; fn?.(String(m.a[1]), '%s', m.a[2]); continue; }
        if (m.f === '__fail') throw new Error(String(m.a[0]));
        if (m.f.startsWith('__nvs_')) { this.nvs(m.f, m.a, child); continue; }
        if (m.f === '__cost') { this.spend(Number(m.a[0]) / 1e6); continue; }
        if (m.f === '__snap') { child.stdin.write(this.snapLine(Number(m.a[0]), String(m.a[1]), handles)); continue; }
        if (m.f === '__delay') { // vTaskDelay with fast I/O: spend the firmware's CPU time, wait, reply with a snapshot
          this.spend(Number(m.a[0]) / 1e6);
          await (api.vTaskDelay as (ms: number) => Promise<void>)(Number(m.a[1]));
          child.stdin.write(this.snapLine(0, 'none', handles));
          continue;
        }
        const fn = api[m.f];
        if (typeof fn !== 'function') throw new Error(`${m.f}() is not simulated yet.`);
        const args = m.a.map(conv);
        const out = { value: 0 as unknown };
        if (m.o) args.push(out);
        let ret = (fn as (...a: unknown[]) => unknown)(...args);
        if (ret && typeof (ret as Promise<unknown>).then === 'function') ret = await ret;
        if (m.r) child.stdin.write(`R ${num(ret)} ${m.o ? num(out.value) : 0}\n`);
      }
    } finally {
      rl.close();
      this.dispose();
    }
  }

  // Simulated flash (NVS): stored in the session's memory so it survives between runs, as flash survives a power
  // cycle. Values are kept as bytes (hex) with their type; reading a key as another type finds nothing, as on the chip.
  private nvs(f: string, a: unknown[], child: ChildProcessWithoutNullStreams) {
    const flash = this.flash();
    const ns = String(a[0]);
    const k = (key: unknown) => `nvs/${ns}/${String(key)}`;
    if (f === '__nvs_set') {
      const hex = String(a[3]);
      if (!/^[0-9a-f]*$/.test(hex) || hex.length > 32000) throw new Error('Firmware wrote an invalid value to flash.');
      flash[k(a[1])] = { type: String(a[2]), hex };
    } else if (f === '__nvs_get') {
      const v = flash[k(a[1])] as { type: string; hex: string } | undefined;
      const want = String(a[2]);
      if (!v || (want !== '*' && v.type !== want)) child.stdin.write('T -1\n');
      else child.stdin.write(`T ${v.hex.length / 2} ${v.hex}\n`);
    } else if (f === '__nvs_erase') {
      const prefix = ns === '*' ? 'nvs/' : a[1] === null ? `nvs/${ns}/` : k(a[1]);
      for (const key of Object.keys(flash)) if (a[1] === null || ns === '*' ? key.startsWith(prefix) : key === prefix) delete flash[key];
    } else throw new Error(`${f}() is not simulated.`);
  }

  // Fast I/O (LFSIM_FAST_IO): everything the firmware reads in this physics tick, in one line:
  // S <tick left µs> <now µs> <ADC read cost µs> <call cost µs> <n> {<adc handle> <channel> <value>}… <m> {<pcnt unit> <count>}…
  private snapLine(flush_us: number, first: string, handles: unknown[]): string {
    const first_s = first === 'adc' ? (this.wiring.board === 'avr' ? 112e-6 : 10e-6) : first === 'pcnt' ? 0.5e-6 : 0;
    const sn = this.snapshot(flush_us / 1e6, first_s);
    const adc: string[] = [];
    handles.forEach((h, id) => {
      const unit = (h as { unit?: number } | null)?.unit;
      if (unit !== 1 && unit !== 2) return;
      for (const a of this.wiring.adcChannels) if (a.unit === unit) {
        const i = this.wiring.sensorPins.indexOf(a.gpio);
        if (i >= 0) adc.push(`${id} ${a.channel} ${sn.sensors[i]}`);
      }
    });
    const pc = sn.pcnt.map((p) => `${p.unit} ${p.count}`);
    return `S ${(sn.tickLeft_s * 1e6).toFixed(3)} ${sn.now_us} ${sn.costAdc_s * 1e6} ${sn.costCall_s * 1e6} ${adc.length} ${adc.join(' ')} ${pc.length} ${pc.join(' ')}\n`;
  }
}

// A basic guard for firmware written by an AI agent before it is compiled and run as a native program: refuse calls
// that reach files, processes or the network, and inline assembly. Not a sandbox — it catches mistakes and obvious
// misuse; review agent changes before trusting them (see DECISIONS.md).
const BANNED: [RegExp, string][] = [
  [/\b(system|popen|fork|vfork|execl|execlp|execle|execv|execvp|execve|posix_spawn|dlopen|syscall)\s*\(/, 'process or system call'],
  [/\b(fopen|freopen|open|openat|creat|unlink|remove|rename|mkdir|rmdir|opendir)\s*\(/, 'file access'],
  [/\b(socket|connect|bind|listen|accept|getaddrinfo|gethostbyname)\s*\(/, 'network access'],
  [/\b(asm|__asm__|__asm)\b/, 'inline assembly'],
  [/#\s*include\s*<(unistd|fcntl|dirent|dlfcn|spawn|netdb|windows|io|process)\.h>|#\s*include\s*<(sys|arpa|netinet)\//, 'system header'],
];
export function checkUntrusted(sources: string[]): string[] {
  const out: string[] = [];
  for (const f of sources) {
    const text = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const [re, what] of BANNED) if (re.test(text)) out.push(`${path.basename(f)}: ${what} (${re.exec(text)![0].trim()})`);
  }
  return out;
}
