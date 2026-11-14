import { Track } from '../track/track';
import { Group, NumField, SelectField, Toggle } from './Field';
import { TrackSetup } from './persist';

interface Props {
  setup: TrackSetup;
  track: Track | null;
  messages: string[];
  loading: boolean;
  offLine_cm: number;
  onChange: (s: TrackSetup) => void;
  onOffLine: (v: number) => void;
  onPickImage: () => void;
  onUseSample: () => void;
}

export function TrackPanel({ setup, track, messages, loading, offLine_cm, onChange, onOffLine, onPickImage, onUseSample }: Props) {
  const set = <K extends keyof TrackSetup>(k: K, v: TrackSetup[K]) => onChange({ ...setup, [k]: v });
  const setC = <K extends keyof TrackSetup['custom']>(k: K, v: number) => onChange({ ...setup, custom: { ...setup.custom, [k]: v } });
  const pose = track?.startPose;
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
      <p className="panel-note">Use a clean top-down image. Its edges are taken as the edges of the track; black lines on white.</p>
      {loading && <div className="callout">Processing the image…</div>}
      {!loading && messages.length > 0 && (
        <ul className="messages">{messages.map((m) => <li key={m}>{m}</li>)}</ul>
      )}

      <Group title="Rules preset">
        <SelectField label="Preset" value={setup.presetId} onChange={(v) => set('presetId', v)}
          options={[{ value: 'roborun', label: 'Robo-Run (Shaastra), 2.5 × 2.5 m' }, { value: 'custom', label: 'Custom size' }]} />
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
