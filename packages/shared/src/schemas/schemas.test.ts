import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createMeetingSchema,
  emailSchema,
  formatZodIssues,
  loginSchema,
  passwordSchema,
  updateMeetingSchema,
  usernameSchema,
} from './index.js';

function firstIssue(schema: z.ZodType, value: unknown): string | undefined {
  const r = schema.safeParse(value);
  if (r.success) return undefined;
  return r.error.issues[0]?.message;
}

const validMeeting = {
  title: 'Reunião de alinhamento',
  responsibleName: 'João da Silva',
  date: '2026-12-01',
  start: '09:00',
  end: '10:00',
  description: 'Pauta de alinhamento semanal do time.',
  observations: 'Sala 2',
  // Setor da reunião é OBRIGATÓRIO na criação (V2 §6).
  departmentId: '1e2179b4-e545-4b72-9f19-24b019a1709f',
};

describe('createMeetingSchema', () => {
  it('aceita uma reunião válida completa', () => {
    const r = createMeetingSchema.safeParse(validMeeting);
    expect(r.success).toBe(true);
  });

  it('aceita sem observações (campo opcional)', () => {
    const { observations: _o, ...rest } = validMeeting;
    expect(createMeetingSchema.safeParse(rest).success).toBe(true);
    expect(createMeetingSchema.safeParse({ ...rest, observations: '' }).success).toBe(true);
  });

  it('recusa fim menor ou igual ao início', () => {
    expect(firstIssue(createMeetingSchema, { ...validMeeting, end: '09:00' })).toBe(
      'A hora de término deve ser posterior à hora de início.',
    );
    expect(firstIssue(createMeetingSchema, { ...validMeeting, end: '08:00' })).toBe(
      'A hora de término deve ser posterior à hora de início.',
    );
  });

  it('aceita intervalos consecutivos como payload individual', () => {
    // 10:00-11:00 é válido por si só (a proibição é de sobreposição, não de fronteira)
    expect(createMeetingSchema.safeParse({ ...validMeeting, start: '10:00', end: '11:00' }).success).toBe(true);
  });

  it('exige todos os campos obrigatórios com mensagens em pt-BR', () => {
    expect(firstIssue(createMeetingSchema, { ...validMeeting, title: '' })).toBe(
      'Assunto precisa ter ao menos 3 caracteres.',
    );
    expect(firstIssue(createMeetingSchema, { ...validMeeting, responsibleName: '' })).toBe(
      'Responsável é obrigatório.',
    );
    expect(firstIssue(createMeetingSchema, { ...validMeeting, description: 'abc' })).toBe(
      'Descrição precisa ter ao menos 5 caracteres.',
    );
    expect(firstIssue(createMeetingSchema, { ...validMeeting, date: '01/12/2026' })).toBe(
      'Data deve estar no formato aaaa-mm-dd.',
    );
    expect(firstIssue(createMeetingSchema, { ...validMeeting, start: '9h' })).toBe(
      'Hora deve estar no formato HH:MM.',
    );
    expect(firstIssue(createMeetingSchema, { ...validMeeting, date: '2026-02-30' })).toBe(
      'Data inexistente.',
    );
    expect(firstIssue(createMeetingSchema, { ...validMeeting, start: '25:00' })).toBe('Hora inválida.');
  });
});

describe('updateMeetingSchema', () => {
  it('aceita atualização parcial (somente título)', () => {
    expect(updateMeetingSchema.safeParse({ title: 'Novo título' }).success).toBe(true);
  });

  it('valida início/fim quando ambos presentes', () => {
    expect(firstIssue(updateMeetingSchema, { start: '10:00', end: '09:00' })).toBe(
      'A hora de término deve ser posterior à hora de início.',
    );
  });

  it('ignora start sozinho (sem end para comparar)', () => {
    expect(updateMeetingSchema.safeParse({ start: '10:00' }).success).toBe(true);
  });
});

describe('normalização de username/e-mail/senha', () => {
  it('username: mínimo 3, caracteres permitidos', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('maria.souza').success).toBe(true);
    expect(usernameSchema.safeParse('joao@silva').success).toBe(false);
    expect(usernameSchema.safeParse('  admin  ').success).toBe(true); // trim
    expect(usernameSchema.safeParse('a'.repeat(61)).success).toBe(false);
  });

  it('e-mail: formato aceito e limite de tamanho', () => {
    expect(emailSchema.safeParse('joao@baeletrica.com.br').success).toBe(true);
    expect(emailSchema.safeParse('joao@').success).toBe(false);
    expect(emailSchema.safeParse('sem-arroba.com').success).toBe(false);
    expect(emailSchema.safeParse('  Joao@BAEletrica.com.br  ').success).toBe(true);
  });

  it('senha: mínimo de 4 caracteres (Revisão V2 §3.5)', () => {
    expect(passwordSchema.safeParse('abc').success).toBe(false);
    expect(passwordSchema.safeParse('abcd').success).toBe(true);
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(true);
  });

  it('login: exige usuário e senha não vazios', () => {
    expect(loginSchema.safeParse({ username: '', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ username: 'admin', password: 'x' }).success).toBe(true);
  });
});

describe('formatZodIssues', () => {
  it('agrupa mensagens por campo', () => {
    // Payload com valores inválidos (não ausentes) para pegar as mensagens de regra.
    const r = createMeetingSchema.safeParse({
      title: 'ab',
      responsibleName: 'x',
      date: '2026-02-30',
      start: '25:00',
      end: '11:00',
      description: 'abc',
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const mapped = formatZodIssues(r.error);
    expect(mapped.title?.[0]).toBe('Assunto precisa ter ao menos 3 caracteres.');
    expect(mapped.responsibleName?.[0]).toBe('Responsável é obrigatório.');
    expect(mapped.date?.[0]).toBe('Data inexistente.');
    expect(mapped.start?.[0]).toBe('Hora inválida.');
    expect(mapped.description?.[0]).toBe('Descrição precisa ter ao menos 5 caracteres.');

    // Refine de início/fim roda quando a base é válida.
    const r2 = createMeetingSchema.safeParse({ ...validMeeting, start: '10:00', end: '09:00' });
    expect(r2.success).toBe(false);
    if (r2.success) return;
    const mapped2 = formatZodIssues(r2.error);
    expect(mapped2.end?.[0]).toBe('A hora de término deve ser posterior à hora de início.');
  });

  it('usa "_" quando o erro não tem campo', () => {
    const err = new z.ZodError([
      { code: 'custom', message: 'erro geral', path: [] },
    ]);
    expect(formatZodIssues(err)).toEqual({ _: ['erro geral'] });
  });
});
