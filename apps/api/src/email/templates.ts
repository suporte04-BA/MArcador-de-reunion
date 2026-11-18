import {
  DEFAULT_TIMEZONE,
  durationText,
  formatFullDateBR,
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
  name: 'BA ElÃ©trica',
  product: 'Agenda BA',
  accent: '#2563eb',
  accentLight: '#3b82f6',
  accentDark: '#1e40af',
  dark: '#0f172a',
  darkMid: '#1e293b',
  text: '#1e293b',
  muted: '#64748b',
  border: '#cbd5e1',
  surface: '#f8fafc',
  cardBg: '#ffffff',
  highlight: '#eff6ff',
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
};

function ctaButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
    <tr><td bgcolor="${BRAND.accent}" style="background-color:${BRAND.accent};padding:0;mso-padding-alt:14px 28px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(href)}" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="8%" stroke="f" fillcolor="${BRAND.accent}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${escapeHtml(label)}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;border-radius:6px;background-color:${BRAND.accent};letter-spacing:0.3px;">${escapeHtml(label)}</a><!--<![endif]-->
    </td></tr>
  </table>`;
}

function infoRow(label: string, value: string, isLast: boolean): string {
  return `<tr>
    <td style="padding:10px 0 ${isLast ? '0' : '10px'};color:${BRAND.muted};font-size:13px;width:110px;vertical-align:top;border-bottom:${isLast ? 'none' : '1px solid ' + BRAND.border};">${escapeHtml(label)}</td>
    <td style="padding:10px 0 ${isLast ? '0' : '10px'};color:${BRAND.text};font-size:14px;font-weight:600;vertical-align:top;border-bottom:${isLast ? 'none' : '1px solid ' + BRAND.border};">${value}</td>
  </tr>`;
}

function summaryTable(rows: Array<[string, string]>): string {
  const body = rows.map(([label, value], i) => infoRow(label, value, i === rows.length - 1)).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.cardBg}" style="width:100%;max-width:600px;border-collapse:collapse;background-color:${BRAND.cardBg};border:1px solid ${BRAND.border};margin:0 0 8px;mso-cellspacing:0;">
    <tr><td style="padding:4px 20px 4px 20px;mso-padding-alt:4px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="mso-cellspacing:0;">
        ${body}
      </table>
    </td></tr>
  </table>`;
}

function sectionBlock(title: string, content: string, accentColor: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 8px;mso-cellspacing:0;">
    <tr><td style="padding:0 0 6px 0;">
      <div style="font-size:12px;font-weight:bold;color:${accentColor};text-transform:uppercase;letter-spacing:1.5px;mso-line-height-rule:exactly;">${escapeHtml(title)}</div>
    </td></tr>
    <tr><td style="padding:12px 16px;background-color:${BRAND.surface};border-left:3px solid ${accentColor};">
      <div style="color:${BRAND.text};font-size:14px;line-height:1.7;mso-line-height-rule:exactly;">${content}</div>
    </td></tr>
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
  body { margin:0; padding:0; background:#f1f5f9; font-family:Arial,Helvetica,sans-serif; -webkit-text-size-adjust:100%; mso-line-height-rule:exactly; }
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; height:auto; line-height:100%; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  h1 { margin:0; }
  a { color:${BRAND.accent}; }
</style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;mso-line-height-rule:exactly;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:32px 16px;mso-cellspacing:0;mso-padding-alt:32px 16px;">
<tr><td align="center">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #d1d5db;mso-cellspacing:0;">
  <!-- Accent bar -->
  <tr><td bgcolor="${BRAND.accent}" height="4" style="background-color:${BRAND.accent};height:4px;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>
  <!-- Header -->
  <tr><td bgcolor="${BRAND.dark}" style="background-color:${BRAND.dark};padding:24px 32px;">
    ${opts.logoHtml}
    <div style="color:#93c5fd;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;margin-top:12px;font-weight:bold;mso-line-height-rule:exactly;">${escapeHtml(BRAND.product)}</div>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:32px;">
    <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:${BRAND.dark};font-weight:bold;mso-line-height-rule:exactly;">${escapeHtml(opts.heading)}</h1>
    <div style="color:${BRAND.muted};font-size:13px;line-height:1.5;margin:0 0 20px;mso-line-height-rule:exactly;">${opts.introHtml}</div>
    ${opts.contentHtml}
    ${cta}
    <p style="color:${BRAND.muted};font-size:12px;line-height:1.6;margin:20px 0 0;mso-line-height-rule:exactly;">${escapeHtml(opts.footerNote)}</p>
  </td></tr>
  <!-- Footer -->
  <tr><td bgcolor="#f8fafc" style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;color:${BRAND.muted};font-size:12px;line-height:1.6;mso-line-height-rule:exactly;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="mso-cellspacing:0;">
      <tr>
        <td style="color:${BRAND.muted};font-size:12px;line-height:1.6;">
          <strong style="color:${BRAND.text};">${escapeHtml(BRAND.name)}</strong> &mdash; Agenda Corporativa
        </td>
        <td align="right" style="color:${BRAND.muted};font-size:11px;line-height:1.6;">
          Enviado automaticamente
        </td>
      </tr>
    </table>
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
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
  /** Setor da reuniÃ£o (V2 Â§6) â€” exibido em todas as notificaÃ§Ãµes. */
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
    ['InÃ­cio', `${escapeHtml(start)} (fuso ${DEFAULT_TIMEZONE})`],
    ['TÃ©rmino', escapeHtml(end)],
    ['DuraÃ§Ã£o', escapeHtml(duration)],
    ['ResponsÃ¡vel', escapeHtml(m.responsibleName)],
    ['Setor', escapeHtml(m.departmentName ?? 'â€”')],
    ['Agendado por', escapeHtml(m.createdByName)],
  ];
}

