import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MEMORY_ALGORITHMS } from './brain/settings';
import { SAMPLE_NOTES, SAMPLE_SOURCE, SAMPLE_TRANSLATED, SAMPLE_WIRING } from './brain/sampleFirmware';
import { foldBands } from './sim/simulation';
import { profileProblems } from './sim/profile';
import { startPoseFor } from './track/importTrack';
import { buildGraph, routePoints, shortestPath, JunctionGraph } from './track/graph';
import { Pose, Track } from './track/track';
import { BrainPanel } from './ui/BrainPanel';
import { ComparePanel, RUN_COLORS } from './ui/ComparePanel';
import { GifClip, pathImage, reportHtml } from './ui/exports';
import { LivePanel } from './ui/LivePanel';
import { buildTrack, presetFor, trackBitmap } from './ui/loadTrack';
import {
  AppSettings, blobToDataUrl, CodeSetup, dataUrlToBlob, download, loadSettings, loadTrackImage, parseImport, ProjectFile,
  saveSettings, saveTrackImage, TrackFile,
} from './ui/persist';
import { RobotPanel } from './ui/RobotPanel';
import { RunController, RunData, RunSummary } from './ui/run';
import { SimPanel } from './ui/SimPanel';
import { TrackPanel } from './ui/TrackPanel';
import { Overlay, Viewport, ViewOptions } from './ui/Viewport';

type Tab = 'robot' | 'track' | 'brain' | 'simulate' | 'compare';
const TABS: { id: Tab; label: string }[] = [
  { id: 'robot', label: 'Robot' }, { id: 'track', label: 'Track' }, { id: 'brain', label: 'Brain' },
  { id: 'simulate', label: 'Simulate' }, { id: 'compare', label: 'Compare' },
];
const SPEEDS = [0.25, 0.5, 1, 2, 4, 10];
const SAMPLE_URL = `${import.meta.env.BASE_URL}samples/roborun-sample.png`;
const RUNS_KEY = 'lfsim.runs.v1';
const MEM_KEY = 'lfsim.memory.v1';

const MRobot = memo(RobotPanel);
const MTrack = memo(TrackPanel);
const MBrain = memo(BrainPanel);

function loadJson<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } }
function saveJson(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full */ } }

