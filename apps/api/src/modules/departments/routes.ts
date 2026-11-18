import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createDepartmentSchema,
  departmentKey,
  departmentSlug,
  formatZodIssues,
  updateDepartmentSchema,
  type DepartmentColorKey,
} from '@agenda/shared';
import { queryMany, queryOne, withTransaction } from '../../config/db.js';
import { requireAdmin, requireAuth } from '../../plugins/auth.js';
import { audit } from '../audit/audit.js';

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

type DepartmentRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color_key: DepartmentColorKey | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  active_user_count: number;
  meeting_count: number;
};

type DepartmentDto = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  colorKey: DepartmentColorKey | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  activeUserCount: number;
  meetingCount: number;
};

function toDto(r: DepartmentRow): DepartmentDto {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    colorKey: r.color_key,
    isActive: r.is_active,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    activeUserCount: r.active_user_count,
    meetingCount: r.meeting_count,
  };
}

const SELECT_DEPARTMENT = `
  SELECT d.id, d.name, d.slug, d.description, d.color_key, d.is_active,
         d.created_at, d.updated_at,
         (SELECT count(*) FROM users u
           WHERE u.department_id = d.id AND u.status = 'ACTIVE')::int AS active_user_count,
         (SELECT count(*) FROM meetings m WHERE m.department_id = d.id)::int AS meeting_count
    FROM departments d`;

/**
 * Rotas de setor (Revisão V2 §10).
 *
 * - `/api/v1/departments`       -> lista para selects (ativa, exigido login);
 * - `/api/v1/admin/departments` -> lista completa com contagens (ADMIN);
 * - POST/PATCH/activate/deactivate/summary -> apenas ADMIN.
 *
 * Setor organizacional NUNCA concede permissão: `role` continua
 * independente (V2 §1.2).
 */
