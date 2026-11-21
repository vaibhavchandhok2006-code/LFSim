import { useMemo, useState } from 'react';
import { Algorithm, MEMORY_ALGORITHMS, SettingsParams } from '../brain/settings';
import { Wiring } from '../worker/protocol';
import { Group, NumField, SelectField } from './Field';
import { CodeSetup } from './persist';
import { formatButtons, formatOperator, parseButtons, parseOperator } from '../brain/operator';

interface Props {
  mode: 'settings' | 'code';
  onMode: (m: 'settings' | 'code') => void;
  settings: SettingsParams;
  onChange: (s: SettingsParams) => void;
  code: CodeSetup;
  onCode: (c: CodeSetup) => void;
  onLoadSample: () => void;
}

const ALGOS: { value: Algorithm; label: string }[] = [
  { value: 'pid-only', label: 'Line following only (no junction logic)' },
  { value: 'left-hand', label: 'Left-hand: always take the leftmost branch' },
  { value: 'right-hand', label: 'Right-hand: always take the rightmost branch' },
  { value: 'straight-first', label: 'Straight first, then a fallback side' },
  { value: 'custom', label: 'Custom priority order' },
  { value: 'lsrb', label: 'LSRB with branch numbers (memory run)' },
  { value: 'tremaux', label: 'Mapping + shortest path (memory run)' },
];

export function BrainPanel({ mode, onMode, settings: s, onChange, code, onCode, onLoadSample }: Props) {
  const set = <K extends keyof SettingsParams>(k: K, v: SettingsParams[K]) => onChange({ ...s, [k]: v });
  return (
    <div className="panel-scroll">
      <div className="segmented" role="tablist" aria-label="Robot brain">
        <button role="tab" aria-selected={mode === 'settings'} className={mode === 'settings' ? 'on' : ''} onClick={() => onMode('settings')}>Settings mode</button>
        <button role="tab" aria-selected={mode === 'code'} className={mode === 'code' ? 'on' : ''} onClick={() => onMode('code')}>Code mode</button>
      </div>
      {mode === 'settings' ? <SettingsForm s={s} set={set} /> : <CodeForm code={code} onCode={onCode} onLoadSample={onLoadSample} />}
    </div>
  );
}

