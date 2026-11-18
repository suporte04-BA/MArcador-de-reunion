import { env } from '../../config/env.js';
import { queryMany, withTransaction } from '../../config/db.js';
import { enqueueMeetingEvent } from '../notifications/outbox.js';
import { wakeWorker } from '../notifications/outbox.js';
import { SELECT_MEETING } from '../meetings/service.js';
import type { MeetingRow } from '../meetings/service.js';

function mailDataOf(row: MeetingRow) {
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

export async function enqueueTodayReminders(): Promise<number> {
  const tz = env.APP_TIMEZONE;
  const rows = await queryMany<MeetingRow>(
    `${SELECT_MEETING}
       WHERE m.status = 'SCHEDULED'
         AND (m.starts_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date`,
    [tz],
  );

  let queued = 0;
  for (const row of rows) {
    try {
      const result = await withTransaction(async (client) => {
        const enq = await enqueueMeetingEvent(client, {
          eventType: 'MEETING_REMINDER',
          kind: 'reminder',
          meetingId: row.id,
          eventKey: `reminder:${row.id}`,
          meeting: mailDataOf(row),
          baseUrl: env.APP_BASE_URL,
        });
        return enq.queued;
      });
      if (result > 0) {
        queued += result;
        wakeWorker();
      }
    } catch (err) {
      console.error('[REMINDER] falha ao enfileirar lembrete:', row.id, err);
    }
  }
  if (queued > 0) {
    console.log(`[REMINDER] ${queued} lembrete(s) enfileirado(s) para hoje.`);
  }
  return queued;
}

export function startReminderScheduler(intervalMs = 60 * 60 * 1000): { stop: () => void } {
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await enqueueTodayReminders();
    } catch (err) {
      console.error('[REMINDER] erro no scheduler:', err);
    }
  };
  const first = setTimeout(() => void tick(), 30_000);
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  first.unref?.();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(first);
    },
  };
}
