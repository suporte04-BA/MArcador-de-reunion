/**
 * Helpers compartilhados dos specs E2E da Agenda BA.
 *
 * Convenções:
 * - Horários/datas sempre no fuso do produto (America/Manaus), nunca no fuso
 *   da máquina;
 * - Slots futuros livres são escolhidos via API `/meetings/availability`
 *   (zero dependência de horários "óbvios" que possam estar ocupados);
 * - E-mails são consultados no Mailpit (`/api/v1/messages`) e filtrados por
 *   assunto + destinatário + instante do teste (os runs anteriores deixam
 *   mensagens na caixa).
 */
import { expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE, MAILPIT_API, loadAccounts } from './auth-state';

export { loadAccounts };

const MESES = [
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

/* ------------------------------ datas ------------------------------ */

/** Chave de data (aaaa-mm-dd) de `days` dias a partir de agora, em Manaus. */
export function manausDayPlus(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus' }).format(d);
}

/** Data de hoje no fuso do produto. */
export function manausToday(): string {
  return manausDayPlus(0);
}

/** Data formatada dd/MM/aaaa (datas são sempre absolutas na UI). */
export function brDate(dateKey: string): string {
  return `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}/${dateKey.slice(0, 4)}`;
}

/** Rótulo do botão de dia no mini-calendário ("17 de novembro"). */
export function dayButtonLabel(dateKey: string): string {
  return `${Number(dateKey.slice(8, 10))} de ${MESES[Number(dateKey.slice(5, 7)) - 1] ?? ''}`;
}

/* ------------------------------ API ------------------------------ */

/** Abre um contexto de requisição autenticado (cookie de sessão). */
export async function apiLogin(username: string, password: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  const res = await ctx.post('/api/v1/auth/login', { data: { username, password } });
  if (!res.ok()) {
    const text = await res.text();
    await ctx.dispose();
    throw new Error(`Login de teste falhou para ${username}: ${res.status()} ${text}`);
  }
  return ctx;
}

export type Slot = { date: string; start: string; end: string };

/** Procura um horário livre (dia útil comercial, 08:00–17:00) via API. */
export async function pickFreeSlot(
  ctx: APIRequestContext,
  dayOffsets: number[] = [1, 2, 3, 4],
): Promise<Slot> {
  for (const offset of dayOffsets) {
    const date = manausDayPlus(offset);
    for (let hour = 8; hour <= 16; hour += 1) {
      const start = `${String(hour).padStart(2, '0')}:00`;
      const end = `${String(hour + 1).padStart(2, '0')}:00`;
      const res = await ctx.get(`/api/v1/meetings/availability?date=${date}&start=${start}&end=${end}`);
      if (!res.ok()) continue;
      const body = (await res.json()) as { available?: boolean };
      if (body.available) return { date, start, end };
    }
  }
  throw new Error('Nenhum horário livre encontrado na janela de teste.');
}

export async function createMeetingViaApi(
  ctx: APIRequestContext,
  slot: Slot,
  overrides: Partial<{
    title: string;
    responsibleName: string;
    description: string;
    observations: string;
    departmentId: string;
  }> = {},
): Promise<{ id: string; title: string }> {
  const title = overrides.title ?? `Reunião E2E ${Date.now()}`;
  // Setor é obrigatório na criação (V2 §6) — usa o primeiro setor ativo disponível.
  let departmentId: string | undefined = overrides.departmentId;
  if (!departmentId) {
    const depRes = await ctx.get('/api/v1/departments');
    const depBody = (await depRes.json().catch(() => null)) as { items?: Array<{ id: string }> } | null;
    departmentId = depBody?.items?.[0]?.id;
  }
  const res = await ctx.post('/api/v1/meetings', {
    data: {
      title,
      responsibleName: overrides.responsibleName ?? 'E2E Responsável',
      departmentId,
      date: slot.date,
      start: slot.start,
      end: slot.end,
      description: overrides.description ?? 'Descrição gerada pelos testes automatizados E2E.',
      ...(overrides.observations ? { observations: overrides.observations } : {}),
    },
  });
  const body = (await res.json().catch(() => null)) as { meeting?: { id: string } } | null;
  if (res.status() !== 201 || !body?.meeting) {
    throw new Error(`POST /api/v1/meetings → ${res.status()}: ${JSON.stringify(body)}`);
  }
  return { id: body.meeting.id, title };
}

export async function cancelMeetingViaApi(ctx: APIRequestContext, id: string): Promise<void> {
  const res = await ctx.delete(`/api/v1/meetings/${id}`);
  if (!res.ok() && res.status() !== 409) {
    throw new Error(`DELETE /api/v1/meetings/${id} → ${res.status()}: ${await res.text()}`);
  }
}

/** Consulta o endpoint de disponibilidade. */
export async function isSlotFree(ctx: APIRequestContext, slot: Slot): Promise<boolean> {
  const res = await ctx.get(
    `/api/v1/meetings/availability?date=${slot.date}&start=${slot.start}&end=${slot.end}`,
  );
  if (!res.ok()) return false;
  const body = (await res.json()) as { available?: boolean };
  return Boolean(body.available);
}

/* --------------------------- UI: login --------------------------- */

export async function uiLogin(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entre na sua conta' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agenda de Reuniões' })).toBeVisible();
}

/* ----------------------- UI: formulário ----------------------- */

function formDialog(page: Page) {
  return page.getByRole('dialog');
}

