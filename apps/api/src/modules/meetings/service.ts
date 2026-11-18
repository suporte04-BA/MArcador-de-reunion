import type pg from 'pg';
import {
  DEFAULT_TIMEZONE,
  intervalsOverlap,
  avatarUrlOf,
  minutesBetween,
} from '@agenda/shared';
import { env } from '../../config/env.js';
import { query, queryOne } from '../../config/db.js';

export type MeetingRow = {
  id: string;
  title: string;
  responsible_name: string;
  starts_at: Date;
  ends_at: Date;
  description: string;
  observations: string | null;
  status: 'SCHEDULED' | 'CANCELLED';
  created_by_user_id: string;
  created_by_name: string;
  created_by_username: string;
  created_by_avatar: string | null;
  updated_by_name: string | null;
  created_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  cancelled_by_name: string | null;
  /** Setor da reunião (V2 §6) — setor inativo continua visível no histórico. */
  department_id: string | null;
  department_name: string | null;
  department_color_key: string | null;
};

export type MeetingDto = {
  id: string;
  title: string;
  responsibleName: string;
  startsAt: string;
  endsAt: string;
  description: string;
  observations: string | null;
  status: 'SCHEDULED' | 'CANCELLED';
  createdByUserId: string;
  createdByName: string;
  createdByUsername: string;
  createdByAvatarUrl: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  canManage: boolean;
  departmentId: string | null;
  departmentName: string | null;
  departmentColorKey: string | null;
};

export const SELECT_MEETING = `
  SELECT m.id, m.title, m.responsible_name, m.starts_at, m.ends_at, m.description,
         m.observations, m.status, m.created_by_user_id,
         u.full_name  AS created_by_name,
         u.username   AS created_by_username,
         u.avatar_path AS created_by_avatar,
         au.full_name AS updated_by_name,
         m.created_at, m.updated_at, m.cancelled_at,
         cu.full_name AS cancelled_by_name,
         m.department_id,
         d.name       AS department_name,
         d.color_key  AS department_color_key
    FROM meetings m
    JOIN users u  ON u.id  = m.created_by_user_id
    LEFT JOIN departments d ON d.id = m.department_id
    LEFT JOIN users au ON au.id = m.updated_by_user_id
    LEFT JOIN users cu ON cu.id = m.cancelled_by_user_id`;

export type SessionLike = { id: string; role: 'ADMIN' | 'USER' };

export function toMeetingDto(row: MeetingRow, user: SessionLike): MeetingDto {
  return {
    id: row.id,
    title: row.title,
    responsibleName: row.responsible_name,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    description: row.description,
    observations: row.observations,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdByUsername: row.created_by_username,
    createdByAvatarUrl: avatarUrlOf(row.created_by_avatar),
    updatedByName: row.updated_by_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
    cancelledByName: row.cancelled_by_name,
    canManage: user.role === 'ADMIN' || user.id === row.created_by_user_id,
    departmentId: row.department_id,
    departmentName: row.department_name,
    departmentColorKey: row.department_color_key,
  };
}

export async function findMeeting(id: string): Promise<MeetingRow | null> {
  return queryOne<MeetingRow>(`${SELECT_MEETING} WHERE m.id = $1`, [id]);
}

export type ConflictInfo = {
  id: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  responsible_name: string;
};

/**
 * Busca reuniões ativas que se sobrepõem ao intervalo informado.
 * Considera o buffer de preparação configurado (padrão 0).
 */
export async function findConflicts(
  startsAt: Date,
  endsAt: Date,
  excludeId?: string,
  client?: Pick<pg.Pool | pg.PoolClient, 'query'>,
): Promise<ConflictInfo[]> {
  const buffer = env.MEETING_BUFFER_MINUTES;
  const sql = `
    SELECT id, title, starts_at, ends_at, responsible_name
      FROM meetings
     WHERE status = 'SCHEDULED'
       AND tstzrange(starts_at - ($4 || ' minutes')::interval,
                     ends_at   + ($4 || ' minutes')::interval, '[)')
           && tstzrange($1::timestamptz, $2::timestamptz, '[)')
       AND ($3::uuid IS NULL OR id <> $3::uuid)
     ORDER BY starts_at`;

  const run = client ? client.query.bind(client) : query;
  const r = await run<ConflictInfo>(sql, [
    startsAt.toISOString(),
    endsAt.toISOString(),
    excludeId ?? null,
    String(buffer),
  ]);
  return r.rows;
}

/** Formata uma mensagem amigável de conflito. */
export function conflictMessage(conflicts: ConflictInfo[]): string {
  const first = conflicts[0];
  if (!first) return 'Este intervalo já está ocupado.';
  const fmt = (d: Date): string => {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: DEFAULT_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
    return p;
  };
  const when = `${fmt(first.starts_at)}–${fmt(first.ends_at)}`;
  if (conflicts.length === 1) {
    return `Horário ocupado: "${first.title}" (${when}) já está agendado neste período. Escolha outro horário.`;
  }
  return `Horário ocupado: ${conflicts.length} reuniões já cobrem este período (primeira: "${first.title}" às ${when}). Escolha outro horário.`;
}

/** Erro de domínio HTTP 409 para conflito de agenda. */
export class ScheduleConflictError extends Error {
  statusCode = 409;
  code = 'SCHEDULE_CONFLICT';
  conflicts: ConflictInfo[];
  constructor(message: string, conflicts: ConflictInfo[]) {
    super(message);
    this.name = 'ScheduleConflictError';
    this.conflicts = conflicts;
  }
}

