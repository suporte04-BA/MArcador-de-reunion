/**
 * Bootstrap idempotente da conta administrativa de teste (Revisão V2 §5).
 *
 * Uso:
 *   npm run admin:bootstrap
 *   npm run admin:bootstrap -- --force-password     (pula env var e pergunta)
 *
 * A senha NUNCA é gravada em arquivo, log, variável persistida ou relatório.
 * Fontes aceitas, nesta ordem:
 *   1. variável de ambiente `BOOTSTRAP_ADMIN_PASSWORD` (recomendada em CI);
 *   2. prompt com eco OCULTO no terminal (não aparece na tela nem no histórico).
 *
 * A conta é provisionada de forma idempotente: rodar N vezes mantém o mesmo
 * resultado (mesmo id, mesmo setor, mesma role ADMIN, status ACTIVE).
 */
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { hash, verify } from '@node-rs/argon2';
import { PASSWORD_MIN_LENGTH, departmentKey, usernameKey } from '@agenda/shared';
import { closePool, queryOne } from './db.js';
import { audit } from '../modules/audit/audit.js';

const ACCOUNT = {
  fullName: 'Sérgio Rodrigues',
  username: 'Sérgio Rodrigues',
  email: 'suporte04@baeletrica.com.br',
  department: 'Administrador/TI',
  role: 'ADMIN' as const,
};

/** Lê uma linha do terminal sem ecoar os caracteres digitados. */
async function readHidden(question: string): Promise<string> {
  // Sem TTY (pipe/CI) não dá para esconder: usa stdin cru.
  if (!input.isTTY) {
    const rl = readline.createInterface({ input, terminal: false });
    try {
      output.write(question);
      return await new Promise<string>((resolve) => rl.once('line', (l) => resolve(l)));
    } finally {
      rl.close();
    }
  }

  const rl = readline.createInterface({ input, output, terminal: true }) as readline.Interface & {
    _writeToOutput?: (s: string) => void;
  };
  const originalWrite = rl._writeToOutput?.bind(rl);
  // Silencia TODO eco do teclado durante a digitação.
  rl._writeToOutput = () => undefined;
  output.write(question);
  try {
    return await new Promise<string>((resolve) => rl.question('', (answer) => resolve(answer)));
  } finally {
    if (originalWrite) rl._writeToOutput = originalWrite;
    rl.close();
  }
}

async function resolvePassword(): Promise<{ password: string; source: string }> {
  const fromEnv = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (fromEnv && fromEnv.length > 0 && !process.argv.includes('--force-password')) {
    // Nunca imprime o valor — apenas a origem.
    return { password: fromEnv, source: 'variável BOOTSTRAP_ADMIN_PASSWORD' };
  }
  const password = await readHidden(
    `\nSenha para a conta "${ACCOUNT.username}" (mínimo ${PASSWORD_MIN_LENGTH} caracteres, eco oculto): `,
  );
  return { password, source: 'prompt oculto do terminal' };
}

