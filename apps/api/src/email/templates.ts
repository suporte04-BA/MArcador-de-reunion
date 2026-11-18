import {
  DEFAULT_TIMEZONE,
  durationText,
  formatFullDateBR,
  formatDateBR,
  minutesBetween,
  utcToZonedTimeStr,
} from '@agenda/shared';

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BRAND = {
  name: 'BA Elétrica',
  product: 'Agenda BA',
  accent: '#1d4ed8',
  accentSoft: '#2563eb',
  dark: '#0b1b33',
  darkSoft: '#123a6b',
  text: '#1e293b',
  muted: '#64748b',
  border: '#e2e8f0',
  surface: '#f8fafc',
};

function ctaButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px;">
    <tr><td bgcolor="${BRAND.accent}" style="background-color:${BRAND.accent};padding:12px 22px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(href)}" style="height:42px;v-text-anchor:middle;width:220px;" arcsize="12%" stroke="f" fillcolor="${BRAND.accent}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">${escapeHtml(label)}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;border-radius:8px;background-color:${BRAND.accent};">${escapeHtml(label)}</a><!--<![endif]-->
    </td></tr>
  </table>`;
}

function summaryTable(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:9px 0;color:${BRAND.muted};font-size:13px;width:150px;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:9px 0;color:${BRAND.text};font-size:14px;font-weight:600;vertical-align:top;">${value}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="1" bgcolor="${BRAND.surface}" style="width:100%;border-collapse:collapse;background-color:${BRAND.surface};border:1px solid ${BRAND.border};margin:0 0 8px;mso-padding-alt:6px 16px;">
    <tr><td style="padding:6px 16px;mso-padding-alt:6px 16px;">${body}</td></tr>
  </table>`;
}

type LayoutOptions = {
  preheader: string;
  heading: string;
  introHtml: string;
  contentHtml: string;
  ctaLabel?: string;
  ctaHref?: string;
  footerNote: string;
  logoHtml: string;
};

