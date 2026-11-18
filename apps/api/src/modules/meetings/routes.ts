import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  availabilityQuerySchema,
  createMeetingSchema,
  formatZodIssues,
  listMeetingsQuerySchema,
  updateMeetingSchema,
  zonedTimeToUtc,
} from '@agenda/shared';
import { env } from '../../config/env.js';
import { queryMany, queryOne, withTransaction } from '../../config/db.js';
import { canManageMeeting, requireAuth } from '../../plugins/auth.js';
import { audit } from '../audit/audit.js';
import { enqueueMeetingEvent, wakeWorker } from '../notifications/outbox.js';
import {
  ScheduleConflictError,
  computeMetrics,
  conflictMessage,
  findConflicts,
  findMeeting,
  isExclusionViolation,
  monthCounts,
  toMeetingDto,
  type MeetingRow,
} from './service.js';

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
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

const SELECT_MEETING = `
  SELECT m.id, m.title, m.responsible_name, m.starts_at, m.ends_at, m.description,
         m.observations, m.status, m.created_by_user_id,
         u.full_name   AS created_by_name,
         u.username    AS created_by_username,
         u.avatar_path AS created_by_avatar,
         au.full_name  AS updated_by_name,
         m.created_at, m.updated_at, m.cancelled_at,
         cu.full_name  AS cancelled_by_name,
         m.department_id,
         d.name        AS department_name,
         d.color_key   AS department_color_key
    FROM meetings m
    JOIN users u ON u.id = m.created_by_user_id
    LEFT JOIN departments d ON d.id = m.department_id
    LEFT JOIN users au ON au.id = m.updated_by_user_id
    LEFT JOIN users cu ON cu.id = m.cancelled_by_user_id`;

/**
 * Valida o setor informado para uma reunião (V2 §6): precisa existir e estar
 * ativo. Reuniões antigas com setor desativado continuam legíveis — a checagem
 * vale apenas para novos vínculos/alterações.
 */
async function requireActiveDepartment(departmentId: string): Promise<{ id: string; name: string }> {
  const department = await queryOne<{ id: string; name: string; is_active: boolean }>(
    'SELECT id, name, is_active FROM departments WHERE id = $1',
    [departmentId],
  );
  if (!department) throw httpError(400, 'VALIDATION', 'Setor da reunião não existe.');
  if (!department.is_active) {
    throw httpError(400, 'VALIDATION', `O setor "${department.name}" está inativo. Reative-o ou escolha outro setor.`);
  }
  return department;
}

function mailDataOf(row: MeetingRow): {
  id: string;
  title: string;
  responsibleName: string;
  startsAt: Date;
  endsAt: Date;
  description: string;
  observations: string | null;
  createdByName: string;
  createdAt: Date;
  departmentName?: string | null;
} {
  return {
    id: row.id,
    title: row.title,
    responsibleName: row.responsible_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    description: row.description,
    observations: row.observations,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    departmentName: row.department_name,
  };
}

const FIELD_LABELS: Record<string, string> = {
  title: 'assunto',
  responsible_name: 'responsável',
  starts_at: 'data/hora de início',
  ends_at: 'data/hora de término',
  description: 'descrição',
  observations: 'observações',
  department_id: 'setor da reunião',
};