async function main(): Promise<void> {
  console.log('\n[BOOTSTRAP] Conta administrativa de teste — Agenda BA\n');

  const { password, source } = await resolvePassword();

  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`A senha precisa ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (password.trim().length !== password.length) {
    throw new Error('A senha não pode começar ou terminar com espaços.');
  }

  const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

  // --- Setor (idempotente, mesmo mecanismo do seed da migration 003) ---
  let department = await queryOne<{ id: string; name: string; is_active: boolean }>(
    'SELECT id, name, is_active FROM departments WHERE normalized_name = $1',
    [departmentKey(ACCOUNT.department)],
  );
  if (!department) {
    department = await queryOne<{ id: string; name: string; is_active: boolean }>(
      `INSERT INTO departments (name, normalized_name, slug, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, name, is_active`,
      [ACCOUNT.department, departmentKey(ACCOUNT.department), 'administrador-ti'],
    );
    console.log(`[BOOTSTRAP] Setor "${ACCOUNT.department}" criado.`);
  }
  if (!department) throw new Error('Falha ao provisionar o setor.');
  if (!department.is_active) {
    console.log(`[BOOTSTRAP] Setor "${department.name}" estava inativo — reativado.`);
    await queryOne('UPDATE departments SET is_active = true, updated_at = now() WHERE id = $1', [
      department.id,
    ]);
  }

  // --- Usuário (procura pela chave normalizada: caixa/acento/espaço não importam) ---
  const uKey = usernameKey(ACCOUNT.username);
  const eKey = usernameKey(ACCOUNT.email);

  const existing = await queryOne<{ id: string; role: string; status: string }>(
    'SELECT id, role, status FROM users WHERE username_key = $1 OR email_key = $2',
    [uKey, eKey],
  );

  let userId: string;
  let action: string;

  if (existing) {
    userId = existing.id;
    action = 'USER_UPDATED';
    await queryOne(
      `UPDATE users
          SET full_name = $2,
              username = $3,
              email = $4,
              password_hash = $5,
              role = 'ADMIN',
              status = 'ACTIVE',
              department_id = $6,
              must_change_password = false,
              failed_login_attempts = 0,
              locked_until = NULL,
              invitation_token_hash = NULL,
              invitation_expires_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [userId, ACCOUNT.fullName, ACCOUNT.username, ACCOUNT.email, passwordHash, department.id],
    );
    console.log(`[BOOTSTRAP] Conta existente normalizada (id ${userId}).`);
  } else {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO users (full_name, username, email, password_hash, role, status, department_id, must_change_password)
       VALUES ($1, $2, $3, $4, 'ADMIN', 'ACTIVE', $5, false)
       RETURNING id`,
      [ACCOUNT.fullName, ACCOUNT.username, ACCOUNT.email, passwordHash, department.id],
    );
    if (!row) throw new Error('Falha ao criar a conta administrativa.');
    userId = row.id;
    action = 'USER_CREATED';
    console.log(`[BOOTSTRAP] Conta criada (id ${userId}).`);
  }

  await audit({
    actor: { id: userId, fullName: ACCOUNT.fullName, username: ACCOUNT.username },
    action,
    entityType: 'user',
    entityId: userId,
    entityLabel: ACCOUNT.username,
    metadata: { bootstrap: true, role: ACCOUNT.role, department: department.name },
  });

  // --- Verificação: hash confere e a conta nasceu nas condições pedidas ---
  const check = await queryOne<{
    username: string;
    email: string;
    role: string;
    status: string;
    must_change_password: boolean;
    department_name: string | null;
    password_hash: string | null;
  }>(
    `SELECT u.username, u.email, u.role, u.status, u.must_change_password,
            u.password_hash, d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = $1`,
    [userId],
  );
  if (!check) throw new Error('Conta não encontrada após gravação.');

  const hashOk = check.password_hash ? await verify(check.password_hash, password) : false;

  const problems: string[] = [];
  if (!hashOk) problems.push('hash Argon2id não confere com a senha informada');
  if (check.role !== 'ADMIN') problems.push('role não é ADMIN');
  if (check.status !== 'ACTIVE') problems.push('status não é ACTIVE');
  if (check.must_change_password) problems.push('must_change_password deveria ser false');
  if (check.department_name !== department.name) problems.push('setor divergente');
  if (check.email !== ACCOUNT.email) problems.push('e-mail divergente');

  if (problems.length > 0) {
    throw new Error(`Verificação falhou: ${problems.join('; ')}`);
  }

  // --- Resultado (a senha NUNCA aparece aqui) ---
  console.log('\n[BOOTSTRAP] OK — verificação de integridade concluída.');
  console.log('  Usuário:      ', check.username);
  console.log('  E-mail:       ', check.email);
  console.log('  Setor:        ', check.department_name);
  console.log('  Acesso:       ', check.role, '/', check.status);
  console.log('  Troca senha:  ', 'não obrigatória');
  console.log('  Senha:        ', `definida via ${source}; valor não exibido nem gravado`);
  console.log('\n  Login: http://localhost:5173 (usuário acima + a senha que você informou)\n');
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(`\n[BOOTSTRAP] ERRO: ${err instanceof Error ? err.message : String(err)}\n`);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
