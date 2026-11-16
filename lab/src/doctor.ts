// Check the tools LFSim Lab needs on this computer and say how to fix what is missing.
import { execFileSync } from 'node:child_process';

interface Check { name: string; ok: boolean; found: string; fix: string; needed: string }

function version(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, shell: process.platform === 'win32' }).trim().split(/\r?\n/)[0];
  } catch { return null; }
}

export function doctor(): { checks: Check[]; ok: boolean } {
  const win = process.platform === 'win32';
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const git = version('git', ['--version']);
  const gcc = version('gcc', ['--version']);
  const claude = version('claude', ['--version']);
  const checks: Check[] = [
    { name: 'Node.js', needed: 'Phase 0', ok: nodeMajor >= 20, found: `v${process.versions.node}`, fix: win ? 'winget install OpenJS.NodeJS.LTS' : 'Install Node.js 22 LTS' },
    { name: 'Git', needed: 'Phase 0', ok: git !== null, found: git ?? 'not found', fix: win ? 'winget install Git.Git' : 'sudo apt install git' },
    { name: 'C compiler (gcc)', needed: 'Phase 2 (firmware in the loop)', ok: gcc !== null, found: gcc ?? 'not found',
      fix: win ? 'Install MSYS2 (winget install MSYS2.MSYS2), then in the "MSYS2 UCRT64" shell: pacman -S --needed mingw-w64-ucrt-x86_64-gcc, and add C:\\msys64\\ucrt64\\bin to PATH' : 'sudo apt install build-essential' },
    { name: 'Claude Code', needed: 'Phase 5 (algorithm agent)', ok: claude !== null, found: claude ?? 'not found',
      fix: win ? 'In PowerShell: irm https://claude.ai/install.ps1 | iex   then open a new terminal and run: claude' : 'curl -fsSL https://claude.ai/install.sh | bash' },
  ];
  return { checks, ok: checks.every((c) => c.ok) };
}
