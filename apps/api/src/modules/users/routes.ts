import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { hash } from '@node-rs/argon2';
import { z } from 'zod';
import {
  formatZodIssues,
  normalizeEmail,
  normalizeUsername,
  usernameKey,
  departmentKey,
  avatarUrlOf,
  updateUserSchema,
  PASSWORD_MIN_LENGTH,
} from '@agenda/shared';
import { env, STORAGE_DIR } from '../../config/env.js';
import { query, queryMany, queryOne, withTransaction } from '../../config/db.js';
import { destroyUserSessions, generateToken, hashToken, requireAdmin, requireAuth } from '../../plugins/auth.js';
import { audit } from '../audit/audit.js';
import {
  buildInviteEmail,
  buildPasswordResetEmail,
  buildTestEmail,
  buildWelcomeEmail,
  enqueueSingleEmail,
  wakeWorker,
} from '../notifications/outbox.js';
import { describeSmtpConfig, verifySmtpConnection } from '../../email/mailer.js';
import { outboxStats } from '../notifications/outbox.js';

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

function httpError(statusCode: number, code: string, message: string): Error {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * Criação de usuário (Revisão V2 §3.4):
 * - setor OBRIGATÓRIO (organizacional, independente de `role`);
 * - senha inicial obrigatória, mínimo `PASSWORD_MIN_LENGTH`;
 * - a conta nasce `ACTIVE` (sem troca forçada) e o e-mail de boas-vindas
 *   NUNCA contém senha.
 *
 * O perfil (ADMIN/USER) é derivado do setor: setor "Administrador/TI"
 * concede acesso administrativo; demais setores são usuários comuns.
 * (Regra ajustada conforme solicitação do produto: TI = administradores.)
 */
const tempPasswordSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  username: z.string().trim().min(3).max(60),
  email: z.string().trim().min(5).max(254),
  departmentId: z.string().uuid('Setor é obrigatório.'),
  // Mesma regra das demais senhas: mínimo 4 caracteres (Revisão V2 §3.5).
  temporaryPassword: z.string().min(PASSWORD_MIN_LENGTH).max(200),
});

type AdminUserRow = {
  id: string;
  full_name: string;
  username: string;
  email: string;
  role: 'ADMIN' | 'USER';
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE';
  avatar_path: string | null;
  created_at: Date;
  last_login_at: Date | null;
  meeting_count: number;
  must_change_password: boolean;
  department_id: string | null;
  department_name: string | null;
  department_color_key: string | null;
};

const INVITE_HOURS = 72;