export default async function departmentRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------- LISTA PÚBLICA (selects) -------------------- */
  app.get('/api/v1/departments', async (request, reply) => {
    requireAuth(request);
    const q = request.query as { all?: string };
    // Usuário comum vê apenas ativos; administrador pode pedir todos.
    const wantAll = q.all === 'true' && request.sessionUser?.role === 'ADMIN';

    const rows = await queryMany<DepartmentRow>(
      `${SELECT_DEPARTMENT}
        WHERE ($1 = true OR d.is_active = true)
        ORDER BY d.name`,
      [wantAll],
    );
    await reply.send({ items: rows.map(toDto), total: rows.length });
  });

  /* ------------------- LISTA COMPLETA (ADMIN) -------------------- */
  app.get('/api/v1/admin/departments', async (request, reply) => {
    requireAdmin(request);
    const rows = await queryMany<DepartmentRow>(`${SELECT_DEPARTMENT} ORDER BY d.name`);
    await reply.send({ items: rows.map(toDto), total: rows.length });
  });

  /* --------------------------- CRIAÇÃO ---------------------------- */
  app.post('/api/v1/admin/departments', async (request, reply) => {
    const admin = requireAdmin(request);
    const body = parse(createDepartmentSchema, request.body);

    const key = departmentKey(body.name);
    const slug = departmentSlug(body.name);

    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM departments WHERE normalized_name = $1',
      [key],
    );
    if (existing) {
      throw httpError(409, 'DUPLICATE', `Já existe um setor chamado "${body.name.trim()}".`);
    }
    // Slug é recalculado no servidor; colisão de slug com nome diferente
    // recebe sufixo numérico em vez de estourar erro SQL cru.
    const slugTaken = await queryOne<{ id: string }>(
      'SELECT id FROM departments WHERE slug = $1',
      [slug],
    );
    const finalSlug = slugTaken ? `${slug}-${Date.now().toString(36)}` : slug;

    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO departments (name, normalized_name, slug, description, color_key, is_active, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING id`,
      [
        body.name.trim(),
        key,
        finalSlug,
        body.description?.trim() ? body.description.trim() : null,
        body.colorKey ?? null,
        body.isActive !== false,
        admin.id,
      ],
    );
    if (!inserted) throw httpError(500, 'INTERNAL', 'Falha ao criar o setor.');

    const created = await queryOne<DepartmentRow>(`${SELECT_DEPARTMENT} WHERE d.id = $1`, [
      inserted.id,
    ]);
    if (!created) throw httpError(500, 'INTERNAL', 'Falha ao reler o setor.');

    await audit({
      actor: admin,
      action: 'DEPARTMENT_CREATED',
      entityType: 'department',
      entityId: created.id,
      entityLabel: created.name,
      metadata: { slug: finalSlug, colorKey: created.color_key },
    });

    await reply.code(201).send({ ok: true, department: toDto(created) });
  });

  /* --------------------------- EDIÇÃO ----------------------------- */
  app.patch('/api/v1/admin/departments/:id', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parse(updateDepartmentSchema, request.body);

    const target = await queryOne<{
      id: string;
      name: string;
      description: string | null;
      color_key: DepartmentColorKey | null;
      is_active: boolean;
    }>('SELECT id, name, description, color_key, is_active FROM departments WHERE id = $1', [id]);
    if (!target) throw httpError(404, 'NOT_FOUND', 'Setor não encontrado.');

    const name = body.name !== undefined ? body.name.trim() : target.name;

    if (body.name !== undefined) {
      const key = departmentKey(name);
      const duplicate = await queryOne<{ id: string }>(
        'SELECT id FROM departments WHERE normalized_name = $1 AND id <> $2',
        [key, id],
      );
      if (duplicate) {
        throw httpError(409, 'DUPLICATE', `Já existe um setor chamado "${name}".`);
      }
    }

    const updated = await queryOne<{ id: string }>(
      `UPDATE departments
          SET name = $2,
              normalized_name = $3,
              description = $4,
              color_key = $5,
              is_active = $6,
              updated_by_user_id = $7,
              updated_at = now()
        WHERE id = $1
        RETURNING id`,
      [
        id,
        name,
        departmentKey(name),
        body.description !== undefined ? body.description.trim() || null : target.description,
        body.colorKey !== undefined ? body.colorKey : target.color_key,
        body.isActive !== undefined ? body.isActive : target.is_active,
        admin.id,
      ],
    );
    if (!updated) throw httpError(500, 'INTERNAL', 'Falha ao atualizar o setor.');

    const full = await queryOne<DepartmentRow>(`${SELECT_DEPARTMENT} WHERE d.id = $1`, [id]);
    if (!full) throw httpError(500, 'INTERNAL', 'Falha ao reler o setor.');

    await audit({
      actor: admin,
      action: 'DEPARTMENT_UPDATED',
      entityType: 'department',
      entityId: id,
      entityLabel: full.name,
      metadata: { fields: Object.keys(body) },
    });

    await reply.send({ ok: true, department: toDto(full) });
  });

  /* ------------------------ DESATIVAR ----------------------------- */
  app.post('/api/v1/admin/departments/:id/deactivate', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };

    const target = await queryOne<{ id: string; name: string; is_active: boolean }>(
      'SELECT id, name, is_active FROM departments WHERE id = $1',
      [id],
    );
    if (!target) throw httpError(404, 'NOT_FOUND', 'Setor não encontrado.');

    const counts = await queryOne<{ users: number; meetings: number }>(
      `SELECT
         (SELECT count(*) FROM users u WHERE u.department_id = $1)::int AS users,
         (SELECT count(*) FROM meetings m WHERE m.department_id = $1)::int AS meetings`,
      [id],
    );

    // V2 §2.2: desativar mantém histórico e bloqueia novos vínculos;
    // o banco impede exclusão física enquanto houver vínculo (FK NO ACTION).
    const updated = await queryOne<{ id: string }>(
      `UPDATE departments
          SET is_active = false, updated_by_user_id = $2, updated_at = now()
        WHERE id = $1
        RETURNING id`,
      [id, admin.id],
    );
    if (!updated) throw httpError(500, 'INTERNAL', 'Falha ao desativar o setor.');

    await audit({
      actor: admin,
      action: 'DEPARTMENT_DEACTIVATED',
      entityType: 'department',
      entityId: id,
      entityLabel: target.name,
      metadata: { linkedUsers: counts?.users ?? 0, linkedMeetings: counts?.meetings ?? 0 },
    });

    await reply.send({
      ok: true,
      message: `Setor "${target.name}" desativado. Ele continua no histórico, mas não aparece em novos vínculos.`,
      linkedUsers: counts?.users ?? 0,
      linkedMeetings: counts?.meetings ?? 0,
    });
  });

  /* ------------------------- REATIVAR ----------------------------- */
  app.post('/api/v1/admin/departments/:id/activate', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };

    const target = await queryOne<{ id: string; name: string }>(
      'SELECT id, name FROM departments WHERE id = $1',
      [id],
    );
    if (!target) throw httpError(404, 'NOT_FOUND', 'Setor não encontrado.');

    const updated = await queryOne<{ id: string }>(
      `UPDATE departments
          SET is_active = true, updated_by_user_id = $2, updated_at = now()
        WHERE id = $1
        RETURNING id`,
      [id, admin.id],
    );
    if (!updated) throw httpError(500, 'INTERNAL', 'Falha ao reativar o setor.');

    await audit({
      actor: admin,
      action: 'DEPARTMENT_ACTIVATED',
      entityType: 'department',
      entityId: id,
      entityLabel: target.name,
    });

    await reply.send({ ok: true, message: `Setor "${target.name}" reativado.` });
  });

  /* --------------------- DETALHE / RESUMO ------------------------- */
  app.get('/api/v1/admin/departments/:id/summary', async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };

    const dept = await queryOne<DepartmentRow>(`${SELECT_DEPARTMENT} WHERE d.id = $1`, [id]);
    if (!dept) throw httpError(404, 'NOT_FOUND', 'Setor não encontrado.');

    const [users, meetings] = await Promise.all([
      queryMany<{
        id: string;
        full_name: string;
        username: string;
        status: string;
        role: string;
      }>(
        `SELECT id, full_name, username, status, role
           FROM users WHERE department_id = $1
          ORDER BY full_name`,
        [id],
      ),
      queryMany<{
        id: string;
        title: string;
        starts_at: Date;
        status: string;
        created_by_name: string;
      }>(
        `SELECT m.id, m.title, m.starts_at, m.status, u.full_name AS created_by_name
           FROM meetings m JOIN users u ON u.id = m.created_by_user_id
          WHERE m.department_id = $1
          ORDER BY m.starts_at DESC
          LIMIT 200`,
        [id],
      ),
    ]);

    await reply.send({
      department: toDto(dept),
      users: users.map((u) => ({
        id: u.id,
        fullName: u.full_name,
        username: u.username,
        status: u.status,
        role: u.role,
      })),
      meetings: meetings.map((m) => ({
        id: m.id,
        title: m.title,
        startsAt: m.starts_at.toISOString(),
        status: m.status,
        createdByName: m.created_by_name,
      })),
    });
  });

  /* ------------- EXCLUSÃO FÍSICA (manutenção restrita) -------------- */
  /*
   * V2 §2.2: não há botão de exclusão física no fluxo normal. Este endpoint
   * existe apenas para manutenção, exige ADMIN, confirmação explícita e
   * recusa qualquer setor com vínculo (a FK NO ACTION já bloqueia, mas o
   * erro amigável vem daqui).
   */
  app.delete('/api/v1/admin/departments/:id', async (request, reply) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = z
      .object({ confirm: z.literal(true, { message: 'Confirmação obrigatória.' }) })
      .safeParse(request.body ?? {});
    if (!body.success) {
      throw httpError(400, 'VALIDATION', 'Exclusão física requer confirmação explícita.');
    }

    const target = await queryOne<{ id: string; name: string }>(
      'SELECT id, name FROM departments WHERE id = $1',
      [id],
    );
    if (!target) throw httpError(404, 'NOT_FOUND', 'Setor não encontrado.');

    // Salvaguarda: os 3 setores do seed (migration 003) são estruturais e
    // nunca podem ser excluídos fisicamente — apenas desativados.
    const SEEDED = new Set(['administrador/ti', 'fiscal', 'financeiro']);
    if (SEEDED.has(departmentKey(target.name))) {
      throw httpError(
        409,
        'SEEDED',
        `"${target.name}" é um setor do seed do sistema. Use a desativação em vez da exclusão.`,
      );
    }

    const links = await queryOne<{ users: number; meetings: number }>(
      `SELECT
         (SELECT count(*) FROM users u WHERE u.department_id = $1)::int AS users,
         (SELECT count(*) FROM meetings m WHERE m.department_id = $1)::int AS meetings`,
      [id],
    );
    if ((links?.users ?? 0) > 0 || (links?.meetings ?? 0) > 0) {
      throw httpError(
        409,
        'IN_USE',
        `O setor "${target.name}" tem ${links?.users ?? 0} usuário(s) e ${
          links?.meetings ?? 0
        } reunião(ões) vinculados. Desative o setor em vez de excluí-lo.`,
      );
    }

    await withTransaction(async (client) => {
      await client.query('DELETE FROM departments WHERE id = $1', [id]);
    });

    await audit({
      actor: admin,
      action: 'DEPARTMENT_DELETED',
      entityType: 'department',
      entityId: id,
      entityLabel: target.name,
    });

    await reply.send({ ok: true, message: `Setor "${target.name}" excluído permanentemente.` });
  });

  /* --------------------- KPIs DA ÁREA ----------------------------- */
  app.get('/api/v1/admin/stats', async (request, reply) => {
    requireAdmin(request);
    const stats = await queryOne<{
      users_total: number;
      users_active: number;
      users_inactive: number;
      users_pending: number;
      dep_total: number;
      dep_active: number;
      dep_inactive: number;
    }>(
      `SELECT
         (SELECT count(*) FROM users)::int                                   AS users_total,
         (SELECT count(*) FROM users WHERE status = 'ACTIVE')::int           AS users_active,
         (SELECT count(*) FROM users WHERE status = 'INACTIVE')::int         AS users_inactive,
         (SELECT count(*) FROM users WHERE status = 'PENDING')::int          AS users_pending,
         (SELECT count(*) FROM departments)::int                             AS dep_total,
         (SELECT count(*) FROM departments WHERE is_active)::int             AS dep_active,
         (SELECT count(*) FROM departments WHERE NOT is_active)::int         AS dep_inactive`,
    );
    if (!stats) throw httpError(500, 'INTERNAL', 'Falha ao calcular indicadores.');

    await reply.send({
      users: {
        total: stats.users_total,
        active: stats.users_active,
        inactive: stats.users_inactive,
        pending: stats.users_pending,
      },
      departments: {
        total: stats.dep_total,
        active: stats.dep_active,
        inactive: stats.dep_inactive,
      },
    });
  });
}
