import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/** Localiza a raiz do repositório (package.json com o nome do projeto). */
function findProjectRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i += 1) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
        if (pkg.name === 'agenda-ba-eletrica') return dir;
      } catch {
        /* ignora package.json inválido e continua subindo */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const PROJECT_ROOT = findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
dotenv.config({ path: path.join(PROJECT_ROOT, '.env.local'), override: false });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_HOST: z.string().default('0.0.0.0'),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(4175),
  APP_BASE_URL: z.string().url().default('http://localhost:4175'),
  APP_TIMEZONE: z.string().min(3).default('America/Manaus'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL é obrigatório. Copie .env.example para .env e preencha.'),
  SESSION_SECRET: z
    .string()
    .min(
      16,
      'SESSION_SECRET é obrigatório e precisa ter ao menos 16 caracteres. Gere um valor aleatório.',
    ),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),

  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_SECURE: z
    .union([z.boolean(), z.string()])
    .default(false)
    .transform((v) => v === true || v === 'true'),
  SMTP_REQUIRE_TLS: z
    .union([z.boolean(), z.string()])
    .default(false)
    .transform((v) => v === true || v === 'true'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM_NAME: z.string().default('Agenda BA | BA Elétrica'),
  SMTP_FROM_ADDRESS: z.string().default('agenda@baeletrica.com.br'),

  // Resend (API HTTP) — alternativa ao SMTP. Se RESEND_API_KEY estiver
  // definido, o envio usa a API do Resend em vez do SMTP.
  RESEND_API_KEY: z.string().default(''),
  RESEND_FROM: z.string().default(''),

  MEETING_BUFFER_MINUTES: z.coerce.number().int().min(0).max(480).default(0),
  EMAIL_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
  EMAIL_RETRY_BASE_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  AVATAR_MAX_BYTES: z.coerce.number().int().min(1024).max(20 * 1024 * 1024).default(2 * 1024 * 1024),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  console.error('\n[CONFIG] Variáveis de ambiente inválidas:\n' + lines.join('\n'));
  console.error('\n  Copie .env.example para .env na raiz do projeto e preencha os valores.\n');
  process.exit(1);
}

export const env = parsed.data;

/** True quando existe um servidor SMTP configurado. */
export const smtpConfigured = env.SMTP_HOST.trim().length > 0;

/** True quando a API do Resend está configurada (envio via HTTP). */
export const resendConfigured = env.RESEND_API_KEY.trim().length > 0 && env.NODE_ENV !== 'test';

/** Endereço de envio preferencial (Resend quando configurado). */
function parseResendFrom(raw: string): { name: string; address: string } {
  const m = raw.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = (m[1] || '').trim() || env.SMTP_FROM_NAME;
    const address = (m[2] ?? '').trim();
    return { name, address };
  }
  const addr = raw.trim();
  if (addr) return { name: env.SMTP_FROM_NAME, address: addr };
  return { name: env.SMTP_FROM_NAME, address: env.SMTP_FROM_ADDRESS };
}

const resendFrom = parseResendFrom(env.RESEND_FROM);
export const emailFromAddress = resendConfigured ? resendFrom.address : env.SMTP_FROM_ADDRESS;
export const emailFromName = resendConfigured ? resendFrom.name : env.SMTP_FROM_NAME;

/** Diretório de dados persistentes do projeto. */
export const STORAGE_DIR = path.join(PROJECT_ROOT, 'storage');
export const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'database', 'migrations');
export const WEB_DIST_DIR = path.join(PROJECT_ROOT, 'apps', 'web', 'dist');
export const BRAND_DIR = path.join(STORAGE_DIR, 'brand');
