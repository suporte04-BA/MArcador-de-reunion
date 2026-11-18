/**
 * E2E — autenticação e shell da aplicação.
 * Roda nos dois projetos (desktop e mobile).
 */
import { expect, test } from '@playwright/test';
import { ADMIN_CREDENTIALS } from './auth-state';
import { openMeetingForm, uiLogin } from './helpers';

test('login inválido exibe alerta e não autentica', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entre na sua conta' })).toBeVisible();

  await page.getByLabel('Usuário').fill(`nao_existe_${Date.now().toString(36)}`);
  await page.getByLabel('Senha', { exact: true }).fill('senha-errada-123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Usuário ou senha inválidos.');
  // Continua na tela de login — nenhuma aba é renderizada.
  await expect(page.getByRole('heading', { name: 'Agenda de Reuniões' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toHaveCount(0);
});

test('login válido abre exatamente duas abas, com logo e rodapé de fuso', async ({ page }) => {
  await uiLogin(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);

  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  await expect(nav.getByRole('button', { name: 'Reuniões' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Usuários' })).toBeVisible();
  await expect(nav.getByRole('button')).toHaveCount(2);

  // Logo oficial do Help Desk / BA Elétrica.
  await expect(page.getByRole('img', { name: 'BA Elétrica' })).toBeVisible();

  // Rodapé com fuso horário absoluto do produto.
  await expect(page.getByText('Fuso horário America/Manaus')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agenda de Reuniões' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Agendar reunião/ }).first()).toBeVisible();
});

test('teclado: Enter envia o login e Escape fecha o drawer', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Usuário').fill(ADMIN_CREDENTIALS.username);
  await page.getByLabel('Senha', { exact: true }).fill(ADMIN_CREDENTIALS.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Agenda de Reuniões' })).toBeVisible();

  await openMeetingForm(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});