/** Abre o drawer "Agendar reunião" a partir do cabeçalho da agenda. */
export async function openMeetingForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Agendar reunião', exact: true }).first().click();
  await expect(formDialog(page).getByRole('heading', { name: 'Agendar reunião' })).toBeVisible();
}

/** Seleciona a data no mini-calendário dentro do formulário. */
export async function selectDateInForm(page: Page, dateKey: string): Promise<void> {
  const dialog = formDialog(page);
  const day = Number(dateKey.slice(8, 10));
  const targetMonth = MESES[Number(dateKey.slice(5, 7)) - 1] ?? '';
  const targetYear = dateKey.slice(0, 4);
  const dayButton = dialog.getByRole('button', { name: `${day} de ${targetMonth}`, exact: true });
  const header = dialog.locator('div.text-sm.capitalize').first();

  for (let i = 0; i < 4; i += 1) {
    if (await dayButton.first().isVisible().catch(() => false)) break;
    const text = ((await header.textContent()) ?? '').trim().toLowerCase();
    const [monthName = '', year = ''] = text.split(/\s+/);
    const monthIndex = MESES.indexOf(monthName);
    if (monthIndex < 0 || !/^\d{4}$/.test(year)) break;
    const current = Number(year) * 12 + monthIndex;
    const target = Number(targetYear) * 12 + MESES.indexOf(targetMonth);
    const delta = target - current;
    if (delta === 0) break;
    await dialog.getByRole('button', { name: delta > 0 ? 'Próximo mês' : 'Mês anterior' }).click();
  }

  await expect(dayButton.first()).toBeVisible();
  await dayButton.first().click();
}

export type MeetingFormInput = {
  title: string;
  responsibleName: string;
  date: string;
  start: string;
  end: string;
  description: string;
  observations?: string;
};

export async function fillMeetingForm(page: Page, input: MeetingFormInput): Promise<void> {
  const dialog = formDialog(page);
  await dialog.getByLabel('Assunto').fill(input.title);
  await dialog.getByLabel('Responsável pela reunião').fill(input.responsibleName);
  await selectDateInForm(page, input.date);
  await dialog.getByLabel('Hora de início').fill(input.start);
  await dialog.getByLabel('Hora de término').fill(input.end);
  await dialog.getByLabel('Descrição').fill(input.description);
  if (input.observations) await dialog.getByLabel('Observações').fill(input.observations);
}

/** Espera o selo de disponibilidade "Livre …" dentro do formulário. */
export async function expectSlotAvailable(page: Page): Promise<void> {
  await expect(
    formDialog(page)
      .locator('[role="status"]')
      .filter({ hasText: 'Livre — este horário está disponível.' }),
  ).toBeVisible({ timeout: 15_000 });
}

export async function submitMeetingForm(page: Page, mode: 'create' | 'edit' = 'create'): Promise<void> {
  const name = mode === 'create' ? 'Agendar reunião' : 'Salvar alterações';
  await formDialog(page).getByRole('button', { name, exact: true }).click();
}

/* ----------------------------- e-mails ----------------------------- */

export type MailpitMessage = {
  ID: string;
  Subject: string;
  Created: string;
  To: Array<{ Address: string; Name?: string }>;
};

export type MailFilter = {
  /** Assunto exato ou regex (ex.: prefixo com título único). */
  subject: string | RegExp;
  /** Destinatário obrigatório (endereço exato). */
  to?: string;
  /** Só mensagens criadas a partir deste instante (com tolerância de 2 s). */
  since?: Date;
};

export async function listMail(): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT_API}/api/v1/messages?limit=500`);
  if (!res.ok) throw new Error(`Mailpit indisponível (HTTP ${res.status}).`);
  const data = (await res.json()) as { messages?: MailpitMessage[] };
  return data.messages ?? [];
}

function matches(m: MailpitMessage, f: MailFilter): boolean {
  const subjectOk = typeof f.subject === 'string' ? m.Subject === f.subject : f.subject.test(m.Subject);
  if (!subjectOk) return false;
  if (f.to) {
    const to = f.to.toLowerCase();
    if (!(m.To ?? []).some((t) => t.Address?.toLowerCase() === to)) return false;
  }
  if (f.since && new Date(m.Created).getTime() < f.since.getTime() - 2_000) return false;
  return true;
}

/** Espera (polling) por uma mensagem no Mailpit. */
export async function waitForMail(f: MailFilter, timeoutMs = 60_000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const all = await listMail();
    const hit = all.find((m) => matches(m, f));
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(
        `E-mail não recebido em ${timeoutMs} ms (filtro: ${JSON.stringify({ ...f, since: f.since?.toISOString() })}; ${all.length} mensagens no Mailpit).`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

export type MailAttachment = { FileName: string; ContentType: string; ContentID?: string };
export type MailBody = { text: string; html: string; inline: MailAttachment[]; attachments: MailAttachment[] };

export async function mailBody(id: string): Promise<MailBody> {
  const res = await fetch(`${MAILPIT_API}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Detalhe do e-mail ${id} → HTTP ${res.status}.`);
  const d = (await res.json()) as {
    Text?: string;
    HTML?: string | string[];
    Inline?: MailAttachment[];
    Attachments?: MailAttachment[];
  };
  const html = Array.isArray(d.HTML) ? d.HTML.join('\n') : (d.HTML ?? '');
  return { text: d.Text ?? '', html, inline: d.Inline ?? [], attachments: d.Attachments ?? [] };
}
