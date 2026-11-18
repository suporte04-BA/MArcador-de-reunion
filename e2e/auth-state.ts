/**
 * Estado compartilhado entre playwright.config.ts, o global-setup e os specs.
 *
 * - Carrega o `.env` real (não versionado) para as variáveis de teste;
 * - Define os caminhos dos `storageState` salvos pelo global-setup;
 * - Guarda as credenciais do administrador real (definidas em `.env`).
 *
 * Este arquivo é importado pelo `playwright.config.ts`, portanto não pode usar
 * `import.meta` (a configuração é transpilada para CommonJS).
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export const REPO_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

/** Prefixo exclusivo dos usuários criados pelos testes (limpeza por LIKE). */
export const E2E_USER_PREFIX = 'e2e';
/** Domínio dos e-mails de teste (caixa local no Mailpit). */
export const E2E_EMAIL_DOMAIN = 'teste.baeletrica.com.br';

export const API_BASE = 'http://127.0.0.1:4175';
export const WEB_BASE = 'http://127.0.0.1:5173';
export const MAILPIT_API = 'http://127.0.0.1:8025';

export const AUTH_DIR = path.join(REPO_ROOT, 'e2e', '.auth');
export const AUTH = {
  admin: path.join(AUTH_DIR, 'admin.json'),
  a: path.join(AUTH_DIR, 'a.json'),
  b: path.join(AUTH_DIR, 'b.json'),
} as const;
export const ACCOUNTS_FILE = path.join(AUTH_DIR, 'accounts.json');

export type E2EAccount = {
  id: string;
  username: string;
  fullName: string;
  email: string;
  password: string;
  role: 'ADMIN' | 'USER';
};

export type E2EAccounts = {
  suffix: string;
  admin: E2EAccount;
  a: E2EAccount;
  b: E2EAccount;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável ${name} ausente no .env — necessária para os testes E2E.`);
  }
  return value;
}

/** Administrador real usado como terceiro usuário nas notificações. */
export const ADMIN_CREDENTIALS = {
  username: requireEnv('E2E_ADMIN_USER'),
  password: requireEnv('E2E_ADMIN_PASSWORD'),
};

/** Contas gravadas pelo global-setup (JSON é lido pelos specs). */
export function loadAccounts(): E2EAccounts {
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    throw new Error('accounts.json não encontrado — rode `npm run test:e2e` (o global-setup cria as contas).');
  }
  return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')) as E2EAccounts;
}
