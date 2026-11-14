import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SettingsBrain } from './brain/settings';
import { Simulation } from './sim/simulation';
import { startPoseFor } from './track/importTrack';
import { Pose, Track } from './track/track';
import { BrainPanel } from './ui/BrainPanel';
import { LivePanel } from './ui/LivePanel';
import { buildTrack, presetFor, trackBitmap } from './ui/loadTrack';
import {
  AppSettings, blobToDataUrl, dataUrlToBlob, download, loadSettings, loadTrackImage, parseImport, ProjectFile,
  saveSettings, saveTrackImage,
} from './ui/persist';
import { RobotPanel } from './ui/RobotPanel';
import { SimPanel } from './ui/SimPanel';
import { TrackPanel } from './ui/TrackPanel';
import { Viewport, ViewOptions } from './ui/Viewport';

type Tab = 'robot' | 'track' | 'brain' | 'simulate';
const TABS: { id: Tab; label: string }[] = [
  { id: 'robot', label: 'Robot' },
  { id: 'track', label: 'Track' },
  { id: 'brain', label: 'Brain' },
  { id: 'simulate', label: 'Simulate' },
];
const SPEEDS = [0.25, 0.5, 1, 2, 4, 10];
const SAMPLE_URL = `${import.meta.env.BASE_URL}samples/roborun-sample.png`;

const MRobot = memo(RobotPanel);
const MTrack = memo(TrackPanel);
const MBrain = memo(BrainPanel);

