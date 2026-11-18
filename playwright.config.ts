import { defineConfig, devices } from '@playwright/test';

/**
 * Configuração E2E da Agenda BA.
 *
 * - Dois projetos: desktop 1440×900 e mobile (Pixel 7);
 * - Fuso America/Manaus e locale pt-BR (mesmas regras do produto);
 * - Workers = 1: os testes compartilham o mesmo PostgreSQL/SMTP local;
 * - webServer reusa os servidores de desenvolvimento já em execução
 *   (API :4175 e Vite :5173) e só os inicia se estiverem ausentes.
 */
const API_PORT = 4175;
const WEB_PORT = 5173;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Manaus',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      // Smoke mobile: autenticação e shell (os fluxos completos rodam no desktop).
      testMatch: /auth\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev -w @agenda/api',
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev -w @agenda/web',
      url: `http://127.0.0.1:${WEB_PORT}/`,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
