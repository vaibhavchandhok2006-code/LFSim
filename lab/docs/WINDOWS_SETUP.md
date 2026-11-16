# LFSim Lab — Windows setup

One-time setup of your Windows laptop for LFSim Lab. Takes about 20–30 minutes. Use **PowerShell** (Start menu →
"Windows PowerShell" or "Terminal"); you do not need to run it as Administrator unless a step says so.

## 1. Install the tools

Copy each line into PowerShell and press Enter. Close and reopen PowerShell after this step so the new commands are found.

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install MSYS2.MSYS2
irm https://claude.ai/install.ps1 | iex
```

| Tool | What it is for |
| --- | --- |
| Git | Getting the LFSim code and saving changes |
| Node.js (LTS, 20 or newer) | Runs the simulator and the jobs |
| MSYS2 | Gives you the GCC C compiler, so your real firmware can run in the simulator (Phase 2) |
| Claude Code | The AI agents (Phase 5) and building LFSim with me on your laptop |

If PowerShell then says **`claude` is not recognized**, the installer could not add its folder to PATH. Run this,
then close and reopen PowerShell:

```powershell
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$HOME\.local\bin", "User")
```

If **`npm` cannot be loaded because running scripts is disabled**, allow scripts for your user only (answer Y):

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## 2. Set up the C compiler (MSYS2)

1. Open **MSYS2 UCRT64** from the Start menu (a black terminal).
2. Run: `pacman -S --needed mingw-w64-ucrt-x86_64-gcc` and answer `Y`.
3. Add the compiler to Windows' PATH: Start → "Edit the system environment variables" → Environment Variables →
   under *User variables* select **Path** → Edit → New → `C:\msys64\ucrt64\bin` → OK on every window.
4. Reopen PowerShell and check: `gcc --version` prints a version.

## 3. Sign in to Claude Code

Run `claude` only inside the LFSim folder (step 4), not in your home folder: when it asks whether you trust the
folder, say yes only for `Documents\LFSim`. Choose to sign in with your Claude account (your Pro plan) and finish in the browser.
Type `/exit` to leave. `claude --version` should now print a version.

## 4. Get LFSim and check everything

```powershell
cd $HOME\Documents
git clone https://github.com/vaibhavchandhok2006-code/LFSim.git
cd LFSim
npm ci
npm test
npm run lab -- doctor
```

`npm run lab -- doctor` should show **OK** on all four lines. If one says **MISSING**, it prints the fix.

## 5. First headless run

```powershell
npm run lab -- run --track public/samples/roborun-sample.png --algorithm left-hand --seconds 60 --csv run.csv
```

It prints the result (status, run time, off-line count, distance, decisions) and writes the same CSV the website
exports. To run exactly what you set up in the website: **Save project** there, then

```powershell
npm run lab -- run --project path\to\your.lfsim.json --seconds 120
```

## Keeping the laptop awake for overnight jobs

Settings → System → Power → set *Screen and sleep* "When plugged in, put my device to sleep after" to **Never**
while a long job runs, and keep the charger connected.
