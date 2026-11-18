import fs from 'node:fs';
import dns from 'node:dns/promises';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { env, smtpConfigured, resendConfigured, emailFromAddress, emailFromName, BRAND_DIR } from '../config/env.js';

export const LOGO_PATH = path.join(BRAND_DIR, 'logo-ba.png');

let transporter: Transporter | null = null;
let logoLoaded = false;

function getLogoBase64(): string | null {
  if (logoLoaded) return logoBase64;
  logoLoaded = true;
  try {
    if (fs.existsSync(LOGO_PATH)) {
      logoBase64 = fs.readFileSync(LOGO_PATH).toString('base64');
    }
  } catch (err) {
    console.error('[EMAIL] Falha ao carregar logo:', err instanceof Error ? err.message : err);
  }
  return logoBase64;
}
let logoBase64: string | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTLS: env.SMTP_REQUIRE_TLS,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: env.SMTP_SECURE || env.SMTP_REQUIRE_TLS ? { minVersion: 'TLSv1.2' } : undefined,
  });
  return transporter;
}

export type SendResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
};

export type MailAttachment = {
  filename: string;
  content?: Buffer | string;
  path?: string;
  contentType?: string;
  cid?: string;
};

/**
 * Envia uma mensagem pelo SMTP configurado.
 * Não lança: retorna o resultado sanitizado para a outbox.
 */
/** True quando existe algum provedor de e-mail configurado (SMTP ou Resend). */
export const emailConfigured = smtpConfigured || resendConfigured;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/**
 * Envia uma mensagem pelo provedor configurado (Resend HTTP ou SMTP).
 * Não lança: retorna o resultado sanitizado para a outbox.
 *
 * Anti-spam:
 *  - valida o formato do destinatário antes de tentar enviar (evita bounces);
 *  - adiciona headers de rastreabilidade (Message-ID gerado pelo provedor,
 *    Reply-To, X-Mailer) e evita cabeçalhos de "bulk";
 *  - from usa um endereço de domínio verificado (Resend) ou configurado.
 */
