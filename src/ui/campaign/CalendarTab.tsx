import { useEffect, useId, useMemo, useState } from 'react';
import {
  ADVANCE_STEPS,
  advanceCalendar,
  CALENDAR_PRESETS,
  createCalendar,
  formatCalendarDate,
  formatMonthLines,
  parseMonthLines,
  sortedEvents,
  toMinutes,
  withMonths,
  type AdvanceStep,
  type Calendar,
  type CalendarDate,
  type CalendarEvent,
  type CalendarMonth,
  type CalendarPreset,
} from '@/core/campaign/calendar';
import { newId } from '@/core/model';
import { CampaignFiles } from '@/data/campaignFiles';
import { useAppStore } from '@/state/appStore';
import { saveCampaignCalendar } from '@/state/calendarStore';
import { Field, NumberField, SelectField, TextField } from '../components/fields';
import { Button, Dialog, EmptyState, Section } from '../kit';
import type { CampaignTabProps } from './campaignUi';

/** Year, month, day, hour and minute of `value` in the calendar's months. */
function DateFields({
  calendar,
  value,
  onChange,
}: {
  calendar: Calendar;
  value: CalendarDate;
  onChange: (d: CalendarDate) => void;
}) {
  const monthIds = calendar.months.map((_, i) => String(i + 1));
  const days = calendar.months[value.month - 1]!.days;
  return (
    <>
      <NumberField label="Year" value={value.year} step={1} onChange={(year) => onChange({ ...value, year })} />
      <SelectField
        label="Month"
        value={String(value.month)}
        options={monthIds}
        format={(id) => calendar.months[Number(id) - 1]!.name}
        onChange={(id) => {
          const month = Number(id);
          onChange({ ...value, month, day: Math.min(value.day, calendar.months[month - 1]!.days) });
        }}
      />
      <NumberField label="Day" value={value.day} min={1} max={days} onChange={(day) => onChange({ ...value, day })} />
      <NumberField label="Hour" value={value.hour} min={0} max={23} onChange={(hour) => onChange({ ...value, hour })} />
      <NumberField
        label="Minute"
        value={value.minute}
        min={0}
        max={59}
        onChange={(minute) => onChange({ ...value, minute })}
      />
    </>
  );
}

function SetDateDialog(props: { calendar: Calendar; onSave: (c: Calendar) => Promise<void>; onClose: () => void }) {
  const { calendar, onSave, onClose } = props;
  const reportError = useAppStore((s) => s.reportError);
  const [now, setNow] = useState(calendar.now);
  return (
    <Dialog
      title="Set date and time"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button
            label="Set"
            variant="primary"
            onClick={() => onSave({ ...calendar, now }).then(onClose, reportError)}
          />
        </>
      }
    >
      <DateFields calendar={calendar} value={now} onChange={setNow} />
    </Dialog>
  );
}

function MonthsDialog(props: { calendar: Calendar; onSave: (c: Calendar) => Promise<void>; onClose: () => void }) {
  const { calendar, onSave, onClose } = props;
  const reportError = useAppStore((s) => s.reportError);
  const [yearLabel, setYearLabel] = useState(calendar.yearLabel);
  const [text, setText] = useState(formatMonthLines(calendar.months));
  const id = useId();
  const parsed = useMemo(() => {
    let result: { months: CalendarMonth[] } | { error: string };
    try {
      result = { months: parseMonthLines(text) };
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    }
    return result;
  }, [text]);
  return (
    <Dialog
      title="Months"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button
            label="Save months"
            variant="primary"
            disabled={'error' in parsed}
            onClick={() =>
              'months' in parsed &&
              onSave({ ...withMonths(calendar, parsed.months), yearLabel: yearLabel.trim() }).then(onClose, reportError)
            }
          />
        </>
      }
    >
      <TextField label="After the year" placeholder="DR" value={yearLabel} onChange={setYearLabel} />
      <Field label="Months" htmlFor={id}>
        <textarea id={id} rows={12} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <p className={'error' in parsed ? 'error-text' : 'muted'}>
        {'error' in parsed ? parsed.error : 'One month per line: "Name: days". Dates past a shorter month move back.'}
      </p>
    </Dialog>
  );
}

function EventDialog(props: { calendar: Calendar; onSave: (c: Calendar) => Promise<void>; onClose: () => void }) {
  const { calendar, onSave, onClose } = props;
  const reportError = useAppStore((s) => s.reportError);
  const [event, setEvent] = useState<CalendarEvent>({ id: newId(), at: calendar.now, title: '', notes: '' });
  return (
    <Dialog
      title="New event"
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button
            label="Add event"
            variant="primary"
            disabled={event.title.trim() === ''}
            onClick={() =>
              onSave({ ...calendar, events: [...calendar.events, { ...event, title: event.title.trim() }] }).then(
                onClose,
                reportError,
              )
            }
          />
        </>
      }
    >
      <Field label="Title">
        <input
          aria-label="Event title"
          value={event.title}
          placeholder="Festival, deadline, the caravan leaves"
          onChange={(e) => setEvent({ ...event, title: e.target.value })}
        />
      </Field>
      <DateFields calendar={calendar} value={event.at} onChange={(at) => setEvent({ ...event, at })} />
      <TextField label="Notes" multiline value={event.notes} onChange={(notes) => setEvent({ ...event, notes })} />
    </Dialog>
  );
}

