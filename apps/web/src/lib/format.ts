/**
 * Formatação de data/hora para a interface.
 * Regra do produto: datas exibidas no fuso America/Manaus (configurável na API),
 * com datas completas e absolutas — nunca "hoje"/"amanhã".
 */
import {
  DEFAULT_TIMEZONE,
  weekdayPtBRLong,
  monthNamePtBRLong,
} from '@agenda/shared';

const TIMEZONE = DEFAULT_TIMEZONE;

function parts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const list = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(list.find((p) => p.type === type)?.value ?? '0');
  const wdMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const wd = list.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    weekday: wdMap[wd] ?? 0,
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Data de parede (aaaa-mm-dd) no fuso da aplicação. */
export function dateKeyOf(date: Date): string {
  const p = parts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Hora de parede (HH:MM) no fuso da aplicação. */
export function timeOf(date: Date): string {
  const p = parts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** dd/MM/aaaa a partir de ISO. */
export function formatDay(iso: string | Date): string {
  const p = parts(typeof iso === 'string' ? new Date(iso) : iso);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

/** "terça-feira, 17/11/2026" */
export function formatFullDay(iso: string | Date): string {
  const p = parts(typeof iso === 'string' ? new Date(iso) : iso);
  return `${weekdayPtBRLong(p.weekday)}, ${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

/** "09:00" */
export function formatClock(iso: string | Date): string {
  return timeOf(typeof iso === 'string' ? new Date(iso) : iso);
}

/** "09:00–10:00" */
export function formatClockRange(startIso: string, endIso: string): string {
  return `${formatClock(startIso)}–${formatClock(endIso)}`;
}

/** "dd/MM/aaaa 09:00–10:00" (texto único para linhas de tabela/KPI) */
export function formatWhen(startIso: string, endIso: string): string {
  return `${formatDay(startIso)} ${formatClockRange(startIso, endIso)}`;
}

/** Duração legível: "1h30", "45min". */
export function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const minutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h${pad(m)}`;
  if (h) return `${h}h`;
  return `${m}min`;
}

/** Data/hora absoluta: "17/11/2026 às 09:00" */
export function formatAbsolute(iso: string): string {
  return `${formatDay(iso)} às ${formatClock(iso)}`;
}

/** Nome do mês em pt-BR ("novembro"). */
export function monthName(monthIndex: number): string {
  return monthNamePtBRLong(monthIndex);
}

/** Iniciais do nome ("João da Silva" → "JS"). */
export function initialsOf(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return '?';
  const words = clean.split(' ');
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/** Data de hoje no fuso da aplicação (aaaa-mm-dd). */
export function todayKey(): string {
  return dateKeyOf(new Date());
}

/** Primeiro dia (aaaa-mm-dd) do mês de uma data de parede. */
export function monthStartKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

/** Soma dias a uma data de parede. */
export function addDaysKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** yyyy-MM-dd de um Date local-ish (usa fuso da aplicação). */
export function monthKeyOf(date: Date): string {
  const p = parts(date);
  return `${p.year}-${pad(p.month)}`;
}

/** Data de parede → Date (início do dia no fuso da aplicação) para Date inputs. */
export function dateKeyToDisplay(dateKey: string): string {
  return dateKey;
}
