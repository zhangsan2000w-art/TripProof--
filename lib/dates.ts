import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import holidays from '@/data/holidays.json';
dayjs.extend(utc); dayjs.extend(timezone); dayjs.extend(customParseFormat);
export const TZ = 'Asia/Shanghai';
export const now = () => new Date().toISOString();
export const today = () => dayjs().tz(TZ).format('YYYY-MM-DD');
export function validDate(date: string) { return dayjs(date, 'YYYY-MM-DD', true).isValid(); }
export const dateForDay = (start: string, day: number) => dayjs.tz(`${start}T12:00:00`, TZ).add(day - 1, 'day').format('YYYY-MM-DD');
export const weekday = (date: string) => dayjs.tz(`${date}T12:00:00`, TZ).day();
export const weekdayLabel = (date: string) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][weekday(date)];
export const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const formatMinutes = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
export const addDays = (date: string, days: number) => dateForDay(date, days + 1);
export const tomorrow = () => addDays(today(), 1);
export const daysUntil = (date: string, base = today()) => Math.round(dayjs.tz(`${date}T12:00:00`, TZ).diff(dayjs.tz(`${base}T12:00:00`, TZ), 'day', true));
export function holidayState(date: string): 'holiday' | 'workday' | 'ordinary' | 'unpublished' {
  const calendar = holidays.years[String(date.slice(0, 4)) as keyof typeof holidays.years];
  if (!calendar) return 'unpublished';
  if ((calendar.holidays as string[]).includes(date)) return 'holiday';
  if ((calendar.workdays as string[]).includes(date)) return 'workday';
  return 'ordinary';
}
export function inSeason(date: string, from: string, to: string) {
  const md = date.slice(5);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}
export function localTime(value: string | null | undefined, short = false) {
  if (!value) return '未注明';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.tz(TZ).format(short ? 'MM-DD HH:mm' : 'YYYY-MM-DD HH:mm') : '未注明';
}
