import { Algorithm, SettingsParams } from '../brain/settings';
import { Group, NumField, SelectField } from './Field';

interface Props {
  settings: SettingsParams;
  onChange: (s: SettingsParams) => void;
}

const ALGOS: { value: Algorithm; label: string; disabled?: boolean }[] = [
  { value: 'pid-only', label: 'Line following only (PID)' },
  { value: 'left-hand', label: 'Left-hand (Phase 2)', disabled: true },
  { value: 'right-hand', label: 'Right-hand (Phase 2)', disabled: true },
  { value: 'straight-first', label: 'Straight-first (Phase 2)', disabled: true },
  { value: 'custom', label: 'Custom priority (Phase 2)', disabled: true },
  { value: 'lsrb', label: 'LSRB with memory run (Phase 2)', disabled: true },
  { value: 'tremaux', label: 'Mapping + shortest path (Phase 2)', disabled: true },
];

export function BrainPanel({ settings: s, onChange }: Props) {
  const set = <K extends keyof SettingsParams>(k: K, v: SettingsParams[K]) => onChange({ ...s, [k]: v });
  return (
    <div className="panel-scroll">
      <div className="segmented" role="tablist" aria-label="Robot brain">
        <button role="tab" aria-selected="true" className="on">Settings mode</button>
        <button role="tab" aria-selected="false" disabled title="Arrives in Phase 4">Code mode</button>
      </div>
      <p className="panel-note">The built-in robot: PID on the analog line position, with junctions and the finish judged from on/off sensor patterns.</p>

      <Group title="Algorithm">
        <SelectField label="At junctions" value={s.algorithm} options={ALGOS} onChange={(v) => set('algorithm', v)} />
      </Group>

      <Group title="PID line following" note="Error is the line position in mm (+ = line to the left).">
        <NumField label="Kp" unit="duty/mm" step={0.001} min={0} value={s.kp} onChange={(v) => set('kp', v)} />
        <NumField label="Ki" unit="duty/(mm·s)" step={0.001} min={0} value={s.ki} onChange={(v) => set('ki', v)} />
        <NumField label="Kd" unit="duty/(mm/s)" step={0.0001} min={0} value={s.kd} onChange={(v) => set('kd', v)} />
        <NumField label="Integral limit" unit="duty" step={0.05} min={0} value={s.iLimit} onChange={(v) => set('iLimit', v)} />
        <NumField label="D filter" unit="Hz" step={5} min={0} value={s.dFilterHz} onChange={(v) => set('dFilterHz', v)} hint="Low-pass on the derivative so sensor noise doesn't shake the motors. 0 = off." />
        <NumField label="Loop rate" unit="Hz" step={50} min={10} max={1000} value={s.loopHz} onChange={(v) => set('loopHz', v)} hint="How often the code reads sensors and updates motors." />
      </Group>

      <Group title="Speeds" note="As PWM duty, 0 to 1.">
        <NumField label="Base speed" step={0.02} min={0} max={1} value={s.baseSpeed} onChange={(v) => set('baseSpeed', v)} />
        <NumField label="Max per wheel" step={0.02} min={0} max={1} value={s.maxSpeed} onChange={(v) => set('maxSpeed', v)} />
        <NumField label="Turn speed" step={0.02} min={0} max={1} value={s.turnSpeed} onChange={(v) => set('turnSpeed', v)} hint="Used for in-place turns and searching for the line." />
        <NumField label="Acceleration limit" unit="duty/s" step={0.1} min={0.1} value={s.accel} onChange={(v) => set('accel', v)} />
      </Group>

      <Group title="Finish and lost line">
        <NumField label="Finish: all black for" unit="cm" step={0.5} min={1} value={s.finishBlack_cm} onChange={(v) => set('finishBlack_cm', v)} />
        <NumField label="Give up searching after" unit="s" step={0.5} min={0.2} value={s.lostTimeout_s} onChange={(v) => set('lostTimeout_s', v)} />
      </Group>

      <Group title="Junctions" note="Used by the maze algorithms arriving in Phase 2.">
        <NumField label="Outer sensors for a branch" step={1} min={1} value={s.junctionOuter} onChange={(v) => set('junctionOuter', Math.round(v))} />
        <NumField label="Inch forward" unit="cm" step={0.5} min={0} value={s.inchForward_cm} onChange={(v) => set('inchForward_cm', v)} />
        <SelectField label="Turn method" value={s.turnMethod} onChange={(v) => set('turnMethod', v)}
          options={[{ value: 'spin-until-line', label: 'Spin until the line is found' }, { value: 'timed', label: 'Timed turn' }]} />
        <NumField label="Dead end: all white for" unit="cm" step={0.5} min={0.5} value={s.deadEndWhite_cm} onChange={(v) => set('deadEndWhite_cm', v)} />
      </Group>
    </div>
  );
}
