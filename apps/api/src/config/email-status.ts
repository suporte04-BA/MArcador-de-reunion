/** Exibe a configuração de e-mail e o estado da fila (sem expor segredos). */
import { closePool } from './db.js';
import { describeSmtpConfig, logoAvailable, verifySmtpConnection } from '../email/mailer.js';
import { outboxStats } from '../modules/notifications/outbox.js';
import { env } from './env.js';

async function main(): Promise<void> {
  const smtp = describeSmtpConfig();
  console.log('\n=== Agenda BA — status de e-mail ===\n');
  console.log(`  Modo:        ${smtp.mode === 'smtp' ? 'SMTP configurado' : 'DESATIVADO (SMTP_HOST vazio)'}`);
  console.log(`  Servidor:    ${smtp.host}:${smtp.port}${smtp.secure ? ' (TLS)' : ''}`);
  console.log(`  Autenticação:${smtp.auth ? ' sim' : ' não'}`);
  console.log(`  Remetente:   ${smtp.fromName} <${smtp.from}>`);
  console.log(`  Base URL:    ${env.APP_BASE_URL}`);
  console.log(`  Logo oficial:${logoAvailable() ? ' encontrada' : ' AUSENTE (storage/brand/logo-ba.png)'}`);
  console.log(`  Fuso:        ${env.APP_TIMEZONE}`);

  const verify = await verifySmtpConnection();
  console.log(`\n  Conexão SMTP: ${verify.ok ? 'OK — servidor acessível' : `FALHOU — ${verify.error}`}`);

  const stats = await outboxStats();
  console.log('\n  Fila (outbox):');
  console.log(`    Pendentes:  ${stats.pending}`);
  console.log(`    Enviando:   ${stats.sending}`);
  console.log(`    Reagendadas:${stats.retrying}`);
  console.log(`    Enviadas:   ${stats.sent}`);
  console.log(`    Falhas:     ${stats.failed}`);

  if (stats.failed > 0) {
    console.log('\n  Últimas falhas:');
    for (const r of stats.recent.filter((x) => x.status === 'FAILED').slice(0, 5)) {
      console.log(`    - ${r.recipientEmail} [${r.eventType}] ${r.lastError ?? ''}`);
    }
  }
  console.log('\n====================================\n');
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    await closePool().catch(() => undefined);
    process.exit(1);
  });
