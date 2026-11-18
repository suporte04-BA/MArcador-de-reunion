import { describe, expect, it } from 'vitest';
import {
  renderInviteEmail,
  renderMeetingEmail,
  renderPasswordResetEmail,
  renderTestEmail,
  type MeetingMailData,
} from './templates';

const BASE = 'http://192.168.0.102:4175';

// 18/11/2026 (quarta-feira) 09:00–10:30 em America/Manaus = 13:00–14:30 UTC
const meeting: MeetingMailData = {
  id: 'abc-123',
  title: 'Reunião de alinhamento <script>',
  responsibleName: 'João da Silva',
  startsAt: new Date('2026-11-18T13:00:00.000Z'),
  endsAt: new Date('2026-11-18T14:30:00.000Z'),
  description: 'Pauta: revisar indicadores do período.',
  observations: 'Sala de reunião 2.',
  createdByName: 'Maria & Pedro',
  createdAt: new Date('2026-11-17T12:00:00.000Z'),
};

const recipient = { fullName: 'Ana Cristina' };

describe('templates de e-mail de reunião', () => {
  it('criação: assunto, link de deep link e escape de HTML', () => {
    const r = renderMeetingEmail('created', meeting, recipient, BASE, true);

    expect(r.subject).toBe('Nova reunião agendada: Reunião de alinhamento <script>');
    expect(r.html).toContain('Nova reunião agendada');
    expect(r.html).toContain(`${BASE}/?reuniao=abc-123`);
    // Escape correto de caracteres perigosos no HTML
    expect(r.html).toContain('Reunião de alinhamento &lt;script&gt;');
    expect(r.html).not.toContain('<script>');
  });

  it('criação: data/hora em pt-BR e no fuso America/Manaus', () => {
    const r = renderMeetingEmail('created', meeting, recipient, BASE, true);
    // Texto puro: data completa + horário local (UTC-4)
    expect(r.text).toContain('quarta-feira, 18/11/2026');
    expect(r.text).toMatch(/Início:\s+09:00/);
    expect(r.text).toMatch(/Término:\s+10:30/);
    expect(r.text).toMatch(/Duração:\s+1h30/);
    // HTML: fuso declarado
    expect(r.html).toContain('America/Manaus');
    expect(r.html).toContain('09:00');
    expect(r.html).toContain('10:30');
  });

  it('criação: HTML e alternativa texto presentes, logo via CID', () => {
    const r = renderMeetingEmail('created', meeting, recipient, BASE, true);
    expect(r.html).toContain('<html');
    expect(r.html).toContain('cid:logo');
    expect(r.text.length).toBeGreaterThan(100);
    expect(r.text).not.toContain('<table'); // texto não é HTML
    expect(r.text).toContain('Olá, Ana Cristina');
  });

  it('sem logo oficial, usa bloco de texto no lugar da imagem', () => {
    const r = renderMeetingEmail('created', meeting, recipient, BASE, false);
    expect(r.html).not.toContain('cid:logo');
    expect(r.html).toContain('BA Elétrica');
  });

  it('alteração: assunto e campos alterados', () => {
    const r = renderMeetingEmail(
      'updated',
      { ...meeting, changedFields: ['Horário', 'Descrição'] },
      recipient,
      BASE,
      true,
    );
    expect(r.subject).toBe('Reunião alterada: Reunião de alinhamento <script>');
    expect(r.html).toContain('Campos alterados');
    expect(r.html).toContain('Horário, Descrição');
    expect(r.text).toContain('Campos alterados: Horário, Descrição.');
  });

  it('cancelamento: assunto e aviso de liberação de horário', () => {
    const r = renderMeetingEmail('cancelled', meeting, recipient, BASE, true);
    expect(r.subject).toBe('Reunião cancelada: Reunião de alinhamento <script>');
    expect(r.html).toContain('Reunião cancelada');
    expect(r.text).toContain('voltou a ficar disponível');
  });

  it('observações e descrição aparecem nos dois formatos', () => {
    const r = renderMeetingEmail('created', meeting, recipient, BASE, true);
    expect(r.html).toContain('Sala de reunião 2.');
    expect(r.text).toContain('Sala de reunião 2.');
    expect(r.text).toContain('Pauta: revisar indicadores do período.');
  });
});

describe('convite e redefinição — nunca enviam senha', () => {
  const inviteUser = { fullName: 'João Silva', username: 'joao.silva', email: 'joao@baeletrica.com.br' };

  it('convite: link de uso único com expiração de 72h', () => {
    const r = renderInviteEmail(inviteUser, 'TOKEN_CONVITE_123', BASE, true);
    expect(r.subject).toBe('Ative seu acesso — Agenda BA');
    expect(r.html).toContain(`${BASE}/?convite=TOKEN_CONVITE_123`);
    expect(r.text).toContain(`${BASE}/?convite=TOKEN_CONVITE_123`);
    expect(r.html).toContain('72 horas');
    expect(r.text).toContain('Nenhuma senha é enviada por e-mail');
    // Nenhuma senha — nem o token em texto fora do link esperado
    expect(r.text).not.toMatch(/senha:\s*\S+/i);
    expect(r.html).toContain('cid:logo');
  });

  it('redefinição: link de uso único com expiração de 60 minutos', () => {
    const r = renderPasswordResetEmail(
      { fullName: 'João Silva', username: 'joao.silva' },
      'TOKEN_RESET_456',
      BASE,
      true,
    );
    expect(r.html).toContain(`${BASE}/?redefinir=TOKEN_RESET_456`);
    expect(r.text).toContain(`${BASE}/?redefinir=TOKEN_RESET_456`);
    expect(r.html).toContain('60 minutos');
    expect(r.text).not.toMatch(/senha:\s*\S+/i);
  });

  it('e-mail de teste: identifica o remetente do pedido', () => {
    const r = renderTestEmail(
      { fullName: 'João Silva', email: 'joao@baeletrica.com.br' },
      BASE,
      true,
      'Administrador Agenda BA',
    );
    expect(r.subject).toContain('Teste de e-mail');
    expect(r.text).toContain('Solicitado por: Administrador Agenda BA');
    expect(r.text).toContain('Destinatário:   joao@baeletrica.com.br');
    expect(r.html).toContain('cid:logo');
    expect(r.text).not.toMatch(/senha:\s*\S+/i);
  });
});
