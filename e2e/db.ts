/**
 * Acesso ao PostgreSQL para o setup/teardown dos testes E2E.
 *
 * Os usuários de teste são criados diretamente no banco (com hash Argon2id
 * real) e removidos ao final da execução, mantendo o ambiente limpo.
 */
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { hash } from '@node-rs/argon2';

// Transpilado para CommonJS pelo Playwright (a raiz não é "type": "module").
export const REPO_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(REPO_ROOT, '.env') });

/** Prefixo exclusivo dos usuários de teste (usado na limpeza). */
export const E2E_USER_PREFIX = 'e2e';

export type E2EUser = {
  envKey: 'ADMIN' | 'A' | 'B';
  username: string;
  fullName: string;
  email: string;
  role: 'ADMIN' | 'USER';
  password: string;
};

export function createPool(): pg.Pool {
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    application_name: 'agenda-ba-e2e',
  });
}

/** Apaga usuários E2E de execuções anteriores (e seus rastros). */
export async function removeE2EUsers(pool: pg.Pool, likePattern = `${E2E_USER_PREFIX}%`): Promise<number> {
  const found = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE username LIKE $1',
    [likePattern],
  );
  const ids = found.rows.map((r) => r.id);
  if (ids.length === 0) return 0;

  const meetings = await pool.query<{ id: string }>(
    `SELECT id FROM meetings
      WHERE created_by_user_id = ANY($1::uuid[])
         OR updated_by_user_id = ANY($1::uuid[])
         OR cancelled_by_user_id = ANY($1::uuid[])`,
    [ids],
  );
  const meetingIds = meetings.rows.map((m) => m.id);

  await pool.query('DELETE FROM notification_outbox WHERE recipient_user_id = ANY($1::uuid[]) OR meeting_id = ANY($2::uuid[])', [ids, meetingIds]);
  await pool.query(
    `DELETE FROM audit_logs
      WHERE actor_user_id = ANY($1::uuid[])
         OR (entity_type = 'meeting' AND entity_id = ANY($2::text[]))`,
    [ids, meetingIds],
  );
  await pool.query('DELETE FROM meetings WHERE id = ANY($1::uuid[])', [meetingIds]);
  // sessions e auth_tokens têm ON DELETE CASCADE em user_id.
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);

  return ids.length;
}

/** Cria um usuário ativo com hash Argon2id e devolve o id. */
export async function insertUser(
  pool: pg.Pool,
  user: Omit<E2EUser, 'password'> & { password: string },
): Promise<string> {
  const passwordHash = await hash(user.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const row = await pool.query<{ id: string }>(
    `INSERT INTO users (full_name, username, email, password_hash, role, status, must_change_password)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', false)
     RETURNING id`,
    [user.fullName, user.username, user.email, passwordHash, user.role],
  );
  const id = row.rows[0]?.id;
  if (!id) throw new Error(`Falha ao criar usuário de teste ${user.username}`);
  return id;
}