export default async function meetingRoutes(app: FastifyInstance): Promise<void> {
  /* --------------------------- MÉTRICAS --------------------------- */
  app.get('/api/v1/dashboard/meeting-metrics', async (request, reply) => {
    const user = requireAuth(request);
    const q = request.query as { month?: string };
    const month = /^\d{4}-\d{2}$/.test(q.month ?? '')
      ? (q.month as string)
      : new Date().toISOString().slice(0, 7);
    const metrics = await computeMetrics(user, month, env.APP_TIMEZONE);
    const { month: monthCount, ...rest } = metrics;
    await reply.send({ month, monthCount, ...rest });
  });

  app.get('/api/v1/dashboard/month-counts', async (request, reply) => {
    requireAuth(request);
    const q = request.query as { month?: string };
    const month = /^\d{4}-\d{2}$/.test(q.month ?? '')
      ? (q.month as string)
      : new Date().toISOString().slice(0, 7);
    const counts = await monthCounts(month, env.APP_TIMEZONE);
    await reply.send({ month, counts });
  });

  /* ------------------------- DISPONIBILIDADE ---------------------- */
  app.get('/api/v1/meetings/availability', async (request, reply) => {
    requireAuth(request);
    const q = parse(availabilityQuerySchema, request.query);
    const startsAt = zonedTimeToUtc(q.date, q.start, env.APP_TIMEZONE);
    const endsAt = zonedTimeToUtc(q.date, q.end, env.APP_TIMEZONE);

    if (endsAt <= startsAt) {
      await reply.send({
        date: q.date,
        start: q.start,
        end: q.end,
        available: false,
        conflicts: [],
        invalidRange: true,
      });
      return;
    }

    const conflicts = await findConflicts(startsAt, endsAt, q.excludeId);
    await reply.send({
      date: q.date,
      start: q.start,
      end: q.end,
      available: conflicts.length === 0,
      conflicts: conflicts.map((c) => ({
        id: c.id,
        title: c.title,
        startsAt: c.starts_at.toISOString(),
        endsAt: c.ends_at.toISOString(),
        responsibleName: c.responsible_name,
      })),
    });
  });

  /* ---------------------------- LISTA ----------------------------- */
  app.get('/api/v1/meetings', async (request, reply) => {
    const user = requireAuth(request);
    const q = parse(listMeetingsQuerySchema, request.query ?? {});
    const tz = env.APP_TIMEZONE;

    const where: string[] = [];
    const params: unknown[] = [];
    // O fuso ($n) só entra na consulta quando há filtros de data — evita
    // parâmetro órfão (bind com quantidade divergente → erro 08P01).
    let tzRef = '';
    if (q.from || q.to) {
      params.push(tz);
      tzRef = `$${params.length}`;
    }
    const push = (clause: string, value: unknown): void => {
      params.push(value);
      where.push(clause.replace('?', `$${params.length}`));
    };

    if (q.from) push(`m.starts_at >= (?::date)::timestamp AT TIME ZONE ${tzRef}`, q.from);
    if (q.to) push(`m.starts_at < ((?::date) + interval '1 day')::timestamp AT TIME ZONE ${tzRef}`, q.to);
    if (q.status && q.status !== 'ALL') push('m.status = ?', q.status);
    if (q.createdByMe === 'true') push('m.created_by_user_id = ?', user.id);
    if (q.departmentId) push('m.department_id = ?', q.departmentId);
    if (q.q) {
      params.push(`%${q.q}%`);
      const idx = params.length;
      where.push(`(m.title ILIKE $${idx} OR m.responsible_name ILIKE $${idx} OR u.full_name ILIKE $${idx})`);
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 100;

    const countSql = `SELECT count(*)::int AS n FROM meetings m JOIN users u ON u.id = m.created_by_user_id ${whereSql}`;
    // LIMIT/OFFSET validados acima (inteiros) — interpolados como literais seguros.
    const listSql = `${SELECT_MEETING} ${whereSql} ORDER BY m.starts_at ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

    const [countRes, listRes] = await Promise.all([
      queryOne<{ n: number }>(countSql, params),
      queryMany<MeetingRow>(listSql, params),
    ]);

    await reply.send({
      items: listRes.map((r) => toMeetingDto(r, user)),
      total: countRes?.n ?? 0,
      page,
      pageSize,
    });
  });

  /* ---------------------------- DETALHE --------------------------- */
  app.get('/api/v1/meetings/:id', async (request, reply) => {
    const user = requireAuth(request);
    const { id } = request.params as { id: string };
    const row = await findMeeting(id);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Reunião não encontrada.');
    await reply.send({ meeting: toMeetingDto(row, user) });
  });

  /* ---------------------------- CRIAÇÃO --------------------------- */
  app.post('/api/v1/meetings', async (request, reply) => {
    const user = requireAuth(request);
    const body = parse(createMeetingSchema, request.body);

    const startsAt = zonedTimeToUtc(body.date, body.start, env.APP_TIMEZONE);
    const endsAt = zonedTimeToUtc(body.date, body.end, env.APP_TIMEZONE);

    if (endsAt <= startsAt) {
      throw httpError(400, 'VALIDATION', 'A hora de término deve ser posterior à hora de início.');
    }
    if (startsAt.getTime() <= Date.now()) {
      throw httpError(400, 'VALIDATION', 'Não é possível agendar uma reunião com início no passado.');
    }

    const department = await requireActiveDepartment(body.departmentId);

    const conflicts = await findConflicts(startsAt, endsAt);
    if (conflicts.length > 0) {
      throw new ScheduleConflictError(conflictMessage(conflicts), conflicts);
    }

    let created: MeetingRow;
    let queued: number;

    try {
      const result = await withTransaction(async (client) => {
        const ins = await client.query<MeetingRow>(
          `INSERT INTO meetings
             (title, responsible_name, starts_at, ends_at, description, observations,
              created_by_user_id, updated_by_user_id, department_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8)
           RETURNING id, title, responsible_name, starts_at, ends_at, description, observations,
                     status, created_by_user_id, created_at, updated_at, cancelled_at,
                     department_id`,
          [
            body.title,
            body.responsibleName,
            startsAt.toISOString(),
            endsAt.toISOString(),
            body.description,
            body.observations?.trim() ? body.observations.trim() : null,
            user.id,
            department.id,
          ],
        );
        const row = ins.rows[0];
        if (!row) throw new Error('Falha ao gravar a reunião.');

        // Preenche os campos de autoria que o RETURNING simplificado não traz.
        const full = await client.query<MeetingRow>(
          `${SELECT_MEETING} WHERE m.id = $1`,
          [row.id],
        );
        const meeting = full.rows[0];
        if (!meeting) throw new Error('Falha ao ler a reunião gravada.');

        const enq = await enqueueMeetingEvent(client, {
          eventType: 'MEETING_CREATED',
          kind: 'created',
          meetingId: meeting.id,
          eventKey: `created:${meeting.id}`,
          meeting: mailDataOf(meeting),
          baseUrl: env.APP_BASE_URL,
        });

        return { meeting, queued: enq.queued };
      });
      created = result.meeting;
      queued = result.queued;
    } catch (err) {
      if (isExclusionViolation(err)) {
        const again = await findConflicts(startsAt, endsAt);
        throw new ScheduleConflictError(conflictMessage(again), again);
      }
      throw err;
    }

    await audit({
      actor: user,
      action: 'MEETING_CREATED',
      entityType: 'meeting',
      entityId: created.id,
      entityLabel: created.title,
      metadata: {
        startsAt: created.starts_at.toISOString(),
        endsAt: created.ends_at.toISOString(),
        responsible: created.responsible_name,
        departmentId: department.id,
        department: department.name,
        notifications: queued,
      },
    });

    wakeWorker();
    await reply.code(201).send({ meeting: toMeetingDto(created, user), notificationsQueued: queued });
  });

  /* ---------------------------- EDIÇÃO ---------------------------- */
  const handleUpdate = async (
    request: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
  ): Promise<void> => {
    const user = requireAuth(request);
    const { id } = request.params as { id: string };
    const body = parse(updateMeetingSchema, request.body);

    const existing = await findMeeting(id);
    if (!existing) throw httpError(404, 'NOT_FOUND', 'Reunião não encontrada.');
    if (!canManageMeeting(user, { createdByUserId: existing.created_by_user_id })) {
      throw httpError(403, 'FORBIDDEN', 'Somente quem agendou a reunião ou um administrador pode alterá-la.');
    }

    const currentStart = existing.starts_at;
    const currentEnd = existing.ends_at;
    let startsAt = currentStart;
    let endsAt = currentEnd;

    if (body.date || body.start || body.end) {
      const dateStr =
        body.date ??
        new Intl.DateTimeFormat('en-CA', {
          timeZone: env.APP_TIMEZONE,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(currentStart);
      const startStr = body.start ?? new Intl.DateTimeFormat('en-GB', {
        timeZone: env.APP_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(currentStart);
      const endStr =
        body.end ??
        new Intl.DateTimeFormat('en-GB', {
          timeZone: env.APP_TIMEZONE,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(currentEnd);

      startsAt = zonedTimeToUtc(dateStr, startStr, env.APP_TIMEZONE);
      endsAt = zonedTimeToUtc(dateStr, endStr, env.APP_TIMEZONE);

      if (endsAt <= startsAt) {
        throw httpError(400, 'VALIDATION', 'A hora de término deve ser posterior à hora de início.');
      }
    }

    const timeChanged =
      startsAt.getTime() !== currentStart.getTime() || endsAt.getTime() !== currentEnd.getTime();

    if (timeChanged) {
      const conflicts = await findConflicts(startsAt, endsAt, existing.id);
      if (conflicts.length > 0) {
        throw new ScheduleConflictError(conflictMessage(conflicts), conflicts);
      }
    }

    const nextTitle = body.title ?? existing.title;
    const nextResponsible = body.responsibleName ?? existing.responsible_name;
    const nextDescription = body.description ?? existing.description;
    const nextObservations =
      body.observations !== undefined
        ? body.observations.trim()
          ? body.observations.trim()
          : null
        : existing.observations;

    // Setor: validado apenas quando enviado (V2 §6 — setor inativo bloqueado).
    let nextDepartmentId = existing.department_id;
    if (body.departmentId !== undefined && body.departmentId !== existing.department_id) {
      const department = await requireActiveDepartment(body.departmentId);
      nextDepartmentId = department.id;
    }

    const changed: string[] = [];
    if (nextTitle !== existing.title) changed.push('title');
    if (nextResponsible !== existing.responsible_name) changed.push('responsible_name');
    if (nextDescription !== existing.description) changed.push('description');
    if ((nextObservations ?? null) !== (existing.observations ?? null)) changed.push('observations');
    if (nextDepartmentId !== existing.department_id) changed.push('department_id');
    if (timeChanged) {
      if (startsAt.getTime() !== currentStart.getTime()) changed.push('starts_at');
      if (endsAt.getTime() !== currentEnd.getTime()) changed.push('ends_at');
    }

    if (changed.length === 0) {
      await reply.send({ meeting: toMeetingDto(existing, user), notificationsQueued: 0, changed: [] });
      return;
    }

    let updated: MeetingRow;
    let queued: number;

    try {
      const result = await withTransaction(async (client) => {
        const upd = await client.query<{ id: string }>(
          `UPDATE meetings
              SET title = $2, responsible_name = $3, starts_at = $4, ends_at = $5,
                  description = $6, observations = $7, department_id = $9,
                  updated_by_user_id = $8, updated_at = now()
            WHERE id = $1
            RETURNING id`,
          [id, nextTitle, nextResponsible, startsAt.toISOString(), endsAt.toISOString(),
           nextDescription, nextObservations, user.id, nextDepartmentId],
        );
        if ((upd.rowCount ?? 0) === 0) throw httpError(404, 'NOT_FOUND', 'Reunião não encontrada.');

        const full = await client.query<MeetingRow>(`${SELECT_MEETING} WHERE m.id = $1`, [id]);
        const meeting = full.rows[0];
        if (!meeting) throw new Error('Falha ao ler a reunião atualizada.');

        const enq = await enqueueMeetingEvent(client, {
          eventType: 'MEETING_UPDATED',
          kind: 'updated',
          meetingId: meeting.id,
          eventKey: `updated:${meeting.id}:${meeting.updated_at.toISOString()}`,
          meeting: { ...mailDataOf(meeting), changedFields: changed.map((c) => FIELD_LABELS[c] ?? c) },
          baseUrl: env.APP_BASE_URL,
        });

        return { meeting, queued: enq.queued };
      });
      updated = result.meeting;
      queued = result.queued;
    } catch (err) {
      if (isExclusionViolation(err)) {
        const again = await findConflicts(startsAt, endsAt, existing.id);
        throw new ScheduleConflictError(conflictMessage(again), again);
      }
      throw err;
    }

    await audit({
      actor: user,
      action: 'MEETING_UPDATED',
      entityType: 'meeting',
      entityId: id,
      entityLabel: updated.title,
      metadata: { changed, notifications: queued },
    });

    wakeWorker();
    await reply.send({
      meeting: toMeetingDto(updated, user),
      notificationsQueued: queued,
      changed: changed.map((c) => FIELD_LABELS[c] ?? c),
    });
  };

  app.route({ method: ['PATCH', 'PUT'], url: '/api/v1/meetings/:id', handler: handleUpdate });

  /* --------------------- CANCELAMENTO / EXCLUSÃO ------------------- */
  app.delete('/api/v1/meetings/:id', async (request, reply) => {
    const user = requireAuth(request);
    const { id } = request.params as { id: string };

    const existing = await findMeeting(id);
    if (!existing) throw httpError(404, 'NOT_FOUND', 'Reunião não encontrada.');
    if (!canManageMeeting(user, { createdByUserId: existing.created_by_user_id })) {
      throw httpError(403, 'FORBIDDEN', 'Somente quem agendou a reunião ou um administrador pode excluí-la.');
    }
    if (existing.status === 'CANCELLED') {
      throw httpError(409, 'ALREADY_CANCELLED', 'Esta reunião já está cancelada.');
    }

    const { meeting: cancelled, queued } = await withTransaction(async (client) => {
      const upd = await client.query<{ id: string }>(
        `UPDATE meetings
            SET status = 'CANCELLED', cancelled_at = now(), cancelled_by_user_id = $2, updated_at = now()
          WHERE id = $1 AND status = 'SCHEDULED'
          RETURNING id`,
        [id, user.id],
      );
      if ((upd.rowCount ?? 0) === 0) {
        throw httpError(409, 'ALREADY_CANCELLED', 'Esta reunião já está cancelada.');
      }

      const full = await client.query<MeetingRow>(`${SELECT_MEETING} WHERE m.id = $1`, [id]);
      const meeting = full.rows[0];
      if (!meeting) throw new Error('Falha ao ler a reunião cancelada.');

      const enq = await enqueueMeetingEvent(client, {
        eventType: 'MEETING_CANCELLED',
        kind: 'cancelled',
        meetingId: meeting.id,
        eventKey: `cancelled:${meeting.id}`,
        meeting: mailDataOf(meeting),
        baseUrl: env.APP_BASE_URL,
      });

      return { meeting, queued: enq.queued };
    });

    await audit({
      actor: user,
      action: 'MEETING_CANCELLED',
      entityType: 'meeting',
      entityId: id,
      entityLabel: cancelled.title,
      metadata: { notifications: queued },
    });

    wakeWorker();
    await reply.send({
      meeting: toMeetingDto(cancelled, user),
      notificationsQueued: queued,
      message: 'Reunião cancelada. O horário voltou a ficar disponível.',
    });
  });
}
