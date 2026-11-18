/**
 * Remove TODO o esquema do banco de dados e aplica as migrations do zero.
 * Uso:  npm run db:reset -- --yes
 * Sem a flag --yes, o comando pede confirmação.
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { pool, closePool } from './db.js';
import { runMigrations } from './migrate.js';

async function main(): Promise<void> {
  const confirmed = process.argv.includes('--yes');

  if (!confirmed) {
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question(
      '\nATENÇÃO: isto apaga TODOS os dados (usuários, reuniões, auditoria e fila de e-mail).\nDigite "APAGAR" para confirmar: ',
    );
    rl.close();
    if (answer.trim() !== 'APAGAR') {
      console.log('\n[DB] Operação cancelada.\n');
      return;
    }
  }

  console.log('[DB] Removendo esquema...');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query('GRANT ALL ON SCHEMA public TO public');

  console.log('[DB] Aplicando migrations...');
  const applied = await runMigrations(false);
  console.log(`\n[DB] Reset concluído. ${applied.length} migration(s) aplicada(s).\n`);
  console.log('  Crie o primeiro administrador com:  npm run admin:create\n');
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(`\n[DB] ERRO: ${err instanceof Error ? err.message : String(err)}\n`);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
