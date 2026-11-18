/**
 * Global-teardown: remove os usuários `e2e%` (e reuniões, outbox e sessões
 * associados) para deixar o banco limpo após a execução dos testes E2E.
 */
import { createPool, removeE2EUsers } from './db';

export default async function globalTeardown(): Promise<void> {
  const pool = createPool();
  try {
    const removed = await removeE2EUsers(pool);
    console.log(`[e2e] ${removed} usuário(s) de teste removido(s).`);
  } finally {
    await pool.end();
  }
}
