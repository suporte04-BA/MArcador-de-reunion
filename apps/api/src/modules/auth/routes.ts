import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import {
  activateInvitationSchema,
  changePasswordSchema,
  completePasswordResetSchema,
  formatZodIssues,
  loginSchema,
  requestPasswordResetSchema,
  avatarUrlOf,
  usernameKey,
  type SessionUser,
} from '@agenda/shared';
import { env } from '../../config/env.js';
import { query, queryOne, withTransaction } from '../../config/db.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  destroyUserSessions,
  generateToken,
  hashToken,
  requireAuth,
  setSessionCookie,
} from '../../plugins/auth.js';
import { audit } from '../audit/audit.js';
import { buildInviteEmail, buildPasswordResetEmail, enqueueSingleEmail, wakeWorker } from '../notifications/outbox.js';
import { rateLimit, resetRateLimit } from '../../lib/rate-limit.js';

/** Hash usado quando o usuário não existe (evita revelar existência por tempo de resposta). */
const DUMMY_HASH =
  '$argon2id$v=19$m=46080,t=3,p=1$c29tZXNhbHRzb21lc2FsdA$8Q0o0Q0o0Q0o0Q0o0Q0o0Q0o0Q0o0Q0o0Q0o0Q0o0Q0';

const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;
const RESET_TOKEN_MINUTES = 60;
const INVITE_TOKEN_HOURS = 72;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const err = new Error('Dados inválidos.') as Error & {
      statusCode: number;
      code: string;
      details: unknown;
    };
    err.statusCode = 400;
    err.code = 'VALIDATION';
    err.details = formatZodIssues(r.error);
    throw err;
  }
  return r.data;
}

type UserAuthRow = {
  id: string;
  full_name: string;
  username: string;
  email: string;
  password_hash: string | null;
  role: 'ADMIN' | 'USER';
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE';
  avatar_path: string | null;
  must_change_password: boolean;
  department_id: string | null;
  failed_login_attempts: number;
  locked_until: Date | null;
};

