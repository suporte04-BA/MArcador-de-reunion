import type pg from 'pg';
import { env } from '../../config/env.js';
import { pool, query, queryOne } from '../../config/db.js';
import { sendMail, logoAttachment, logoAvailable, type MailAttachment } from '../../email/mailer.js';
import {
  renderInviteEmail,
  renderMeetingEmail,
  renderPasswordResetEmail,
  renderTestEmail,
  renderWelcomeEmail,
  type MeetingMailData,
} from '../../email/templates.js';

type Client = Pick<pg.Pool | pg.PoolClient, 'query'>;

export type EnqueueResult = { queued: number; skipped: number };

function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(env.SMTP_PASS, '***')
    .replace(env.RESEND_API_KEY, '***')
    .replace(/(\/\/[^:\s]+:)[^@\s]+@/g, '$1***@')
    .slice(0, 400);
}

/**
 * Grava uma linha na outbox na MESMA transação da reunião.
 * A chave de idempotência impede duplicação em retries da própria gravação.
 */
async function enqueueOne(
  client: Client,
  row: {
    eventType: string;
    eventKey: string;
    meetingId?: string | null;
    recipientUserId: string;
    recipientEmail: string;
    recipientName: string;
    subject: string;
    text: string;
    html: string;
  },
): Promise<boolean> {
  const res = await client.query(
    `INSERT INTO notification_outbox
       (event_type, meeting_id, event_key, recipient_user_id,
        recipient_email_snapshot, recipient_name_snapshot,
        subject, text_body, html_body, status, next_attempt_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING', now())
     ON CONFLICT (event_key, recipient_user_id) DO NOTHING
     RETURNING id`,
    [
      row.eventType,
      row.meetingId ?? null,
      row.eventKey,
      row.recipientUserId,
      row.recipientEmail,
      row.recipientName,
      row.subject,
      row.text,
      row.html,
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

async function activeRecipients(client: Client): Promise<Array<{ id: string; fullName: string; email: string }>> {
  const r = await client.query<{ id: string; full_name: string; email: string }>(
    `SELECT id, full_name, email FROM users WHERE status = 'ACTIVE' ORDER BY full_name`,
  );
  return r.rows.map((u) => ({ id: u.id, fullName: u.full_name, email: u.email }));
}

/** Notifica todos os usuários ativos sobre um evento de reunião. */
export async function enqueueMeetingEvent(
  client: Client,
  params: {
    eventType: 'MEETING_CREATED' | 'MEETING_UPDATED' | 'MEETING_CANCELLED' | 'MEETING_REMINDER';
    kind: 'created' | 'updated' | 'cancelled' | 'reminder';
    meetingId: string;
    eventKey: string;
    meeting: MeetingMailData;
    baseUrl: string;
  },
): Promise<EnqueueResult> {
  const recipients = await activeRecipients(client);
  const logo = logoAvailable();
  let queued = 0;
  let skipped = 0;

  for (const r of recipients) {
    const rendered = renderMeetingEmail(params.kind, params.meeting, { fullName: r.fullName }, params.baseUrl, logo);
    const ok = await enqueueOne(client, {
      eventType: params.eventType,
      eventKey: params.eventKey,
      meetingId: params.meetingId,
      recipientUserId: r.id,
      recipientEmail: r.email,
      recipientName: r.fullName,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    if (ok) queued += 1;
    else skipped += 1;
  }

  return { queued, skipped };
}

/** Envia um e-mail único para um destinatário específico (convite, teste, redefinição). */
export async function enqueueSingleEmail(
  client: Client,
  params: {
    eventType: 'INVITE' | 'WELCOME' | 'TEST_EMAIL' | 'PASSWORD_RESET';
    eventKey: string;
    recipientUserId: string;
    recipientEmail: string;
    recipientName: string;
    subject: string;
    text: string;
    html: string;
    meetingId?: string | null;
  },
): Promise<EnqueueResult> {
  const ok = await enqueueOne(client, params);
  return { queued: ok ? 1 : 0, skipped: ok ? 0 : 1 };
}

export function buildInviteEmail(
  user: { fullName: string; username: string; email: string },
  token: string,
  baseUrl: string,
) {
  return renderInviteEmail(user, token, baseUrl, logoAvailable());
}

/** Boas-vindas do cadastro feito pelo administrador (sem senha/token). */
export function buildWelcomeEmail(
  user: { fullName: string; username: string; email: string },
  departmentName: string,
  baseUrl: string,
) {
  return renderWelcomeEmail(user, departmentName, baseUrl, logoAvailable());
}

export function buildPasswordResetEmail(
  user: { fullName: string; username: string },
  token: string,
  baseUrl: string,
) {
  return renderPasswordResetEmail(user, token, baseUrl, logoAvailable());
}

export function buildTestEmail(
  recipient: { fullName: string; email: string },
  baseUrl: string,
  requestedBy: string,
) {
  return renderTestEmail(recipient, baseUrl, logoAvailable(), requestedBy);
}

/* --------------------------- Worker de envio --------------------------- */

export type ProcessResult = {
  sent: number;
  failed: number;
  retried: number;
  skipped: number;
};

function backoffSeconds(attempt: number): number {
  const base = env.EMAIL_RETRY_BASE_SECONDS;
  const value = base * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(value, 60 * 60 * 60);
}

/**
 * Processa um lote da outbox com `FOR UPDATE SKIP LOCKED`,
 * garantindo que duas instâncias não enviem a mesma mensagem.
 */
export async function processOutbox(limit = 10): Promise<ProcessResult> {
  const result: ProcessResult = { sent: 0, failed: 0, retried: 0, skipped: 0 };

  const claimed = await pool.query<{
    id: string;
    event_type: string;
    recipient_email_snapshot: string;
    subject: string;
    text_body: string;
    html_body: string;
    attempt_count: number;
    meeting_id: string | null;
  }>(
    `UPDATE notification_outbox
        SET status = 'SENDING', updated_at = now(), attempt_count = attempt_count + 1
      WHERE id IN (
        SELECT id FROM notification_outbox
         WHERE status IN ('PENDING','RETRYING')
           AND next_attempt_at <= now()
         ORDER BY next_attempt_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, event_type, recipient_email_snapshot, subject, text_body, html_body,
                attempt_count, meeting_id`,
    [limit],
  );

  for (const row of claimed.rows) {
    // Logo oficial via CID (o HTML referencia cid:logo) + anexo .ics para
    // eventos de reunião. Sem o anexo, clientes de e-mail exibiriam imagem
    // quebrada — a logo precisa viajar na mensagem.
    const attachments: MailAttachment[] = [...logoAttachment()];
    if (row.meeting_id && row.event_type.startsWith('MEETING_')) {
      attachments.push(...(await loadIcsAttachment(row.meeting_id)));
    }

    const send = await sendMail({
      to: row.recipient_email_snapshot,
      subject: row.subject,
      text: row.text_body,
      html: row.html_body,
      attachments: attachments.length ? attachments : undefined,
    });

    if (send.ok) {
      await query(
        `UPDATE notification_outbox
            SET status = 'SENT', sent_at = now(), provider_message_id = $2,
                last_error = NULL, updated_at = now()
          WHERE id = $1`,
        [row.id, send.providerMessageId ?? null],
      );
      result.sent += 1;
    } else {
      const attempt = row.attempt_count;
      const permanent =
        attempt >= env.EMAIL_RETRY_MAX_ATTEMPTS ||
        /Invalid login|Authentication failed|550 5\.1\.1|does not exist|You can only send testing emails|Invalid `from`|sem registros MX|inexistente \(sem DNS/i.test(send.error ?? '');

      if (permanent) {
        await query(
          `UPDATE notification_outbox
              SET status = 'FAILED', last_error = $2, updated_at = now()
            WHERE id = $1`,
          [row.id, send.error ?? 'erro desconhecido'],
        );
        result.failed += 1;
      } else {
        const delay = backoffSeconds(attempt);
        await query(
          `UPDATE notification_outbox
              SET status = 'RETRYING', last_error = $2,
                  next_attempt_at = now() + ($3 || ' seconds')::interval,
                  updated_at = now()
            WHERE id = $1`,
          [row.id, send.error ?? 'erro desconhecido', String(delay)],
        );
        result.retried += 1;
      }
    }
  }

  return result;
}

async function loadIcsAttachment(
  meetingId: string,
): Promise<Array<{ filename: string; content: Buffer; path?: string; contentType?: string; cid?: string }>> {
  const meeting = await queryOne<{
    id: string;
    title: string;
    responsible_name: string;
    starts_at: Date;
    ends_at: Date;
    description: string;
    observations: string | null;
    created_by_name: string;
    organizer_email: string;
  }>(
    `SELECT m.id, m.title, m.responsible_name, m.starts_at, m.ends_at, m.description,
            m.observations, u.full_name AS created_by_name, u.email AS organizer_email
       FROM meetings m JOIN users u ON u.id = m.created_by_user_id
      WHERE m.id = $1`,
    [meetingId],
  );
  if (!meeting) return [];

  const { icsAttachment } = await import('../../email/templates.js');
  const ics = icsAttachment(
    {
      id: meeting.id,
      title: meeting.title,
      responsibleName: meeting.responsible_name,
      startsAt: meeting.starts_at,
      endsAt: meeting.ends_at,
      description: meeting.description,
      observations: meeting.observations,
      createdByName: meeting.created_by_name,
      createdAt: meeting.starts_at,
    },
    meeting.organizer_email,
  );

  return [{ filename: ics.filename, content: ics.content, contentType: ics.contentType }];
}

/** Loop contínuo do worker (iniciado pelo servidor). */
export function startOutboxWorker(intervalMs = 10_000): { stop: () => void } {
  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const r = await processOutbox(10);
      if (r.sent || r.failed || r.retried) {
        console.log(
          `[OUTBOX] enviado=${r.sent} reagendado=${r.retried} falhou=${r.failed}`,
        );
      }
    } catch (err) {
      console.error('[OUTBOX] erro no worker:', sanitizeError(err));
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();

  // Primeiro processamento imediato.
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/** Acorda o worker imediatamente após uma inserção. */
export function wakeWorker(): void {
  void processOutbox(20).catch((err) => console.error('[OUTBOX] erro ao acordar:', sanitizeError(err)));
}

/** Estatísticas para o painel do administrador. */
export async function outboxStats(): Promise<{
  pending: number;
  sending: number;
  sent: number;
  retrying: number;
  failed: number;
  recent: Array<{
    id: string;
    eventType: string;
    recipientName: string;
    recipientEmail: string;
    status: string;
    attemptCount: number;
    lastError: string | null;
    providerMessageId: string | null;
    sentAt: Date | null;
    createdAt: Date;
  }>;
}> {
  const counts = await query<{ status: string; n: number }>(
    'SELECT status, count(*)::int AS n FROM notification_outbox GROUP BY status',
  );
  const map = new Map(counts.rows.map((r) => [r.status, r.n]));

  const recent = await query<{
    id: string;
    event_type: string;
    recipient_name_snapshot: string;
    recipient_email_snapshot: string;
    status: string;
    attempt_count: number;
    last_error: string | null;
    provider_message_id: string | null;
    sent_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, event_type, recipient_name_snapshot, recipient_email_snapshot, status,
            attempt_count, last_error, provider_message_id, sent_at, created_at
       FROM notification_outbox
      ORDER BY created_at DESC
      LIMIT 25`,
  );

  return {
    pending: map.get('PENDING') ?? 0,
    sending: map.get('SENDING') ?? 0,
    sent: map.get('SENT') ?? 0,
    retrying: map.get('RETRYING') ?? 0,
    failed: map.get('FAILED') ?? 0,
    recent: recent.rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      recipientName: r.recipient_name_snapshot,
      recipientEmail: r.recipient_email_snapshot,
      status: r.status,
      attemptCount: r.attempt_count,
      lastError: r.last_error,
      providerMessageId: r.provider_message_id,
      sentAt: r.sent_at,
      createdAt: r.created_at,
    })),
  };
}

export { logoAttachment };
