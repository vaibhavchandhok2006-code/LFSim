import { Track } from '../track/track';
import { Group, NumField, SelectField, Toggle } from './Field';
import { TrackSetup } from './persist';
import { CornerEditor } from './CornerEditor';

interface Props {
  setup: TrackSetup;
  track: Track | null;
  messages: string[];
  loading: boolean;
  imageSize: { w: number; h: number } | null;
  imageUrl: string | null;
  offLine_cm: number;
  onChange: (s: TrackSetup) => void;
  onOffLine: (v: number) => void;
  onPickImage: () => void;
  onUseSample: () => void;
}

export function TrackPanel({ setup, track, messages, loading, imageSize, imageUrl, offLine_cm, onChange, onOffLine, onPickImage, onUseSample }: Props) {
  const set = <K extends keyof TrackSetup>(k: K, v: TrackSetup[K]) => onChange({ ...setup, [k]: v });
  const setC = <K extends keyof TrackSetup['custom']>(k: K, v: number) => onChange({ ...setup, custom: { ...setup.custom, [k]: v } });
  const pose = track?.startPose;
  const crop = setup.crop ?? { left_pct: 0, top_pct: 0, right_pct: 0, bottom_pct: 0 };
  const setCrop = (k: keyof typeof crop, v: number) => onChange({ ...setup, crop: { ...crop, [k]: Math.max(0, Math.min(45, v)) } });
  // Trim the longer side equally so the kept part has the track's shape.
  const fitCrop = () => {
    if (!imageSize || !track) return;
    const want = track.preset.width_m / track.preset.height_m, have = imageSize.w / imageSize.h;
    const c = { left_pct: 0, top_pct: 0, right_pct: 0, bottom_pct: 0 };
    if (have > want) { const t = (1 - want / have) * 50; c.left_pct = t; c.right_pct = t; } else { const t = (1 - have / want) * 50; c.top_pct = t; c.bottom_pct = t; }
    onChange({ ...setup, crop: { left_pct: +c.left_pct.toFixed(2), top_pct: +c.top_pct.toFixed(2), right_pct: +c.right_pct.toFixed(2), bottom_pct: +c.bottom_pct.toFixed(2) } });
  };
  return (
    <div className="panel-scroll">
      <div className="panel-head">
        <div>
          <p className="kicker">Track image</p>
          <p className="file-name">{setup.imageName}</p>
        </div>
        <div className="row-buttons">
          <button onClick={onPickImage}>Load image</button>
          <button onClick={onUseSample}>Use sample</button>
        </div>
      </div>
      <p className="panel-note">Use a clean top-down image (its edges are the edges of the track), or an angled photo with the mat's corners marked below. Black lines on white.</p>
      {loading && <div className="callout">Processing the image…</div>}
      {!loading && messages.length > 0 && (
        <ul className="messages">{messages.map((m) => <li key={m}>{m}</li>)}</ul>
      )}

      <Group title="Rules preset">
        <SelectField label="Preset" value={setup.presetId} onChange={(v) => set('presetId', v)}
          options={[{ value: 'roborun-2027', label: 'Robo-Run 2027 (Shaastra), 16 × 16 squares, 4 × 4 m' }, { value: 'roborun', label: 'Robo-Run 2026 (Shaastra), 10 × 10 squares, 2.5 × 2.5 m' }, { value: 'custom', label: 'Custom size' }]} />
        {setup.presetId === 'custom' && <>
          <NumField label="Track width" unit="m" value={setup.custom.width_m} min={0.3} step={0.1} onChange={(v) => setC('width_m', v)} />
          <NumField label="Track height" unit="m" value={setup.custom.height_m} min={0.3} step={0.1} onChange={(v) => setC('height_m', v)} />
          <NumField label="Line width" unit="cm" value={setup.custom.lineWidth_cm} min={0.5} step={0.1} onChange={(v) => setC('lineWidth_cm', v)} />
          <NumField label="Robot max length" unit="mm" value={setup.custom.maxRobotL_mm} min={10} onChange={(v) => setC('maxRobotL_mm', v)} />
          <NumField label="Robot max width" unit="mm" value={setup.custom.maxRobotW_mm} min={10} onChange={(v) => setC('maxRobotW_mm', v)} />
        </>}
        <Toggle label="Set line width to the preset width" checked={setup.normaliseWidth} onChange={(v) => set('normaliseWidth', v)}
          hint="Keeps the track's shape, changes only line thickness." />
      </Group>

      <Group title="Angled photo" note="For a photo taken at an angle (a frame from a video, say): mark the mat's four corners and the photo is flattened to a top-down track. The crop below is then not used.">
        {setup.corners && imageUrl && imageSize
          ? <CornerEditor imageUrl={imageUrl} aspect={imageSize.w / imageSize.h} corners={setup.corners} onCommit={(c) => set('corners', c)} />
          : null}
        <div className="row-buttons left crop-buttons">
          {!setup.corners
            ? <button disabled={!imageSize} onClick={() => set('corners', [[10, 10], [90, 10], [90, 90], [10, 90]])}>Mark the mat’s corners</button>
            : <button onClick={() => set('corners', null)}>Remove perspective correction</button>}
        </div>
      </Group>

      {!setup.corners && <Group title="Crop" note={imageSize ? `Image ${imageSize.w} × ${imageSize.h} px. Trim the edges so only the mat is left; the kept part is fitted to the track size.` : 'Trim the edges so only the mat is left.'}>
        <NumField label="Left" unit="%" value={crop.left_pct} min={0} max={45} step={0.5} onChange={(v) => setCrop('left_pct', v)} />
        <NumField label="Right" unit="%" value={crop.right_pct} min={0} max={45} step={0.5} onChange={(v) => setCrop('right_pct', v)} />
        <NumField label="Top" unit="%" value={crop.top_pct} min={0} max={45} step={0.5} onChange={(v) => setCrop('top_pct', v)} />
        <NumField label="Bottom" unit="%" value={crop.bottom_pct} min={0} max={45} step={0.5} onChange={(v) => setCrop('bottom_pct', v)} />
        <div className="row-buttons left crop-buttons">
          <button disabled={!imageSize} onClick={fitCrop}>Crop centre to the track's shape</button>
          <button onClick={() => onChange({ ...setup, crop: { left_pct: 0, top_pct: 0, right_pct: 0, bottom_pct: 0 } })}>No crop</button>
        </div>
      </Group>}

      <Group title="Start and finish">
        <p className="group-text">
          {track?.start ? 'Start square found.' : 'No start square found.'} {track?.finish ? 'Finish square found.' : 'No finish square found.'}
        </p>
        <Toggle label="Swap start and finish" checked={setup.swapStartFinish} onChange={(v) => set('swapStartFinish', v)} />
      </Group>

      <Group title="Robot placement" note="Drag the robot on the track, or type its position.">
        {pose && <>
          <NumField label="x" unit="m" step={0.01} value={Number(pose.x.toFixed(3))} onChange={(v) => set('poseOverride', { ...pose, x: v })} />
          <NumField label="y" unit="m" step={0.01} value={Number(pose.y.toFixed(3))} onChange={(v) => set('poseOverride', { ...pose, y: v })} />
          <NumField label="Heading" unit="°" step={1} value={Number(((pose.theta * 180) / Math.PI).toFixed(1))} onChange={(v) => set('poseOverride', { ...pose, theta: (v * Math.PI) / 180 })} hint="0° = facing right, 90° = facing down." />
        </>}
        <button className="wide" disabled={!setup.poseOverride} onClick={() => set('poseOverride', null)}>Put back in the start square</button>
      </Group>

      <Group title="Off-line judging" note="A run counts as off the line when every sensor sees white and the wheels have moved this far from the nearest line. Spins on the line don't count.">
        <NumField label="Distance from line" unit="cm" value={offLine_cm} min={0.5} step={0.5} onChange={onOffLine} />
      </Group>
    </div>
  );
}