export default function App() {
  const [app, setApp] = useState<AppSettings>(() => loadSettings());
  const [tab, setTab] = useState<Tab>('simulate');
  const [image, setImage] = useState<Blob | null>(null);
  const [base, setBase] = useState<Track | null>(null);
  const [bitmap, setBitmap] = useState<HTMLCanvasElement | null>(null);
  const [graph, setGraph] = useState<JunctionGraph | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [ctl, setCtl] = useState<RunController | null>(null);
  const [playT, setPlayT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [frame, setFrame] = useState(0);
  const [view, setView] = useState<ViewOptions>({ follow: false, grid: false, trail: true, spots: false, ideal: false, decisions: true });
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>(() => loadJson(RUNS_KEY, []));
  const [selected, setSelected] = useState<number[]>([]);
  const [memory, setMemory] = useState<{ key: string; data: Record<string, unknown> } | null>(() => loadJson(MEM_KEY, null));
  const [isMemoryRun, setIsMemoryRun] = useState(false);
  const [recording, setRecording] = useState<null | 'webm' | 'gif'>(null);
  const savedRunFor = useRef<number | null>(null);
  const canvasEl = useRef<HTMLCanvasElement | null>(null);
  const fileTrack = useRef<HTMLInputElement>(null);
  const fileProject = useRef<HTMLInputElement>(null);
  const fileRobot = useRef<HTMLInputElement>(null);
  const playRef = useRef({ playT: 0 });
  playRef.current.playT = playT;

  useEffect(() => { saveSettings(app); }, [app]);
  useEffect(() => { saveJson(RUNS_KEY, runs); }, [runs]);
  useEffect(() => { saveJson(MEM_KEY, memory); }, [memory]);
  useEffect(() => { document.documentElement.dataset.theme = app.theme; }, [app.theme]);

  useEffect(() => {
    (async () => {
      const saved = await loadTrackImage();
      setImage(saved ?? await (await fetch(SAMPLE_URL)).blob());
    })().catch((e) => setError(`Could not load the track image: ${String(e)}`));
  }, []);

  const t = app.track;
  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    setLoading(true);
    buildTrack(image, { ...t, poseOverride: null }, app.profile)
      .then(({ track, messages: m, size }) => {
        if (cancelled) return;
        setImgSize(size);
        setBase(track); setBitmap(trackBitmap(track)); setMessages(m); setLoading(false);
        setTimeout(() => { try { setGraph(buildGraph(track)); } catch { setGraph(null); } }, 0);
      })
      .catch((e) => { setError(`Could not read that image: ${String(e)}`); setLoading(false); });
    return () => { cancelled = true; };
  }, [image, t.presetId, t.custom.width_m, t.custom.height_m, t.custom.lineWidth_cm, t.normaliseWidth, t.swapStartFinish, t.crop?.left_pct, t.crop?.top_pct, t.crop?.right_pct, t.crop?.bottom_pct, JSON.stringify(t.corners ?? null)]); // eslint-disable-line react-hooks/exhaustive-deps
  // The source photo, for marking an angled photo's corners.
  const imageUrl = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  const startPose: Pose = useMemo(() => {
    if (!base) return { x: 0.2, y: 0.2, theta: 0 };
    return t.poseOverride ?? startPoseFor(base, app.profile.axleFromFront_mm / 1000);
  }, [base, t.poseOverride, app.profile.axleFromFront_mm]);
  const track: Track | null = useMemo(() => (base ? { ...base, startPose } : null), [base, startPose]);

  // Any change to the setup ends the current run and puts the robot back at the start.
  const setupKey = JSON.stringify([app.profile, app.settings, app.flags, app.offLine_cm, app.brainMode, app.code.translated, app.code.wiring, app.disturbances]);
  useEffect(() => { setCtl((c) => { c?.dispose(); return null; }); setPlaying(false); setPlayT(0); }, [setupKey, base, startPose]);

  const memKey = app.brainMode === 'settings' ? `${app.settings.algorithm}` : 'code';
  const memoryAvailable = memory !== null && memory.key === memKey && Object.keys(memory.data).length > 0;

  const run: RunData | null = ctl?.data ?? null;
  const endT = run?.endTime ?? null;

  // Save a run summary to Compare once playback reaches the end of a finished/stopped run.
  const saveSummary = useCallback((c: RunController, at: number) => {
    if (savedRunFor.current === c.runId) return;
    savedRunFor.current = c.runId;
    const d = c.data, r = d.at(at);
    const s = app.settings;
    const algo = app.brainMode === 'code' ? 'Own code' : s.algorithm;
    const summary: RunSummary = {
      id: Date.now(), label: `${algo}${isMemoryRun ? ' (memory run)' : ''}`, algorithm: algo, robot: app.profile.name, track: app.track.imageName,
      memoryRun: isMemoryRun, reachedFinish: r.finish !== null, codeStopped: r.codeStopped, runTime_s: r.runTime, score_s: r.score,
      distance_m: r.distance, decisions: r.decisions, deadEnds: r.deadEnds, offLine: r.offLine,
      status: d.status === 'error' ? 'Error' : r.finish !== null ? 'Finished' : 'Did not finish',
      path: d.path(at, 500),
      settingsNote: app.brainMode === 'code' ? `Code mode, ${app.code.sourceLang || 'firmware'}` : `Kp ${s.kp}, Kd ${s.kd}, base ${s.baseSpeed}, turn ${s.turnSpeed}`,
    };
    setRuns((rs) => [summary, ...rs].slice(0, 100));
    if (d.memory && Object.keys(d.memory).length && r.finish !== null && !isMemoryRun) setMemory({ key: memKey, data: d.memory });
  }, [app, isMemoryRun, memKey]);

  // A memory run becomes available as soon as run 1 reaches the finish (the run itself goes on until Stop).
  const memSavedFor = useRef(-1);
  useEffect(() => {
    if (!ctl || isMemoryRun || memSavedFor.current === ctl.runId) return;
    const d = ctl.data;
    if (d.memory && Object.keys(d.memory).length && d.at(playT).finish !== null) { memSavedFor.current = ctl.runId; setMemory({ key: memKey, data: d.memory }); }
  }, [ctl, frame, playT, isMemoryRun, memKey]);

  // Playback loop: advance the playback clock and keep the worker computing ahead.
  useEffect(() => {
    if (!ctl) return;
    ctl.onUpdate = () => setFrame((f) => f + 1);
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const d = ctl.data;
      let pt = playRef.current.playT;
      if (playing) {
        const limit = d.endTime ?? d.computedTime;
        pt = Math.min(pt + dt * speed, limit);
        playRef.current.playT = pt;
        setPlayT(pt);
        if (d.endTime !== null && pt >= d.endTime - 1e-9) { setPlaying(false); saveSummary(ctl, d.endTime); }
      }
      ctl.ensureAhead(pt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ctl, playing, speed, saveSummary]);

  const newRun = useCallback((withMemory: boolean): RunController | null => {
    if (!track) return null;
    const problems = profileProblems(app.profile);
    if (problems.length) { setError(`The robot has values out of range (Robot tab): ${problems[0]}`); return null; }
    if (app.brainMode === 'code' && !app.code.translated.trim()) { setError('Code mode needs translated firmware. Load the sample or import a robot file from the LFSim skill.'); return null; }
    const c = new RunController({
      track, profile: app.profile,
      brain: app.brainMode === 'settings' ? { mode: 'settings', settings: app.settings } : { mode: 'code', code: app.code.translated, wiring: app.code.wiring },
      flags: app.flags, disturbances: app.disturbances, offLine_cm: app.offLine_cm,
      memory: withMemory && memory ? JSON.parse(JSON.stringify(memory.data)) : {},
    });
    ctl?.dispose();
    setCtl(c); setPlayT(0); playRef.current.playT = 0; setIsMemoryRun(withMemory);
    savedRunFor.current = null;
    return c;
  }, [track, app, memory, ctl]);

  const ended = run !== null && endT !== null && playT >= endT - 1e-9;
  const play = () => {
    if (playing) { setPlaying(false); return; }
    if (!ctl || ended) { if (!newRun(false)) return; }
    setPlaying(true);
  };
  const memoryRun = () => { if (newRun(true)) { setPlaying(true); setTab('simulate'); } };
  const stop = () => { if (ctl && run && run.endTime === null) { ctl.stop(playT); setPlaying(false); saveSummary(ctl, playT); setFrame((f) => f + 1); } };
  const reset = () => { ctl?.dispose(); setCtl(null); setPlaying(false); setPlayT(0); };
  const step = () => {
    let c = ctl;
    if (!c || ended) { c = newRun(false); if (!c) return; }
    setPlaying(false);
    const dt = app.brainMode === 'settings' ? 1 / app.settings.loopHz : 0.002;
    const target = playT + dt;
    c.ensureAhead(target);
    if (c.data.computedTime >= target) setPlayT(target);
    else setTimeout(() => setPlayT((p) => Math.min(p + dt, c!.data.computedTime)), 80);
  };
  const scrub = (v: number) => { setPlaying(false); setPlayT(v); playRef.current.playT = v; };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) { e.preventDefault(); play(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- setters ----
  const setProfile = useCallback((profile: AppSettings['profile']) => setApp((a) => ({ ...a, profile })), []);
  const setSettings = useCallback((settings: AppSettings['settings']) => setApp((a) => ({ ...a, settings })), []);
  const setTrackSetup = useCallback((tr: AppSettings['track']) => setApp((a) => ({ ...a, track: tr })), []);
  const setOffLine = useCallback((offLine_cm: number) => setApp((a) => ({ ...a, offLine_cm })), []);
  const setPose = useCallback((p: Pose) => setApp((a) => ({ ...a, track: { ...a.track, poseOverride: p } })), []);
  const setMode = useCallback((brainMode: 'settings' | 'code') => setApp((a) => ({ ...a, brainMode })), []);
  const setCode = useCallback((code: CodeSetup) => setApp((a) => ({ ...a, code })), []);
  const loadSample = useCallback(() => setApp((a) => ({ ...a, code: { source: SAMPLE_SOURCE, sourceLang: 'Arduino C++ (ESP32)', translated: SAMPLE_TRANSLATED, notes: SAMPLE_NOTES, wiring: SAMPLE_WIRING } })), []);

  const pickImage = useCallback(() => fileTrack.current?.click(), []);
  const useSample = useCallback(async () => {
    const b = await (await fetch(SAMPLE_URL)).blob();
    setImage(b); saveTrackImage(b);
    setApp((a) => ({ ...a, track: { ...a.track, imageName: 'roborun-sample.png', poseOverride: null } }));
  }, []);
  const onTrackFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { setError('That image is over 25 MB. Use a smaller image.'); return; }
    setImage(f); saveTrackImage(f);
    setApp((a) => ({ ...a, track: { ...a.track, imageName: f.name, poseOverride: null } }));
  };
  const slug = (s: string) => (s || 'lfsim').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();

  const exportRobot = useCallback(() => {
    const withCode = app.code.translated ? { ...app.profile, firmware: app.code } : app.profile;
    download(`${slug(app.profile.name)}.robot.json`, JSON.stringify(withCode, null, 2));
  }, [app.profile, app.code]);
  const importRobot = useCallback(() => fileRobot.current?.click(), []);
  const exportTrack = useCallback(async () => {
    if (!image) return;
    const tf: TrackFile = { lfsim: 'track', version: 1, setup: app.track, image: await blobToDataUrl(image) };
    download(`${slug(app.track.imageName.replace(/\.[a-z]+$/i, ''))}.track.json`, JSON.stringify(tf));
  }, [image, app.track]);

  const saveProject = async () => {
    const proj: ProjectFile = { lfsim: 'project', version: 1, settings: app, trackImage: image ? await blobToDataUrl(image) : null, runs, memory: memory?.data ?? null };
    download(`${slug(app.profile.name)}.lfsim.json`, JSON.stringify(proj));
  };
  const onImportFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = parseImport(await f.text());
      if (r.kind === 'robot') {
        const code = r.code;
        setApp((a) => ({ ...a, profile: r.value, ...(code ? { brainMode: 'code' as const, code: { ...a.code, ...code } } : {}) }));
        setTab(code ? 'brain' : 'robot');
        return;
      }
      if (r.kind === 'track') {
        const b = await dataUrlToBlob(r.value.image);
        setImage(b); saveTrackImage(b);
        setApp((a) => ({ ...a, track: r.value.setup }));
        setTab('track');
        return;
      }
      const p = r.value;
      setApp(p.settings);
      setRuns(p.runs);
      if (p.memory) setMemory({ key: p.settings.brainMode === 'settings' ? p.settings.settings.algorithm : 'code', data: p.memory });
      if (p.trackImage) { const b = await dataUrlToBlob(p.trackImage); setImage(b); saveTrackImage(b); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- exports ----
  const exportCsv = async () => { if (ctl) download(`${slug(app.profile.name)}-run.csv`, await ctl.csv(playT), 'text/csv'); };
  const exportPng = () => {
    if (!run || !track || !bitmap) return;
    pathImage(track, bitmap, run, playT).toBlob((b) => b && download(`${slug(app.profile.name)}-path.png`, b, 'image/png'));
  };
  const exportReport = () => {
    if (!run || !track || !bitmap || !ctl) return;
    const png = pathImage(track, bitmap, run, playT, 900).toDataURL('image/png');
    const r = run.at(playT);
    const summary: RunSummary = { id: 0, label: '', algorithm: app.brainMode === 'code' ? 'Own code' : app.settings.algorithm, robot: app.profile.name, track: app.track.imageName, memoryRun: isMemoryRun, reachedFinish: r.finish !== null, codeStopped: r.codeStopped, runTime_s: r.runTime, score_s: r.score, distance_m: r.distance, decisions: r.decisions, deadEnds: r.deadEnds, offLine: r.offLine, status: '', path: [], settingsNote: '' };
    const html = reportHtml({ title: `${app.profile.name}: ${summary.algorithm}`, profile: app.profile, settings: app.brainMode === 'settings' ? app.settings : null, codeLang: app.brainMode === 'code' ? app.code.sourceLang : null, track, run, t: playT, pathPng: png, summary });
    download(`${slug(app.profile.name)}-report.html`, html, 'text/html');
  };
  const record = async (kind: 'webm' | 'gif') => {
    const c = canvasEl.current;
    if (!c || !run || recording) return;
    setRecording(kind);
    setTab('simulate');
    const startAt = kind === 'gif' ? (run.endTime !== null && playT >= run.endTime - 0.05 ? Math.max(0, run.endTime - 10 * speed) : playT) : 0;
    const stopAt = kind === 'gif' ? Math.min(startAt + 10 * speed, run.endTime ?? Infinity) : (run.endTime ?? playT);
    setPlayT(startAt); playRef.current.playT = startAt; setPlaying(true);
    const waitEnd = () => new Promise<void>((res) => { const iv = setInterval(() => { if (playRef.current.playT >= stopAt - 1e-6) { clearInterval(iv); res(); } }, 50); });
    try {
      if (kind === 'webm') {
        if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video.');
        const stream = c.captureStream(30);
        const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        const done = new Promise<void>((res) => { rec.onstop = () => res(); });
        rec.start(250);
        await waitEnd();
        rec.stop(); await done;
        download(`${slug(app.profile.name)}-run.webm`, new Blob(chunks, { type: 'video/webm' }), 'video/webm');
      } else {
        const clip = new GifClip(480, c.height / c.width);
        const iv = setInterval(() => clip.add(c, 100), 100);
        await waitEnd();
        clearInterval(iv);
        download(`${slug(app.profile.name)}-clip.gif`, clip.finish(), 'image/gif');
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setPlaying(false); setRecording(null);
  };

  // ---- overlays ----
  const overlays: Overlay[] = useMemo(() => {
    const out: Overlay[] = [];
    if (tab === 'compare') {
      selected.forEach((id, i) => { const rr = runs.find((x) => x.id === id); if (rr) out.push({ points: rr.path, color: RUN_COLORS[i % RUN_COLORS.length], label: rr.label }); });
      return out;
    }
    if (view.ideal && graph) { const sp = shortestPath(graph); if (sp.ok) out.push({ points: routePoints(graph, sp.route), color: 'rgba(31,107,71,0.4)', label: 'Ideal path', dashed: true }); }
    return out;
  }, [tab, selected, runs, view.ideal, graph]);
  const folds = useMemo(() => (track ? foldBands(track, app.disturbances) : []), [track, app.disturbances]);

  const preset = presetFor(app.track);
  const r = run?.at(playT);
  const statusText = !track ? 'Loading track' : !run ? 'Ready at the start' : run.status === 'error' ? 'Error'
    : ended ? (r?.finish != null ? 'Finished' : 'Did not finish') : playing ? (isMemoryRun ? 'Memory run' : 'Running') : 'Paused';
  const maxT = run ? Math.max(run.endTime ?? run.computedTime, playT) : 0;
  const isMemoryAlgo = app.brainMode === 'settings' && MEMORY_ALGORITHMS.includes(app.settings.algorithm);
  const showRun = tab !== 'robot' && tab !== 'compare';

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
            <button key={x.id} className={tab === x.id ? 'tab on' : 'tab'} aria-current={tab === x.id} onClick={() => setTab(x.id)}>
              {x.label}{x.id === 'compare' && runs.length > 0 && <span className="count">{runs.length}</span>}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <details className="menu">
            <summary>Export</summary>
            <div className="menu-list" onClick={(e) => { (e.currentTarget.parentElement as HTMLDetailsElement).open = false; }}>
              <button onClick={exportReport} disabled={!run}>Summary report (HTML, printable)</button>
              <button onClick={exportCsv} disabled={!run}>Data log (CSV)</button>
              <button onClick={exportPng} disabled={!run}>Path image (PNG)</button>
              <button onClick={() => record('webm')} disabled={!run || !!recording}>Video of the run (WebM)</button>
              <button onClick={() => record('gif')} disabled={!run || !!recording}>10 s clip from here (GIF)</button>
              <hr />
              <button onClick={exportRobot}>Robot (.robot.json)</button>
              <button onClick={exportTrack} disabled={!image}>Track (.track.json)</button>
            </div>
          </details>
          <button onClick={() => setApp((a) => ({ ...a, theme: a.theme === 'light' ? 'dark' : 'light' }))} aria-label={`Switch to ${app.theme === 'light' ? 'dark' : 'light'} theme`}>{app.theme === 'light' ? 'Dark' : 'Light'}</button>
          <button onClick={() => fileProject.current?.click()}>Open</button>
          <button className="primary" onClick={saveProject}>Save project</button>
        </div>
      </header>

      {error && (
        <div className="error-bar" role="alert">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {recording && <div className="rec-bar" role="status">Recording {recording === 'webm' ? 'video' : 'GIF'}. Keep this tab open until the download starts.</div>}

      <main className={`work${tab === 'compare' ? ' wide-left' : ''}`}>
        <div className="left">
          {tab === 'robot' && <MRobot profile={app.profile} preset={preset} onChange={setProfile} onExport={exportRobot} onImport={importRobot} />}
          {tab === 'track' && <MTrack setup={app.track} track={track} messages={messages} loading={loading} imageSize={imgSize} imageUrl={imageUrl} offLine_cm={app.offLine_cm}
            onChange={setTrackSetup} onOffLine={setOffLine} onPickImage={pickImage} onUseSample={useSample} />}
          {tab === 'brain' && <MBrain mode={app.brainMode} onMode={setMode} settings={app.settings} onChange={setSettings} code={app.code} onCode={setCode} onLoadSample={loadSample} />}
          {tab === 'simulate' && <SimPanel flags={app.flags} onFlags={(flags) => setApp((a) => ({ ...a, flags }))} dist={app.disturbances} onDist={(disturbances) => setApp((a) => ({ ...a, disturbances }))}
            view={view} onView={setView} run={run} t={playT} memoryAvailable={memoryAvailable} onMemoryRun={memoryRun}
            onClearMemory={() => setMemory(null)} isMemoryAlgo={isMemoryAlgo} codeMode={app.brainMode === 'code'} />}
          {tab === 'compare' && <ComparePanel runs={runs} selected={selected}
            onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
            onDelete={(id) => { setRuns((rs) => rs.filter((x) => x.id !== id)); setSelected((s) => s.filter((x) => x !== id)); }}
            onRename={(id, label) => setRuns((rs) => rs.map((x) => (x.id === id ? { ...x, label } : x)))} />}
        </div>

        <Viewport
          track={track} bitmap={bitmap} run={showRun ? run : null} t={playT} profile={app.profile}
          pose={tab === 'robot' ? { x: 0, y: 0, theta: 0 } : startPose}
          editable={!run && tab !== 'robot' && tab !== 'compare'} onPoseChange={setPose} view={view} frame={frame}
          mode={tab === 'robot' ? 'robot' : 'track'} overlays={overlays} folds={folds}
          canvasRef={(c) => { canvasEl.current = c; }}
        />

        {tab !== 'compare' && <LivePanel run={showRun ? run : null} t={playT} profile={app.profile} frame={frame} />}
      </main>

      <footer className="transport">
        <div className="controls">
          <button className="primary play" onClick={play} disabled={!track || !!recording} aria-label={playing ? 'Pause' : 'Run'}>
            {playing ? <PauseIcon /> : <PlayIcon />}{playing ? 'Pause' : run && !ended ? 'Resume' : 'Run'}
          </button>
          <button onClick={stop} disabled={!run || run.endTime !== null}><StopIcon />Stop</button>
          <button onClick={step} disabled={!track || playing} title="Advance one control-loop tick">Step</button>
          <button onClick={reset} disabled={!run}>Back to start</button>
        </div>
        <div className="scrub">
          <input type="range" min={0} max={Math.max(0.01, maxT)} step={0.002} value={Math.min(playT, Math.max(0.01, maxT))} disabled={!run}
            onChange={(e) => scrub(Number(e.target.value))} aria-label="Timeline" />
          <span className="scrub-t">{playT.toFixed(2)} / {maxT.toFixed(2)} s</span>
        </div>
        <div className="speed" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}
        </div>
        <dl className="stats">
          <div><dt>Status</dt><dd>{statusText}</dd></div>
          <div><dt>Run time</dt><dd>{r?.runTime == null ? '—' : `${r.runTime.toFixed(2)} s`}</dd></div>
          <div><dt>Off line</dt><dd>{r ? r.offLine : 0}</dd></div>
          <div><dt>Score</dt><dd>{r?.score == null ? '—' : `${r.score.toFixed(2)} s`}</dd></div>
        </dl>
      </footer>

      <input ref={fileTrack} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { onTrackFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={fileProject} type="file" accept=".json,application/json" hidden onChange={(e) => { onImportFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={fileRobot} type="file" accept=".json,application/json" hidden onChange={(e) => { onImportFile(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

const PlayIcon = () => <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>;
const PauseIcon = () => <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" /></svg>;
const StopIcon = () => <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" /></svg>;