export default function App() {
  const [app, setApp] = useState<AppSettings>(() => loadSettings());
  const [tab, setTab] = useState<Tab>('simulate');
  const [image, setImage] = useState<Blob | null>(null);
  const [base, setBase] = useState<Track | null>(null);
  const [bitmap, setBitmap] = useState<HTMLCanvasElement | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [frame, setFrame] = useState(0);
  const [slow, setSlow] = useState(0);
  const [view, setView] = useState<ViewOptions>({ follow: false, grid: false, trail: true, spots: false });
  const [error, setError] = useState<string | null>(null);
  const fileTrack = useRef<HTMLInputElement>(null);
  const fileProject = useRef<HTMLInputElement>(null);
  const fileRobot = useRef<HTMLInputElement>(null);

  useEffect(() => { saveSettings(app); }, [app]);

  // Load the saved track image, or the Robo-Run sample on first visit.
  useEffect(() => {
    (async () => {
      const saved = await loadTrackImage();
      if (saved) { setImage(saved); return; }
      setImage(await (await fetch(SAMPLE_URL)).blob());
    })().catch((e) => setError(`Could not load the track image: ${String(e)}`));
  }, []);

  // Process the image whenever it or the track rules change.
  const t = app.track;
  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    setLoading(true);
    buildTrack(image, { ...t, poseOverride: null }, app.profile)
      .then(({ track, messages: m }) => {
        if (cancelled) return;
        setBase(track); setBitmap(trackBitmap(track)); setMessages(m); setLoading(false);
      })
      .catch((e) => { setError(`Could not read that image: ${String(e)}`); setLoading(false); });
    return () => { cancelled = true; };
  }, [image, t.presetId, t.custom.width_m, t.custom.height_m, t.custom.lineWidth_cm, t.normaliseWidth, t.swapStartFinish]); // eslint-disable-line react-hooks/exhaustive-deps

  const startPose: Pose = useMemo(() => {
    if (!base) return { x: 0.2, y: 0.2, theta: 0 };
    return t.poseOverride ?? startPoseFor(base, app.profile.axleFromFront_mm / 1000);
  }, [base, t.poseOverride, app.profile.axleFromFront_mm]);
  const track: Track | null = useMemo(() => (base ? { ...base, startPose } : null), [base, startPose]);

  // Any change to the setup puts the robot back at the start.
  useEffect(() => { setSim(null); setPlaying(false); }, [app, base]);

  const newSim = useCallback(() => {
    if (!track) return null;
    return new Simulation(track, app.profile, new SettingsBrain(app.settings), app.flags, { distance_cm: app.offLine_cm });
  }, [track, app]);

  // Animation loop: advance sim time by wall time × speed.
  useEffect(() => {
    if (!playing || !sim) return;
    let raf = 0, last = performance.now(), n = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      sim.advance(dt * speed);
      setFrame((f) => f + 1);
      n += 1;
      if (n % 6 === 0) setSlow((f) => f + 1);
      if (sim.status === 'finished' || sim.status === 'stopped') { setPlaying(false); setSlow((f) => f + 1); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, sim, speed]);

  const play = () => {
    if (playing) { setPlaying(false); return; }
    if (!sim || sim.status === 'finished' || sim.status === 'stopped') { const s = newSim(); setSim(s); }
    setPlaying(true);
  };
  const stop = () => { if (sim) { sim.stop(); setPlaying(false); setSlow((f) => f + 1); setFrame((f) => f + 1); } };
  const reset = () => { setSim(null); setPlaying(false); };
  const step = () => {
    let s = sim;
    if (!s || s.status === 'finished' || s.status === 'stopped') { s = newSim(); setSim(s); }
    if (!s) return;
    setPlaying(false);
    s.advance(1 / app.settings.loopHz);
    setFrame((f) => f + 1); setSlow((f) => f + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA' && tag !== 'BUTTON') { e.preventDefault(); play(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- setters (stable for memoised panels) ----
  const setProfile = useCallback((profile: AppSettings['profile']) => setApp((a) => ({ ...a, profile })), []);
  const setSettings = useCallback((settings: AppSettings['settings']) => setApp((a) => ({ ...a, settings })), []);
  const setTrackSetup = useCallback((track: AppSettings['track']) => setApp((a) => ({ ...a, track })), []);
  const setOffLine = useCallback((offLine_cm: number) => setApp((a) => ({ ...a, offLine_cm })), []);
  const setPose = useCallback((p: Pose) => setApp((a) => ({ ...a, track: { ...a.track, poseOverride: p } })), []);

  const pickImage = useCallback(() => fileTrack.current?.click(), []);
  const useSample = useCallback(async () => {
    const b = await (await fetch(SAMPLE_URL)).blob();
    setImage(b); saveTrackImage(b);
    setApp((a) => ({ ...a, track: { ...a.track, imageName: 'roborun-sample.png', poseOverride: null } }));
  }, []);
  const onTrackFile = async (f: File | undefined) => {
    if (!f) return;
    setImage(f); saveTrackImage(f);
    setApp((a) => ({ ...a, track: { ...a.track, imageName: f.name, poseOverride: null } }));
  };

  const exportRobot = useCallback(() => {
    const name = (app.profile.name || 'robot').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    download(`${name}.robot.json`, JSON.stringify(app.profile, null, 2));
  }, [app.profile]);
  const importRobot = useCallback(() => fileRobot.current?.click(), []);

  const saveProject = async () => {
    const proj: ProjectFile = { lfsim: 'project', version: 1, settings: app, trackImage: image ? await blobToDataUrl(image) : null };
    const name = (app.profile.name || 'project').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    download(`${name}.lfsim.json`, JSON.stringify(proj));
  };
  const onImportFile = async (f: File | undefined, expect: 'project' | 'robot' | 'any') => {
    if (!f) return;
    try {
      const r = parseImport(await f.text());
      if (r.kind === 'robot') { setProfile(r.value as AppSettings['profile']); setTab('robot'); return; }
      if (expect === 'robot') throw new Error('That is a project file. Use Open project instead.');
      const p = r.value as ProjectFile;
      setApp(p.settings);
      if (p.trackImage) { const b = await dataUrlToBlob(p.trackImage); setImage(b); saveTrackImage(b); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const preset = presetFor(app.track);
  const status = sim ? sim.status : 'ready';
  const statusText = !track ? 'Loading track' : status === 'ready' ? 'Ready at the start' : status === 'running' ? (playing ? 'Running' : 'Paused')
    : status === 'finished' ? 'Finished'
    : sim?.events.some((e) => e.kind === 'aborted') ? 'Aborted: back in start square' : 'Stopped';
  const rt = sim?.runTime() ?? null;
  const sc = sim?.score() ?? null;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true"><i /><i /><i /></span>
          <span className="wordmark">LFSim</span>
          <span className="tagline">Line follower simulator</span>
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((x) => (
            <button key={x.id} className={tab === x.id ? 'tab on' : 'tab'} aria-current={tab === x.id} onClick={() => setTab(x.id)}>{x.label}</button>
          ))}
          <button className="tab" disabled title="Arrives in Phase 3">Compare</button>
        </nav>
        <div className="top-actions">
          <button onClick={() => fileProject.current?.click()}>Open project</button>
          <button className="primary" onClick={saveProject}>Save project</button>
        </div>
      </header>

      {error && (
        <div className="error-bar" role="alert">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <main className="work">
        <div className="left">
          {tab === 'robot' && <MRobot profile={app.profile} preset={preset} onChange={setProfile} onExport={exportRobot} onImport={importRobot} />}
          {tab === 'track' && <MTrack setup={app.track} track={track} messages={messages} loading={loading} offLine_cm={app.offLine_cm}
            onChange={setTrackSetup} onOffLine={setOffLine} onPickImage={pickImage} onUseSample={useSample} />}
          {tab === 'brain' && <MBrain settings={app.settings} onChange={setSettings} />}
          {tab === 'simulate' && <SimPanel flags={app.flags} onFlags={(flags) => setApp((a) => ({ ...a, flags }))} view={view} onView={setView} sim={sim} />}
        </div>

        <Viewport
          track={track} bitmap={bitmap} sim={tab === 'robot' ? null : sim} profile={app.profile}
          pose={tab === 'robot' ? { x: 0, y: 0, theta: 0 } : startPose}
          editable={!sim && tab !== 'robot'} onPoseChange={setPose} view={view} frame={frame}
          mode={tab === 'robot' ? 'robot' : 'track'}
        />

        <LivePanel sim={sim} profile={app.profile} frame={slow} />
      </main>

      <footer className="transport">
        <div className="controls">
          <button className="primary play" onClick={play} disabled={!track} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <PauseIcon /> : <PlayIcon />}{playing ? 'Pause' : sim && sim.status === 'running' ? 'Resume' : 'Run'}
          </button>
          <button onClick={stop} disabled={!sim || status === 'finished' || status === 'stopped'}><StopIcon />Stop</button>
          <button onClick={step} disabled={!track || playing} title="Advance one control-loop tick">Step</button>
          <button onClick={reset} disabled={!sim}>Back to start</button>
        </div>
        <div className="speed" role="group" aria-label="Simulation speed">
          {SPEEDS.map((s) => (
            <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </div>
        <dl className="stats">
          <div><dt>Status</dt><dd>{statusText}</dd></div>
          <div><dt>Clock</dt><dd>{sim ? `${sim.time.toFixed(2)} s` : '0.00 s'}</dd></div>
          <div><dt>Run time</dt><dd>{rt === null ? '—' : `${rt.toFixed(2)} s`}</dd></div>
          <div><dt>Off line</dt><dd>{sim ? sim.offLineCount : 0}</dd></div>
          <div><dt>Score</dt><dd>{sc === null ? '—' : `${sc.toFixed(2)} s`}</dd></div>
        </dl>
      </footer>

      <input ref={fileTrack} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { onTrackFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={fileProject} type="file" accept=".json,application/json" hidden onChange={(e) => { onImportFile(e.target.files?.[0], 'any'); e.target.value = ''; }} />
      <input ref={fileRobot} type="file" accept=".json,application/json" hidden onChange={(e) => { onImportFile(e.target.files?.[0], 'robot'); e.target.value = ''; }} />
    </div>
  );
}

const PlayIcon = () => <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>;
const PauseIcon = () => <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" /></svg>;
const StopIcon = () => <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" /></svg>;