function layout(opts: LayoutOptions): string {
  const cta =
    opts.ctaLabel && opts.ctaHref ? ctaButton(opts.ctaLabel, opts.ctaHref) : '';
  return `<!DOCTYPE html>
<html lang="pt-BR" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
<o:AllowPNG/>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<![endif]-->
<title>${escapeHtml(opts.heading)}</title>
<style>
  body { margin:0; padding:0; background:#eef1f6; font-family:Arial,Helvetica,sans-serif; -webkit-text-size-adjust:100%; mso-line-height-rule:exactly; }
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; height:auto; line-height:100%; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
</style>
</head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;mso-line-height-rule:exactly;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f6;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid ${BRAND.border};">
  <tr><td bgcolor="${BRAND.dark}" style="background-color:${BRAND.dark};padding:22px 28px;">
    ${opts.logoHtml}
    <div style="color:#93c5fd;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:10px;font-weight:bold;mso-line-height-rule:exactly;">${escapeHtml(BRAND.product)}</div>
  </td></tr>
  <tr><td style="padding:28px;">
    <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:${BRAND.dark};mso-line-height-rule:exactly;">${escapeHtml(opts.heading)}</h1>
    <div style="color:${BRAND.text};font-size:14px;line-height:1.6;mso-line-height-rule:exactly;">${opts.introHtml}</div>
    ${opts.contentHtml}
    ${cta}
    <p style="color:${BRAND.muted};font-size:13px;line-height:1.6;margin:18px 0 0;mso-line-height-rule:exactly;">${escapeHtml(opts.footerNote)}</p>
  </td></tr>
  <tr><td bgcolor="${BRAND.surface}" style="background-color:${BRAND.surface};border-top:1px solid ${BRAND.border};padding:16px 28px;color:${BRAND.muted};font-size:12px;line-height:1.6;mso-line-height-rule:exactly;">
    <strong style="color:${BRAND.text};">${escapeHtml(BRAND.name)}</strong> — Agenda Corporativa<br>
    Mensagem enviada automaticamente pelo sistema de agendamento.
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function logoHtmlBlock(available: boolean): string {
  if (!available) {
    return `<div style="color:#ffffff;font-size:24px;font-weight:bold;letter-spacing:-0.5px;mso-line-height-rule:exactly;">${escapeHtml(BRAND.name)}</div>`;
  }
  return `<img src="cid:logo" alt="${escapeHtml(BRAND.name)}" width="170" height="104" border="0" style="display:block;border:0;height:auto;max-width:170px;" />`;
}

function textRule(): string {
  return '----------------------------------------';
}

export type MeetingMailData = {
  id: string;
  title: string;
  responsibleName: string;
  startsAt: Date;
  endsAt: Date;
  description: string;
  observations: string | null;
  createdByName: string;
  createdAt: Date;
  /** Setor da reunião (V2 §6) — exibido em todas as notificações. */
  departmentName?: string | null;
  changedFields?: string[];
  cancelledAt?: Date | null;
};

function meetingRows(m: MeetingMailData): Array<[string, string]> {
  const dateStr = formatFullDateBR(zonedDateStr(m.startsAt));
  const start = utcToZonedTimeStr(m.startsAt, DEFAULT_TIMEZONE);
  const end = utcToZonedTimeStr(m.endsAt, DEFAULT_TIMEZONE);
  const duration = durationText(minutesBetween(m.startsAt, m.endsAt));
  return [
    ['Assunto', escapeHtml(m.title)],
    ['Data', escapeHtml(dateStr)],
    ['Início', `${escapeHtml(start)} (fuso ${DEFAULT_TIMEZONE})`],
    ['Término', escapeHtml(end)],
    ['Duração', escapeHtml(duration)],
    ['Responsável', escapeHtml(m.responsibleName)],
    ['Setor', escapeHtml(m.departmentName ?? '—')],
    ['Agendado por', escapeHtml(m.createdByName)],
  ];
}

function formatWhen(m: MeetingMailData): string {
  return `${formatFullDateBR(zonedDateStr(m.startsAt))}, ${utcToZonedTimeStr(m.startsAt, DEFAULT_TIMEZONE)}–${utcToZonedTimeStr(m.endsAt, DEFAULT_TIMEZONE)}`;
}

/** Constrói a data de parede correta no fuso da aplicação. */
function zonedDateStr(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return p;
}

function meetingSummaryText(m: MeetingMailData): string {
  return [
    `Assunto:        ${m.title}`,
    `Data:           ${formatFullDateBR(zonedDateStr(m.startsAt))}`,
    `Início:         ${utcToZonedTimeStr(m.startsAt, DEFAULT_TIMEZONE)}`,
    `Término:        ${utcToZonedTimeStr(m.endsAt, DEFAULT_TIMEZONE)}`,
    `Duração:        ${durationText(minutesBetween(m.startsAt, m.endsAt))}`,
    `Responsável:    ${m.responsibleName}`,
    `Setor:          ${m.departmentName ?? '—'}`,
    `Agendado por:   ${m.createdByName}`,
  ].join('\n');
}

export function renderMeetingEmail(
  kind: 'created' | 'updated' | 'cancelled' | 'reminder',
  m: MeetingMailData,
  recipient: { fullName: string },
  baseUrl: string,
  logoAvailableFlag: boolean,
): RenderedEmail {
  const meetingUrl = `${baseUrl}/?reuniao=${encodeURIComponent(m.id)}`;
  const when = formatWhen(m);

  const config = {
    created: {
      subject: `Nova reunião agendada: ${m.title}`,
      heading: 'Nova reunião agendada',
      preheader: `${m.title} — ${when}`,
      intro: `Olá, <strong>${escapeHtml(recipient.fullName)}</strong>. Uma nova reunião foi agendada na agenda compartilhada da ${escapeHtml(BRAND.name)}.`,
      note: 'Você recebeu este e-mail porque é um usuário ativo da Agenda BA. Todas as reuniões da empresa são comunicadas a todos os usuários ativos.',
      cta: 'Ver reunião na Agenda BA',
    },
    updated: {
      subject: `Reunião alterada: ${m.title}`,
      heading: 'Reunião alterada',
      preheader: `${m.title} — ${when}`,
      intro: `Olá, <strong>${escapeHtml(recipient.fullName)}</strong>. A reunião abaixo teve alterações em seus dados ou horário.`,
      note: 'Você recebeu este e-mail porque é um usuário ativo da Agenda BA. Confira os dados atualizados antes da reunião.',
      cta: 'Ver reunião na Agenda BA',
    },
    cancelled: {
      subject: `Reunião cancelada: ${m.title}`,
      heading: 'Reunião cancelada',
      preheader: `${m.title} — ${when}`,
      intro: `Olá, <strong>${escapeHtml(recipient.fullName)}</strong>. A reunião abaixo foi cancelada e o horário voltou a ficar disponível na agenda.`,
      note: 'Você recebeu este e-mail porque é um usuário ativo da Agenda BA.',
      cta: 'Abrir a agenda',
    },
    reminder: {
      subject: `Lembrete: reunião hoje — ${m.title}`,
      heading: 'Lembrete de reunião hoje',
      preheader: `${m.title} — ${when}`,
      intro: `Olá, <strong>${escapeHtml(recipient.fullName)}</strong>. Lembrete: você tem uma reunião agendada para <strong>hoje</strong>.`,
      note: 'Você recebeu este e-mail porque é um usuário ativo da Agenda BA. Confira os detalhes abaixo e prepare-se para a reunião.',
      cta: 'Ver reunião na Agenda BA',
    },
  }[kind];

  const changedHtml = m.changedFields?.length
    ? `<p style="color:${BRAND.text};font-size:14px;margin:16px 0 6px;"><strong>Campos alterados:</strong> ${escapeHtml(m.changedFields.join(', '))}.</p>`
    : '';

  const descriptionHtml = m.description
    ? `<p style="color:${BRAND.text};font-size:14px;margin:16px 0 4px;"><strong>Descrição</strong></p>
       <p style="color:${BRAND.text};font-size:14px;line-height:1.6;margin:0 0 8px;">${escapeHtml(m.description).replace(/\n/g, '<br>')}</p>`
    : '';

  const observationsHtml = m.observations
    ? `<p style="color:${BRAND.text};font-size:14px;margin:14px 0 4px;"><strong>Observações</strong></p>
       <p style="color:${BRAND.text};font-size:14px;line-height:1.6;margin:0;">${escapeHtml(m.observations).replace(/\n/g, '<br>')}</p>`
    : '';

  const whenCard = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.accent}" style="width:100%;border-collapse:collapse;background-color:${BRAND.accent};margin:0 0 14px;mso-padding-alt:16px 18px;">
    <tr><td style="padding:16px 18px;color:#ffffff;mso-padding-alt:16px 18px;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85;font-weight:bold;mso-line-height-rule:exactly;">Quando</div>
      <div style="font-size:18px;font-weight:bold;margin-top:4px;mso-line-height-rule:exactly;">${escapeHtml(formatFullDateBR(zonedDateStr(m.startsAt)))}</div>
      <div style="font-size:14px;margin-top:2px;opacity:0.95;mso-line-height-rule:exactly;">${escapeHtml(utcToZonedTimeStr(m.startsAt, DEFAULT_TIMEZONE))} - ${escapeHtml(utcToZonedTimeStr(m.endsAt, DEFAULT_TIMEZONE))} (${escapeHtml(durationText(minutesBetween(m.startsAt, m.endsAt)))})</div>
    </td></tr>
  </table>`;

  const html = layout({
    preheader: config.preheader,
    heading: config.heading,
    introHtml: config.intro,
    logoHtml: logoHtmlBlock(logoAvailableFlag),
    contentHtml: `
      ${changedHtml}
      ${whenCard}
      ${summaryTable(meetingRows(m))}
      ${descriptionHtml}
      ${observationsHtml}
      <p style="color:${BRAND.muted};font-size:13px;margin:16px 0 0;">Horário de referência: ${escapeHtml(when)}.</p>`,
    ctaLabel: config.cta,
    ctaHref: meetingUrl,
    footerNote: config.note,
  });

  const lines: string[] = [
    config.heading.toUpperCase(),
    textRule(),
    config.intro.replace(/<[^>]+>/g, ''),
    '',
    meetingSummaryText(m),
  ];
  if (m.changedFields?.length) {
    lines.push('', `Campos alterados: ${m.changedFields.join(', ')}.`);
  }
  if (m.description) lines.push('', 'Descrição:', m.description);
  if (m.observations) lines.push('', 'Observações:', m.observations);
  lines.push(
    '',
    `Horário de referência: ${when}.`,
    '',
    `Abrir na Agenda BA: ${meetingUrl}`,
    textRule(),
    config.note,
    `${BRAND.name} — ${BRAND.product}`,
    baseUrl,
  );
  const text = lines.join('\n');

  return { subject: config.subject, text, html };
}

