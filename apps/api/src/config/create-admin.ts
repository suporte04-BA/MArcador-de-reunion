/**
 * Bootstrap seguro do primeiro administrador.
 * Uso:
 *   npm run admin:create -- --username=admin --password=*** --email=admin@empresa.com --full-name="Nome"
 *   npm run admin:create            (pergunta os dados de forma interativa)
 *
 * A senha nunca é gravada em arquivo nem exibida em log depois de enviada.
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { hash } from '@node-rs/argon2';
import { pool, closePool, queryOne, query } from './db.js';
import { normalizeEmail, normalizeUsername, PASSWORD_MIN_LENGTH, usernameKey } from '@agenda/shared';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  const next = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (next && !next.startsWith('--')) return next;
  return undefined;
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    const usernameRaw = argValue('username') ?? (await rl.question('Nome de usuário do administrador: '));
    const emailRaw = argValue('email') ?? (await rl.question('E-mail do administrador: '));
    const fullNameRaw = argValue('full-name') ?? (await rl.question('Nome completo: '));
    const password = argValue('password') ?? (await rl.question(`Senha (mínimo ${PASSWORD_MIN_LENGTH} caracteres): `));

    const username = normalizeUsername(usernameRaw);
    const email = normalizeEmail(emailRaw);
    const fullName = fullNameRaw.trim();

    // Chave normalizada: aceita caixa, acentos e espaços no nome de usuário
    // (o nome exibido é preservado; a unicidade é pela chave — V2 §4.2).
    if (username.length < 3 || username.length > 60) {
      throw new Error('Nome de usuário inválido (3-60 caracteres).');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
    if (fullName.length < 2) throw new Error('Nome completo é obrigatório.');
    if (password.length < PASSWORD_MIN_LENGTH)
      throw new Error(`A senha precisa ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`);

    // Argon2id é o padrão do @node-rs/argon2 (não requer tipo explícito).
    const passwordHash = await hash(password, {
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const existing = await queryOne<{ id: string; role: string }>(
      'SELECT id, role FROM users WHERE username_key = $1 OR email_key = $2',
      [usernameKey(username), usernameKey(email)],
    );

    if (existing) {
      if (existing.role !== 'ADMIN') {
        await query("UPDATE users SET role = 'ADMIN', status = 'ACTIVE', password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1", [
          existing.id,
          passwordHash,
        ]);
        console.log(`\n[ADMIN] Usuário "${username}" promovido a ADMINISTRADOR com nova senha.\n`);
      } else {
        await query(
          "UPDATE users SET password_hash = $2, status = 'ACTIVE', must_change_password = false, failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1",
          [existing.id, passwordHash],
        );
        console.log(`\n[ADMIN] Senha do administrador "${username}" redefinida.\n`);
      }
    } else {
      await query(
        `INSERT INTO users (full_name, username, email, password_hash, role, status, must_change_password)
         VALUES ($1,$2,$3,$4,'ADMIN','ACTIVE',false)`,
        [fullName, username, email, passwordHash],
      );
      console.log(`\n[ADMIN] Administrador "${username}" criado com sucesso.\n`);
    }

    console.log('  Entre com:');
    console.log(`    Usuário: ${username}`);
    console.log('    Senha:   (a que você acabou de definir)\n');
  } finally {
    rl.close();
    await closePool().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error(`\n[ADMIN] ERRO: ${err instanceof Error ? err.message : String(err)}\n`);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