function formatWhen(m: MeetingMailData): string {
  return `${formatFullDateBR(zonedDateStr(m.startsAt))}, ${utcToZonedTimeStr(m.startsAt, DEFAULT_TIMEZONE)}â€“${utcToZonedTimeStr(m.endsAt, DEFAULT_TIMEZONE)}`;
}

/** ConstrÃ³i a data de parede correta no fuso da aplicaÃ§Ã£o. */
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
    `InÃ­cio:         ${utcToZonedTimeStr(m.startsAt, DEFAULT_TIMEZONE)}`,
    `TÃ©rmino:        ${utcToZonedTimeStr(m.endsAt, DEFAULT_TIMEZONE)}`,
    `DuraÃ§Ã£o:        ${durationText(minutesBetween(m.startsAt, m.endsAt))}`,
    `ResponsÃ¡vel:    ${m.responsibleName}`,
    `Setor:          ${m.departmentName ?? 'â€”'}`,
    `Agendado por:   ${m.createdByName}`,
  ].join('\\n');
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
      subject: `Nova reuniÃ£o agendada: ${m.title}`,
      heading: 'Nova reuniÃ£o agendada',
      preheader: `${m.title} â€” ${when}`,
      intro: `OlÃ¡, <strong>${escapeHtml(recipient.fullName)}</strong>. Uma nova reuniÃ£o foi agendada na agenda compartilhada da ${escapeHtml(BRAND.name)}.`,
      note: 'VocÃª recebeu este e-mail porque Ã© um usuÃ¡rio ativo da Agenda BA. Todas as reuniÃµes da empresa sÃ£o comunicadas a todos os usuÃ¡rios ativos.',
      cta: 'Ver reuniÃ£o na Agenda BA',
    },
    updated: {
      subject: `ReuniÃ£o alterada: ${m.title}`,
      heading: 'ReuniÃ£o alterada',
      preheader: `${m.title} â€” ${when}`,
      intro: `OlÃ¡, <strong>${escapeHtml(recipient.fullName)}</strong>. A reuniÃ£o abaixo teve alteraÃ§Ãµes em seus dados ou horÃ¡rio.`,
      note: 'VocÃª recebeu este e-mail porque Ã© um usuÃ¡rio ativo da Agenda BA. Confira os dados atualizados antes da reuniÃ£o.',
      cta: 'Ver reuniÃ£o na Agenda BA',
    },
    cancelled: {
      subject: `ReuniÃ£o cancelada: ${m.title}`,
      heading: 'ReuniÃ£o cancelada',
      preheader: `${m.title} â€” ${when}`,
      intro: `OlÃ¡, <strong>${escapeHtml(recipient.fullName)}</strong>. A reuniÃ£o abaixo foi cancelada e o horÃ¡rio voltou a ficar disponÃ­vel na agenda.`,
      note: 'VocÃª recebeu este e-mail porque Ã© um usuÃ¡rio ativo da Agenda BA.',
      cta: 'Abrir a agenda',
    },
    reminder: {
      subject: `Lembrete: reuniÃ£o hoje â€” ${m.title}`,
      heading: 'Lembrete de reuniÃ£o hoje',
      preheader: `${m.title} â€” ${when}`,
      intro: `OlÃ¡, <strong>${escapeHtml(recipient.fullName)}</strong>. Lembrete: vocÃª tem uma reuniÃ£o agendada para <strong>hoje</strong>.`,
      note: 'VocÃª recebeu este e-mail porque Ã© um usuÃ¡rio ativo da Agenda BA. Confira os detalhes abaixo e prepare-se para a reuniÃ£o.',
      cta: 'Ver reuniÃ£o na Agenda BA',
    },
  }[kind];

  const changedHtml = m.changedFields?.length
    ? `<p style="color:${BRAND.text};font-size:14px;margin:16px 0 6px;"><strong>Campos alterados:</strong> ${escapeHtml(m.changedFields.join(', '))}.</p>`
    : '';

  const descriptionHtml = m.description
    ? sectionBlock('DescriÃ§Ã£o', escapeHtml(m.description).replace(/\\n/g, '<br>'), BRAND.accent)
    : '';

  const observationsHtml = m.observations
    ? sectionBlock('ObservaÃ§Ãµes', escapeHtml(m.observations).replace(/\\n/g, '<br>'), BRAND.warning)
    : '';

  const whenCard = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.accent}" style="width:100%;max-width:600px;border-collapse:collapse;background-color:${BRAND.accent};margin:0 0 16px;mso-cellspacing:0;mso-padding-alt:20px 24px;">
    <tr><td style="padding:20px 24px;color:#ffffff;mso-padding-alt:20px 24px;">
      <div style="font-size:11px;letter-spacing:2.5px;text-transform:uppercase;opacity:0.8;font-weight:bold;mso-line-height-rule:exactly;">Quando</div>
      <div style="font-size:20px;font-weight:bold;margin-top:6px;mso-line-height-rule:exactly;">${escapeHtml(formatFullDateBR(zonedDateStr(m.startsAt)))}</div>
      <div style="font-size:14px;margin-top:4px;opacity:0.9;mso-line-height-rule:exactly;">${escapeHtml(utcToZonedTimeStr(m.startsAt, DEFAULT_TIMEZONE))} - ${escapeHtml(utcToZonedTimeStr(m.endsAt, DEFAULT_TIMEZONE))} &nbsp;(${escapeHtml(durationText(minutesBetween(m.startsAt, m.endsAt)))})</div>
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
      <p style="color:${BRAND.muted};font-size:12px;margin:16px 0 0;mso-line-height-rule:exactly;">HorÃ¡rio de referÃªncia: ${escapeHtml(when)}.</p>`,
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
  if (m.description) lines.push('', 'DescriÃ§Ã£o:', m.description);
  if (m.observations) lines.push('', 'ObservaÃ§Ãµes:', m.observations);
  lines.push(
    '',
    `HorÃ¡rio de referÃªncia: ${when}.`,
    '',
    `Abrir na Agenda BA: ${meetingUrl}`,
    textRule(),
    config.note,
    `${BRAND.name} â€” ${BRAND.product}`,
    baseUrl,
  );
  const text = lines.join('\\n');

  return { subject: config.subject, text, html };
}

export function renderInviteEmail(
  user: { fullName: string; username: string; email: string },
  token: string,
  baseUrl: string,
  logoAvailableFlag: boolean,
): RenderedEmail {
  const activateUrl = `${baseUrl}/?convite=${encodeURIComponent(token)}`;
  const heading = 'Ative seu acesso Ã  Agenda BA';
  const html = layout({
    preheader: `Ola ${user.fullName}, ative seu acesso a agenda`,
    heading,
    introHtml: `OlÃ¡, <strong>${escapeHtml(user.fullName)}</strong>. Um acesso foi criado para vocÃª na agenda corporativa da ${escapeHtml(BRAND.name)}.`,
    logoHtml: logoHtmlBlock(logoAvailableFlag),
    contentHtml: summaryTable([
      ['Nome de usuÃ¡rio', escapeHtml(user.username)],
      ['E-mail', escapeHtml(user.email)],
      ['Perfil', user.username ? 'Conforme cadastrado pelo administrador' : 'â€”'],
    ]),
    ctaLabel: 'Ativar meu acesso',
    ctaHref: activateUrl,
    footerNote:
      'Este link Ã© de uso Ãºnico e expira em 72 horas. Se vocÃª nÃ£o solicitou este acesso, ignore esta mensagem. Por seguranÃ§a, nenhuma senha Ã© enviada por e-mail: vocÃª definerÃ¡ a sua prÃ³pria senha no primeiro acesso.',
  });

  const text = [
    heading.toUpperCase(),
    textRule(),
    `OlÃ¡ ${user.fullName},`,
    '',
    'Um acesso foi criado para vocÃª na agenda corporativa da BA ElÃ©trica.',
    '',
    `Nome de usuÃ¡rio: ${user.username}`,
    `E-mail:         ${user.email}`,
    '',
    `Ativar meu acesso: ${activateUrl}`,
    '',
    'O link Ã© de uso Ãºnico e expira em 72 horas. Nenhuma senha Ã© enviada por e-mail:',
    'vocÃª irÃ¡ definir a sua prÃ³pria senha ao ativar o acesso.',
    textRule(),
    `${BRAND.name} â€” ${BRAND.product}`,
    baseUrl,
  ].join('\\n');

  return { subject: `Ative seu acesso â€” ${BRAND.product}`, text, html };
}

/**
 * E-mail de boas-vindas enviado quando o administrador cadastra um usuÃ¡rio
 * (RevisÃ£o V2 Â§3.4 item 6/7). NÃƒO contÃ©m senha, token nem link de ativaÃ§Ã£o:
 * a conta jÃ¡ nasce ativa e o acesso Ã© feito com o usuÃ¡rio + senha definidos.
 */
export function renderWelcomeEmail(
  user: { fullName: string; username: string; email: string },
  departmentName: string,
  baseUrl: string,
  logoAvailableFlag: boolean,
): RenderedEmail {
  const heading = 'Cadastro realizado na Agenda BA';
  const html = layout({
    preheader: `Ola ${user.fullName}, seu acesso a agenda corporativa esta ativo`,
    heading,
    introHtml: `Ola, <strong>${escapeHtml(user.fullName)}</strong>. Seu acesso a agenda corporativa da ${escapeHtml(BRAND.name)} foi cadastrado e ja esta ativo.`,
    logoHtml: logoHtmlBlock(logoAvailableFlag),
    contentHtml: summaryTable([
      ['Nome de usuÃ¡rio', escapeHtml(user.username)],
      ['E-mail', escapeHtml(user.email)],
      ['Setor', escapeHtml(departmentName)],
      ['SituaÃ§Ã£o', 'Ativo â€” login liberado'],
    ]),
    ctaLabel: 'Abrir a Agenda BA',
    ctaHref: baseUrl,
    footerNote:
      'Por seguranÃ§a, nenhuma senha Ã© enviada por e-mail. Use o nome de usuÃ¡rio acima e a senha definida para acessar o sistema. Se vocÃª nÃ£o solicitou este cadastro, ignore esta mensagem.',
  });

  const text = [
    'CADASTRO REALIZADO NA AGENDA BA',
    textRule(),
    `OlÃ¡ ${user.fullName},`,
    '',
    'Seu acesso Ã  agenda corporativa da BA ElÃ©trica foi cadastrado e jÃ¡ estÃ¡ ativo.',
    '',
    `Nome de usuÃ¡rio: ${user.username}`,
    `E-mail:         ${user.email}`,
    `Setor:          ${departmentName}`,
    'SituaÃ§Ã£o:       Ativo â€” login liberado',
    '',
    `Abrir a agenda: ${baseUrl}`,
    '',
    'Por seguranÃ§a, nenhuma senha Ã© enviada por e-mail.',
    textRule(),
    `${BRAND.name} â€” ${BRAND.product}`,
    baseUrl,
  ].join('\\n');

  return { subject: `Seu acesso estÃ¡ ativo â€” ${BRAND.product}`, text, html };
}

export function renderPasswordResetEmail(
  user: { fullName: string; username: string },
  token: string,
  baseUrl: string,
  logoAvailableFlag: boolean,
): RenderedEmail {
  const resetUrl = `${baseUrl}/?redefinir=${encodeURIComponent(token)}`;
  const heading = 'RedefiniÃ§Ã£o de senha';
  const html = layout({
    preheader: 'SolicitaÃ§Ã£o de redefiniÃ§Ã£o de senha',
    heading,
    introHtml: `OlÃ¡, <strong>${escapeHtml(user.fullName)}</strong>. Recebemos uma solicitaÃ§Ã£o para redefinir a senha da sua conta (<strong>${escapeHtml(user.username)}</strong>).`,
    logoHtml: logoHtmlBlock(logoAvailableFlag),
    contentHtml: `<p style="color:${BRAND.text};font-size:14px;line-height:1.6;margin:14px 0 0;">Se foi vocÃª, use o botÃ£o abaixo para escolher uma nova senha. O link expira em <strong>60 minutos</strong> e pode ser usado uma Ãºnica vez.</p>`,
    ctaLabel: 'Redefinir minha senha',
    ctaHref: resetUrl,
    footerNote:
      'Se vocÃª nÃ£o solicitou esta redefiniÃ§Ã£o, ignore esta mensagem: sua senha continua a atual. Nunca compartilhe este link.',
  });

  const text = [
    heading.toUpperCase(),
    textRule(),
    `OlÃ¡ ${user.fullName},`,
    '',
    'Recebemos uma solicitaÃ§Ã£o para redefinir a senha da sua conta.',
    `UsuÃ¡rio: ${user.username}`,
    '',
    `Redefinir: ${resetUrl}`,
    'O link expira em 60 minutos e Ã© de uso Ãºnico.',
    '',
    'Se vocÃª nÃ£o solicitou esta redefiniÃ§Ã£o, ignore esta mensagem.',
    textRule(),
    `${BRAND.name} â€” ${BRAND.product}`,
    baseUrl,
  ].join('\\n');

  return { subject: `RedefiniÃ§Ã£o de senha â€” ${BRAND.product}`, text, html };
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
    introHtml: `OlÃ¡, <strong>${escapeHtml(recipient.fullName)}</strong>. Esta Ã© uma mensagem de teste do canal de e-mail da <strong>${escapeHtml(BRAND.name)}</strong>.`,
    logoHtml: logoHtmlBlock(logoAvailableFlag),
    contentHtml: summaryTable([
      ['DestinatÃ¡rio', escapeHtml(recipient.email)],
      ['Solicitado por', escapeHtml(requestedBy)],
      ['Sistema', 'Agenda BA â€” canal transacional'],
      ['Status', 'Mensagem de teste enviada com sucesso'],
    ]),
    ctaLabel: 'Abrir a Agenda BA',
    ctaHref: baseUrl,
    footerNote:
      'Esta mensagem foi solicitada pelo administrador do sistema para validar o envio. Nenhuma aÃ§Ã£o Ã© necessÃ¡ria.',
  });

  const text = [
    'TESTE DE E-MAIL',
    textRule(),
    `OlÃ¡ ${recipient.fullName},`,
    '',
    'Esta Ã© uma mensagem de teste do canal de e-mail da BA ElÃ©trica.',
    '',
    `DestinatÃ¡rio:   ${recipient.email}`,
    `Solicitado por: ${requestedBy}`,
    `Sistema:        Agenda BA â€” canal transacional`,
    '',
    `Abrir a agenda: ${baseUrl}`,
    textRule(),
    'Mensagem solicitada pelo administrador. Nenhuma aÃ§Ã£o Ã© necessÃ¡ria.',
    `${BRAND.name} â€” ${BRAND.product}`,
  ].join('\\n');

  return { subject: `Teste de e-mail â€” ${BRAND.product}`, text, html };
}

/* ---------------------------- anexo .ics ---------------------------- */

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\\n/g, '\\\\n');
}

export function icsAttachment(m: MeetingMailData, organizerEmail: string): {
  filename: string;
  content: Buffer;
  contentType: string;
} {
  const uid = `${m.id}@agenda-ba`;
  const dtStart = m.startsAt.toISOString().replace(/[-:]/g, '').replace(/\\.\\d{3}/, '');
  const dtEnd = m.endsAt.toISOString().replace(/[-:]/g, '').replace(/\\.\\d{3}/, '');
  const summary = icsEscape(m.title);
  const description = icsEscape(m.description || '');
  const location = icsEscape(m.departmentName ?? '');
  const organizer = icsEscape(organizerEmail);

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Agenda BA//BA Eletrica//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStart}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    `ORGANIZER;CN=${icsEscape(m.createdByName)}:mailto:${icsEscape(organizer)}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\\r\\n');

  return {
    filename: `${m.title.replace(/[^a-z0-9]/gi, '_')}.ics`,
    content: Buffer.from(ics, 'utf8'),
    contentType: 'text/calendar; charset=utf-8; method=REQUEST',
  };
}
