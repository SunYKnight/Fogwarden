import { useState } from 'react';
import { dayPhase, formatMinute, PHASE_MINUTE, type DayPhase } from '@/core/atmosphere/timeOfDay';
import { WEATHERS, type Weather } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { setCalendarTimeOfDay, useCalendarStore } from '@/state/calendarStore';
import { useEncounterStore } from '@/state/encounterStore';
import { useDmScene } from '@/state/scene';
import { CheckboxField } from '../components/fields';
import { Button, Popover, ToolButton, type IconName } from '../kit';

const PHASES: DayPhase[] = ['dawn', 'day', 'dusk', 'night'];
const PHASE_LABEL: Record<DayPhase, string> = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };
const WEATHER_LABEL: Record<Weather, string> = { none: 'Clear', rain: 'Rain', snow: 'Snow', fog: 'Fog' };
const WEATHER_ICON: Record<Weather, IconName> = { none: 'sun', rain: 'rain', snow: 'snow', fog: 'fog' };
const NOON = 12 * 60;

/** Time of day (DM and players' light) and weather; with a campaign calendar the slider moves its clock. */
function ScenePanel({ onClose }: { onClose: () => void }) {
  const atmosphere = useEncounterStore((s) => s.encounter?.atmosphere);
  const calendar = useCalendarStore((s) => s.calendar);
  const sceneMinute = useDmScene()?.minute ?? null;
  // Dragging previews here; one undo step and calendar write on release.
  const [draft, setDraft] = useState<number | null>(null);
  const minute = sceneMinute === null ? null : (draft ?? sceneMinute);
  const reportError = useAppStore((s) => s.reportError);
  const { update } = useEncounterStore.getState();
  const setMinute = (next: number) => {
    update((d) => void (d.atmosphere.minute = next), 'Time of day');
    if (calendar) setCalendarTimeOfDay(next).catch(reportError);
    setDraft(null);
  };
  const commitDraft = () => {
    if (draft !== null) setMinute(draft);
  };

  return (
    atmosphere && (
      <div className="scene-popover">
        <div className="row">
          <strong>Scene</strong>
          <div className="spacer" />
          <Button icon="close" label="Close scene menu" iconOnly variant="ghost" onClick={onClose} />
        </div>
        <CheckboxField
          label="Time of day"
          value={atmosphere.minute !== null}
          onChange={(on) => update((d) => void (d.atmosphere.minute = on ? NOON : null), 'Time of day')}
        />
        {minute === null ? (
          <p className="muted small">Off: the map&apos;s own light. Turn on to darken open maps at night.</p>
        ) : (
          <>
            <div className="row">
              <input
                type="range"
                className="scene-time"
                min={0}
                max={1439}
                step={10}
                value={minute}
                aria-label="Time of day"
                onChange={(e) => setDraft(Number(e.target.value))}
                onPointerUp={commitDraft}
                onKeyUp={commitDraft}
                onBlur={commitDraft}
              />
              <span className="muted scene-clock">
                {formatMinute(minute)} · {PHASE_LABEL[dayPhase(minute)]}
              </span>
            </div>
            <div className="row" role="group" aria-label="Time of day">
              {PHASES.map((phase) => (
                <Button
                  key={phase}
                  label={PHASE_LABEL[phase]}
                  active={dayPhase(minute) === phase}
                  onClick={() => setMinute(PHASE_MINUTE[phase])}
                />
              ))}
            </div>
            {calendar && <p className="muted small">Follows the campaign calendar.</p>}
          </>
        )}
        <strong>Weather</strong>
        <div className="row" role="group" aria-label="Weather">
          {WEATHERS.map((weather) => (
            <Button
              key={weather}
              icon={WEATHER_ICON[weather]}
              label={WEATHER_LABEL[weather]}
              active={atmosphere.weather === weather}
              onClick={() => update((d) => void (d.atmosphere.weather = weather), 'Weather')}
            />
          ))}
        </div>
      </div>
    )
  );
}

/** Play canvas toolbar entry: the Scene popover. */
export function SceneMenu() {
  return (
    <Popover
      label="Scene"
      trigger={(open, toggle) => <ToolButton icon="sun" label="Scene" active={open} onClick={toggle} />}
    >
      {(close) => <ScenePanel onClose={close} />}
    </Popover>
  );
}