export function renderInviteEmail(
  user: { fullName: string; username: string; email: string },
  token: string,
  baseUrl: string,
  logoAvailableFlag: boolean,
): RenderedEmail {
  const activateUrl = `${baseUrl}/?convite=${encodeURIComponent(token)}`;
  const heading = 'Ative seu acesso à Agenda BA';
  const html = layout({
    preheader: `Olá ${user.fullName}, ative seu acesso à agenda`,
    heading,
    introHtml: `Olá, <strong>${escapeHtml(user.fullName)}</strong>. Um acesso foi criado para você na agenda corporativa da ${escapeHtml(BRAND.name)}.`,
    logoHtml: logoHtmlBlock(logoAvailableFlag),
    contentHtml: summaryTable([
      ['Nome de usuário', escapeHtml(user.username)],
      ['E-mail', escapeHtml(user.email)],
      ['Perfil', user.username ? 'Conforme cadastrado pelo administrador' : '—'],
    ]),
    ctaLabel: 'Ativar meu acesso',
    ctaHref: activateUrl,
    footerNote:
      'Este link é de uso único e expira em 72 horas. Se você não solicitou este acesso, ignore esta mensagem. Por segurança, nenhuma senha é enviada por e-mail: você definerá a sua própria senha no primeiro acesso.',
  });

  const text = [
    heading.toUpperCase(),
    textRule(),
    `Olá ${user.fullName},`,
    '',
    'Um acesso foi criado para você na agenda corporativa da BA Elétrica.',
    '',
    `Nome de usuário: ${user.username}`,
    `E-mail:         ${user.email}`,
    '',
    `Ativar meu acesso: ${activateUrl}`,
    '',
    'O link é de uso único e expira em 72 horas. Nenhuma senha é enviada por e-mail:',
    'você irá definir a sua própria senha ao ativar o acesso.',
    textRule(),
    `${BRAND.name} — ${BRAND.product}`,
    baseUrl,
  ].join('\n');

  return { subject: `Ative seu acesso — ${BRAND.product}`, text, html };
}

