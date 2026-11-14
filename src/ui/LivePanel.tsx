import { useEffect, useRef } from 'react';
import { Simulation } from '../sim/simulation';
import { RobotProfile } from '../sim/profile';

interface Props { sim: Simulation | null; profile: RobotProfile; frame: number }

export function LivePanel({ sim, profile, frame }: Props) {
  const s = profile.sensor;
  const raw = sim ? sim.sensors.raw : new Array(s.channels).fill(s.whiteRaw);
  const max = 2 ** s.adcBits - 1;
  const highIsBlack = s.blackRaw >= s.whiteRaw;
  const b = sim?.body;
  const tel = sim?.brain.telemetry() ?? {};
  const wheelV = (w: number | undefined) => (w === undefined || !sim ? '—' : (w * sim.physics.wheelR).toFixed(2));

  return (
    <aside className="live" aria-label="Live robot data">
      <section>
        <h3>Sensors</h3>
        <div className="bars" style={{ gridTemplateColumns: `repeat(${s.channels}, 1fr)` }}>
          {raw.map((v, i) => {
            const on = highIsBlack ? v > s.threshold : v < s.threshold;
            return (
              <div className="bar-col" key={i} title={`Sensor ${i + 1}: ${v}`}>
                <span className={`led${on ? ' on' : ''}`} />
                <div className="bar"><div className="bar-fill" style={{ height: `${(v / max) * 100}%` }} /><div className="bar-th" style={{ bottom: `${(s.threshold / max) * 100}%` }} /></div>
                <span className="bar-v">{v}</span>
              </div>
            );
          })}
        </div>
        <p className="hint">Leftmost sensor first. The tick marks the threshold.</p>
      </section>

      <section>
        <h3>Robot</h3>
        <dl className="readout">
          <dt>State</dt><dd>{sim ? sim.brain.state() : 'Ready'}</dd>
          <dt>Speed</dt><dd>{b ? `${sim!.physics.forwardSpeed(b).toFixed(2)} m/s` : '—'}</dd>
          <dt>Wheels L / R</dt><dd>{wheelV(b?.wL)} / {wheelV(b?.wR)} m/s</dd>
          <dt>PWM L / R</dt><dd>{sim ? `${sim.dutyL.toFixed(2)} / ${sim.dutyR.toFixed(2)}` : '—'}</dd>
          <dt>Line error</dt><dd>{tel.error_mm !== undefined ? `${tel.error_mm.toFixed(1)} mm` : '—'}</dd>
          <dt>Battery</dt><dd>{b ? `${b.vBatt.toFixed(2)} V` : `${profile.battery.fullV.toFixed(2)} V`}</dd>
          <dt>Current L / R</dt><dd>{b ? `${b.iL.toFixed(2)} / ${b.iR.toFixed(2)} A` : '—'}</dd>
          <dt>Wheel slip</dt><dd>{b?.slipping ? 'Skidding' : 'Gripping'}</dd>
        </dl>
      </section>

      <section>
        <h3>Last 5 seconds</h3>
        <Graph sim={sim} frame={frame} />
        <p className="legend"><span className="sw sw-err" />Line error (±40 mm) <span className="sw sw-l" />Left PWM <span className="sw sw-r" />Right PWM</p>
      </section>
    </aside>
  );
}

function Graph({ sim, frame }: { sim: Simulation | null; frame: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    c.width = r.width * dpr; c.height = r.height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.strokeStyle = '#D5DCE3'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, r.height / 2); ctx.lineTo(r.width, r.height / 2); ctx.stroke();
    if (!sim || sim.history.length < 2) return;
    const t1 = sim.time, t0 = t1 - 5;
    const pts = sim.history.filter((h) => h.t >= t0);
    const line = (key: string, scale: number, color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
      pts.forEach((h, i) => {
        const x = ((h.t - t0) / 5) * r.width;
        const y = r.height / 2 - ((h[key] ?? 0) / scale) * (r.height / 2 - 4);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    line('dutyL', 1, '#2457C5');
    line('dutyR', 1, '#C2410C');
    line('error_mm', 40, '#16212C');
  }, [sim, frame]);
  return <canvas ref={ref} className="graph" aria-label="Line error and motor PWM over the last 5 seconds" />;
}
