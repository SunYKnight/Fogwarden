import { z } from 'zod';
import { MINUTES_PER_DAY } from '../atmosphere/timeOfDay';
import { idSchema } from '../model/common';

/**
 * In-game calendar of a campaign (`campaigns/<id>/calendar.json`): custom months, the current date and time,
 * events. Days have 24 hours of 60 minutes; years are the sum of the month lengths (no leap years).
 */

export const CALENDAR_SCHEMA_VERSION = 1;

const MAX_MONTH_DAYS = 1000;

export const calendarMonthSchema = z.object({
  name: z.string().min(1),
  days: z.number().int().min(1).max(MAX_MONTH_DAYS),
});
export type CalendarMonth = z.infer<typeof calendarMonthSchema>;

/** `month` and `day` count from 1. */
export const calendarDateSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1),
  day: z.number().int().min(1),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});
export type CalendarDate = z.infer<typeof calendarDateSchema>;

export const calendarEventSchema = z.object({
  id: idSchema,
  at: calendarDateSchema,
  title: z.string().min(1),
  notes: z.string(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const calendarSchema = z
  .object({
    schema: z.literal('calendar'),
    version: z.literal(CALENDAR_SCHEMA_VERSION),
    /** After the year number, e.g. "DR" for Dale Reckoning. */
    yearLabel: z.string(),
    months: z.array(calendarMonthSchema).min(1),
    now: calendarDateSchema,
    events: z.array(calendarEventSchema),
  })
  .superRefine((calendar, context) => {
    const dates = [
      { path: ['now'], date: calendar.now },
      ...calendar.events.map((e, i) => ({ path: ['events', i, 'at'], date: e.at })),
    ];
    dates
      .filter(({ date }) => !(date.day <= (calendar.months[date.month - 1]?.days ?? 0)))
      .forEach(({ path, date }) =>
        context.addIssue({ code: 'custom', path, message: `Month ${date.month} has no day ${date.day}` }),
      );
  });
export type Calendar = z.infer<typeof calendarSchema>;

export type CalendarPreset = 'harptos' | 'gregorian';

const PRESET_MONTHS: Record<CalendarPreset, { label: string; yearLabel: string; year: number; months: string }> = {
  harptos: {
    label: 'Harptos (Forgotten Realms)',
    yearLabel: 'DR',
    year: 1492,
    months:
      'Hammer 30, Midwinter 1, Alturiak 30, Ches 30, Tarsakh 30, Greengrass 1, Mirtul 30, Kythorn 30, ' +
      'Flamerule 30, Midsummer 1, Eleasis 30, Eleint 30, Highharvestide 1, Marpenoth 30, Uktar 30, ' +
      'Feast of the Moon 1, Nightal 30',
  },
  gregorian: {
    label: 'Gregorian (no leap years)',
    yearLabel: '',
    year: 1000,
    months:
      'January 31, February 28, March 31, April 30, May 31, June 30, July 31, August 31, September 30, ' +
      'October 31, November 30, December 31',
  },
};

export const CALENDAR_PRESETS = Object.entries(PRESET_MONTHS).map(([id, p]) => ({
  id: id as CalendarPreset,
  label: p.label,
}));

export function createCalendar(preset: CalendarPreset): Calendar {
  const p = PRESET_MONTHS[preset];
  const months = p.months.split(', ').map((m) => {
    const split = m.lastIndexOf(' ');
    return { name: m.slice(0, split), days: Number(m.slice(split + 1)) };
  });
  return {
    schema: 'calendar',
    version: CALENDAR_SCHEMA_VERSION,
    yearLabel: p.yearLabel,
    months,
    now: { year: p.year, month: 1, day: 1, hour: 8, minute: 0 },
    events: [],
  };
}

function daysPerYear(months: CalendarMonth[]): number {
  return months.reduce((sum, m) => sum + m.days, 0);
}

/** Minutes since the start of year 0; dates compare and subtract through it. */
export function toMinutes(months: CalendarMonth[], date: CalendarDate): number {
  const daysBefore = months.slice(0, date.month - 1).reduce((sum, m) => sum + m.days, 0);
  const day = date.year * daysPerYear(months) + daysBefore + date.day - 1;
  return day * MINUTES_PER_DAY + date.hour * 60 + date.minute;
}

function fromMinutes(months: CalendarMonth[], total: number): CalendarDate {
  const perYear = daysPerYear(months);
  const days = Math.floor(total / MINUTES_PER_DAY);
  const minuteOfDay = total - days * MINUTES_PER_DAY;
  const year = Math.floor(days / perYear);
  let dayOfYear = days - year * perYear;
  let month = 0;
  while (dayOfYear >= months[month]!.days) {
    dayOfYear -= months[month]!.days;
    month += 1;
  }
  return { year, month: month + 1, day: dayOfYear + 1, hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 };
}

export type AdvanceStep = 'tenMinutes' | 'hour' | 'shortRest' | 'longRest' | 'day';

/** 5e rests: a short rest takes at least 1 hour, a long rest at least 8 hours. */
export const ADVANCE_STEPS: Record<AdvanceStep, { label: string; minutes: number }> = {
  tenMinutes: { label: '+10 min', minutes: 10 },
  hour: { label: '+1 h', minutes: 60 },
  shortRest: { label: 'Short rest', minutes: 60 },
  longRest: { label: 'Long rest', minutes: 8 * 60 },
  day: { label: '+1 day', minutes: MINUTES_PER_DAY },
};

/** Moves the current time by `minutes` (negative goes back). */
export function advanceCalendar(calendar: Calendar, minutes: number): Calendar {
  return { ...calendar, now: fromMinutes(calendar.months, toMinutes(calendar.months, calendar.now) + minutes) };
}

/** Minutes since midnight (0..1439); the Scene's time of day follows it. */
export function minuteOfDay(calendar: Calendar): number {
  return calendar.now.hour * 60 + calendar.now.minute;
}

/** Same in-game day, another time. */
export function withTimeOfDay(calendar: Calendar, minute: number): Calendar {
  const clamped = Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(minute)));
  return { ...calendar, now: { ...calendar.now, hour: Math.floor(clamped / 60), minute: clamped % 60 } };
}

export function formatCalendarDate(calendar: Calendar, date: CalendarDate): string {
  const month = calendar.months[date.month - 1]!;
  const year = calendar.yearLabel === '' ? `${date.year}` : `${date.year} ${calendar.yearLabel}`;
  const time = `${String(date.hour).padStart(2, '0')}:${String(date.minute).padStart(2, '0')}`;
  const dayPart = month.days === 1 ? month.name : `${date.day} ${month.name}`;
  return `${dayPart} ${year}, ${time}`;
}

/** Events in time order. */
export function sortedEvents(calendar: Calendar): CalendarEvent[] {
  const at = (e: CalendarEvent) => toMinutes(calendar.months, e.at);
  return [...calendar.events].sort((a, b) => at(a) - at(b));
}

/** One month per line, `Name: days`; what the month editor shows. */
export function formatMonthLines(months: CalendarMonth[]): string {
  return months.map((m) => `${m.name}: ${m.days}`).join('\n');
}

export function parseMonthLines(text: string): CalendarMonth[] {
  const months = text.split('\n').flatMap((raw, i) => {
    const line = raw.trim();
    const match = /^(.+?)\s*:\s*(\d+)$/.exec(line);
    const days = Number(match?.[2]);
    if (line !== '' && (!match || days < 1 || days > MAX_MONTH_DAYS)) {
      throw new Error(`Line ${i + 1}: expected "Month name: days" with 1-${MAX_MONTH_DAYS} days, e.g. "Hammer: 30"`);
    }
    return match ? [{ name: match[1]!, days }] : [];
  });
  if (months.length === 0) {
    throw new Error('A calendar needs at least one month');
  }
  return months;
}

/** New months: dates past a shorter or removed month move to its last day or the last month. */
export function withMonths(calendar: Calendar, months: CalendarMonth[]): Calendar {
  const clamp = (date: CalendarDate): CalendarDate => {
    const month = Math.min(date.month, months.length);
    return { ...date, month, day: Math.min(date.day, months[month - 1]!.days) };
  };
  return {
    ...calendar,
    months,
    now: clamp(calendar.now),
    events: calendar.events.map((e) => ({ ...e, at: clamp(e.at) })),
  };
}