/**
 * E-mail de boas-vindas enviado quando o administrador cadastra um usuário
 * (Revisão V2 §3.4 item 6/7). NÃO contém senha, token nem link de ativação:
 * a conta já nasce ativa e o acesso é feito com o usuário + senha definidos.
 */
export function renderWelcomeEmail(
  user: { fullName: string; username: string; email: string },
  departmentName: string,
  baseUrl: string,
  logoAvailableFlag: boolean,
): RenderedEmail {
  const heading = 'Cadastro realizado na Agenda BA';
  const html = layout({
    preheader: `Olá ${user.fullName}, seu acesso à agenda corporativa está ativo`,
    heading,
    introHtml: `Olá, <strong>${escapeHtml(user.fullName)}</strong>. Seu acesso à agenda corporativa da ${escapeHtml(BRAND.name)} foi cadastrado e já está ativo.`,
    logoHtml: logoHtmlBlock(logoAvailableFlag),
    contentHtml: summaryTable([
      ['Nome de usuário', escapeHtml(user.username)],
      ['E-mail', escapeHtml(user.email)],
      ['Setor', escapeHtml(departmentName)],
      ['Situação', 'Ativo — login liberado'],
    ]),
    ctaLabel: 'Abrir a Agenda BA',
    ctaHref: baseUrl,
    footerNote:
      'Por segurança, nenhuma senha é enviada por e-mail. Use o nome de usuário acima e a senha definida para acessar o sistema. Se você não solicitou este cadastro, ignore esta mensagem.',
  });

  const text = [
    'CADASTRO REALIZADO NA AGENDA BA',
    textRule(),
    `Olá ${user.fullName},`,
    '',
    'Seu acesso à agenda corporativa da BA Elétrica foi cadastrado e já está ativo.',
    '',
    `Nome de usuário: ${user.username}`,
    `E-mail:         ${user.email}`,
    `Setor:          ${departmentName}`,
    'Situação:       Ativo — login liberado',
    '',
    `Abrir a agenda: ${baseUrl}`,
    '',
    'Por segurança, nenhuma senha é enviada por e-mail.',
    textRule(),
    `${BRAND.name} — ${BRAND.product}`,
    baseUrl,
  ].join('\n');

  return { subject: `Seu acesso está ativo — ${BRAND.product}`, text, html };
}

export function renderPasswordResetEmail(
  user: { fullName: string; username: string },
  token: string,
  baseUrl: string,
  logoAvailableFlag: boolean,
): RenderedEmail {
  const resetUrl = `${baseUrl}/?redefinir=${encodeURIComponent(token)}`;
  const heading = 'Redefinição de senha';
  const html = layout({
    preheader: 'Solicitação de redefinição de senha',
    heading,
    introHtml: `Olá, <strong>${escapeHtml(user.fullName)}</strong>. Recebemos uma solicitação para redefinir a senha da sua conta (<strong>${escapeHtml(user.username)}</strong>).`,
    logoHtml: logoHtmlBlock(logoAvailableFlag),
    contentHtml: `<p style="color:${BRAND.text};font-size:14px;line-height:1.6;margin:14px 0 0;">Se foi você, use o botão abaixo para escolher uma nova senha. O link expira em <strong>60 minutos</strong> e pode ser usado uma única vez.</p>`,
    ctaLabel: 'Redefinir minha senha',
    ctaHref: resetUrl,
    footerNote:
      'Se você não solicitou esta redefinição, ignore esta mensagem: sua senha continua a atual. Nunca compartilhe este link.',
  });

  const text = [
    heading.toUpperCase(),
    textRule(),
    `Olá ${user.fullName},`,
    '',
    'Recebemos uma solicitação para redefinir a senha da sua conta.',
    `Usuário: ${user.username}`,
    '',
    `Redefinir: ${resetUrl}`,
    'O link expira em 60 minutos e é de uso único.',
    '',
    'Se você não solicitou esta redefinição, ignore esta mensagem.',
    textRule(),
    `${BRAND.name} — ${BRAND.product}`,
    baseUrl,
  ].join('\n');

  return { subject: `Redefinição de senha — ${BRAND.product}`, text, html };
}

