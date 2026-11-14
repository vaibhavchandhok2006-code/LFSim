import { DriverModel, RobotProfile, spotDiameter_mm, yawInertia } from '../sim/profile';
import { Physics } from '../sim/physics';
import { TrackPreset } from '../track/track';
import { Group, NumField, SelectField, Toggle } from './Field';

interface Props {
  profile: RobotProfile;
  preset: TrackPreset;
  onChange: (p: RobotProfile) => void;
  onExport: () => void;
  onImport: () => void;
}

export function RobotPanel({ profile: p, preset, onChange, onExport, onImport }: Props) {
  const set = <K extends keyof RobotProfile>(k: K, v: RobotProfile[K]) => onChange({ ...p, [k]: v });
  const setS = <K extends keyof RobotProfile['sensor']>(k: K, v: RobotProfile['sensor'][K]) => onChange({ ...p, sensor: { ...p.sensor, [k]: v } });
  const setM = <K extends keyof RobotProfile['motor']>(k: K, v: RobotProfile['motor'][K]) => onChange({ ...p, motor: { ...p.motor, [k]: v } });
  const setB = <K extends keyof RobotProfile['battery']>(k: K, v: RobotProfile['battery'][K]) => onChange({ ...p, battery: { ...p.battery, [k]: v } });
  const setE = <K extends keyof RobotProfile['encoders']>(k: K, v: RobotProfile['encoders'][K]) => onChange({ ...p, encoders: { ...p.encoders, [k]: v } });

  const fits = p.length_mm <= preset.maxRobotL_mm && p.width_mm <= preset.maxRobotW_mm;
  const top = new Physics(p, { motorMismatch: false, batterySag: false, grip: true }).nominalTopSpeed();
  const span = (p.sensor.channels - 1) * p.sensor.spacing_mm;

  return (
    <div className="panel-scroll">
      <div className="panel-head">
        <input className="name-input" value={p.name} aria-label="Robot name" onChange={(e) => set('name', e.target.value)} />
        <div className="row-buttons">
          <button onClick={onImport}>Import robot</button>
          <button onClick={onExport}>Export robot</button>
        </div>
      </div>

      <div className={`callout ${fits ? 'ok' : 'warn'}`}>
        {fits
          ? `Fits the ${preset.name} limit of ${preset.maxRobotL_mm} × ${preset.maxRobotW_mm} mm.`
          : `Too big for ${preset.name}: limit is ${preset.maxRobotL_mm} × ${preset.maxRobotW_mm} mm.`}
        {' '}Top speed about {top.toFixed(2)} m/s. Array spans {span} mm.
      </div>

      <Group title="Geometry">
        <NumField label="Wheelbase" unit="mm" value={p.wheelbase_mm} min={20} onChange={(v) => set('wheelbase_mm', v)} hint="Wheel centre to wheel centre." />
        <NumField label="Sensor offset" unit="mm" value={p.sensorOffset_mm} min={0} onChange={(v) => set('sensorOffset_mm', v)} hint="Array distance ahead of the wheel axle." />
        <NumField label="Wheel diameter" unit="mm" value={p.wheelDiameter_mm} min={5} onChange={(v) => set('wheelDiameter_mm', v)} />
        <NumField label="Wheel width" unit="mm" value={p.wheelWidth_mm} min={2} onChange={(v) => set('wheelWidth_mm', v)} />
        <NumField label="Length" unit="mm" value={p.length_mm} min={20} onChange={(v) => set('length_mm', v)} />
        <NumField label="Width" unit="mm" value={p.width_mm} min={20} onChange={(v) => set('width_mm', v)} />
        <NumField label="Axle from front" unit="mm" value={p.axleFromFront_mm} min={0} onChange={(v) => set('axleFromFront_mm', v)} hint="Front edge of the robot back to the axle." />
        <NumField label="Caster position" unit="mm" value={p.casterOffset_mm} onChange={(v) => set('casterOffset_mm', v)} hint="From the axle: + ahead, − behind." />
        <NumField label="Centre of mass" unit="mm" value={p.comOffset_mm} onChange={(v) => set('comOffset_mm', v)} hint="From the axle: + ahead, − behind." />
      </Group>

      <Group title="Sensor array" note={`Straight array. Each sensor sees a ${spotDiameter_mm(p.sensor).toFixed(1)} mm spot on the floor.`}>
        <NumField label="Channels" value={p.sensor.channels} min={2} max={32} onChange={(v) => setS('channels', Math.round(v))} />
        <NumField label="Spacing" unit="mm" value={p.sensor.spacing_mm} min={1} step={0.5} onChange={(v) => setS('spacing_mm', v)} />
        <NumField label="Height" unit="mm" value={p.sensor.height_mm} min={0.5} step={0.5} onChange={(v) => setS('height_mm', v)} hint="Above the floor. Higher gives a bigger, blurrier spot." />
        <NumField label="Spot size" unit="mm" value={p.sensor.spot_mm} min={0} step={0.5} onChange={(v) => setS('spot_mm', v)} hint="0 estimates it from the height." />
        <NumField label="ADC bits" value={p.sensor.adcBits} min={8} max={16} onChange={(v) => setS('adcBits', Math.round(v))} />
        <NumField label="White reading" value={p.sensor.whiteRaw} min={0} onChange={(v) => setS('whiteRaw', v)} hint="Raw value over white at 5 mm height." />
        <NumField label="Black reading" value={p.sensor.blackRaw} min={0} onChange={(v) => setS('blackRaw', v)} hint="Raw value over black at 5 mm height." />
        <NumField label="Threshold" value={p.sensor.threshold} min={0} onChange={(v) => setS('threshold', v)} hint="Raw value that lights the LED (on the line)." />
        <NumField label="Noise" unit="%" value={p.sensor.noise_pct} min={0} step={0.5} onChange={(v) => setS('noise_pct', v)} />
        <NumField label="Sensor spread" unit="%" value={p.sensor.mismatch_pct} min={0} step={0.5} onChange={(v) => setS('mismatch_pct', v)} hint="Gain difference between sensors." />
      </Group>

      <Group title="Motors" note="Use the gear motor's shop-page numbers (output shaft).">
        <NumField label="Rated voltage" unit="V" value={p.motor.ratedV} min={1} step={0.5} onChange={(v) => setM('ratedV', v)} />
        <NumField label="No-load speed" unit="rpm" value={p.motor.noLoadRpm} min={1} onChange={(v) => setM('noLoadRpm', v)} />
        <NumField label="Stall torque" unit="kg·cm" value={p.motor.stallTorque_kgcm} min={0.01} step={0.05} onChange={(v) => setM('stallTorque_kgcm', v)} />
        <NumField label="Stall current" unit="A" value={p.motor.stallCurrent_A} min={0.01} step={0.1} onChange={(v) => setM('stallCurrent_A', v)} />
        <NumField label="Gear ratio" unit=": 1" value={p.motor.gearRatio} min={1} onChange={(v) => setM('gearRatio', v)} />
        <NumField label="Right motor weaker by" unit="%" value={p.motor.mismatch_pct} min={0} step={0.5} onChange={(v) => setM('mismatch_pct', v)} />
      </Group>

      <Group title="Driver and battery">
        <SelectField<DriverModel> label="Motor driver" value={p.driver} onChange={(v) => set('driver', v)}
          options={[{ value: 'TB6612FNG', label: 'TB6612FNG' }, { value: 'L298N', label: 'L298N (about 2 V drop)' }]} />
        <NumField label="PWM frequency" unit="Hz" value={p.pwmFreq_Hz} min={50} onChange={(v) => set('pwmFreq_Hz', v)} />
        <NumField label="PWM resolution" unit="bits" value={p.pwmBits} min={4} max={16} onChange={(v) => set('pwmBits', Math.round(v))} />
        <NumField label="Battery full" unit="V" value={p.battery.fullV} min={1} step={0.1} onChange={(v) => setB('fullV', v)} />
        <NumField label="Battery nominal" unit="V" value={p.battery.nominalV} min={1} step={0.1} onChange={(v) => setB('nominalV', v)} />
        <NumField label="Capacity" unit="mAh" value={p.battery.capacity_mAh} min={10} onChange={(v) => setB('capacity_mAh', v)} />
        <NumField label="Internal resistance" unit="Ω" value={p.battery.internalR_ohm} min={0} step={0.01} onChange={(v) => setB('internalR_ohm', v)} />
      </Group>

      <Group title="Mass and grip">
        <NumField label="Mass" unit="g" value={p.mass_g} min={20} onChange={(v) => set('mass_g', v)} />
        <NumField label="Yaw inertia" unit="kg·m²" value={p.inertia_kgm2} min={0} step={0.0001} onChange={(v) => set('inertia_kgm2', v)}
          hint={`0 estimates it: ${yawInertia(p).toExponential(2)} kg·m².`} />
        <NumField label="Tyre grip" unit="μ" value={p.grip} min={0.1} max={2} step={0.05} onChange={(v) => set('grip', v)} hint="Rubber on a flex mat is about 0.8–1.0." />
      </Group>

      <Group title="Encoders">
        <Toggle label="Robot has wheel encoders" checked={p.encoders.present} onChange={(v) => setE('present', v)} />
        <Toggle label="My code reads the encoders" checked={p.encoders.usedInCode} onChange={(v) => setE('usedInCode', v)} />
        <NumField label="Counts per wheel turn" value={p.encoders.cpr} min={1} onChange={(v) => setE('cpr', v)} />
      </Group>
    </div>
  );
}
