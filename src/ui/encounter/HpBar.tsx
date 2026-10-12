import type { HitPoints } from '@/state/encounterActions';

/** Health as a bar: green above half, yellow above a quarter, red below; temp HP as a blue cap. */
export function HpBar({ hp }: { hp: HitPoints }) {
  const ratio = hp.max > 0 ? Math.max(0, Math.min(1, hp.current / hp.max)) : 0;
  const level = ratio > 0.5 ? 'ok' : ratio > 0.25 ? 'low' : 'critical';
  return (
    <div className={`hp-bar ${level}`} aria-hidden="true">
      <div className="hp-fill" style={{ width: `${ratio * 100}%` }} />
      {hp.temp > 0 && <div className="hp-temp" />}
    </div>
  );
}
