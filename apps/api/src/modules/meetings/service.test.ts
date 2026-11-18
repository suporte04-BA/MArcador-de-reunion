import { describe, expect, it } from 'vitest';
import { conflictMessage, isExclusionViolation } from './service';

describe('isExclusionViolation — detecção de sobreposição no banco', () => {
  it('reconhece a exclusion constraint clássica (23P01)', () => {
    expect(isExclusionViolation({ code: '23P01' })).toBe(true);
  });

  it('reconhece deadlock (40P01) ocorrido DENTRO da checagem da constraint', () => {
    expect(
      isExclusionViolation({
        code: '40P01',
        message: 'deadlock detected',
        where: 'while checking exclusion constraint on tuple (0,59) in relation "meetings"',
        detail: 'Process 9638 waits for ShareLock on transaction 1540; blocked by process 9639.',
      }),
    ).toBe(true);
  });

  it('NÃO trata deadlock alheio à constraint como conflito de agenda', () => {
    expect(
      isExclusionViolation({
        code: '40P01',
        message: 'deadlock detected',
        where: 'while updating relation "notification_outbox"',
      }),
    ).toBe(false);
  });

  it('outros erros continuam sendo erro interno (500)', () => {
    expect(isExclusionViolation({ code: '23505' })).toBe(false); // unique_violation
    expect(isExclusionViolation({ code: '40001' })).toBe(false); // serialization_failure
    expect(isExclusionViolation(new Error('boom'))).toBe(false);
    expect(isExclusionViolation(undefined)).toBe(false);
  });
});

describe('conflictMessage — mensagem amigável em pt-BR', () => {
  const base = {
    id: 'x',
    title: 'Reunião do time',
    starts_at: new Date('2026-11-18T13:00:00.000Z'), // 09:00 em Manaus
    ends_at: new Date('2026-11-18T14:00:00.000Z'),
    responsible_name: 'João da Silva',
  };

  it('sem conflitos identificados, ainda avisa que o intervalo está ocupado', () => {
    expect(conflictMessage([])).toBe('Este intervalo já está ocupado.');
  });

  it('um conflito: cita assunto e horário no fuso de Manaus', () => {
    const msg = conflictMessage([base]);
    expect(msg).toContain('Horário ocupado');
    expect(msg).toContain('Reunião do time');
    expect(msg).toContain('09:00–10:00');
    expect(msg).toContain('Escolha outro horário.');
  });

  it('vários conflitos: conta as reuniões', () => {
    const msg = conflictMessage([base, { ...base, id: 'y', title: 'Segunda' }]);
    expect(msg).toContain('2 reuniões');
    expect(msg).toContain('primeira');
    expect(msg).toContain('Reunião do time');
  });
});
