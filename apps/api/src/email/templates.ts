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
  name: 'BA Elétrica',
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
  // Botão "bulletproof" baseado em padding de <td> (padrão profissional para
  // Outlook 2016: sem VML, sem dependência de border-radius — funciona igual
  // no Word engine e em clientes modernos).
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="margin:20px 0 4px;mso-cellspacing:0;">
    <tr>
      <td align="center" bgcolor="${BRAND.accent}" style="background-color:${BRAND.accent};padding:12px 24px;border-radius:6px;mso-padding-alt:12px 24px;">
        <a href="${escapeHtml(href)}" style="display:inline-block;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;text-decoration:none;letter-spacing:0.4px;line-height:1.4;mso-line-height-rule:exactly;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

function infoRow(label: string, value: string, isLast: boolean): string {
  // Linha de detalhe: coluna de rótulo com fundo próprio + coluna de valor,
  // espaçamento generoso (16/20, múltiplos de 4 — evita linhas brancas no Word)
  // e separadores sutis. Alinhamento vertical centralizado.
  const border = isLast ? 'none' : '1px solid #e8edf4';
  return `<tr>
    <td width="170" bgcolor="${BRAND.surface}" style="background-color:${BRAND.surface};padding:16px 20px;color:${BRAND.muted};font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;line-height:1.4;vertical-align:middle;border-bottom:${border};mso-line-height-rule:exactly;mso-padding-alt:16px 20px;">${escapeHtml(label)}</td>
    <td style="padding:16px 20px;color:${BRAND.dark};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;line-height:1.5;vertical-align:middle;border-bottom:${border};mso-line-height-rule:exactly;mso-padding-alt:16px 20px;">${value}</td>
  </tr>`;
}

function summaryTable(rows: Array<[string, string]>, title: string): string {
  // IMPORTANTE: as linhas (<tr>) são filhas diretas do <table> — nunca
  // aninhadas dentro de um <td> (HTML inválido quebra o Word engine do Outlook).
  // Composto por: faixa de destaque azul (4px), barra de título escura e as
  // linhas de detalhe com coluna de rótulo em fundo claro.
  const body = rows.map(([label, value], i) => infoRow(label, value, i === rows.length - 1)).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.cardBg}" style="width:100%;max-width:600px;border-collapse:collapse;background-color:${BRAND.cardBg};border:1px solid #dbe3ee;margin:0 0 20px;mso-cellspacing:0;">
    <tr><td colspan="2" height="4" bgcolor="${BRAND.accent}" style="background-color:${BRAND.accent};height:4px;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>
    <tr><td colspan="2" bgcolor="${BRAND.dark}" style="background-color:${BRAND.dark};padding:16px 20px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;line-height:1.4;mso-line-height-rule:exactly;mso-padding-alt:16px 20px;">${escapeHtml(title)}</td></tr>
    ${body}
  </table>`;
}

function badgeHtml(label: string, bgColor: string): string {
  // Selo de status: tabela aninhada com bgcolor (renderiza em todo cliente;
  // border-radius é ignorado no Word e o selo continua correto com cantos retos).
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="display:inline-block;mso-cellspacing:0;">
    <tr><td align="center" bgcolor="${escapeHtml(bgColor)}" style="background-color:${escapeHtml(bgColor)};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;padding:8px 16px;border-radius:4px;letter-spacing:0.4px;line-height:1.4;mso-line-height-rule:exactly;mso-padding-alt:8px 16px;">${escapeHtml(label)}</td></tr>
  </table>`;
}