export async function sendMail(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
  headers?: Record<string, string>;
}): Promise<SendResult> {
  const recipient = options.to.trim();
  if (!isValidEmail(recipient)) {
    return { ok: false, error: `Destinatário inválido: "${recipient}".` };
  }

  // Anti-spam / anti-bounce: verifica se o domínio do destinatário possui
  // registros MX. E-mails para domínios inexistentes geram bounces e prejudicam
  // a reputação do remetente; abortamos antes de tentar o envio.
  const domain = (recipient.split('@')[1] ?? '').trim();
  if (domain && env.NODE_ENV !== 'test') {
    try {
      const mx = await dns.resolveMx(domain);
      if (!mx || mx.length === 0) {
        return { ok: false, error: `Domínio "${domain}" sem registros MX (e-mail inexistente).` };
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code ?? '';
      if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN' || code === 'SERVFAIL') {
        return { ok: false, error: `Domínio "${domain}" inexistente (sem DNS/MX).` };
      }
      // Outros erros de DNS (timeout transitório): não bloqueia, segue o envio.
    }
  }

  const fromAddress = emailFromAddress;
  const fromName = emailFromName;
  const replyTo = fromAddress;

  const antiSpamHeaders: Record<string, string> = {
    'X-Mailer': 'Agenda BA',
    'X-Priority': '3',
    'Importance': 'normal',
    ...(options.headers ?? {}),
  };

  // ---------- Provedor Resend (API HTTP) ----------
  if (resendConfigured) {
    try {
      const attachments = (options.attachments ?? [])
        .filter((a) => a.content || a.path)
        .map((a) => ({
          filename: a.filename,
          content: a.content
            ? Buffer.isBuffer(a.content)
              ? a.content.toString('base64')
              : Buffer.from(String(a.content)).toString('base64')
            : undefined,
          ...(a.cid ? { content_id: a.cid } : {}),
        }));

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${fromName} <${fromAddress}>`,
          to: [recipient],
          subject: options.subject,
          text: options.text,
          html: options.html,
          reply_to: replyTo,
          headers: antiSpamHeaders,
          ...(attachments.length ? { attachments } : {}),
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (res.ok) {
        return { ok: true, providerMessageId: data.id };
      }
      // Resend falhou: se for erro permanente (modo teste, domínio não verificado),
      // não tenta fallback (evita spam/bounce). Caso contrário, tenta SMTP.
      const msg = data.message || data.name || `HTTP ${res.status}`;
      const permanent = /You can only send testing emails|Invalid `from`|domain.*not.*verif/i.test(msg);
      if (permanent || !smtpConfigured) {
        return { ok: false, error: `Resend: ${msg}`.slice(0, 500) };
      }
      // Fallback para SMTP
      console.warn('[EMAIL] Resend falhou, tentando SMTP:', msg);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (!smtpConfigured) {
        return { ok: false, error: `Resend: ${raw}`.replace(env.RESEND_API_KEY, '***').slice(0, 500) };
      }
      console.warn('[EMAIL] Resend exceção, tentando SMTP:', raw);
    }
  }

  // ---------- Provedor SMTP (nodemailer) — fallback ou principal ----------
  if (!smtpConfigured) {
    return { ok: false, error: 'Nenhum provedor de e-mail configurado (SMTP_HOST ou RESEND_API_KEY).' };
  }

  try {
    const info = await getTransporter().sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: recipient,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
      headers: { ...antiSpamHeaders, ...(options.headers ?? {}) },
      replyTo: replyTo,
    });
    return { ok: true, providerMessageId: info.messageId ?? undefined };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const sanitized = raw
      .replace(env.SMTP_PASS, '***')
      .replace(env.RESEND_API_KEY, '***')
      .replace(/(\/\/[^:\s]+:)[^@\s]+@/g, '$1***@')
      .slice(0, 500);
    return { ok: false, error: sanitized };
  }
}

/** Verifica a conexão com o provedor de e-mail (não envia mensagem real). */
export async function verifyEmailConnection(): Promise<{ ok: boolean; error?: string }> {
  if (resendConfigured) {
    try {
      const res = await fetch('https://api.resend.com/domains', {
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}` },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        return { ok: false, error: `Resend: ${data.message || `HTTP ${res.status}`}` };
      }
      return { ok: true };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return { ok: false, error: raw.replace(env.RESEND_API_KEY, '***').slice(0, 500) };
    }
  }
  if (!smtpConfigured) return { ok: false, error: 'Nenhum provedor de e-mail configurado.' };
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return { ok: false, error: raw.replace(env.SMTP_PASS, '***').slice(0, 500) };
  }
}

/** Alias de compatibilidade (rotas antigas). */
export const verifySmtpConnection = verifyEmailConnection;

/** Anexo da logo oficial em CID (evita depender de URL acessível). */
export function logoAttachment(): MailAttachment[] {
  const b64 = getLogoBase64();
  if (!b64) return [];
  return [
    {
      filename: 'logo-ba.png',
      content: Buffer.from(b64, 'base64'),
      contentType: 'image/png',
      cid: 'logo',
    },
  ];
}

export function logoAvailable(): boolean {
  return getLogoBase64() !== null;
}

export function describeSmtpConfig(): {
  mode: 'resend' | 'smtp' | 'disabled';
  host: string;
  port: number;
  secure: boolean;
  from: string;
  fromName: string;
  auth: boolean;
} {
  return {
    mode: resendConfigured ? 'resend' : smtpConfigured ? 'smtp' : 'disabled',
    host: resendConfigured ? 'api.resend.com' : (env.SMTP_HOST || '(não configurado)'),
    port: resendConfigured ? 443 : env.SMTP_PORT,
    secure: true,
    from: emailFromAddress,
    fromName: emailFromName,
    auth: resendConfigured || Boolean(env.SMTP_USER),
  };
}