function SettingsForm({ s, set }: { s: SettingsParams; set: <K extends keyof SettingsParams>(k: K, v: SettingsParams[K]) => void }) {
  const orderOk = /^[LSRB]{1,4}$/i.test(s.customOrder) && new Set(s.customOrder.toUpperCase()).size === s.customOrder.length;
  return (
    <>
      <p className="panel-note">The built-in robot: PID on the analog line position. At a junction it rolls onto it, reads the branches from what its sensors saw on the way (no look-around spin), then turns onto the one the algorithm picks.</p>
      <Group title="Algorithm">
        <SelectField label="At junctions" value={s.algorithm} options={ALGOS} onChange={(v) => set('algorithm', v)}
          hint={MEMORY_ALGORITHMS.includes(s.algorithm) ? 'Run 1 explores and saves memory. Then use "Run again with memory" in Simulate.' : undefined} />
        {s.algorithm === 'straight-first' && (
          <SelectField label="When there is no straight" value={s.straightFallback} onChange={(v) => set('straightFallback', v)}
            options={[{ value: 'left', label: 'Turn left' }, { value: 'right', label: 'Turn right' }]} />
        )}
        {s.algorithm === 'custom' && (
          <div className="field wide-field">
            <label htmlFor="order">Priority order</label>
            <div className="order-row" id="order">
              {s.customOrder.toUpperCase().split('').map((c, i, arr) => (
                <span key={c + i} className="order-chip">
                  {c}
                  <button aria-label={`Move ${c} earlier`} disabled={i === 0} onClick={() => { const a = [...arr]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set('customOrder', a.join('')); }}>◀</button>
                  <button aria-label={`Move ${c} later`} disabled={i === arr.length - 1} onClick={() => { const a = [...arr]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; set('customOrder', a.join('')); }}>▶</button>
                </span>
              ))}
            </div>
            {!orderOk && <p className="hint">Use each of L, S, R, B once.</p>}
            <p className="hint">L = left, S = straight, R = right, B = turn back. The first one available is taken.</p>
          </div>
        )}
      </Group>

      <Group title="PID line following" note="Error is the line position in mm (+ = line to the left).">
        <NumField label="Kp" unit="duty/mm" step={0.001} min={0} value={s.kp} onChange={(v) => set('kp', v)} />
        <NumField label="Ki" unit="duty/(mm·s)" step={0.001} min={0} value={s.ki} onChange={(v) => set('ki', v)} />
        <NumField label="Kd" unit="duty/(mm/s)" step={0.0001} min={0} value={s.kd} onChange={(v) => set('kd', v)} />
        <NumField label="Integral limit" unit="duty" step={0.05} min={0} value={s.iLimit} onChange={(v) => set('iLimit', v)} />
        <NumField label="D filter" unit="Hz" step={5} min={0} value={s.dFilterHz} onChange={(v) => set('dFilterHz', v)} hint="Low-pass on the derivative so sensor noise doesn't shake the motors. 0 = off." />
        <NumField label="Loop rate" unit="Hz" step={50} min={10} max={2000} value={s.loopHz} onChange={(v) => set('loopHz', v)} hint="How often the code reads sensors and updates motors." />
      </Group>

      <Group title="Speeds" note="As PWM duty, 0 to 1.">
        <NumField label="Base speed" step={0.02} min={0} max={1} value={s.baseSpeed} onChange={(v) => set('baseSpeed', v)} />
        <NumField label="Max per wheel" step={0.02} min={0} max={1} value={s.maxSpeed} onChange={(v) => set('maxSpeed', v)} />
        <NumField label="Turn speed" step={0.02} min={0} max={1} value={s.turnSpeed} onChange={(v) => set('turnSpeed', v)} hint="In-place turns at junctions and the line search." />
        <NumField label="Acceleration limit" unit="duty/s" step={0.1} min={0.1} value={s.accel} onChange={(v) => set('accel', v)} />
      </Group>

      <Group title="Junctions">
      <p className="group-text">An outermost sensor seeing black (with the centre) starts a junction. While rolling over it the robot maps what its sensors saw and reads the branches from that map — no look-around scan.</p>
        <SelectField<'auto' | 'manual'> label="Roll onto the junction" value={s.inchMode} onChange={(v) => set('inchMode', v)}
          options={[{ value: 'auto', label: 'Auto: until the axle is over the junction centre' }, { value: 'manual', label: 'Fixed distance (below)' }]} />
        {s.inchMode === 'manual' && <NumField label="Inch forward" unit="cm" step={0.5} min={0} value={s.inchForward_cm} onChange={(v) => set('inchForward_cm', v)} hint="Roll this far after detecting a junction, so the axle sits over it." />}
        <SelectField label="Turn method" value={s.turnMethod} onChange={(v) => set('turnMethod', v)}
          options={[{ value: 'spin-until-line', label: 'Spin until the centre sensors find the line' }, { value: 'timed', label: 'Turn by measured angle (timed turn)' }]} />
        <NumField label="Dead end: all white for" unit="cm" step={0.5} min={0.5} value={s.deadEndWhite_cm} onChange={(v) => set('deadEndWhite_cm', v)} />
      </Group>

      <Group title="Finish and lost line">
        <NumField label="Finish: all black for" unit="cm" step={0.5} min={1} value={s.finishBlack_cm} onChange={(v) => set('finishBlack_cm', v)}
          hint="An all-black patch within 60 cm of the start (by odometry) is taken as the start square, not the finish." />
        <NumField label="Give up searching after" unit="s" step={0.5} min={0.2} value={s.lostTimeout_s} onChange={(v) => set('lostTimeout_s', v)} hint="Line-following-only mode." />
      </Group>
    </>
  );
}

