import { describe, expect, it } from 'vitest';
import {
  addDaysToDateStr,
  dayKey,
  durationText,
  endOfDayUtc,
  endOfMonthDateStr,
  formatDateBR,
  formatFullDateBR,
  formatRangeBR,
  intervalsOverlap,
  minutesBetween,
  monthNamePtBRLong,
  normalizeEmail,
  normalizeUsername,
  startOfDayUtc,
  startOfMonthDateStr,
  utcToZonedDateStr,
  utcToZonedTimeStr,
  weekdayPtBRLong,
  zonedTimeToUtc,
  DEFAULT_TIMEZONE,
} from './index.js';

const TZ = 'America/Manaus'; // UTC-4, sem horário de verão

describe('intervalsOverlap — regra [início, fim)', () => {
  it('detecta sobreposição parcial', () => {
    // novo 09:00-10:00 vs existente 09:30-10:30
    expect(intervalsOverlap(900, 1000, 950, 1050)).toBe(true);
    expect(intervalsOverlap(950, 1050, 900, 1000)).toBe(true);
  });

  it('intervalos adjacentes NÃO conflitam (fim exclusivo)', () => {
    // 09:00-10:00 e 10:00-11:00
    expect(intervalsOverlap(900, 1000, 1000, 1100)).toBe(false);
    expect(intervalsOverlap(1000, 1100, 900, 1000)).toBe(false);
    // 08:00-09:00 e 09:00-10:00
    expect(intervalsOverlap(800, 900, 900, 1000)).toBe(false);
  });

  it('intervalo contido conflita', () => {
    expect(intervalsOverlap(900, 1200, 1000, 1100)).toBe(true);
    expect(intervalsOverlap(1000, 1100, 900, 1200)).toBe(true);
  });

  it('intervalos idênticos conflitam', () => {
    expect(intervalsOverlap(900, 1000, 900, 1000)).toBe(true);
  });

  it('intervalos disjuntos não conflitam', () => {
    expect(intervalsOverlap(900, 1000, 1100, 1200)).toBe(false);
    expect(intervalsOverlap(1100, 1200, 900, 1000)).toBe(false);
  });

  it('contato em um único ponto não conflita (09:00-09:00)', () => {
    expect(intervalsOverlap(900, 900, 900, 1000)).toBe(false);
    expect(intervalsOverlap(900, 1000, 1000, 1000)).toBe(false);
  });
});

describe('America/Manaus — conversões de fuso', () => {
  it('zonedTimeToUtc aplica UTC-4', () => {
    expect(zonedTimeToUtc('2026-01-15', '09:00', TZ).toISOString()).toBe('2026-01-15T13:00:00.000Z');
    expect(zonedTimeToUtc('2026-06-10', '00:30', TZ).toISOString()).toBe('2026-06-10T04:30:00.000Z');
  });

  it('Manaus não tem horário de verão (offset constante)', () => {
    const jan = zonedTimeToUtc('2026-01-10', '12:00', TZ);
    const jul = zonedTimeToUtc('2026-07-10', '12:00', TZ);
    expect(jan.toISOString()).toBe('2026-01-10T16:00:00.000Z');
    expect(jul.toISOString()).toBe('2026-07-10T16:00:00.000Z');
  });

  it('ida e volta preservam data/hora de parede', () => {
    const iso = zonedTimeToUtc('2026-11-17', '14:45', TZ);
    expect(utcToZonedDateStr(iso, TZ)).toBe('2026-11-17');
    expect(utcToZonedTimeStr(iso, TZ)).toBe('14:45');
  });

  it('dia vira na virada da meia-noite local', () => {
    // 00:30 em Manaus = 04:30 UTC do mesmo dia
    const iso = zonedTimeToUtc('2026-11-18', '00:30', TZ);
    expect(iso.toISOString()).toBe('2026-11-18T04:30:00.000Z');
    // 23:30 local ainda é o mesmo dia em UTC-4? 23:30 + 4 = 03:30 do dia seguinte
    const late = zonedTimeToUtc('2026-11-18', '23:30', TZ);
    expect(late.toISOString()).toBe('2026-11-19T03:30:00.000Z');
    expect(utcToZonedDateStr(late, TZ)).toBe('2026-11-18');
  });

  it('início e fim do dia formam exatamente 24 horas', () => {
    const start = startOfDayUtc(new Date('2026-11-17T12:00:00Z'), TZ);
    const end = endOfDayUtc(new Date('2026-11-17T12:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-11-17T04:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('dayKey devolve a data local', () => {
    expect(dayKey(new Date('2026-11-17T02:00:00Z'), TZ)).toBe('2026-11-16'); // 22:00 do dia anterior
    expect(dayKey(new Date('2026-11-17T12:00:00Z'), TZ)).toBe('2026-11-17');
    expect(DEFAULT_TIMEZONE).toBe('America/Manaus');
  });
});

describe('formatação pt-BR', () => {
  it('formatDateBR converte aaaa-mm-dd em dd/mm/aaaa', () => {
    expect(formatDateBR('2026-11-17')).toBe('17/11/2026');
  });

  it('formatFullDateBR inclui o dia da semana em pt-BR', () => {
    expect(formatFullDateBR('2026-11-17')).toBe('terça-feira, 17/11/2026');
    expect(formatFullDateBR('2026-01-01')).toBe('quinta-feira, 01/01/2026');
  });

  it('meses e dias da semana em português', () => {
    expect(monthNamePtBRLong(10)).toBe('novembro');
    expect(monthNamePtBRLong(0)).toBe('janeiro');
    expect(weekdayPtBRLong(0)).toBe('domingo');
    expect(weekdayPtBRLong(6)).toBe('sábado');
    expect(monthNamePtBRLong(12)).toBe('');
  });

  it('formatRangeBR mostra o intervalo no fuso local', () => {
    const s = zonedTimeToUtc('2026-11-18', '09:00', TZ);
    const e = zonedTimeToUtc('2026-11-18', '10:30', TZ);
    expect(formatRangeBR(s, e, TZ)).toBe('18/11/2026 09:00 – 10:30');
  });

  it('durationText e minutesBetween', () => {
    expect(durationText(60)).toBe('1h');
    expect(durationText(90)).toBe('1h30');
    expect(durationText(45)).toBe('45min');
    expect(durationText(0)).toBe('0min');
    expect(
      minutesBetween(zonedTimeToUtc('2026-11-18', '09:00', TZ), zonedTimeToUtc('2026-11-18', '10:30', TZ)),
    ).toBe(90);
  });
});

describe('datas de parede e normalização', () => {
  it('addDaysToDateStr cruza meses e anos', () => {
    expect(addDaysToDateStr('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDaysToDateStr('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateStr('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToDateStr('2026-11-17', -7)).toBe('2026-11-10');
  });

  it('limites de mês (base dos KPIs mensais)', () => {
    expect(startOfMonthDateStr('2026-11-17')).toBe('2026-11-01');
    expect(endOfMonthDateStr('2026-11-17')).toBe('2026-11-30');
    expect(endOfMonthDateStr('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonthDateStr('2024-02-10')).toBe('2024-02-29'); // bissexto
  });

  it('normalizeUsername: trim (preserva case e espaços)', () => {
    expect(normalizeUsername('  Maria Souza ')).toBe('Maria Souza');
    expect(normalizeUsername('JOAO.SILVA')).toBe('JOAO.SILVA');
  });

  it('normalizeEmail: minúsculas e sem espaços', () => {
    expect(normalizeEmail('  Joao@BAEletrica.COM.br ')).toBe('joao@baeletrica.com.br');
  });
});
