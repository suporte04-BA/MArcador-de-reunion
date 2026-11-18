import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { env, WEB_DIST_DIR, STORAGE_DIR } from './config/env.js';
import { checkDatabase, pool } from './config/db.js';
import { runMigrations } from './config/migrate.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './modules/auth/routes.js';
import meetingRoutes from './modules/meetings/routes.js';
import { startReminderScheduler } from './modules/meetings/reminder.js';
import userRoutes from './modules/users/routes.js';
import departmentRoutes from './modules/departments/routes.js';
import { startOutboxWorker } from './modules/notifications/outbox.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'error' : 'info',
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password'],
    },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    disableRequestLogging: env.NODE_ENV === 'test',
  });

  // Cabeçalhos de segurança básicos (aplicação interna, sem conteúdo de terceiros).
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (!request.url.startsWith('/api/')) {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    }
    return payload;
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed = new Set([env.APP_BASE_URL.replace(/\/$/, '')]);
      try {
        const u = new URL(origin);
        allowed.add(`${u.protocol}//${u.host}`);
      } catch {
        /* origem inválida */
      }
      cb(null, allowed.has(origin.replace(/\/$/, '')));
    },
    credentials: true,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(multipart, {
    limits: { fileSize: env.AVATAR_MAX_BYTES, files: 1 },
  });
  await app.register(authPlugin);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const code = (error as { code?: string }).code ?? 'INTERNAL';
    const details = (error as { details?: unknown }).details;
    const conflicts = (error as { conflicts?: unknown }).conflicts;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'erro não tratado');
    }

    if (statusCode === 400 && code === 'VALIDATION' && details) {
      void reply.code(400).send({ error: error.message, code, details });
      return;
    }

    void reply.code(statusCode).send({
      error: statusCode >= 500 ? 'Erro interno do servidor.' : error.message,
      code,
      ...(statusCode === 409 && conflicts ? { conflicts } : {}),
    });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      void reply.code(404).send({ error: 'Rota não encontrada.', code: 'NOT_FOUND' });
      return;
    }
    // SPA: qualquer rota não-API devolve o index.html.
    const indexFile = path.join(WEB_DIST_DIR, 'index.html');
    if (fs.existsSync(indexFile)) {
      void reply.type('text/html').send(fs.readFileSync(indexFile));
      return;
    }
    void reply
      .code(404)
      .send(
        '<h1>Interface não compilada</h1><p>Execute <code>npm run build</code> na raiz do projeto ou use <code>npm run dev</code>.</p>',
      );
  });

  /* --------------------------- Rotas de dados --------------------------- */
  await app.register(authRoutes);
  await app.register(meetingRoutes);
  await app.register(userRoutes);
  await app.register(departmentRoutes);

  /* ------------------------------ Saúde -------------------------------- */
  app.get('/api/v1/health', async (_request, reply) => {
    const db = await checkDatabase();
    await reply.code(db.ok ? 200 : 503).send({
      status: db.ok ? 'ok' : 'degraded',
      database: db.ok ? 'connected' : db.error,
      timezone: env.APP_TIMEZONE,
      baseUrl: env.APP_BASE_URL,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  /* ------------------------- Estáticos / avatares ----------------------- */
  const avatarsDir = path.join(STORAGE_DIR, 'avatars');
  if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: avatarsDir,
    prefix: '/uploads/avatars/',
    decorateReply: false,
    maxAge: '7d',
    immutable: true,
  });

  const brandDir = path.join(STORAGE_DIR, 'brand');
  if (fs.existsSync(brandDir)) {
    await app.register(fastifyStatic, {
      root: brandDir,
      prefix: '/brand/',
      decorateReply: false,
      maxAge: '1d',
    });
  }

  // Interface compilada (produção): entrega o build do Vite.
  if (fs.existsSync(WEB_DIST_DIR)) {
    await app.register(fastifyStatic, {
      root: WEB_DIST_DIR,
      prefix: '/',
      decorateReply: false,
      index: ['index.html'],
      maxAge: '1h',
    });
  }

  return app;
}

async function main(): Promise<void> {
  const db = await checkDatabase();
  if (!db.ok) {
    console.error('\n[DB] Não foi possível conectar ao PostgreSQL.');
    console.error(`[DB] ${db.error}`);
    console.error('\n  1) Suba o banco:  docker compose up -d');
    console.error('  2) Aplique as migrations:  npm run db:migrate\n');
    process.exit(1);
  }

  console.log('[DB] Conectado ao PostgreSQL.');
  await runMigrations(true);
  console.log('[DB] Migrations verificadas.');

  const app = await buildApp();

  const worker = startOutboxWorker(10_000);
  const reminder = startReminderScheduler(60 * 60 * 1000);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[APP] Encerrando (${signal})...`);
    worker.stop();
    reminder.stop();
    await app.close();
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.APP_HOST, port: env.APP_PORT });

  const banner = [
    '',
    '  ╔══════════════════════════════════════════════════════╗',
    '  ║        AGENDA BA — Agenda Corporativa | BA Elétrica  ║',
    '  ╠══════════════════════════════════════════════════════╣',
    `  ║  Local:   http://localhost:${env.APP_PORT}`.padEnd(57) + '║',
    `  ║  Base:    ${env.APP_BASE_URL}`.padEnd(57) + '║',
    `  ║  Fuso:    ${env.APP_TIMEZONE}`.padEnd(57) + '║',
    '  ╠══════════════════════════════════════════════════════╣',
    '  ║  Painel:  /admin/users  (apenas administrador)      ║',
    '  ╚══════════════════════════════════════════════════════╝',
    '',
  ];
  console.log(banner.join('\n'));
}

const isDirectRun = process.argv[1] && /server\.(ts|js)$/.test(process.argv[1]);
if (isDirectRun) {
  main().catch((err) => {
    console.error('[APP] Falha ao iniciar:', err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}