function CodeForm({ code, onCode, onLoadSample }: { code: CodeSetup; onCode: (c: CodeSetup) => void; onLoadSample: () => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = code.wiring;
  const setW = (patch: Partial<Wiring>) => onCode({ ...code, wiring: { ...w, ...patch } });
  const setD = (patch: Partial<Wiring['driver']>) => setW({ driver: { ...w.driver, ...patch } });
  const pins = (s: string) => s.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0);
  const srcLines = useMemo(() => code.source.split('\n'), [code.source]);
  const jsLines = useMemo(() => code.translated.split('\n').map((l) => { const m = l.match(/\/\/\s*@L(\d+)(?:-(\d+))?\s*$/); return { text: l.replace(/\/\/\s*@L\d+(?:-\d+)?\s*$/, ''), from: m ? Number(m[1]) : null, to: m ? Number(m[2] ?? m[1]) : null }; }), [code.translated]);
  const linked = (n: number) => hover !== null && jsLines[hover]?.from !== null && n >= jsLines[hover].from! && n <= jsLines[hover].to!;
  return (
    <>
      <p className="panel-note">Runs your own firmware. The LFSim Claude skill translates your Arduino or ESP-IDF code into this JavaScript and fills in the wiring. Import its robot file on the Robot tab, or paste below.</p>
      <div className="row-buttons left"><button onClick={onLoadSample}>Load sample firmware</button></div>
      {code.notes && <div className="callout">{code.notes}</div>}

      <Group title="Firmware side by side" note="Hover a translated line to highlight the original lines it came from.">
        <div className="code-pair">
          <div>
            <p className="kicker">Original ({code.sourceLang || 'not provided'})</p>
            <pre className="code" aria-label="Original firmware">{srcLines.map((l, i) => <div key={i} className={linked(i + 1) ? 'hl' : ''}><span className="ln">{i + 1}</span>{l || ' '}</div>)}</pre>
          </div>
          <div>
            <p className="kicker">Translated for LFSim</p>
            <pre className="code" aria-label="Translated firmware" onMouseLeave={() => setHover(null)}>{jsLines.map((l, i) => <div key={i} className={hover === i ? 'hl' : ''} onMouseEnter={() => setHover(i)}><span className="ln">{l.from ?? ''}</span>{l.text || ' '}</div>)}</pre>
          </div>
        </div>
      </Group>

      <Group title="Edit">
        <div className="field wide-field">
          <label htmlFor="src">Original source</label>
          <textarea id="src" className="code-edit" rows={6} value={code.source} onChange={(e) => onCode({ ...code, source: e.target.value })} spellCheck={false} />
        </div>
        <div className="field wide-field">
          <label htmlFor="js">Translated JavaScript</label>
          <textarea id="js" className="code-edit" rows={10} value={code.translated} onChange={(e) => onCode({ ...code, translated: e.target.value })} spellCheck={false} />
          <p className="hint">Must define async setup() and loop(), or async app_main(). See docs/FIRMWARE_API.md.</p>
        </div>
      </Group>

      <Group title="Wiring" note="GPIO numbers exactly as your code uses them.">
        <SelectField<'esp32' | 'avr'> label="Board" value={w.board ?? 'esp32'} onChange={(v) => setW({ board: v })}
          options={[{ value: 'esp32', label: 'ESP32 (analogRead ≈ 10 µs, 12-bit)' }, { value: 'avr', label: 'Arduino Uno / Nano (analogRead ≈ 112 µs, 10-bit)' }]} />
        <div className="field wide-field">
          <label htmlFor="spins">Sensor pins, leftmost first</label>
          <div className="field-input"><input id="spins" key={w.sensorPins.join(',')} defaultValue={w.sensorPins.join(', ')} onBlur={(e) => setW({ sensorPins: pins(e.target.value) })} /></div>
        </div>
        <NumField label="Left PWM pin" value={w.driver.leftPwm} min={0} onChange={(v) => setD({ leftPwm: v })} />
        <NumField label="Right PWM pin" value={w.driver.rightPwm} min={0} onChange={(v) => setD({ rightPwm: v })} />
        <NumField label="Left IN1" value={w.driver.leftIn1} min={0} onChange={(v) => setD({ leftIn1: v })} />
        <NumField label="Left IN2" value={w.driver.leftIn2} min={0} onChange={(v) => setD({ leftIn2: v })} />
        <NumField label="Right IN1" value={w.driver.rightIn1} min={0} onChange={(v) => setD({ rightIn1: v })} />
        <NumField label="Right IN2" value={w.driver.rightIn2} min={0} onChange={(v) => setD({ rightIn2: v })} />
        <NumField label="Standby pin (−1 = none)" value={w.driver.standby ?? -1} min={-1} onChange={(v) => setD({ standby: v < 0 ? null : v })} />
      </Group>

      <ExtrasGroup key={JSON.stringify([w.buttons ?? [], w.operator ?? []])} w={w} setW={setW} />
    </>
  );
}

