/**
 * E2E — aba Reuniões: criação, disponibilidade, conflito, permissões,
 * painel de KPIs, mini-calendário e notificações por e-mail.
 *
 * A sessão vem do storageState do usuário A (global-setup); os contextos de
 * API (A, B e admin) são criados por teste e encerrados em seguida.
 */
import { expect, test } from '@playwright/test';
import { AUTH, ADMIN_CREDENTIALS } from './auth-state';
import {
  apiLogin,
  brDate,
  cancelMeetingViaApi,
  createMeetingViaApi,
  dayButtonLabel,
  expectSlotAvailable,
  fillMeetingForm,
  isSlotFree,
  loadAccounts,
  mailBody,
  manausDayPlus,
  manausToday,
  openMeetingForm,
  pickFreeSlot,
  submitMeetingForm,
  waitForMail,
  type Slot,
} from './helpers';

test.use({ storageState: AUTH.a });

const uniq = (prefix: string): string =>
  `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

test('criação com selo Livre, autoria visível e e-mail para todos os ativos', async ({ page }) => {
  test.setTimeout(240_000);
  const accounts = loadAccounts();
  const api = await apiLogin(accounts.a.username, accounts.a.password);
  try {
    const slot = await pickFreeSlot(api);
    const title = uniq('Reunião E2E criação');
    const since = new Date();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Agenda de Reuniões' })).toBeVisible();

    await openMeetingForm(page);
    await fillMeetingForm(page, {
      title,
      responsibleName: 'E2E Condução',
      date: slot.date,
      start: slot.start,
      end: slot.end,
      description: 'Pauta gerada pelo teste automatizado E2E de criação.',
      observations: 'Sala de reunião 2 — teste E2E.',
    });

    // Selo de disponibilidade em tempo real (endpoint /availability).
    await expectSlotAvailable(page);

    // "Responsável" é texto livre e não confere permissão de edição.
    await expect(
      page.getByRole('dialog').getByText('Campo de texto — não confira permissões de edição.'),
    ).toBeVisible();

    await submitMeetingForm(page, 'create');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Reunião agendada.' })).toBeVisible();

    // A reunião aparece na lista filtrada por assunto.
    const filters = page.getByRole('region', { name: 'Filtros da lista' });
    await filters.getByPlaceholder('Assunto, responsável ou agendador…').fill(title);
    const list = page.getByRole('region', { name: 'Lista de reuniões' });
    await expect(list).toContainText(title);
    await expect(list).toContainText('Agendada');

    // Todos os usuários ativos recebem o aviso (A, B e o administrador).
    const subject = `Nova reunião agendada: ${title}`;
    for (const account of [accounts.a, accounts.b, accounts.admin]) {
      const mail = await waitForMail({ subject, to: account.email, since });
      const body = await mailBody(mail.ID);
      expect(body.html).toContain('cid:logo');
      expect(body.html).toContain('/?reuniao=');
      expect(body.text).toContain(title);
      expect(body.text).toContain('E2E Condução');
      const all = [...body.attachments, ...body.inline];
      expect(all.some((a) => a.ContentID === 'logo' || a.FileName === 'logo-ba.png')).toBe(true);
      // Anexo .ics removido por decisão: a mensagem não carrega calendário.
      expect(all.some((a) => a.FileName.endsWith('.ics'))).toBe(false);
      // Nenhuma credencial viaja por e-mail.
      expect(body.text).not.toMatch(/senha\s*:\s*\S+/i);
      if (process.env.APP_BASE_URL) expect(body.text).toContain(process.env.APP_BASE_URL);
    }

    // Detalhe: data absoluta, autoria com avatar/iniciais.
    await list.getByRole('button').filter({ hasText: title }).first().click();
    const detail = page.getByRole('dialog').filter({ hasText: 'Data completa' });
    await expect(detail).toContainText(title);
    await expect(detail).toContainText(brDate(slot.date));
    await expect(detail).toContainText(`Agendado por @${accounts.a.username}`);
    await expect(detail).toContainText(accounts.a.fullName);
    await expect(detail.locator(`span[title="${accounts.a.fullName}"]`)).toBeVisible();
    await expect(detail).toContainText('Você pode editar');
  } finally {
    await api.dispose();
  }
});

test('KPI abre painel lateral com detalhes e a ação limpar filtro', async ({ page }) => {
  test.setTimeout(180_000);
  const accounts = loadAccounts();
  const api = await apiLogin(accounts.a.username, accounts.a.password);
  let meetingId = '';
  try {
    const slot = await pickFreeSlot(api);
    const title = uniq('Reunião E2E kpi');
    ({ id: meetingId } = await createMeetingViaApi(api, slot, { title }));

    await page.goto('/');
    await page.getByRole('button', { name: /Próximas reuniões/ }).click();

    const panel = page.getByRole('dialog').filter({ hasText: 'Reuniões agendadas a partir de agora' });
    await expect(panel).toBeVisible();
    const row = panel.getByRole('button').filter({ hasText: title });
    await expect(row).toBeVisible();
    // Data absoluta, horário, assunto, responsável e agendador na linha.
    await expect(row).toContainText(brDate(slot.date));
    await expect(row).toContainText(slot.start);
    await expect(row).toContainText(`Responsável: E2E Responsável`);
    await expect(row).toContainText('Agendado por E2E Usuário A');

    // Clique na linha abre o drawer de detalhe.
    await row.first().click();
    const detail = page.getByRole('dialog').filter({ hasText: 'Data completa' });
    await expect(detail).toContainText(title);
    await expect(detail).toContainText(`Agendado por @${accounts.a.username}`);
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();

    // Ação explícita de limpar filtro / voltar à agenda geral.
    await page.getByRole('button', { name: /Próximas reuniões/ }).click();
    await panel.getByRole('button', { name: 'Limpar filtro / agenda geral' }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole('region', { name: 'Filtros da lista' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Filtros da lista' }).getByPlaceholder('Assunto, responsável ou agendador…'),
    ).toHaveValue('');
  } finally {
    if (meetingId) await cancelMeetingViaApi(api, meetingId);
    await api.dispose();
  }
});

test('conflito de horário: 409 na API e aviso amigável na UI', async ({ page }) => {
  test.setTimeout(180_000);
  const accounts = loadAccounts();
  const api = await apiLogin(accounts.a.username, accounts.a.password);
  let meetingId = '';
  try {
    const slot = await pickFreeSlot(api);
    const occupied = uniq('Ocupado E2E');
    ({ id: meetingId } = await createMeetingViaApi(api, slot, { title: occupied }));

    // 1) A API rejeita o segundo agendamento no mesmo intervalo.
    const depRes = await api.get('/api/v1/departments');
    const depBody = (await depRes.json()) as { items: Array<{ id: string }> };
    const departmentId = depBody.items[0].id;
    const res = await api.post('/api/v1/meetings', {
      data: {
        title: uniq('Tentativa E2E'),
        responsibleName: 'E2E Condução',
        departmentId,
        date: slot.date,
        start: slot.start,
        end: slot.end,
        description: 'Tentativa de agendamento em horário já ocupado.',
      },
    });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { error: string; code: string; conflicts?: unknown[] };
    expect(body.code).toBe('SCHEDULE_CONFLICT');
    expect(body.error).toContain('Horário ocupado');
    expect(body.error).toContain(occupied);
    expect(Array.isArray(body.conflicts)).toBe(true);

    // 2) A UI mostra a indisponibilidade e o erro do servidor sem vazar stack.
    await page.goto('/');
    await openMeetingForm(page);
    await fillMeetingForm(page, {
      title: uniq('Tentativa UI E2E'),
      responsibleName: 'E2E Condução',
      date: slot.date,
      start: slot.start,
      end: slot.end,
      description: 'Tentativa de agendamento em horário já ocupado pela UI.',
    });
    await expect(
      page.getByRole('dialog').locator('[role="status"]').filter({ hasText: 'Conflita com reunião existente' }),
    ).toBeVisible({ timeout: 15_000 });

    await submitMeetingForm(page, 'create');
    const alert = page.getByRole('dialog').getByRole('alert');
    await expect(alert).toContainText('Não foi possível salvar');
    await expect(alert).toContainText('Horário ocupado');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  } finally {
    if (meetingId) await cancelMeetingViaApi(api, meetingId);
    await api.dispose();
  }
});

test('horários consecutivos são permitidos e cancelar libera o horário', async () => {
  test.setTimeout(240_000);
  const accounts = loadAccounts();
  const api = await apiLogin(accounts.a.username, accounts.a.password);
  const ids: string[] = [];
  try {
    // Dois intervalos colados em que as DUAS janetas estejam livres.
    let pair: { first: Slot; second: Slot } | null = null;
    for (const offset of [1, 2, 3, 4, 5]) {
      const date = manausDayPlus(offset);
      for (let hour = 8; hour <= 15 && !pair; hour += 1) {
        const start = `${String(hour).padStart(2, '0')}:00`;
        const mid = `${String(hour + 1).padStart(2, '0')}:00`;
        const end = `${String(hour + 2).padStart(2, '0')}:00`;
        const first: Slot = { date, start, end: mid };
        const second: Slot = { date, start: mid, end };
        if ((await isSlotFree(api, first)) && (await isSlotFree(api, second))) pair = { first, second };
      }
      if (pair) break;
    }
    if (!pair) throw new Error('Nenhum par de horários consecutivos livres encontrado.');
    const slot = pair.first;

    // Consecutivos: fim de uma = início da outra (zero sobreposição, mas encostadas ok).
    const first = await createMeetingViaApi(api, slot, { title: uniq('Consecutiva 1 E2E') });
    const next = await createMeetingViaApi(api, pair.second, { title: uniq('Consecutiva 2 E2E') });
    ids.push(first.id, next.id);

    // Cancelar a primeira devolve o horário ao mercado.
    const since = new Date();
    await cancelMeetingViaApi(api, first.id);
    const avail = await api.get(
      `/api/v1/meetings/availability?date=${slot.date}&start=${slot.start}&end=${slot.end}`,
    );
    const availBody = (await avail.json()) as { available: boolean };
    expect(availBody.available).toBe(true);

    // O horário cancelado pode ser reocupado imediatamente.
    const reuse = await createMeetingViaApi(api, slot, { title: uniq('Reocupando E2E') });
    ids.push(reuse.id);

    // E-mail de cancelamento para todos os ativos.
    const mail = await waitForMail({
      subject: `Reunião cancelada: ${first.title}`,
      to: accounts.a.email,
      since,
    });
    const body = await mailBody(mail.ID);
    expect(body.html).toContain('cid:logo');
    expect(body.text).toContain(first.title);
    expect([...body.attachments, ...body.inline].some((a) => a.FileName.endsWith('.ics'))).toBe(false);
  } finally {
    for (const id of ids) await cancelMeetingViaApi(api, id);
    await api.dispose();
  }
});

test('autor edita pela UI, admin edita alheia e usuário comum recebe 403', async ({ page }) => {
  test.setTimeout(180_000);
  const accounts = loadAccounts();
  const apiA = await apiLogin(accounts.a.username, accounts.a.password);
  const apiB = await apiLogin(accounts.b.username, accounts.b.password);
  const apiAdmin = await apiLogin(accounts.admin.username, accounts.admin.password);
  let meetingId = '';
  try {
    const slot = await pickFreeSlot(apiA);
    const original = uniq('Autoria E2E');
    ({ id: meetingId } = await createMeetingViaApi(apiA, slot, { title: original }));

    // Usuário B (não autor, não admin): 403 na edição e no cancelamento — validado na API.
    const patchB = await apiB.patch(`/api/v1/meetings/${meetingId}`, { data: { title: 'Hack B' } });
    expect(patchB.status()).toBe(403);
    expect(((await patchB.json()) as { error: string }).error).toContain('pode alterá-la');
    const deleteB = await apiB.delete(`/api/v1/meetings/${meetingId}`);
    expect(deleteB.status()).toBe(403);

    // Admin consegue alterar reunião criada por outra pessoa.
    const adminEdit = uniq('Editada pelo admin');
    const patchAdmin = await apiAdmin.patch(`/api/v1/meetings/${meetingId}`, { data: { title: adminEdit } });
    expect(patchAdmin.status()).toBe(200);

    // O autor edita pela UI (o admin já renomeou; renomeia de volta para o teste de UI).
    const titleForUi = uniq('Autor edita E2E');
    const restore = await apiA.patch(`/api/v1/meetings/${meetingId}`, { data: { title: titleForUi } });
    expect(restore.status()).toBe(200);

    await page.goto(`/?reuniao=${meetingId}`);
    const detail = page.getByRole('dialog').filter({ hasText: 'Data completa' });
    await expect(detail).toContainText(titleForUi);
    await detail.getByRole('button', { name: 'Editar', exact: true }).click();

    const form = page.getByRole('dialog').filter({ hasText: '1 · Identificação' });
    await expect(form).toBeVisible();
    const newTitle = uniq('Autor UI E2E');
    await form.getByLabel('Assunto').fill(newTitle);
    await form.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Reunião atualizada.' })).toBeVisible();

    const filters = page.getByRole('region', { name: 'Filtros da lista' });
    await filters.getByPlaceholder('Assunto, responsável ou agendador…').fill(newTitle);
    await expect(page.getByRole('region', { name: 'Lista de reuniões' })).toContainText(newTitle);
  } finally {
    if (meetingId) await cancelMeetingViaApi(apiA, meetingId);
    await apiA.dispose();
    await apiB.dispose();
    await apiAdmin.dispose();
  }
});

test.describe('usuário comum (somente leitura)', () => {
  test.use({ storageState: AUTH.b });

  test('não vê botões de gestão em reunião alheia', async ({ page }) => {
    test.setTimeout(120_000);
    const accounts = loadAccounts();
    const apiA = await apiLogin(accounts.a.username, accounts.a.password);
    let meetingId = '';
    try {
      const slot = await pickFreeSlot(apiA);
      const title = uniq('Alheia E2E');
      ({ id: meetingId } = await createMeetingViaApi(apiA, slot, { title }));

      await page.goto(`/?reuniao=${meetingId}`);
      const detail = page.getByRole('dialog').filter({ hasText: 'Somente leitura' });
      await expect(detail).toBeVisible();
      await expect(detail).toContainText(title);
      await expect(detail.getByRole('button', { name: 'Editar', exact: true })).toHaveCount(0);
      await expect(detail.getByRole('button', { name: 'Cancelar reunião', exact: true })).toHaveCount(0);
      await expect(detail).toContainText('um administrador pode alterar ou');
    } finally {
      if (meetingId) await cancelMeetingViaApi(apiA, meetingId);
      await apiA.dispose();
    }
  });
});

test('mini calendário, agenda do dia e datas absolutas', async ({ page }) => {
  test.setTimeout(180_000);
  const accounts = loadAccounts();
  const api = await apiLogin(accounts.a.username, accounts.a.password);
  let meetingId = '';
  try {
    const slot = await pickFreeSlot(api);
    const title = uniq('Calendário E2E');
    ({ id: meetingId } = await createMeetingViaApi(api, slot, { title }));

    await page.goto('/');

    // "Hoje" seleciona o dia corrente (fuso America/Manaus) e o título é absoluto.
    await page.getByRole('button', { name: 'Hoje', exact: true }).click();
    const today = manausToday();
    await expect(page.getByRole('heading', { name: `Agenda do dia ${brDate(today)}` })).toBeVisible();

    // Seleciona o dia da reunião criada no mini-calendário.
    await page.getByRole('button', { name: dayButtonLabel(slot.date), exact: true }).click();
    const dayHeading = page.getByRole('heading', { name: `Agenda do dia ${brDate(slot.date)}` });
    await expect(dayHeading).toBeVisible();

    const agenda = page.getByRole('region', { name: 'Agenda do dia' });
    await expect(agenda).toContainText(title);
    await expect(agenda).toContainText('Responsável: E2E Responsável');
    await expect(agenda).toContainText('Agendado por E2E Usuário A');
    // Contagem do dia no calendário (texto para leitores de tela).
    await expect(
      page.getByRole('button', { name: dayButtonLabel(slot.date), exact: true }).getByText(/reuniões neste dia/),
    ).toBeVisible();

    // Detalhe com datas absolutas (nunca "hoje"/"amanhã").
    await agenda.getByRole('button').filter({ hasText: title }).first().click();
    const detail = page.getByRole('dialog').filter({ hasText: 'Data completa' });
    await expect(detail).toContainText(brDate(slot.date));
    await expect(detail).not.toContainText(/hoje|amanhã/i);

    // "Voltar à agenda geral" limpa a seleção.
    await page.keyboard.press('Escape');
    await agenda.getByRole('button', { name: 'Voltar à agenda geral' }).click();
    await expect(page.getByRole('heading', { name: 'Agenda do dia' })).toBeVisible();
  } finally {
    if (meetingId) await cancelMeetingViaApi(api, meetingId);
    await api.dispose();
  }
});

test('sessão do administrador enxerga as duas abas (controle cruzado)', async () => {
  // Garante que o storageState do admin gerado no setup é válido na API.
  const accounts = loadAccounts();
  expect(accounts.admin.username).toBe(ADMIN_CREDENTIALS.username);
  const api = await apiLogin(accounts.admin.username, accounts.admin.password);
  try {
    const me = await api.get('/api/v1/auth/me');
    expect(me.status()).toBe(200);
    const body = (await me.json()) as { user: { role: string } };
    expect(body.user.role).toBe('ADMIN');
  } finally {
    await api.dispose();
  }
});