export default async function userRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------- LISTA (ADMIN) ------------------------- */
  app.get('/api/v1/admin/users', async (request, reply) => {
    requireAdmin(request);
    const rows = await queryMany<AdminUserRow>(
      `SELECT u.id, u.full_name, u.username, u.email, u.role, u.status, u.avatar_path,
              u.created_at, u.last_login_at, u.must_change_password,
              u.department_id, d.name AS department_name, d.color_key AS department_color_key,
              (SELECT count(*) FROM meetings m
                WHERE m.created_by_user_id = u.id AND m.status = 'SCHEDULED')::int AS meeting_count
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
        ORDER BY CASE u.role WHEN 'ADMIN' THEN 0 ELSE 1 END, u.full_name`,
    );

    await reply.send({
      items: rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        username: r.username,
        email: r.email,
        role: r.role,
        status: r.status,
        avatarUrl: avatarUrlOf(r.avatar_path),
        createdAt: r.created_at.toISOString(),
        lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
        meetingCount: r.meeting_count,
        mustChangePassword: r.must_change_password,
        departmentId: r.department_id,
        departmentName: r.department_name,
        departmentColorKey: r.department_color_key,
      })),
      total: rows.length,
    });
  });

  /* --------------------------- CRIAÇÃO ---------------------------- */
  app.post('/api/v1/admin/users', async (request, reply) => {
    const admin = requireAdmin(request);
    const body = parse(tempPasswordSchema, request.body);

    const username = normalizeUsername(body.username);
    const email = normalizeEmail(body.email);

    if (body.temporaryPassword.trim().length !== body.temporaryPassword.length) {
      throw httpError(400, 'VALIDATION', 'A senha não pode começar ou terminar com espaços.');
    }

    // Setor: obrigatório, precisa existir e estar ativo (V2 §3.4).
    const department = await queryOne<{ id: string; name: string; is_active: boolean }>(
      'SELECT id, name, is_active FROM departments WHERE id = $1',
      [body.departmentId],
    );
    if (!department) {
      throw httpError(400, 'VALIDATION', 'Setor informado não existe.');
    }
    if (!department.is_active) {
      throw httpError(400, 'VALIDATION', `O setor "${department.name}" está inativo. Reative-o antes de vincular usuários.`);
    }

    // Perfil derivado do setor: Administrador/TI = ADMIN, demais = USER.
    const ADMIN_SECTOR_KEY = 'administrador/ti';
    const role: 'ADMIN' | 'USER' =
      departmentKey(department.name) === ADMIN_SECTOR_KEY ? 'ADMIN' : 'USER';

    const existing = await queryOne<{ id: string }>(
      // Chave normalizada: ignora caixa, espaços repetidos e acentos (V2 §4.2).
      'SELECT id FROM users WHERE username_key = $1 OR email_key = $2',
      [usernameKey(username), usernameKey(email)],
    );
    if (existing) {
      throw httpError(409, 'DUPLICATE', 'Já existe um usuário com este nome de usuário ou e-mail.');
    }

    const passwordHash = await hash(body.temporaryPassword, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

    // V2 §3.4: a conta nasce ATIVA, com login imediato — sem troca forçada.
    const status = 'ACTIVE';

    const created = await queryOne<{ id: string }>(
      `INSERT INTO users (full_name, username, email, password_hash, role, status, department_id, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false)
       RETURNING id`,
      [
        body.fullName.trim(),
        username,
        email,
        passwordHash,
        role,
        status,
        department.id,
      ],
    );
    if (!created) throw httpError(500, 'INTERNAL', 'Falha ao criar o usuário.');

    /*
     * E-mail de boas-vindas SEM senha em texto (V2 §3.4 item 6/7).
     * Falha de e-mail NUNCA desfaz o cadastro: a conta segue ativa e a UI
     * apenas informa "conta criada; notificação pendente/falhou".
     */
    let queued = 0;
    try {
      const rendered = buildWelcomeEmail(
        { fullName: body.fullName.trim(), username, email },
        department.name,
        env.APP_BASE_URL,
      );
      const enq = await withTransaction((client) =>
        enqueueSingleEmail(client, {
          eventType: 'WELCOME',
          eventKey: `welcome:${created.id}:create`,
          recipientUserId: created.id,
          recipientEmail: email,
          recipientName: body.fullName.trim(),
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        }),
      );
      queued = enq.queued;
      wakeWorker();
    } catch (err) {
      request.log.error({ err }, 'falha ao enfileirar e-mail de boas-vindas (cadastro segue ativo)');
    }

    await audit({
      actor: admin,
      action: 'USER_CREATED',
      entityType: 'user',
      entityId: created.id,
      entityLabel: username,
      metadata: { role, departmentId: department.id, department: department.name },
    });

    await reply.code(201).send({
      ok: true,
      id: created.id,
      status,
      notificationsQueued: queued,
      message:
        queued > 0
          ? 'Usuário cadastrado e ativo. Ele já pode entrar com nome de usuário e senha. Aviso de cadastro enfileirado.'
          : 'Usuário cadastrado e ativo. Ele já pode entrar com nome de usuário e senha. Aviso de cadastro pendente.',
    });
  });

  /* --------------------------- EDIÇÃO ----------------------------- */
  app.patch('/api/v1/admin/users/:id', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parse(updateUserSchema, request.body);

    const target = await queryOne<AdminUserRow>(
      'SELECT id, full_name, username, email, role, status, department_id FROM users WHERE id = $1',
      [id],
    );
    if (!target) throw httpError(404, 'NOT_FOUND', 'Usuário não encontrado.');

    const username = body.username ? normalizeUsername(body.username) : target.username;
    const email = body.email ? normalizeEmail(body.email) : target.email;
    const status = body.status ?? target.status;

    // Setor: se enviado, precisa existir e estar ativo (histórico de setor
    // inativo já vinculado continua válido — só novos vínculos são barrados).
    let departmentId = body.departmentId ?? target.department_id;
    if (body.departmentId && body.departmentId !== target.department_id) {
      const department = await queryOne<{ id: string; name: string; is_active: boolean }>(
        'SELECT id, name, is_active FROM departments WHERE id = $1',
        [body.departmentId],
      );
      if (!department) throw httpError(400, 'VALIDATION', 'Setor informado não existe.');
      if (!department.is_active) {
        throw httpError(400, 'VALIDATION', `O setor "${department.name}" está inativo.`);
      }
      departmentId = department.id;
    }

    // Perfil derivado do setor: Administrador/TI = ADMIN, demais = USER.
    // Se o setor não mudou, mantém o role atual (permite ajuste manual via status).
    const ADMIN_SECTOR_KEY = 'administrador/ti';
    let role: 'ADMIN' | 'USER' = target.role;
    if (body.departmentId && body.departmentId !== target.department_id) {
      const newDept = await queryOne<{ name: string }>('SELECT name FROM departments WHERE id = $1', [departmentId]);
      role = newDept && departmentKey(newDept.name) === ADMIN_SECTOR_KEY ? 'ADMIN' : 'USER';
    }

    // Impede remover o último administrador ativo (rebaixar OU desativar).
    if (target.role === 'ADMIN' && (role !== 'ADMIN' || status !== 'ACTIVE')) {
      const others = await queryOne<{ n: number }>(
        "SELECT count(*)::int AS n FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> $1",
        [id],
      );
      if ((others?.n ?? 0) === 0) {
        throw httpError(
          409,
          'LAST_ADMIN',
          'Não é possível rebaixar/desativar o último administrador ativo. Promova outro usuário antes.',
        );
      }
    }

    const duplicate = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE (username_key = $1 OR email_key = $2) AND id <> $3',
      [usernameKey(username), usernameKey(email), id],
    );
    if (duplicate) {
      throw httpError(409, 'DUPLICATE', 'Já existe um usuário com este nome de usuário ou e-mail.');
    }

    const emailChanged = email !== target.email;
    const usernameChanged = username !== target.username;

    if (body.password && body.password.trim() !== '') {
      const passwordHash = await hash(body.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
      await query(
        "UPDATE users SET password_hash = $2, must_change_password = false, status = 'ACTIVE', updated_at = now() WHERE id = $1",
        [id, passwordHash],
      );
      await destroyUserSessions(id);
    }

    await query(
      `UPDATE users SET full_name = $2, username = $3, email = $4, role = $5,
              department_id = $6, status = $7, updated_at = now()
        WHERE id = $1`,
      [id, body.fullName?.trim() ?? target.full_name, username, email, role, departmentId, status],
    );

    /*
     * V2 §3.4: mudar username, privilégio ou situação invalida as sessões
     * existentes — ninguém continua logado com uma identidade alterada.
     */
    if (role !== target.role || usernameChanged || status !== target.status) {
      await destroyUserSessions(id);
    }

    await audit({
      actor: admin,
      action: 'USER_UPDATED',
      entityType: 'user',
      entityId: id,
      entityLabel: username,
      metadata: {
        roleChanged: role !== target.role,
        emailChanged,
        previousEmail: emailChanged ? target.email : undefined,
        usernameChanged,
        previousUsername: usernameChanged ? target.username : undefined,
        departmentChanged: departmentId !== target.department_id,
        previousDepartmentId: departmentId !== target.department_id ? target.department_id : undefined,
        statusChanged: status !== target.status,
        previousStatus: status !== target.status ? target.status : undefined,
      },
    });

    await reply.send({ ok: true, message: 'Usuário atualizado.' });
  });

  /* --------------------- EXCLUIR USUÁRIO ------------------------ */
  app.delete('/api/v1/admin/users/:id', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };

    if (id === admin.id) {
      throw httpError(400, 'SELF_DELETE', 'Não é possível excluir a própria conta.');
    }

    const target = await queryOne<{ id: string; username: string; role: string; status: string }>(
      'SELECT id, username, role, status FROM users WHERE id = $1',
      [id],
    );
    if (!target) throw httpError(404, 'NOT_FOUND', 'Usuário não encontrado.');

    if (target.role === 'ADMIN') {
      const others = await queryOne<{ n: number }>(
        "SELECT count(*)::int AS n FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> $1",
        [id],
      );
      if ((others?.n ?? 0) < 2) {
        throw httpError(
          409,
          'LAST_ADMIN',
          'Não é possível excluir: o sistema precisa manter ao menos 2 administradores ativos.',
        );
      }
    }

    // Remove rastros (reuniões criadas/editadas/canceladas, outbox, auditoria).
    const meetings = await query<{ id: string }>(
      `SELECT id FROM meetings
        WHERE created_by_user_id = $1 OR updated_by_user_id = $1 OR cancelled_by_user_id = $1`,
      [id],
    );
    const meetingIds = meetings.rows.map((m) => m.id);
    await query('DELETE FROM notification_outbox WHERE recipient_user_id = $1 OR meeting_id = ANY($2::uuid[])', [
      id,
      meetingIds,
    ]);
    await query(
      `DELETE FROM audit_logs
        WHERE actor_user_id = $1
           OR (entity_type = 'meeting' AND entity_id = ANY($2::text[]))`,
      [id, meetingIds],
    );
    if (meetingIds.length > 0) {
      await query('DELETE FROM meetings WHERE id = ANY($1::uuid[])', [meetingIds]);
    }
    await query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await query('DELETE FROM users WHERE id = $1', [id]);

    await audit({
      actor: admin,
      action: 'USER_DELETED',
      entityType: 'user',
      entityId: id,
      entityLabel: target.username,
    });

    await reply.send({ ok: true, message: `Usuário ${target.username} excluído.` });
  });

  /* --------------------- ATIVAR / DESATIVAR ------------------------ */
  app.post('/api/v1/admin/users/:id/activate', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const r = await query(
      "UPDATE users SET status = 'ACTIVE', failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1 AND status <> 'ACTIVE' RETURNING username",
      [id],
    );
    if ((r.rowCount ?? 0) === 0) throw httpError(404, 'NOT_FOUND', 'Usuário não encontrado ou já ativo.');
    await audit({
      actor: admin,
      action: 'USER_ACTIVATED',
      entityType: 'user',
      entityId: id,
      entityLabel: r.rows[0]?.username,
    });
    await reply.send({ ok: true, message: 'Usuário ativado.' });
  });

  app.post('/api/v1/admin/users/:id/deactivate', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };

    const target = await queryOne<{ username: string; role: string; status: string }>(
      'SELECT username, role, status FROM users WHERE id = $1',
      [id],
    );
    if (!target) throw httpError(404, 'NOT_FOUND', 'Usuário não encontrado.');
    if (target.role === 'ADMIN' && target.status === 'ACTIVE') {
      const others = await queryOne<{ n: number }>(
        "SELECT count(*)::int AS n FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> $1",
        [id],
      );
      if ((others?.n ?? 0) === 0) {
        throw httpError(409, 'LAST_ADMIN', 'Não é possível desativar o último administrador ativo.');
      }
    }
    if (id === admin.id) {
      throw httpError(409, 'SELF_DEACTIVATE', 'Você não pode desativar a própria conta.');
    }

    await query("UPDATE users SET status = 'INACTIVE', updated_at = now() WHERE id = $1", [id]);
    await destroyUserSessions(id);

    await audit({
      actor: admin,
      action: 'USER_DEACTIVATED',
      entityType: 'user',
      entityId: id,
      entityLabel: target.username,
    });
    await reply.send({ ok: true, message: 'Usuário desativado e sessões encerradas.' });
  });

  /* --------------------- REENVIAR CONVITE -------------------------- */
  app.post('/api/v1/admin/users/:id/resend-invitation', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };

    const target = await queryOne<{ id: string; full_name: string; username: string; email: string }>(
      'SELECT id, full_name, username, email FROM users WHERE id = $1',
      [id],
    );
    if (!target) throw httpError(404, 'NOT_FOUND', 'Usuário não encontrado.');

    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITE_HOURS * 3600_000);
    await query(
      `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,'INVITE',$3)`,
      [hashToken(token), id, expiresAt],
    );
    await query('UPDATE users SET invitation_token_hash = $2, invitation_expires_at = $3, updated_at = now() WHERE id = $1', [
      id,
      hashToken(token),
      expiresAt,
    ]);

    const rendered = buildInviteEmail(
      { fullName: target.full_name, username: target.username, email: target.email },
      token,
      env.APP_BASE_URL,
    );
    const enq = await withTransaction((client) =>
      enqueueSingleEmail(client, {
        eventType: 'INVITE',
        eventKey: `invite:${id}:resend:${Date.now()}`,
        recipientUserId: id,
        recipientEmail: target.email,
        recipientName: target.full_name,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
    wakeWorker();

    await audit({
      actor: admin,
      action: 'INVITE_RESENT',
      entityType: 'user',
      entityId: id,
      entityLabel: target.username,
    });

    await reply.send({ ok: true, queued: enq.queued, message: `Convite enfileirado para ${target.email}.` });
  });

  /* ------------------ E-MAIL DE TESTE INDIVIDUAL ------------------- */
  app.post('/api/v1/admin/users/:id/send-test-email', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parse(
      z.object({ confirm: z.boolean().optional(), destination: z.string().trim().optional() }),
      request.body ?? {},
    );

    const target = await queryOne<{ id: string; full_name: string; username: string; email: string }>(
      'SELECT id, full_name, username, email FROM users WHERE id = $1',
      [id],
    );
    if (!target) throw httpError(404, 'NOT_FOUND', 'Usuário não encontrado.');

    if (body.confirm === false) {
      await reply.send({
        requiresConfirmation: true,
        destination: target.email,
        message: `Confirme o envio para ${target.email}.`,
      });
      return;
    }

    const rendered = buildTestEmail(
      { fullName: target.full_name, email: target.email },
      env.APP_BASE_URL,
      `${admin.fullName} (${admin.username})`,
    );

    const enq = await withTransaction((client) =>
      enqueueSingleEmail(client, {
        eventType: 'TEST_EMAIL',
        eventKey: `test-email:${id}:${Date.now()}`,
        recipientUserId: id,
        recipientEmail: target.email,
        recipientName: target.full_name,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
    wakeWorker();

    await audit({
      actor: admin,
      action: 'TEST_EMAIL_QUEUED',
      entityType: 'user',
      entityId: id,
      entityLabel: target.username,
      metadata: { destination: target.email },
    });

    await reply.send({
      ok: true,
      queued: enq.queued,
      destination: target.email,
      message: `E-mail de teste enfileirado para ${target.email}.`,
    });
  });

  /* --------------------- REDEFINIÇÃO DE SENHA ---------------------- */
  app.post('/api/v1/admin/users/:id/request-password-reset', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const target = await queryOne<{ id: string; full_name: string; username: string; email: string; status: string }>(
      'SELECT id, full_name, username, email, status FROM users WHERE id = $1',
      [id],
    );
    if (!target) throw httpError(404, 'NOT_FOUND', 'Usuário não encontrado.');
    if (target.status !== 'ACTIVE') {
      throw httpError(409, 'NOT_ACTIVE', 'Só é possível redefinir a senha de usuários ativos.');
    }

    const token = generateToken();
    await query(
      `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at)
       VALUES ($1,$2,'PASSWORD_RESET',$3)`,
      [hashToken(token), id, new Date(Date.now() + 60 * 60_000)],
    );

    const rendered = buildPasswordResetEmail(
      { fullName: target.full_name, username: target.username },
      token,
      env.APP_BASE_URL,
    );
    const enq = await withTransaction((client) =>
      enqueueSingleEmail(client, {
        eventType: 'PASSWORD_RESET',
        eventKey: `password-reset:${id}:${Date.now()}`,
        recipientUserId: id,
        recipientEmail: target.email,
        recipientName: target.full_name,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
    wakeWorker();

    await audit({
      actor: admin,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'user',
      entityId: id,
      entityLabel: target.username,
    });

    await reply.send({
      ok: true,
      queued: enq.queued,
      message: `Link de redefinição enfileirado para ${target.email} (validade de 60 minutos).`,
    });
  });

  /* --------------------------- AVATAR ------------------------------ */

  /**
   * Valida e persiste a imagem de avatar de um usuário.
   * Usado pelo upload do próprio usuário e pelo upload administrativo.
   */
  async function saveAvatar(
    targetUserId: string,
    file: { toBuffer: () => Promise<Buffer> },
  ): Promise<{ filename: string }> {
    const buffer = await file.toBuffer();
    if (buffer.length > env.AVATAR_MAX_BYTES) {
      throw httpError(413, 'TOO_LARGE', 'Imagem maior que o limite permitido (2 MB).');
    }

    // Valida a assinatura binária (não confia apenas na extensão).
    const isPng = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp =
      buffer.length > 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!isPng && !isJpeg && !isWebp) {
      throw httpError(415, 'UNSUPPORTED', 'Formato inválido. Use PNG, JPEG ou WebP.');
    }

    const ext = isPng ? 'png' : isJpeg ? 'jpg' : 'webp';
    const filename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    const dir = path.join(STORAGE_DIR, 'avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), buffer);

    const previous = await queryOne<{ avatar_path: string | null }>(
      'SELECT avatar_path FROM users WHERE id = $1',
      [targetUserId],
    );
    await query('UPDATE users SET avatar_path = $2, updated_at = now() WHERE id = $1', [targetUserId, filename]);

    if (previous?.avatar_path) {
      const old = path.join(dir, previous.avatar_path);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }

    return { filename };
  }

  app.post('/api/v1/me/avatar', async (request, reply) => {
    const user = requireAuth(request);
    const file = await request.file({ limits: { fileSize: env.AVATAR_MAX_BYTES } });
    if (!file) throw httpError(400, 'VALIDATION', 'Nenhum arquivo enviado.');

    const { filename } = await saveAvatar(user.id, file);

    await audit({
      actor: user,
      action: 'AVATAR_UPDATED',
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.username,
    });

    await reply.send({ ok: true, avatarUrl: `/uploads/avatars/${filename}` });
  });

  /** Upload administrativo de avatar de qualquer usuário. */
  app.post('/api/v1/admin/users/:id/avatar', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };

    const target = await queryOne<{ id: string; username: string }>(
      'SELECT id, username FROM users WHERE id = $1',
      [id],
    );
    if (!target) throw httpError(404, 'NOT_FOUND', 'Usuário não encontrado.');

    const file = await request.file({ limits: { fileSize: env.AVATAR_MAX_BYTES } });
    if (!file) throw httpError(400, 'VALIDATION', 'Nenhum arquivo enviado.');

    const { filename } = await saveAvatar(target.id, file);

    await audit({
      actor: admin,
      action: 'AVATAR_UPDATED',
      entityType: 'user',
      entityId: target.id,
      entityLabel: target.username,
    });

    await reply.send({ ok: true, avatarUrl: `/uploads/avatars/${filename}` });
  });

  async function saveAvatarUrl(targetUserId: string, url: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw httpError(400, 'VALIDATION', 'URL de imagem inválida.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw httpError(400, 'VALIDATION', 'A URL deve usar http ou https.');
    }

    const previous = await queryOne<{ avatar_path: string | null }>(
      'SELECT avatar_path FROM users WHERE id = $1',
      [targetUserId],
    );
    await query('UPDATE users SET avatar_path = $2, updated_at = now() WHERE id = $1', [targetUserId, url]);

    if (previous?.avatar_path && !/^https?:\/\//i.test(previous.avatar_path)) {
      const dir = path.join(STORAGE_DIR, 'avatars');
      const old = path.join(dir, previous.avatar_path);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
  }

  app.post('/api/v1/me/avatar-url', async (request, reply) => {
    const user = requireAuth(request);
    const body = parse(z.object({ url: z.string().trim().min(1).max(2048) }), request.body);
    await saveAvatarUrl(user.id, body.url);
    await audit({
      actor: user,
      action: 'AVATAR_UPDATED',
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.username,
    });
    await reply.send({ ok: true, avatarUrl: body.url });
  });

  app.post('/api/v1/admin/users/:id/avatar-url', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const target = await queryOne<{ id: string; username: string }>(
      'SELECT id, username FROM users WHERE id = $1',
      [id],
    );
    if (!target) throw httpError(404, 'NOT_FOUND', 'Usuário não encontrado.');
    const body = parse(z.object({ url: z.string().trim().min(1).max(2048) }), request.body);
    await saveAvatarUrl(target.id, body.url);
    await audit({
      actor: admin,
      action: 'AVATAR_UPDATED',
      entityType: 'user',
      entityId: target.id,
      entityLabel: target.username,
    });
    await reply.send({ ok: true, avatarUrl: body.url });
  });

  /* ------------------------ STATUS DE E-MAIL ----------------------- */
  app.get('/api/v1/admin/email/status', async (request, reply) => {
    requireAdmin(request);
    const [stats, smtp] = await Promise.all([outboxStats(), Promise.resolve(describeSmtpConfig())]);
    await reply.send({ smtp, ...stats });
  });

  app.post('/api/v1/admin/email/test-connection', async (request, reply) => {
    requireAdmin(request);
    const result = await verifySmtpConnection();
    await reply.send({
      ...result,
      message: result.ok
        ? 'Servidor SMTP aceitou a conexão.'
        : `Falha na conexão SMTP: ${result.error ?? 'erro desconhecido'}`,
    });
  });

  /* --------------------------- AUDITORIA --------------------------- */
  app.get('/api/v1/admin/audit', async (request, reply) => {
    requireAdmin(request);
    const q = request.query as { limit?: string; action?: string };
    const limit = Math.min(Number(q.limit ?? 100) || 100, 500);
    const rows = await queryMany<{
      id: string;
      created_at: Date;
      actor_name: string | null;
      action: string;
      entity_type: string;
      entity_label: string | null;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT id, created_at, actor_name, action, entity_type, entity_label, metadata
         FROM audit_logs
        WHERE ($1::text IS NULL OR action = $1)
        ORDER BY created_at DESC
        LIMIT $2`,
      [q.action ?? null, limit],
    );

    await reply.send({
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at.toISOString(),
        actorName: r.actor_name ?? 'sistema',
        action: r.action,
        entityType: r.entity_type,
        entityLabel: r.entity_label,
        metadata: r.metadata,
      })),
      total: rows.length,
    });
  });

  /* ------------------------ FILA DE E-MAIL ------------------------- */
  app.get('/api/v1/admin/outbox', async (request, reply) => {
    requireAdmin(request);
    const stats = await outboxStats();
    await reply.send(stats);
  });
}