/** Código PostgreSQL da exclusion constraint:23P01 = exclusion_violation. */
export function isExclusionViolation(err: unknown): boolean {
  const e = err as { code?: string; where?: string; detail?: string; message?: string };
  if (e?.code === '23P01') return true;
  // Duas transações simultâneas disputando a mesma faixa podem terminar em
  // deadlock (40P01) EXATAMENTE dentro da checagem da exclusion constraint —
  // o desfecho é o mesmo: sobreposição recusada, então responde 409.
  if (e?.code === '40P01') {
    const ctx = `${e.where ?? ''} ${e.detail ?? ''} ${e.message ?? ''}`;
    return /exclusion constraint/i.test(ctx);
  }
  return false;
}

/* ------------------------------ Métricas ------------------------------ */

export type MeetingMetricsDto = {
  today: number;
  todayNext: MeetingDto | null;
  upcoming: number;
  upcomingNext: MeetingDto | null;
  month: number;
  createdByMe: number;
  total: number;
  cancelled: number;
};

export async function computeMetrics(
  user: SessionLike,
  month: string,
  timezone: string = DEFAULT_TIMEZONE,
): Promise<MeetingMetricsDto> {
  const row = await queryOne<{
    today: number;
    upcoming: number;
    month_count: number;
    created_by_me: number;
    total: number;
    cancelled: number;
  }>(
    `WITH bounds AS (
       SELECT
         (($1 || '-01')::date)::timestamp AT TIME ZONE $2 AS month_start,
         ((($1 || '-01')::date + interval '1 month'))::timestamp AT TIME ZONE $2 AS month_end,
         date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2 AS today_start,
         (date_trunc('day', now() AT TIME ZONE $2) + interval '1 day') AT TIME ZONE $2 AS today_end
     )
     SELECT
       (SELECT count(*) FROM meetings, bounds
         WHERE status = 'SCHEDULED' AND starts_at >= today_start AND starts_at < today_end)::int AS today,
       (SELECT count(*) FROM meetings, bounds
         WHERE status = 'SCHEDULED' AND starts_at >= now())::int AS upcoming,
       (SELECT count(*) FROM meetings, bounds
         WHERE status = 'SCHEDULED' AND starts_at >= month_start AND starts_at < month_end)::int AS month_count,
       (SELECT count(*) FROM meetings, bounds
         WHERE status = 'SCHEDULED' AND created_by_user_id = $3
           AND starts_at >= month_start AND starts_at < month_end)::int AS created_by_me,
       (SELECT count(*) FROM meetings WHERE status = 'SCHEDULED')::int AS total,
       (SELECT count(*) FROM meetings WHERE status = 'CANCELLED')::int AS cancelled`,
    [month, timezone, user.id],
  );

  const todayNextRow = await queryOne<MeetingRow>(
    `${SELECT_MEETING}
      WHERE m.status = 'SCHEDULED'
        AND m.starts_at >= (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1)
        AND m.starts_at <  ((date_trunc('day', now() AT TIME ZONE $1) + interval '1 day') AT TIME ZONE $1)
      ORDER BY m.starts_at ASC LIMIT 1`,
    [timezone],
  );

  const upcomingNextRow = await queryOne<MeetingRow>(
    `${SELECT_MEETING}
      WHERE m.status = 'SCHEDULED' AND m.starts_at >= now()
      ORDER BY m.starts_at ASC LIMIT 1`,
    [],
  );

  return {
    today: row?.today ?? 0,
    todayNext: todayNextRow ? toMeetingDto(todayNextRow, user) : null,
    upcoming: row?.upcoming ?? 0,
    upcomingNext: upcomingNextRow ? toMeetingDto(upcomingNextRow, user) : null,
    month: row?.month_count ?? 0,
    createdByMe: row?.created_by_me ?? 0,
    total: row?.total ?? 0,
    cancelled: row?.cancelled ?? 0,
  };
}

/* ------------------------- Agendas por dia ------------------------- */

export type DayItemDto = {
  id: string;
  title: string;
  responsibleName: string;
  startsAt: string;
  endsAt: string;
  status: 'SCHEDULED' | 'CANCELLED';
  createdByName: string;
  createdByAvatarUrl: string | null;
  canManage: boolean;
};

/** Contagem de reuniões por dia de um mês (para o mini calendário). */
export async function monthCounts(
  month: string,
  timezone: string = DEFAULT_TIMEZONE,
): Promise<Record<string, number>> {
  const rows = await query<{ day: string; n: number }>(
    `SELECT to_char(starts_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day, count(*)::int AS n
       FROM meetings
      WHERE status = 'SCHEDULED'
        AND starts_at >= ((($1 || '-01')::date)::timestamp AT TIME ZONE $2)
        AND starts_at <  (((($1 || '-01')::date) + interval '1 month')::timestamp AT TIME ZONE $2)
      GROUP BY 1`,
    [month, timezone],
  );
  const out: Record<string, number> = {};
  for (const r of rows.rows) out[r.day] = r.n;
  return out;
}

export function durationMinutes(startsAt: Date, endsAt: Date): number {
  return minutesBetween(startsAt, endsAt);
}

export { intervalsOverlap };