function toSessionUser(u: UserAuthRow): SessionUser {
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    email: u.email,
    role: u.role,
    status: u.status,
    avatarUrl: avatarUrlOf(u.avatar_path),
    mustChangePassword: u.must_change_password,
    departmentId: u.department_id,
  };
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------ LOGIN ------------------------------ */
  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = parse(loginSchema, request.body);
    /*
     * Chave de comparação única (V2 §4.2): NFKC -> trim -> colapsar
     * espaços -> minúsculas -> remover diacríticos. Aceita variações de
     * caixa/acentuação/espaços do nome cadastrado e também o e-mail.
     * O nome exibido continua preservado no cadastro.
     */
    const identifier = usernameKey(body.username);

    const ip = request.ip ?? 'unknown';
    const key = `login:${ip}:${identifier}`;
    const limited = rateLimit(key, {
      limit: LOGIN_MAX_ATTEMPTS,
      windowMs: LOGIN_WINDOW_MS,
      lockMs: LOGIN_WINDOW_MS,
    });
    if (!limited.allowed) {
      await reply.header('Retry-After', String(limited.retryAfterSeconds)).code(429).send({
        error: `Muitas tentativas. Tente novamente em ${Math.ceil(limited.retryAfterSeconds / 60)} minuto(s).`,
        code: 'RATE_LIMITED',
      });
      return;
    }

    const user = await queryOne<UserAuthRow>(
      `SELECT id, full_name, username, email, password_hash, role, status, avatar_path,
              must_change_password, failed_login_attempts, locked_until, department_id
         FROM users
        WHERE username_key = $1 OR email_key = $1
        LIMIT 1`,
      [identifier],
    );

    if (user?.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const minutes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60_000);
      await reply.code(429).send({
        error: `Conta bloqueada temporariamente por tentativas repetidas. Tente novamente em ${minutes} minuto(s).`,
        code: 'ACCOUNT_LOCKED',
      });
      return;
    }

    const hashToCheck = user?.password_hash ?? DUMMY_HASH;
    const passwordOk = await verify(hashToCheck, body.password).catch(() => false);

    const valid = Boolean(user) && passwordOk && user?.password_hash !== null;

    if (!valid) {
      if (user) {
        const attempts = user.failed_login_attempts + 1;
        const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null;
        await query(
          'UPDATE users SET failed_login_attempts = $2, locked_until = $3, updated_at = now() WHERE id = $1',
          [user.id, attempts, lockUntil],
        );
        await audit({
          actor: { id: user.id, fullName: user.full_name, username: user.username },
          action: 'LOGIN_FAILED',
          entityType: 'user',
          entityId: user.id,
          entityLabel: user.username,
          metadata: { attempts },
        });
      }
      await reply.code(401).send({ error: 'Usuário ou senha inválidos.', code: 'INVALID_CREDENTIALS' });
      return;
    }

    const found = user as UserAuthRow;

    if (found.status === 'INACTIVE') {
      await reply.code(403).send({ error: 'Conta desativada. Procure o administrador.', code: 'ACCOUNT_NOT_ACTIVE' });
      return;
    }

    resetRateLimit(key);

    const { token, expiresAt } = await createSession(found.id, {
      ip: request.ip,
      userAgent: String(request.headers['user-agent'] ?? ''),
    });

    await query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now(), updated_at = now() WHERE id = $1',
      [found.id],
    );

    setSessionCookie(reply, token, expiresAt);
    await audit({
      actor: { id: found.id, fullName: found.full_name, username: found.username },
      action: 'LOGIN',
      entityType: 'user',
      entityId: found.id,
      entityLabel: found.username,
    });

    await reply.send({ user: toSessionUser(found), mustChangePassword: found.must_change_password });
  });

  /* ------------------------------ LOGOUT ----------------------------- */
  app.post('/api/v1/auth/logout', async (request, reply) => {
    const token = request.cookies?.agenda_session;
    if (token) await destroySession(token);
    clearSessionCookie(reply);
    if (request.sessionUser) {
      await audit({
        actor: request.sessionUser,
        action: 'LOGOUT',
        entityType: 'user',
        entityId: request.sessionUser.id,
        entityLabel: request.sessionUser.username,
      });
    }
    await reply.send({ ok: true });
  });

  /* ------------------------------- ME ------------------------------- */
  app.get('/api/v1/auth/me', async (request, reply) => {
    if (!request.sessionUser) {
      await reply.code(401).send({ error: 'Sessão inválida ou expirada.', code: 'UNAUTHORIZED' });
      return;
    }
    await reply.send({ user: request.sessionUser });
  });

  /* ------------------------ TROCA DE SENHA -------------------------- */
  app.post('/api/v1/auth/change-password', async (request, reply) => {
    const user = requireAuth(request);
    const body = parse(changePasswordSchema, request.body);

    const row = await queryOne<{ password_hash: string; must_change_password: boolean }>(
      'SELECT password_hash, must_change_password FROM users WHERE id = $1',
      [user.id],
    );
    if (!row?.password_hash) {
      await reply.code(401).send({ error: 'Senha atual incorreta.', code: 'INVALID_PASSWORD' });
      return;
    }
    /*
     * Troca forçada (senha temporária): a UI não exibe o campo "senha atual",
     * então a validação só acontece quando a troca não é forçada. A sessão já
     * foi autenticada com a senha temporária no login.
     */
    if (!row.must_change_password && !(await verify(row.password_hash, body.currentPassword))) {
      await reply.code(401).send({ error: 'Senha atual incorreta.', code: 'INVALID_PASSWORD' });
      return;
    }

    const newHash = await hash(body.newPassword, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await query(
      'UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1',
      [user.id, newHash],
    );
    // Derruba as demais sessões; a atual permanece.
    await destroyUserSessions(user.id, request.sessionId ?? undefined);

    await audit({
      actor: user,
      action: 'PASSWORD_CHANGED',
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.username,
    });

    await reply.send({ ok: true, message: 'Senha alterada com sucesso.' });
  });

  /* --------------------- ATIVAÇÃO DE CONVITE ------------------------ */
  app.post('/api/v1/auth/activate-invitation', async (request, reply) => {
    const body = parse(activateInvitationSchema, request.body);

    const tokenRow = await queryOne<{
      id: string;
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT id, user_id, expires_at, used_at
         FROM auth_tokens
        WHERE token_hash = $1 AND purpose = 'INVITE'`,
      [hashToken(body.token)],
    );

    const invalid =
      !tokenRow || tokenRow.used_at !== null || new Date(tokenRow.expires_at).getTime() < Date.now();

    if (invalid) {
      await reply.code(400).send({
        error: 'Link de convite inválido ou expirado. Solicite um novo convite ao administrador.',
        code: 'INVALID_TOKEN',
      });
      return;
    }

    const target = tokenRow as NonNullable<typeof tokenRow>;
    const newHash = await hash(body.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

    const updated = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE users
            SET password_hash = $2, status = 'ACTIVE', must_change_password = false,
                failed_login_attempts = 0, locked_until = NULL, updated_at = now()
          WHERE id = $1
          RETURNING id, full_name, username, email, role, status, avatar_path, must_change_password`,
        [target.user_id, newHash],
      );
      await client.query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [target.id]);
      await client.query(
        `UPDATE auth_tokens SET used_at = now()
          WHERE user_id = $1 AND purpose = 'INVITE' AND used_at IS NULL`,
        [target.user_id],
      );
      return r.rows[0] ?? null;
    });

    if (!updated) {
      await reply.code(400).send({ error: 'Não foi possível ativar o convite.', code: 'INVALID_TOKEN' });
      return;
    }

    await audit({
      actor: { id: updated.id, fullName: updated.full_name, username: updated.username },
      action: 'INVITE_ACCEPTED',
      entityType: 'user',
      entityId: updated.id,
      entityLabel: updated.username,
    });

    await reply.send({ ok: true, message: 'Acesso ativado. Já pode entrar com seu usuário e senha.' });
  });

  /* --------------- SOLICITAÇÃO DE REDEFINIÇÃO DE SENHA -------------- */
  app.post('/api/v1/auth/request-password-reset', async (request, reply) => {
    const body = parse(requestPasswordResetSchema, request.body);
    const identifier = usernameKey(body.identifier);

    const ip = request.ip ?? 'unknown';
    const limited = rateLimit(`reset:${ip}`, { limit: 5, windowMs: 15 * 60_000 });
    if (!limited.allowed) {
      await reply.code(429).send({ error: 'Muitas solicitações. Tente mais tarde.', code: 'RATE_LIMITED' });
      return;
    }

    const generic = {
      ok: true,
      message:
        'Se existir uma conta com esse usuário ou e-mail, enviaremos as instruções de redefinição.',
    };

    const user = await queryOne<{ id: string; full_name: string; username: string; email: string }>(
      `SELECT id, full_name, username, email
         FROM users
        WHERE (username_key = $1 OR email_key = $1) AND status IN ('ACTIVE', 'PENDING')`,
      [identifier],
    );
    if (!user) {
      await reply.send(generic);
      return;
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000);

    await query(
      `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at)
       VALUES ($1, $2, 'PASSWORD_RESET', $3)`,
      [hashToken(token), user.id, expiresAt],
    );

    const rendered = buildPasswordResetEmail(
      { fullName: user.full_name, username: user.username },
      token,
      env.APP_BASE_URL,
    );

    await withTransaction((client) =>
      enqueueSingleEmail(client, {
        eventType: 'PASSWORD_RESET',
        eventKey: `password-reset:${user.id}:${Date.now()}`,
        recipientUserId: user.id,
        recipientEmail: user.email,
        recipientName: user.full_name,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
    wakeWorker();

    await audit({
      actor: null,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.username,
    });

    await reply.send(generic);
  });

  /* --------------- CONCLUSÃO DE REDEFINIÇÃO DE SENHA ---------------- */
  app.post('/api/v1/auth/complete-password-reset', async (request, reply) => {
    const body = parse(completePasswordResetSchema, request.body);

    const tokenRow = await queryOne<{
      id: string;
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT id, user_id, expires_at, used_at
         FROM auth_tokens
        WHERE token_hash = $1 AND purpose = 'PASSWORD_RESET'`,
      [hashToken(body.token)],
    );

    if (!tokenRow || tokenRow.used_at !== null || new Date(tokenRow.expires_at).getTime() < Date.now()) {
      await reply.code(400).send({
        error: 'Link de redefinição inválido ou expirado.',
        code: 'INVALID_TOKEN',
      });
      return;
    }

    const target = tokenRow as NonNullable<typeof tokenRow>;
    const newHash = await hash(body.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users
            SET password_hash = $2, must_change_password = false, status = 'ACTIVE',
                failed_login_attempts = 0, locked_until = NULL, updated_at = now()
          WHERE id = $1`,
        [target.user_id, newHash],
      );
      await client.query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [target.id]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [target.user_id]);
    });

    await audit({
      actor: null,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'user',
      entityId: target.user_id,
    });

    await reply.send({ ok: true, message: 'Senha redefinida. Já pode entrar.' });
  });

  /* -------------- CONVITE GERADO PELO ADMINISTRADOR ----------------- */
  app.post('/api/v1/auth/accept-invite-preview', async (request, reply) => {
    // Consulta pública mínima: mostra o nome de usuário do convite sem revelar dados sensíveis.
    const body = request.body as { token?: string };
    if (!body?.token) {
      await reply.code(400).send({ error: 'Token ausente.', code: 'VALIDATION' });
      return;
    }
    const row = await queryOne<{ username: string; full_name: string; expires_at: Date; used_at: Date | null }>(
      `SELECT u.username, u.full_name, t.expires_at, t.used_at
         FROM auth_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.purpose = 'INVITE'`,
      [hashToken(body.token)],
    );
    if (!row || row.used_at !== null || new Date(row.expires_at).getTime() < Date.now()) {
      await reply.code(400).send({ error: 'Convite inválido ou expirado.', code: 'INVALID_TOKEN' });
      return;
    }
    await reply.send({ fullName: row.full_name, username: row.username });
  });

  /* ------------------------ REENVIAR CONVITE ------------------------ */
  app.post('/api/v1/auth/resend-invite', async (request, reply) => {
    const user = requireAuth(request);
    if (user.role !== 'ADMIN') {
      await reply.code(403).send({ error: 'Acesso restrito ao administrador.', code: 'FORBIDDEN' });
      return;
    }
    const body = request.body as { userId?: string };
    if (!body.userId) {
      await reply.code(400).send({ error: 'Usuário não informado.', code: 'VALIDATION' });
      return;
    }
    const target = await queryOne<{ id: string; full_name: string; username: string; email: string; status: string }>(
      'SELECT id, full_name, username, email, status FROM users WHERE id = $1',
      [body.userId],
    );
    if (!target) {
      await reply.code(404).send({ error: 'Usuário não encontrado.', code: 'NOT_FOUND' });
      return;
    }

    const token = generateToken();
    await query(
      `UPDATE users SET invitation_token_hash = $2, invitation_expires_at = $3, updated_at = now() WHERE id = $1`,
      [target.id, hashToken(token), new Date(Date.now() + INVITE_TOKEN_HOURS * 3600_000)],
    );
    await query(
      `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at)
       VALUES ($1, $2, 'INVITE', $3)`,
      [hashToken(token), target.id, new Date(Date.now() + INVITE_TOKEN_HOURS * 3600_000)],
    );

    const rendered = buildInviteEmail(
      { fullName: target.full_name, username: target.username, email: target.email },
      token,
      env.APP_BASE_URL,
    );
    const result = await withTransaction((client) =>
      enqueueSingleEmail(client, {
        eventType: 'INVITE',
        eventKey: `invite:${target.id}:${Date.now()}`,
        recipientUserId: target.id,
        recipientEmail: target.email,
        recipientName: target.full_name,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
    wakeWorker();

    await audit({
      actor: user,
      action: 'INVITE_RESENT',
      entityType: 'user',
      entityId: target.id,
      entityLabel: target.username,
    });

    await reply.send({ ok: true, queued: result.queued, message: `Convite enfileirado para ${target.email}.` });
  });
}
