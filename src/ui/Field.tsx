import { ReactNode, useEffect, useId, useState } from 'react';

interface NumProps {
  label: string;
  value: number;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}

// Number input that only commits valid numbers, so typing "0." or "-" doesn't break the model.
export function NumField({ label, value, unit, step = 1, min, max, hint, disabled, onChange }: NumProps) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (t: string) => {
    setText(t);
    const v = Number(t);
    if (t.trim() !== '' && Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max)) onChange(v);
  };
  const v = Number(text);
  const bad = text.trim() === '' || !Number.isFinite(v) || (min !== undefined && v < min) || (max !== undefined && v > max);
  return (
    <div className={`field${bad ? ' field-bad' : ''}`}>
      <label htmlFor={id} title={hint}>{label}</label>
      <div className="field-input">
        <input id={id} type="number" inputMode="decimal" step={step} min={min} max={max} value={text} disabled={disabled}
          onChange={(e) => commit(e.target.value)} />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  hint?: string;
}

export function SelectField<T extends string>({ label, value, options, onChange, hint }: SelectProps<T>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="toggle">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Group({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="group">
      <h3>{title}</h3>
      {note && <p className="group-note">{note}</p>}
      <div className="group-grid">{children}</div>
    </section>
  );
}
