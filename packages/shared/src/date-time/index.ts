/**
 * Utilitários de data/hora com suporte a fuso horário IANA.
 * Padrão do produto: America/Manaus (UTC-4, sem horário de verão).
 */

export const DEFAULT_TIMEZONE = 'America/Manaus';

export type DateParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: number; // 0=domingo
};

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Retorna as partes de uma data convertidas para o fuso informado. */
export function zonedParts(date: Date, timeZone: string = DEFAULT_TIMEZONE): DateParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  const wd = parts.find((x) => x.type === 'weekday')?.value ?? 'Sun';
  // Intl pode retornar "24" para meia-noite em alguns ambientes
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
    weekday: WEEKDAY_INDEX[wd] ?? 0,
  };
}

/** Offset (ms) do fuso em um instante específico. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // remove os milissegundos para evitar ruído
  const base = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - base;
}

/**
 * Converte data (aaaa-mm-dd) + hora (HH:MM[:SS]) "de parede" no fuso
 * informado para o instante UTC correspondente.
 */
export function zonedTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm, ss] = timeStr.split(':').map(Number);
  if (!y || !m || !d) throw new Error(`Data inválida: ${dateStr}`);
  const naiveUtc = Date.UTC(y, m - 1, d, hh ?? 0, mm ?? 0, ss ?? 0);
  let ts = naiveUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = timeZoneOffsetMs(new Date(ts), timeZone);
    const next = naiveUtc - offset;
    if (next === ts) break;
    ts = next;
  }
  return new Date(ts);
}

/** Converte um instante UTC para a "data de parede" no fuso informado. */
export function utcToZonedDateStr(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

/** Converte um instante UTC para a "hora de parede" no fuso informado. */
export function utcToZonedTimeStr(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.hour, 2)}:${pad(p.minute, 2)}`;
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0');
}

/** Chave canônica de dia (aaaa-mm-dd) no fuso da aplicação. */
export function dayKey(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return utcToZonedDateStr(date, timeZone);
}

/** Início do dia (00:00) no fuso informado, como instante UTC. */
export function startOfDayUtc(date: Date, timeZone: string = DEFAULT_TIMEZONE): Date {
  return zonedTimeToUtc(utcToZonedDateStr(date, timeZone), '00:00', timeZone);
}

/** Fim exclusivo do dia (24:00) no fuso informado. */
export function endOfDayUtc(date: Date, timeZone: string = DEFAULT_TIMEZONE): Date {
  const d = startOfDayUtc(date, timeZone);
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}

/** Soma dias a uma data de parede (aaaa-mm-dd) e devolve nova data de parede. */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const p = dateStr.split('-').map(Number);
  const y = p[0] ?? 0;
  const m = p[1] ?? 1;
  const d = p[2] ?? 1;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1, 2)}-${pad(dt.getUTCDate(), 2)}`;
}

/** Primeiro dia do mês de uma data de parede. */
export function startOfMonthDateStr(dateStr: string): string {
  const p = dateStr.split('-');
  return `${p[0] ?? ''}-${p[1] ?? '01'}-01`;
}

/** Último dia (inclusive) do mês de uma data de parede. */
export function endOfMonthDateStr(dateStr: string): string {
  const p = dateStr.split('-').map(Number);
  const y = p[0] ?? 0;
  const m = p[1] ?? 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(last, 2)}`;
}

/** Quantidade de dias de um mês. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Nome do mês em pt-BR (0-11). */
const MONTHS_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const MONTHS_PT_SHORT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

const WEEKDAYS_PT = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

const WEEKDAYS_PT_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function monthNamePtBRLong(monthIndex: number): string {
  return MONTHS_PT[monthIndex] ?? '';
}

export function monthNamePtBRShort(monthIndex: number): string {
  return MONTHS_PT_SHORT[monthIndex] ?? '';
}

export function weekdayPtBRLong(weekdayIndex: number): string {
  return WEEKDAYS_PT[weekdayIndex] ?? '';
}

export function weekdayPtBRShort(weekdayIndex: number): string {
  return WEEKDAYS_PT_SHORT[weekdayIndex] ?? '';
}

/** Formata "aaaa-mm-dd" como dd/mm/aaaa. */
export function formatDateBR(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/** Formata "aaaa-mm-dd" como "terça-feira, 17/11/2026". */
export function formatFullDateBR(dateStr: string): string {
  const p = dateStr.split('-').map(Number);
  const y = p[0] ?? 0;
  const m = p[1] ?? 1;
  const d = p[2] ?? 1;
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${weekdayPtBRLong(weekday)}, ${pad(d, 2)}/${pad(m, 2)}/${y}`;
}

/** Formata "HH:MM" como "HH:MM". */
export function formatTimeBR(timeStr: string): string {
  return timeStr.slice(0, 5);
}

/** Formata dois instantes como "dd/mm/aaaa HH:MM – HH:MM". */
export function formatRangeBR(
  startsAt: Date | string,
  endsAt: Date | string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const s = typeof startsAt === 'string' ? new Date(startsAt) : startsAt;
  const e = typeof endsAt === 'string' ? new Date(endsAt) : endsAt;
  return `${formatDateBR(utcToZonedDateStr(s, timeZone))} ${utcToZonedTimeStr(s, timeZone)} – ${utcToZonedTimeStr(e, timeZone)}`;
}

/** Texto de duração legível ("1h30", "45min", "2h"). */
export function durationText(minutes: number): string {
  if (minutes <= 0) return '0min';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h}h${String(m).padStart(2, '0')}`;
  if (h) return `${h}h`;
  return `${m}min`;
}

/** Duração em minutos entre dois instantes. */
export function minutesBetween(start: Date | string, end: Date | string): number {
  const s = typeof start === 'string' ? new Date(start) : start;
  const e = typeof end === 'string' ? new Date(end) : end;
  return Math.round((e.getTime() - s.getTime()) / 60000);
}

/** Normaliza um username: trim (preserva maiúsculas/minúsculas e espaços internos). */
export function normalizeUsername(value: string): string {
  return value.trim();
}

/** Normaliza e-mail: minúsculas e sem espaços. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Verifica sobreposição de intervalos [inicio, fim).
 * Conflito quando novoInicio < existenteFim AND novoFim > existenteInicio.
 * Intervalos adjacentes (novoFim === existenteInicio) NÃO conflitam.
 */
export function intervalsOverlap(
  newStart: number,
  newEnd: number,
  existingStart: number,
  existingEnd: number,
): boolean {
  return newStart < existingEnd && newEnd > existingStart;
}

/** Converte `avatar_path` (nome de arquivo ou URL absoluta) em URL utilizável. */
export function avatarUrlOf(avatarPath: string | null | undefined): string | null {
  if (!avatarPath) return null;
  if (/^https?:\/\//i.test(avatarPath)) return avatarPath;
  return `/uploads/avatars/${avatarPath}`;
}
