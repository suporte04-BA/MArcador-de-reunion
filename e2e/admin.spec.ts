/**
 * E2E — aba Usuários (ADMIN): permissões, cadastro ativo, e-mail de teste
 * individual e senha temporária com troca forçada.
 */
import { expect, test, type Page } from '@playwright/test';
import { AUTH } from './auth-state';
import { listMail, loadAccounts, mailBody, waitForMail } from './helpers';

test.use({ storageState: AUTH.admin });

const uniq = (prefix: string): string =>
  `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const uniqUser = (prefix: string): string => uniq(prefix).replace(/\s+/g, '');

async function openUsersTab(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Usuários' }).click();
  await expect(page.getByRole('heading', { name: 'Usuários' })).toBeVisible();
  await expect(page.locator('table')).toBeVisible();
}

test.describe('usuário comum', () => {
  test.use({ storageState: AUTH.b });

  test('não vê a aba Usuários e a API responde 403', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(nav.getByRole('button')).toHaveCount(1);
    await expect(nav.getByRole('button', { name: 'Reuniões' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Usuários' })).toHaveCount(0);

    const res = await page.request.get('/api/v1/admin/users');
    expect(res.status()).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/administrador/i);
  });
});

test('cadastro de usuário: conta ativa com senha inicial', async ({ page }) => {
  test.setTimeout(180_000);
  const username = uniqUser('e2e_cadastro');
  const email = `${username}@teste.baeletrica.com.br`;
  const password = `TempE2e!${Date.now().toString(36)}`;

  await openUsersTab(page);

  await page.getByRole('button', { name: /Cadastrar usuário/ }).first().click();
  const form = page.getByRole('dialog').filter({ hasText: 'Nome completo' });
  await expect(form).toBeVisible();
  await form.getByLabel('Nome completo').fill('E2E Cadastro Teste');
  await form.getByLabel('Nome de usuário').fill(username);
  await form.getByLabel('E-mail *').fill(email);
  await form.getByLabel('Setor *').selectOption({ index: 1 });
  await form.getByLabel('Senha inicial *').fill(password);
  await form.getByLabel('Confirmar senha *').fill(password);
  await form.getByRole('button', { name: 'Cadastrar', exact: true }).click();

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Usuário cadastrado e ativo' })).toBeVisible({
    timeout: 10_000,
  });

  const table = page.locator('table');
  await expect(table).toContainText(username);
});

test('e-mail de teste é enviado somente para o usuário selecionado', async ({ page }) => {
  test.setTimeout(180_000);
  const accounts = loadAccounts();
  const target = accounts.b;
  const since = new Date();

  await openUsersTab(page);
  await page.getByPlaceholder('Pesquisar por nome, usuário ou e-mail…').fill(target.username);
  const row = page.locator('table tbody tr').filter({ hasText: target.username });
  await expect(row).toHaveCount(1);

  await row.getByRole('button', { name: 'E-mail de teste' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Enviar e-mail de teste' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`somente para ${target.email}`);
  await dialog.getByRole('button', { name: 'Enviar teste' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'enfileirado' })).toBeVisible();

  const mail = await waitForMail({ subject: 'Teste de e-mail — Agenda BA', to: target.email, since }, 150_000);
  const all = await listMail();
  const testsSince = all.filter(
    (m) => m.Subject === 'Teste de e-mail — Agenda BA' && new Date(m.Created).getTime() >= since.getTime() - 2_000,
  );
  expect(testsSince.length).toBeGreaterThan(0);
  for (const m of testsSince) {
    expect((m.To ?? []).map((t) => t.Address)).toEqual([target.email]);
  }

  const body = await mailBody(mail.ID);
  expect(body.text).toContain(target.fullName);
  expect(body.html).toContain('cid:logo');
});