type OpenDialog = 'date' | 'months' | 'event' | null;

/** In-game date and time with rest buttons, custom months and events. */
export function CalendarTab({ campaignId }: CampaignTabProps) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [calendar, setCalendar] = useState<Calendar | null | undefined>(undefined);
  const [preset, setPreset] = useState<CalendarPreset>('harptos');
  const [dialog, setDialog] = useState<OpenDialog>(null);
  // Earlier current times, so a mistaken rest, jump or set date can be taken back.
  const [previous, setPrevious] = useState<CalendarDate[]>([]);
  // Each step builds on the shown date, so the next waits for the last save.
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    new CampaignFiles(repository.storage, campaignId).loadCalendar().then(setCalendar, reportError);
  }, [repository, campaignId, reportError]);

  const save = async (next: Calendar) => {
    setBusy(true);
    try {
      setCalendar(await saveCampaignCalendar(campaignId, next));
    } finally {
      setBusy(false);
    }
  };

  const setDate = async (next: Calendar) => {
    await save(next);
    setPrevious((p) => [...p, calendar!.now]);
  };

  const saveMonths = async (next: Calendar) => {
    await save(next);
    // Earlier dates may lie in months that no longer exist.
    setPrevious([]);
  };

  const start = async () => {
    await save(createCalendar(preset));
    useAppStore.getState().notify('Calendar started', 'success');
  };

  const advance = async (step: AdvanceStep) => {
    const next = advanceCalendar(calendar!, ADVANCE_STEPS[step].minutes);
    await save(next);
    setPrevious((p) => [...p, calendar!.now]);
    useAppStore.getState().notify(`${ADVANCE_STEPS[step].label}: now ${formatCalendarDate(next, next.now)}`, 'success');
  };

  const undo = async () => {
    await save({ ...calendar!, now: previous[previous.length - 1]! });
    setPrevious((p) => p.slice(0, -1));
  };

  const removeEvent = async (event: CalendarEvent) => {
    await save({ ...calendar!, events: calendar!.events.filter((e) => e.id !== event.id) });
    useAppStore.getState().notify(`Removed "${event.title}"`, 'success');
  };

  const nowMinutes = calendar ? toMinutes(calendar.months, calendar.now) : 0;
  return calendar === undefined ? null : calendar === null ? (
    <EmptyState
      icon="calendar"
      title="This campaign has no calendar yet."
      action={
        <div className="col">
          <SelectField
            label="Calendar"
            value={preset}
            options={CALENDAR_PRESETS.map((p) => p.id)}
            format={(id) => CALENDAR_PRESETS.find((p) => p.id === id)!.label}
            onChange={setPreset}
          />
          <Button icon="calendar" label="Start calendar" variant="primary" onClick={() => start().catch(reportError)} />
        </div>
      }
    >
      In-game date and time, rests and events. Months can be changed later. The Scene&apos;s time of day in Play follows
      it.
    </EmptyState>
  ) : (
    <div className="calendar-page">
      <div className="calendar-now panel">
        <span className="muted">Now</span>
        <strong className="calendar-date">{formatCalendarDate(calendar, calendar.now)}</strong>
        <div className="row wrap">
          {(Object.keys(ADVANCE_STEPS) as AdvanceStep[]).map((step) => (
            <Button
              key={step}
              icon="clock"
              label={ADVANCE_STEPS[step].label}
              variant={step === 'longRest' ? 'primary' : 'default'}
              title={`${ADVANCE_STEPS[step].minutes} minutes`}
              disabled={busy}
              onClick={() => advance(step).catch(reportError)}
            />
          ))}
          <Button
            icon="undo"
            label="Undo"
            disabled={previous.length === 0 || busy}
            onClick={() => undo().catch(reportError)}
          />
        </div>
        <div className="row">
          <Button icon="edit" label="Set date…" onClick={() => setDialog('date')} />
          <Button icon="calendar" label="Months…" onClick={() => setDialog('months')} />
        </div>
      </div>
      <Section
        title={`Events (${calendar.events.length})`}
        actions={<Button icon="plus" label="Add event…" onClick={() => setDialog('event')} />}
      >
        <div className="list">
          {sortedEvents(calendar).map((event) => (
            <div
              key={event.id}
              className={toMinutes(calendar.months, event.at) < nowMinutes ? 'list-item past' : 'list-item'}
            >
              <span className="calendar-event-date">{formatCalendarDate(calendar, event.at)}</span>
              <span className="row-name" title={event.notes}>
                {event.title}
              </span>
              <Button
                icon="trash"
                label={`Remove ${event.title}`}
                iconOnly
                variant="ghost"
                onClick={() => removeEvent(event).catch(reportError)}
              />
            </div>
          ))}
        </div>
        {calendar.events.length === 0 && <p className="muted">Festivals, deadlines, appointments.</p>}
      </Section>
      {dialog === 'date' && <SetDateDialog calendar={calendar} onSave={setDate} onClose={() => setDialog(null)} />}
      {dialog === 'months' && <MonthsDialog calendar={calendar} onSave={saveMonths} onClose={() => setDialog(null)} />}
      {dialog === 'event' && <EventDialog calendar={calendar} onSave={save} onClose={() => setDialog(null)} />}
    </div>
  );
}