export function renderTestEmail(
  recipient: { fullName: string; email: string },
  baseUrl: string,
  logoAvailableFlag: boolean,
  requestedBy: string,
): RenderedEmail {
  const heading = 'Teste de e-mail';
  const html = layout({
    preheader: 'Mensagem de teste solicitada pelo administrador',
    heading,
    introHtml: `Olá, <strong>${escapeHtml(recipient.fullName)}</strong>. Esta é uma mensagem de teste do canal de e-mail da <strong>${escapeHtml(BRAND.name)}</strong>.`,
    logoHtml: logoHtmlBlock(logoAvailableFlag),
    contentHtml: summaryTable([
      ['Destinatário', escapeHtml(recipient.email)],
      ['Solicitado por', escapeHtml(requestedBy)],
      ['Sistema', 'Agenda BA — canal transacional'],
      ['Status', 'Mensagem de teste enviada com sucesso'],
    ]),
    ctaLabel: 'Abrir a Agenda BA',
    ctaHref: baseUrl,
    footerNote:
      'Esta mensagem foi solicitada pelo administrador do sistema para validar o envio. Nenhuma ação é necessária.',
  });

  const text = [
    'TESTE DE E-MAIL',
    textRule(),
    `Olá ${recipient.fullName},`,
    '',
    'Esta é uma mensagem de teste do canal de e-mail da BA Elétrica.',
    '',
    `Destinatário:   ${recipient.email}`,
    `Solicitado por: ${requestedBy}`,
    `Sistema:        Agenda BA — canal transacional`,
    '',
    `Abrir a agenda: ${baseUrl}`,
    textRule(),
    'Mensagem solicitada pelo administrador. Nenhuma ação é necessária.',
    `${BRAND.name} — ${BRAND.product}`,
  ].join('\n');

  return { subject: `Teste de e-mail — ${BRAND.product}`, text, html };
}

/* ---------------------------- anexo .ics ---------------------------- */

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function foldIcsLine(line: string): string {
  // RFC 5545: linhas com mais de 75 octetos devem ser quebradas.
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const char of line) {
    const b = Buffer.byteLength(char, 'utf8');
    if (currentBytes + b > 73) {
      parts.push(current);
      current = ' ' + char;
      currentBytes = 1 + b;
    } else {
      current += char;
      currentBytes += b;
    }
  }
  if (current) parts.push(current);
  return parts.join('\r\n');
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Gera anexo .ics em UTC (evita dependência de definição de VTIMEZONE). */
export function renderIcs(m: MeetingMailData, organizerEmail: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//BA Eletrica//Agenda BA//PT-BR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${m.id}@agenda-ba.local`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(m.startsAt)}`,
    `DTEND:${utcStamp(m.endsAt)}`,
    `SUMMARY:${icsEscape(m.title)}`,
    `DESCRIPTION:${icsEscape(`${m.description}${m.observations ? `\n\nObservações: ${m.observations}` : ''}`)}`,
    `LOCATION:${icsEscape('Agenda BA — reunião interna')}`,
    `ORGANIZER;CN=${icsEscape(m.createdByName)}:mailto:${icsEscape(organizerEmail)}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

export function icsAttachment(m: MeetingMailData, organizerEmail: string): {
  filename: string;
  content: Buffer;
  contentType: string;
} {
  return {
    filename: 'reuniao.ics',
    content: Buffer.from(renderIcs(m, organizerEmail), 'utf8'),
    contentType: 'text/calendar; charset=utf-8',
  };
}

/** Data curta dd/mm/aaaa a partir de um Date no fuso da aplicação. */
export function shortDateBr(d: Date): string {
  const [y, m, day] = zonedDateStr(d).split('-');
  return `${day}/${m}/${y}`;
}

export { formatDateBR };
