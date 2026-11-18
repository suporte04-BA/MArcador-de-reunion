import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { SessionUser } from '@agenda/shared';
import { avatarUrlOf } from '@agenda/shared';
import { env } from '../config/env.js';
import { pool, query, queryOne } from '../config/db.js';

export const SESSION_COOKIE = 'agenda_session';

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser: SessionUser | null;
    sessionId: string | null;
  }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export type CreatedSession = { token: string; expiresAt: Date };

/** Cria uma sessão no servidor e devolve o token (única vez). */
export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<CreatedSession> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000);
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(token), userId, expiresAt, meta.ip ?? null, (meta.userAgent ?? '').slice(0, 300)],
  );
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

/** Invalida todas as sessões de um usuário (ex.: desativação ou troca de senha). */
export async function destroyUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  if (exceptSessionId) {
    await query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, exceptSessionId]);
  } else {
    await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}

type SessionRow = {
  session_id: string;
  user_id: string;
  username: string;
  full_name: string;
  email: string;
  role: 'ADMIN' | 'USER';
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE';
  avatar_path: string | null;
  must_change_password: boolean;
  department_id: string | null;
};

async function loadSession(token: string): Promise<SessionUser | null> {
  const row = await queryOne<SessionRow>(
    `SELECT s.id AS session_id, u.id AS user_id, u.username, u.full_name, u.email,
            u.role, u.status, u.avatar_path, u.must_change_password, u.department_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND u.status = 'ACTIVE'`,
    [hashToken(token)],
  );

  if (!row) return null;

  // Expiração deslizante: cada acesso prorroga a sessão.
  void pool
    .query('UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1', [
      row.session_id,
      new Date(Date.now() + env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000),
    ])
    .catch(() => undefined);

  return {
    id: row.user_id,
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    status: row.status,
    avatarUrl: avatarUrlOf(row.avatar_path),
    mustChangePassword: row.must_change_password,
    departmentId: row.department_id,
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Verifica a origem da requisição mutável (proteção CSRF adicional ao SameSite=Lax).
 */
function originAllowed(request: FastifyRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return true;
  const origin = request.headers.origin;
  if (!origin) return true; // cliente sem Origin (curl/testes) — cookie já é SameSite
  // Desenvolvimento: o front (Vite :5173) e a API (:4175) têm origens distintas.
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
  } catch {
    /* ignora origem malformada */
  }
  const host = request.headers.host;
  const candidates = new Set<string>([env.APP_BASE_URL.replace(/\/$/, '')]);
  if (host) {
    candidates.add(`http://${host}`);
    candidates.add(`https://${host}`);
  }
  return candidates.has(origin.replace(/\/$/, ''));
}

async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('sessionUser', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (request, reply) => {
    if (!originAllowed(request)) {
      await reply.code(403).send({ error: 'Origem da requisição não autorizada.', code: 'CSRF' });
      return;
    }

    const token = request.cookies?.[SESSION_COOKIE];
    if (!token) return;

    const user = await loadSession(token);
    if (!user) {
      // Cookie inválido/expirado: remove para não reenviar.
      void reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return;
    }
    request.sessionUser = user;
    // Recupera o id da sessão apenas quando necessário (rotas administrativas).
    if (request.url.includes('/admin/')) {
      const sid = await queryOne<{ id: string }>(
        'SELECT id FROM sessions WHERE token_hash = $1',
        [hashToken(token)],
      );
      request.sessionId = sid?.id ?? null;
    }
  });

  // Limpeza periódica de sessões expiradas.
  const cleaner = setInterval(
    () => {
      void pool.query('DELETE FROM sessions WHERE expires_at < now()').catch(() => undefined);
    },
    10 * 60_000,
  );
  cleaner.unref?.();
  app.addHook('onClose', async () => clearInterval(cleaner));
}

export default fp(authPlugin, { name: 'agenda-auth' });

/** Envia a sessão como cookie HttpOnly. */
export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production' && env.APP_BASE_URL.startsWith('https://'),
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Guarda: exige usuário autenticado. */
export function requireAuth(request: FastifyRequest): SessionUser {
  if (!request.sessionUser) {
    const err = new Error('Faça entrar para continuar.') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  return request.sessionUser;
}

/** Guarda: exige administrador. */
export function requireAdmin(request: FastifyRequest): SessionUser {
  const user = requireAuth(request);
  if (user.role !== 'ADMIN') {
    const err = new Error('Acesso restrito ao administrador.') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
  return user;
}

/**
 * Regra central de autorização de reuniões.
 * Somente o criador autenticado ou um administrador pode gerenciar.
 */
export function canManageMeeting(
  user: SessionUser,
  meeting: { createdByUserId: string },
): boolean {
  return user.role === 'ADMIN' || user.id === meeting.createdByUserId;
}
