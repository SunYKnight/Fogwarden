import type { ReactNode } from 'react';
import { Button, Icon, Popover } from '../kit';

export interface FilterChip {
  /** Shown on the chip, e.g. "CR 1–5". */
  label: string;
  clear: () => void;
}

interface FilterRowProps {
  search: { label: string; value: string; onChange: (text: string) => void };
  /** One chip per filter that differs from its default. */
  chips: FilterChip[];
  reset: () => void;
  /** Fields of the Filters popover. */
  children: ReactNode;
}

/** Search box plus one Filters popover; set filters show as removable chips so the row stays short. */
export function FilterRow({ search, chips, reset, children }: FilterRowProps) {
  return (
    <div className="row wrap compendium-filters">
      <input
        type="search"
        aria-label={search.label}
        placeholder={search.label}
        value={search.value}
        onChange={(e) => search.onChange(e.target.value)}
      />
      <Popover
        label="Filters"
        trigger={(open, toggle) => (
          <Button icon="filter" label="Filters" active={open} aria-haspopup="dialog" onClick={toggle} />
        )}
      >
        <div className="filter-panel">{children}</div>
      </Popover>
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          className="chip filter-chip"
          title={`Remove filter: ${chip.label}`}
          aria-label={`Remove filter: ${chip.label}`}
          onClick={chip.clear}
        >
          {chip.label}
          <Icon name="close" size={12} />
        </button>
      ))}
      {(chips.length > 0 || search.value !== '') && <Button label="Reset" variant="ghost" onClick={reset} />}
    </div>
  );
}

/** Labelled select inside the Filters popover; the empty value means "any". */
export function FilterSelect(props: {
  label: string;
  all: string;
  value: string;
  options: string[];
  format?: (v: string) => string;
  onChange: (v: string) => void;
}) {
  const { label, all, value, options, format = (v) => v, onChange } = props;
  return (
    <label className="filter-field">
      <span className="muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {format(o)}
          </option>
        ))}
      </select>
    </label>
  );
}
