import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool, closePool } from './db.js';
import { MIGRATIONS_DIR } from './env.js';

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name        text PRIMARY KEY,
  checksum    text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);`;

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function runMigrations(silent = false): Promise<string[]> {
  const log = (...a: unknown[]): void => {
    if (!silent) console.log(...a);
  };

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Diretório de migrations não encontrado: ${MIGRATIONS_DIR}`);
  }

  await pool.query(TABLE_SQL);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const appliedRes = await pool.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations',
  );
  const applied = new Map(appliedRes.rows.map((r) => [r.name, r.checksum]));

  const appliedNow: string[] = [];

  for (const file of files) {
    const full = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(full, 'utf8');
    const checksum = sha256(sql);
    const previous = applied.get(file);

    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(
          `Migration "${file}" foi alterada depois de aplicada (checksum divergente). ` +
            'Crie uma nova migration em vez de editar uma já executada.',
        );
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        file,
        checksum,
      ]);
      await client.query('COMMIT');
      appliedNow.push(file);
      log(`  [migrate] aplicada: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(
        `Falha ao aplicar "${file}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    } finally {
      client.release();
    }
  }

  if (appliedNow.length === 0) log('  [migrate] banco já está atualizado.');
  return appliedNow;
}

const isMain = process.argv[1]?.includes('migrate');
if (isMain) {
  runMigrations()
    .then(async (applied) => {
      console.log(`\n[DB] ${applied.length} migration(s) aplicada(s).\n`);
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(`\n[DB] ERRO: ${err instanceof Error ? err.message : String(err)}\n`);
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
