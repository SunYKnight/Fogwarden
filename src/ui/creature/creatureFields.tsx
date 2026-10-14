import { useId } from 'react';
import { Field, TextField, useDraft } from '../components/fields';

interface OptionalNumberInputProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  /** Names the box for screen readers when no field label does. */
  label?: string;
}

/** Integer input where an empty box means "no value"; commits on blur or Enter. */
export function OptionalNumberInput({ value, onChange, placeholder, className, id, label }: OptionalNumberInputProps) {
  const committed = value === undefined ? '' : String(value);
  const [text, setText] = useDraft(committed);
  const commit = () => {
    const parsed = Number(text);
    const next = text.trim() === '' || !Number.isFinite(parsed) ? undefined : Math.round(parsed);
    setText(next === undefined ? '' : String(next));
    if (next !== value) {
      onChange(next);
    }
  };
  return (
    <input
      id={id}
      aria-label={label}
      type="number"
      className={className}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

interface OptionalNumberFieldProps extends OptionalNumberInputProps {
  label: string;
  suffix?: string;
}

/** Labelled optional number for speeds, senses, saves and skills that may be absent. */
export function OptionalNumberField({ label, suffix, ...input }: OptionalNumberFieldProps) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <div className="row">
        <OptionalNumberInput {...input} id={id} className="grow" />
        {suffix && <span className="muted">{suffix}</span>}
      </div>
    </Field>
  );
}

/** Comma-separated list of free-text entries. */
export function ListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <TextField
      label={label}
      value={value.join(', ')}
      onChange={(text) =>
        onChange(
          text
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s !== ''),
        )
      }
    />
  );
}
