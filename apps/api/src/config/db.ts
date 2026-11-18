import pg from 'pg';
import { env } from './env.js';

const { Pool, types } = pg;

// timestamptz (1184) volta como string ISO; int8 (20) como number quando seguro.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'agenda-ba-api',
});

pool.on('error', (err) => {
  console.error('[DB] Erro em conexão ociosa:', err.message);
});

export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

/** Executa uma consulta parametrizada. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
};

/** Retorna a primeira linha ou null. */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const r = await pool.query<T>(text, params as unknown[]);
  return r.rows[0] ?? null;
};

/** Retorna todas as linhas. */
export async function queryMany<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const r = await pool.query<T>(text, params as unknown[]);
  return r.rows;
};

/**
 * Executa um callback dentro de uma transação.
 * Em caso de erro, faz rollback e relança.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* conexão pode já estar quebrada */
    }
    throw err;
  } finally {
    client.release();
  }
};

/** Testa a conectividade com o banco. */
export async function checkDatabase(): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const r = await pool.query('SELECT version() AS v');
    return { ok: true, version: r.rows[0]?.v as string };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/** Libera o pool (usado em testes e encerramento gracioso). */
export async function closePool(): Promise<void> {
  await pool.end();
};
