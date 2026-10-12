import { describe, expect, it } from 'vitest';
import {
  ADVANCE_STEPS,
  advanceCalendar,
  calendarSchema,
  createCalendar,
  formatCalendarDate,
  minuteOfDay,
  parseMonthLines,
  withMonths,
  withTimeOfDay,
  type Calendar,
} from './calendar';

function at(calendar: Calendar, now: Calendar['now']): Calendar {
  return { ...calendar, now };
}

describe('calendar arithmetic', () => {
  const harptos = createCalendar('harptos');

  it('crosses one-day festival months and years', () => {
    const lastOfHammer = at(harptos, { year: 1492, month: 1, day: 30, hour: 20, minute: 0 });
    const midwinter = advanceCalendar(lastOfHammer, ADVANCE_STEPS.longRest.minutes);
    expect(midwinter.now).toEqual({ year: 1492, month: 2, day: 1, hour: 4, minute: 0 });
    expect(formatCalendarDate(midwinter, midwinter.now)).toBe('Midwinter 1492 DR, 04:00');

    const yearEnd = at(harptos, { year: 1492, month: 17, day: 30, hour: 23, minute: 55 });
    expect(advanceCalendar(yearEnd, ADVANCE_STEPS.tenMinutes.minutes).now).toEqual({
      year: 1493,
      month: 1,
      day: 1,
      hour: 0,
      minute: 5,
    });
  });

  it('takes an hour for a short rest and a whole day for +1 day', () => {
    const start = at(harptos, { year: 1492, month: 3, day: 10, hour: 9, minute: 30 });
    expect(advanceCalendar(start, ADVANCE_STEPS.shortRest.minutes).now).toMatchObject({ day: 10, hour: 10 });
    expect(advanceCalendar(start, ADVANCE_STEPS.day.minutes).now).toMatchObject({ day: 11, hour: 9, minute: 30 });
  });

  it('uses custom month lengths and goes back across a year', () => {
    const custom = withMonths(createCalendar('gregorian'), parseMonthLines('Frost: 3\nThaw: 2\n'));
    const start = at(custom, { year: 5, month: 1, day: 1, hour: 0, minute: 0 });
    expect(advanceCalendar(start, 4 * 24 * 60).now).toMatchObject({ year: 5, month: 2, day: 2 });
    expect(advanceCalendar(start, -1).now).toEqual({ year: 4, month: 2, day: 2, hour: 23, minute: 59 });
  });

  it('sets the time of day on the same day for the Scene slider', () => {
    const evening = withTimeOfDay(harptos, 19 * 60 + 45);
    expect(evening.now).toMatchObject({ month: 1, day: 1, hour: 19, minute: 45 });
    expect(minuteOfDay(evening)).toBe(1185);
  });

  it('moves dates past shorter months back when the months change', () => {
    const late = at(harptos, { year: 1492, month: 17, day: 30, hour: 8, minute: 0 });
    const short = withMonths(late, parseMonthLines('Only: 10'));
    expect(short.now).toMatchObject({ month: 1, day: 10 });
    expect(calendarSchema.safeParse(short).success).toBe(true);
    expect(calendarSchema.safeParse({ ...harptos, now: { ...harptos.now, month: 2, day: 2 } }).success).toBe(false);
  });

  it('rejects month lines without a length', () => {
    expect(() => parseMonthLines('Hammer: 30\nAlturiak')).toThrow('Line 2');
  });
});
