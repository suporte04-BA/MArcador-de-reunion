/**
 * Global-setup dos testes E2E:
 *
 * 1. Aguarda a API ficar saudável (o webServer é iniciado antes deste hook);
 * 2. Remove usuários `e2e%` deixados por execuções anteriores;
 * 3. Cria as contas de teste (usuário A e B) com hash Argon2id real;
 * 4. Autentica via API e grava os `storageState` (admin, a, b) — evita estourar
 *    o rate limit de login (10 tentativas / 15 min por IP+usuário);
 * 5. Grava `e2e/.auth/accounts.json` consumido pelos specs.
 */
import fs from 'node:fs';
import { request } from '@playwright/test';
import {
  ADMIN_CREDENTIALS,
  API_BASE,
  AUTH,
  AUTH_DIR,
  ACCOUNTS_FILE,
  E2E_EMAIL_DOMAIN,
  E2E_USER_PREFIX,
  type E2EAccount,
} from './auth-state';
import { createPool, insertUser, removeE2EUsers } from './db';

async function waitForApi(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string;
  for (;;) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/health`);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() > deadline) {
      throw new Error(`API não respondeu em ${API_BASE}/api/v1/health (${lastError}).`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

export default async function globalSetup(): Promise<void> {
  await waitForApi();
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const pool = createPool();

  try {
    await removeE2EUsers(pool);

    const mkUser = (kind: 'a' | 'b', fullName: string, role: 'ADMIN' | 'USER'): E2EAccount => {
      const username = `${E2E_USER_PREFIX}_${kind}_${suffix}`;
      return {
        id: '',
        username,
        fullName,
        email: `${username}@${E2E_EMAIL_DOMAIN}`,
        password: `SenhaE2e!${suffix}`,
        role,
      };
    };

    const userA = mkUser('a', 'E2E Usuário A', 'USER');
    const userB = mkUser('b', 'E2E Usuário B', 'USER');
    userA.id = await insertUser(pool, { envKey: 'A', ...userA });
    userB.id = await insertUser(pool, { envKey: 'B', ...userB });

    const admin: E2EAccount = {
      id: '',
      username: ADMIN_CREDENTIALS.username,
      fullName: 'Administrador E2E',
      email: '',
      password: ADMIN_CREDENTIALS.password,
      role: 'ADMIN',
    };

    const loginAndSave = async (account: E2EAccount, storagePath: string): Promise<void> => {
      const ctx = await request.newContext({ baseURL: API_BASE });
      try {
        const res = await ctx.post('/api/v1/auth/login', {
          data: { username: account.username, password: account.password },
        });
        if (!res.ok()) {
          throw new Error(`Login E2E falhou para ${account.username}: ${res.status()} ${await res.text()}`);
        }
        if (!account.id || !account.email) {
          const me = await ctx.get('/api/v1/auth/me');
          const body = (await me.json()) as { user: E2EAccount };
          account.id = body.user.id;
          account.email = body.user.email;
          account.fullName = body.user.fullName;
        }
        await ctx.storageState({ path: storagePath });
      } finally {
        await ctx.dispose();
      }
    };

    await loginAndSave(admin, AUTH.admin);
    await loginAndSave(userA, AUTH.a);
    await loginAndSave(userB, AUTH.b);

    const accounts = { suffix, admin, a: userA, b: userB };
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
  } finally {
    await pool.end();
  }
}