function sectionBlock(title: string, content: string, accentColor: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px;mso-cellspacing:0;">
    <tr><td style="padding:0 0 8px 0;">
      <div style="font-size:11px;font-weight:bold;color:${accentColor};text-transform:uppercase;letter-spacing:2px;mso-line-height-rule:exactly;">${escapeHtml(title)}</div>
    </td></tr>
    <tr><td style="padding:14px 18px;background-color:${BRAND.surface};border-left:3px solid ${accentColor};">
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
  .ExternalClass { width:100%; }
  .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div { line-height:100%; }
</style>
<!--[if mso]>
<style type="text/css">
  body, table, td { font-family:Arial,Helvetica,sans-serif !important; }
</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;mso-line-height-rule:exactly;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:40px 16px;mso-cellspacing:0;mso-padding-alt:40px 16px;">
<tr><td align="center">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #d1d5db;mso-cellspacing:0;">
  <tr><td bgcolor="${BRAND.accent}" height="5" style="background-color:${BRAND.accent};height:5px;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>
  <tr><td bgcolor="${BRAND.dark}" style="background-color:${BRAND.dark};padding:20px 32px;">
    ${opts.logoHtml}
    <div style="color:#93c5fd;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;margin-top:10px;font-weight:bold;mso-line-height-rule:exactly;">${escapeHtml(BRAND.product)}</div>
  </td></tr>
  <tr><td style="padding:32px 32px 24px 32px;">
    <h1 style="margin:0 0 8px;font-size:24px;line-height:1.25;color:${BRAND.dark};font-weight:bold;mso-line-height-rule:exactly;">${escapeHtml(opts.heading)}</h1>
    <div style="color:${BRAND.muted};font-size:14px;line-height:1.6;margin:0 0 24px;mso-line-height-rule:exactly;">${opts.introHtml}</div>
    ${opts.contentHtml}
    ${cta}
    <p style="color:${BRAND.muted};font-size:12px;line-height:1.6;margin:24px 0 0;mso-line-height-rule:exactly;">${escapeHtml(opts.footerNote)}</p>
  </td></tr>
  <tr><td bgcolor="#f8fafc" style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;color:${BRAND.muted};font-size:12px;line-height:1.6;mso-line-height-rule:exactly;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="mso-cellspacing:0;">
      <tr>
        <td style="color:${BRAND.muted};font-size:12px;line-height:1.6;vertical-align:middle;">
          <strong style="color:${BRAND.text};">${escapeHtml(BRAND.name)}</strong> - Agenda Corporativa
        </td>
        <td align="right" style="color:${BRAND.muted};font-size:11px;line-height:1.6;vertical-align:middle;">
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
    ['Setor', escapeHtml(m.departmentName ?? '-')],
    ['Agendado por', escapeHtml(m.createdByName)],
  ];
}