// Buttons, compass and the operator script (what the person at the track does, at set times).
function ExtrasGroup({ w, setW }: { w: Wiring; setW: (p: Partial<Wiring>) => void }) {
  const activeLow = w.buttons?.[0]?.activeLow ?? true;
  const [btnText, setBtnText] = useState(formatButtons(w.buttons));
  const [opText, setOpText] = useState(formatOperator(w.operator));
  const btn = parseButtons(btnText, activeLow);
  const op = parseOperator(opText);
  const names = new Set((w.buttons ?? []).map((b) => b.name));
  const unknown = op.steps.filter((s) => s.action === 'press' && !names.has(s.button)).map((s) => (s.action === 'press' ? s.button : ''));
  const mag = w.magnetometer ? `qmc-${w.magnetometer.yAxis}` : 'none';
  return (
    <Group title="Buttons, compass and operator" note="Optional. For code that waits for button presses or reads an I²C compass.">
      <div className="field wide-field">
        <label htmlFor="btns">Buttons (NAME=pin)</label>
        <div className="field-input"><input id="btns" value={btnText} placeholder="ZERO=2 LEFT=3 RIGHT=4"
          onChange={(e) => setBtnText(e.target.value)}
          onBlur={() => { if (!btn.errors.length) setW({ buttons: btn.buttons }); }} /></div>
        {btn.errors.length > 0 && <p className="hint">{btn.errors.join(' ')}</p>}
      </div>
      <SelectField<'low' | 'high'> label="A pressed button reads" value={activeLow ? 'low' : 'high'}
        onChange={(v) => setW({ buttons: (w.buttons ?? []).map((b) => ({ ...b, activeLow: v === 'low' })) })}
        options={[{ value: 'low', label: 'LOW (button to GND, INPUT_PULLUP)' }, { value: 'high', label: 'HIGH (button to VCC, pull-down)' }]} />
      <SelectField<'none' | 'qmc-left' | 'qmc-right'> label="Compass (I²C)" value={mag as 'none' | 'qmc-left' | 'qmc-right'}
        onChange={(v) => setW({ magnetometer: v === 'none' ? null : { chip: 'QMC5883L', yAxis: v === 'qmc-left' ? 'left' : 'right' } })}
        hint="Reports the true heading: no noise, no offsets, no motor interference. X arrow forward; with Y left, atan2(y, x) grows on a right turn."
        options={[{ value: 'none', label: 'None' }, { value: 'qmc-left', label: 'QMC5883L at 0x0D, Y arrow left' }, { value: 'qmc-right', label: 'QMC5883L at 0x0D, Y arrow right' }]} />
      <div className="field wide-field">
        <label htmlFor="op">Operator script</label>
        <textarea id="op" className="code-edit" rows={5} value={opText} spellCheck={false}
          placeholder={'0.5 press ZERO\n8 place-at-start\n8.5 press RIGHT\n9.5 press ZERO'}
          onChange={(e) => setOpText(e.target.value)}
          onBlur={() => { if (!op.errors.length) setW({ operator: op.steps }); }} />
        <p className="hint">One step per line, seconds from power-on: "&lt;time&gt; press &lt;BUTTON&gt; [hold s]" (hold 0.1 s by default) or "&lt;time&gt; place-at-start" (puts the robot back on the start; the run timer restarts). Applied when the field loses focus.</p>
        {op.errors.length > 0 && <p className="hint">{op.errors.join(' ')}</p>}
        {unknown.length > 0 && <p className="hint">Not a button above: {[...new Set(unknown)].join(', ')}.</p>}
      </div>
    </Group>
  );
}
