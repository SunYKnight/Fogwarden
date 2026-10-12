import { useId, useState, type ReactNode } from 'react';

/** Local edit buffer that resets whenever the committed value changes from outside. */
function useDraft<T>(value: T): [T, (next: T) => void] {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  return [draft, setDraft];
}

interface FieldProps {
  label: string;
  children: ReactNode;
  title?: string;
  /** Id of the control the label names, so screen readers announce it. */
  htmlFor?: string;
}

export function Field({ label, children, title, htmlFor }: FieldProps) {
  return (
    <div className="field" title={title}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  title?: string;
}

/** Commits on blur or Enter so half-typed values ("1.") never reach the document. */
export function NumberField({ label, value, onChange, min, max, step, suffix, title }: NumberFieldProps) {
  const [text, setText] = useDraft(String(value));
  const id = useId();
  const commit = () => {
    const parsed = Number(text);
    const valid = text.trim() !== '' && Number.isFinite(parsed);
    const clamped = valid ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed)) : value;
    setText(String(clamped));
    if (clamped !== value) {
      onChange(clamped);
    }
  };
  return (
    <Field label={label} title={title} htmlFor={id}>
      <div className="row">
        <input
          id={id}
          type="number"
          value={text}
          min={min}
          max={max}
          step={step}
          style={{ width: '100%' }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
        {suffix && <span className="muted">{suffix}</span>}
      </div>
    </Field>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  /** Masks the value, e.g. keys and passwords. */
  secret?: boolean;
}

export function TextField({ label, value, onChange, multiline, placeholder, secret = false }: TextFieldProps) {
  const [text, setText] = useDraft(value);
  const id = useId();
  const commit = () => {
    if (text !== value) {
      onChange(text);
    }
  };
  return (
    <Field label={label} htmlFor={id}>
      {multiline ? (
        <textarea
          id={id}
          rows={4}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          id={id}
          type={secret ? 'password' : 'text'}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
      )}
    </Field>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  format?: (value: T) => string;
}

export function SelectField<T extends string>({ label, value, options, onChange, format }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {format ? format(o) : o}
          </option>
        ))}
      </select>
    </Field>
  );
}

interface CheckboxFieldProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export function CheckboxField({ label, value, onChange }: CheckboxFieldProps) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <input id={id} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Field>
  );
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
}

export function SliderField({ label, value, min, max, step, onChange, suffix }: SliderFieldProps) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <div className="row">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ flex: 1 }}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="muted" style={{ minWidth: 48, textAlign: 'right' }}>
          {value}
          {suffix}
        </span>
      </div>
    </Field>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