function formatWhen(m: MeetingMailData): string {
  return `${formatFullDateBR(zonedDateStr(m.startsAt))}, ${utcToZonedTimeStr(m.startsAt, DEFAULT_TIMEZONE)} - ${utcToZonedTimeStr(m.endsAt, DEFAULT_TIMEZONE)}`;
}

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
    `Setor:          ${m.departmentName ?? '-'}`,
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
      preheader: `${m.title} - ${when}`,
      intro: `Olá, <strong>${escapeHtml(recipient.fullName)}</strong>. Uma nova reunião foi agendada na agenda compartilhada da ${escapeHtml(BRAND.name)}.`,
      note: 'Você recebeu este e-mail porque é um usuário ativo da Agenda BA. Todas as reuniões da empresa são comunicadas a todos os usuários ativos.',
      cta: 'Ver reunião na Agenda BA',
    },
    updated: {
      subject: `Reunião alterada: ${m.title}`,
      heading: 'Reunião alterada',
      preheader: `${m.title} - ${when}`,
      intro: `Olá, <strong>${escapeHtml(recipient.fullName)}</strong>. A reunião abaixo teve alterações em seus dados ou horário.`,
      note: 'Você recebeu este e-mail porque é um usuário ativo da Agenda BA. Confira os dados atualizados antes da reunião.',
      cta: 'Ver reunião na Agenda BA',
    },
    cancelled: {
      subject: `Reunião cancelada: ${m.title}`,
      heading: 'Reunião cancelada',
      preheader: `${m.title} - ${when}`,
      intro: `Olá, <strong>${escapeHtml(recipient.fullName)}</strong>. A reunião abaixo foi cancelada e o horário voltou a ficar disponível na agenda.`,
      note: 'Você recebeu este e-mail porque é um usuário ativo da Agenda BA.',
      cta: 'Abrir a agenda',
    },
    reminder: {
      subject: `Lembrete: reunião hoje - ${m.title}`,
      heading: 'Lembrete de reunião hoje',
      preheader: `${m.title} - ${when}`,
      intro: `Olá, <strong>${escapeHtml(recipient.fullName)}</strong>. Lembrete: você tem uma reunião agendada para <strong>hoje</strong>.`,
      note: 'Você recebeu este e-mail porque é um usuário ativo da Agenda BA. Confira os detalhes abaixo e prepare-se para a reunião.',
      cta: 'Ver reunião na Agenda BA',
    },
  }[kind];

  const changedHtml = m.changedFields?.length
    ? `<p style="color:${BRAND.text};font-size:14px;margin:16px 0 6px;"><strong>Campos alterados:</strong> ${escapeHtml(m.changedFields.join(', '))}.</p>`
    : '';

  const descriptionHtml = m.description
    ? sectionBlock('Descrição', escapeHtml(m.description).replace(/\n/g, '<br>'), BRAND.accent)
    : '';

  const observationsHtml = m.observations
    ? sectionBlock('Observações', escapeHtml(m.observations).replace(/\n/g, '<br>'), BRAND.warning)
    : '';

  const whenCard = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.accent}" style="width:100%;max-width:600px;border-collapse:collapse;background-color:${BRAND.accent};margin:0 0 12px;mso-cellspacing:0;mso-padding-alt:10px 12px;">
    <tr><td style="padding:10px 12px;color:#ffffff;mso-padding-alt:10px 12px;">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;opacity:0.8;font-weight:bold;mso-line-height-rule:exactly;">Quando</div>
      <div style="font-size:16px;font-weight:bold;margin-top:3px;mso-line-height-rule:exactly;">${escapeHtml(formatFullDateBR(zonedDateStr(m.startsAt)))}</div>
      <div style="font-size:12px;margin-top:2px;opacity:0.9;mso-line-height-rule:exactly;">${escapeHtml(utcToZonedTimeStr(m.startsAt, DEFAULT_TIMEZONE))} - ${escapeHtml(utcToZonedTimeStr(m.endsAt, DEFAULT_TIMEZONE))} &nbsp;(${escapeHtml(durationText(minutesBetween(m.startsAt, m.endsAt)))})</div>
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
      ${summaryTable(meetingRows(m), 'Detalhes da reunião')}
      ${descriptionHtml}
      ${observationsHtml}
      <p style="color:${BRAND.muted};font-size:12px;margin:16px 0 0;mso-line-height-rule:exactly;">Horário de referência: ${escapeHtml(when)}.</p>`,
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
    `${BRAND.name} - ${BRAND.product}`,
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
    ], 'Dados do acesso'),
    ctaLabel: 'Ativar meu acesso',
    ctaHref: activateUrl,
    footerNote:
      'Este link é de uso único e expira em 72 horas. Se você não solicitou este acesso, ignore esta mensagem. Por segurança, nenhuma senha é enviada por e-mail: você definirá a sua própria senha no primeiro acesso.',
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
    `${BRAND.name} - ${BRAND.product}`,
    baseUrl,
  ].join('\n');

  return { subject: `Ative seu acesso - ${BRAND.product}`, text, html };
}

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
      ['Situação', badgeHtml('Ativo - login liberado', BRAND.success)],
    ], 'Dados do acesso'),
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
    'Situação:       Ativo - login liberado',
    '',
    `Abrir a agenda: ${baseUrl}`,
    '',
    'Por segurança, nenhuma senha é enviada por e-mail.',
    textRule(),
    `${BRAND.name} - ${BRAND.product}`,
    baseUrl,
  ].join('\n');

  return { subject: `Seu acesso está ativo - ${BRAND.product}`, text, html };
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
    contentHtml: `<p style="color:${BRAND.text};font-size:14px;line-height:1.6;margin:14px 0 0;">Se foi você, use o botão abaixo para escolher uma nova senha. O link expirá em <strong>60 minutos</strong> e pode ser usado uma única vez.</p>`,
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
    'O link expirá em 60 minutos e é de uso único.',
    '',
    'Se você não solicitou esta redefinição, ignore esta mensagem.',
    textRule(),
    `${BRAND.name} - ${BRAND.product}`,
    baseUrl,
  ].join('\n');

  return { subject: `Redefinição de senha - ${BRAND.product}`, text, html };
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
      ['Sistema', 'Agenda BA - canal transacional'],
      ['Status', badgeHtml('Mensagem de teste enviada com sucesso', BRAND.success)],
    ], 'Informações do teste'),
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
    `Sistema:        Agenda BA - canal transacional`,
    '',
    `Abrir a agenda: ${baseUrl}`,
    textRule(),
    'Mensagem solicitada pelo administrador. Nenhuma ação é necessária.',
    `${BRAND.name} - ${BRAND.product}`,
  ].join('\n');

  return { subject: `Teste de e-mail - ${BRAND.product}`, text, html };
}
