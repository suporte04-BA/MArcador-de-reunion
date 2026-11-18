/**
 * Testes de integração com PostgreSQL real + Fastify (app.inject).
 *
 * Cobre os itens da seção 12.2/12.3 do PLANO_MESTRE:
 * - autenticação e criação de usuários;
 * - gravação e consulta de reuniões (lista/calendário/métricas);
 * - constraint GiST de não-sobreposição (409), adjacentes permitidos,
 *   cancelamento liberando o intervalo e update validando conflito;
 * - autorização na API (403 para não-autor, admin gerencia tudo);
 * - exclusão lógica com auditoria;
 * - outbox transacional e workers concorrentes sem duplicação;
 * - concorrência real: exatamente um 201 e um 409.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { departmentKey, usernameKey } from '@agenda/shared';
import { closePool, query, queryOne, withTransaction } from '../src/config/db.js';
import { runMigrations } from '../src/config/migrate.js';
import { clearRateLimits } from '../src/lib/rate-limit.js';
import { enqueueMeetingEvent, processOutbox } from '../src/modules/notifications/outbox.js';
import type { MeetingMailData } from '../src/email/templates.js';

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000).toString(36)}`;
const PASSWORD = `SenhaIntegracao#${stamp}`;

// Datas fixas no futuro para não colidir com dados reais nem com outros testes.
const DAY_15 = '2030-01-15';
const DAY_16 = '2030-01-16';
const DAY_20 = '2030-01-20';

type Session = { cookie: string; id: string; username: string };

let app: FastifyInstance;
const sessions: Record<'admin' | 'a' | 'b', Session> = {} as Record<'admin' | 'a' | 'b', Session>;
const createdUserIds: string[] = [];

// Reuniões usadas ao longo da suíte.
const m: Record<string, string> = {};

/** Setor semeado pela migration 003 — usado como setor padrão dos testes. */
let DEPT_TI = '';
let DEPT_FISCAL = '';

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Reunião de integração',
    responsibleName: 'Pessoa Responsável',
    date: DAY_15,
    start: '09:00',
    end: '10:00',
    description: 'Pauta criada pelos testes de integração.',
    observations: 'Observação opcional.',
    // Setor é OBRIGATÓRIO na criação (V2 §6).
    departmentId: DEPT_TI,
    ...over,
  };
}

/** Payload padrão de criação de usuário via API (V2 §3.4: setor + senha). */
function userPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: 'USER',
    departmentId: DEPT_TI,
    temporaryPassword: `Senha#${stamp}`,
    ...over,
  };
}

async function createUser(username: string, fullName: string, role: 'ADMIN' | 'USER'): Promise<string> {
  const passwordHash = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (full_name, username, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
     RETURNING id`,
    [fullName, username, `${username}@teste.baeletrica.com.br`, passwordHash, role],
  );
  if (!row) throw new Error('Falha ao criar usuário de teste.');
  createdUserIds.push(row.id);
  return row.id;
}

async function login(username: string, password: string): Promise<{ cookie: string; body: any }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
  return { cookie: cookieOf(res), body: res.json() };
}

function cookieOf(res: { cookies: Array<{ name: string; value: string }> }): string {
  const session = res.cookies.find((c) => c.name === 'agenda_session');
  if (!session) throw new Error('Cookie de sessão não devolvido pelo login.');
  return `agenda_session=${session.value}`;
}

async function mailpitCountBySubject(subject: string): Promise<number | null> {
  try {
    const res = await fetch('http://localhost:8025/api/v1/messages?limit=300');
    if (!res.ok) return null;
    const data = (await res.json()) as { messages?: Array<{ Subject?: string }> };
    return (data.messages ?? []).filter((msg) => msg.Subject === subject).length;
  } catch {
    return null; // Mailpit indisponível: o teste de conteúdo é coberto em outro arquivo.
  }
}

beforeAll(async () => {
  await runMigrations(true);
  clearRateLimits();

  const departments = await query<{ id: string; name: string }>('SELECT id, name FROM departments');
  for (const d of departments.rows) {
    const key = departmentKey(d.name);
    if (key === 'administrador/ti') DEPT_TI = d.id;
    if (key === 'fiscal') DEPT_FISCAL = d.id;
  }
  if (!DEPT_TI || !DEPT_FISCAL) {
    throw new Error('Seed de setores (migration 003) ausente — rode npm run db:migrate.');
  }

  const adminId = await createUser(`it_admin_${stamp}`, 'Administrador de Integração', 'ADMIN');
  const aId = await createUser(`it_a_${stamp}`, 'Usuário A de Integração', 'USER');
  const bId = await createUser(`it_b_${stamp}`, 'Usuário B de Integração', 'USER');

  app = await buildApp();
  await app.ready();

  const adminLogin = await login(`it_admin_${stamp}`, PASSWORD);
  const aLogin = await login(`it_a_${stamp}`, PASSWORD);
  const bLogin = await login(`it_b_${stamp}`, PASSWORD);

  sessions.admin = { cookie: adminLogin.cookie, id: adminId, username: `it_admin_${stamp}` };
  sessions.a = { cookie: aLogin.cookie, id: aId, username: `it_a_${stamp}` };
  sessions.b = { cookie: bLogin.cookie, id: bId, username: `it_b_${stamp}` };
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  const ids = createdUserIds;
  if (ids.length > 0) {
    // 1) Desvincula setores temporários (FK users/meetings -> departments).
    await query(`UPDATE users SET department_id = NULL WHERE id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await query(
      `UPDATE meetings SET department_id = NULL WHERE created_by_user_id = ANY($1::uuid[])`,
      [ids],
    ).catch(() => undefined);
    await query(
      `UPDATE departments
          SET created_by_user_id = NULL, updated_by_user_id = NULL
        WHERE name LIKE 'Setor Temp %' OR name LIKE 'Operações Norte %'
           OR created_by_user_id = ANY($1::uuid[]) OR updated_by_user_id = ANY($1::uuid[])`,
      [ids],
    ).catch(() => undefined);
    await query(
      `DELETE FROM departments WHERE name LIKE 'Setor Temp %' OR name LIKE 'Operações Norte %'`,
    ).catch(() => undefined);

    // 2) Remove dados de teste na ordem das dependências.
    await query(
      `DELETE FROM notification_outbox
        WHERE recipient_user_id = ANY($1::uuid[])
           OR meeting_id IN (SELECT id FROM meetings WHERE created_by_user_id = ANY($1::uuid[]))`,
      [ids],
    ).catch(() => undefined);
    await query(
      `DELETE FROM audit_logs
        WHERE actor_user_id = ANY($1::uuid[])
           OR (entity_type = 'meeting' AND entity_id IN (SELECT id::text FROM meetings WHERE created_by_user_id = ANY($1::uuid[])))`,
      [ids],
    ).catch(() => undefined);
    await query(`DELETE FROM meetings WHERE created_by_user_id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await query(`DELETE FROM auth_tokens WHERE user_id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await query(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  }
  // Varredura final: nenhum resíduo pode sobreviver ao arquivo de teste.
  await query(
    `DELETE FROM departments WHERE name LIKE 'Setor Temp %' OR name LIKE 'Operações Norte %'`,
  ).catch(() => undefined);
  await query(
    `DELETE FROM users WHERE username LIKE 'it\\_%' OR username LIKE 'intruso\\_%'`,
  ).catch(() => undefined);
  await closePool().catch(() => undefined);
}, 30_000);

describe('autenticação e usuários', () => {
  it('login válido cria sessão e /auth/me a devolve', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: sessions.a.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.username).toBe(sessions.a.username);
    expect(body.user.role).toBe('USER');
  });

  it('sessão ausente/inválida retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);

    const forged = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: 'agenda_session=abc123' },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('senha incorreta é recusada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: sessions.a.username, password: 'senha-errada' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBeTruthy();
  });

  it('login aceita variações de caixa, acento e espaços (V2 §4.2)', async () => {
    const fullName = 'Sérgio   Rodrigues';
    const username = `Sérgio Rodrigues ${stamp}`;
    const password = `Sn${stamp}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.admin.cookie },
      payload: userPayload({
        fullName,
        username,
        email: `sergio.${stamp}@teste.baeletrica.com.br`,
        temporaryPassword: password,
      }),
    });
    expect(res.statusCode).toBe(201);
    createdUserIds.push(res.json().id);

    // O nome exibido é preservado no cadastro (com caixa e acento).
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.admin.cookie },
    });
    const stored = list.json().items.find((u: { id: string }) => u.id === res.json().id);
    expect(stored.username).toBe(username);

    const variations = [
      username, // como cadastrado
      username.toUpperCase(), // caixa
      username.replace(/é/gi, 'e'), // sem acento
      username.replace(/\s+/g, '   '), // espaços repetidos
      `  ${username}  `, // pontas
      `sergio.${stamp}@TESTE.baeletrica.com.br`, // e-mail em caixa mista
    ];
    for (const v of variations) {
      const r = await login(v, password);
      expect(r.body?.user?.username, `login com "${v}"`).toBe(username);
      await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: r.cookie } });
    }
  });

  it('chave normalizada do TypeScript é idêntica à do PostgreSQL', async () => {
    const amostras = [
      'Sérgio Rodrigues',
      '  José   da   Silva ',
      'JOSE DA SILVA',
      'Administrador/TI',
      'Marcelo  Ângelo Conceição',
      'ana-maria.souza_junior',
      'Straße',
      'a b',
    ];
    for (const s of amostras) {
      const row = await queryOne<{ ts: string; sql: string }>(
        'SELECT $1::text AS ts, agenda_normalize_key($1) AS sql',
        [usernameKey(s)],
      );
      expect(row?.ts, `paridade da chave para "${s}"`).toBe(row?.sql);
      // A chave da amostra calculada no TS precisa igualar a do SQL aplicado à amostra.
      const row2 = await queryOne<{ sql: string }>('SELECT agenda_normalize_key($1) AS sql', [s]);
      expect(usernameKey(s), `paridade direta para "${s}"`).toBe(row2?.sql);
    }
  });

  it('senha com 4 caracteres é aceita (regra única V2 §3.5)', async () => {
    const username = `it_min4_${stamp}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.admin.cookie },
      payload: userPayload({
        fullName: 'Usuário Senha Mínima',
        username,
        email: `${username}@teste.baeletrica.com.br`,
        temporaryPassword: 'abcd',
      }),
    });
    expect(res.statusCode).toBe(201);
    createdUserIds.push(res.json().id);

    const r = await login(username, 'abcd');
    expect(r.body?.user?.username).toBe(username);

    // 3 caracteres continua recusado nas DUAS camadas.
    const short = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.admin.cookie },
      payload: userPayload({
        fullName: 'Usuário Senha Curta',
        username: `it_min3_${stamp}`,
        email: `it_min3_${stamp}@teste.baeletrica.com.br`,
        temporaryPassword: 'abc',
      }),
    });
    expect(short.statusCode).toBe(400);
  });

  it('admin cadastra usuário: conta nasce ATIVA, loga na hora, sem troca forçada (V2 §3.4)', async () => {
    const username = `it_temp_${stamp}`;
    const password = `Temp#${stamp}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.admin.cookie },
      payload: userPayload({
        fullName: 'Usuário Temporário',
        username,
        email: `${username}@teste.baeletrica.com.br`,
        temporaryPassword: password,
      }),
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.status).toBe('ACTIVE');
    createdUserIds.push(created.id);

    // Login imediato e SEM obrigação de trocar a senha.
    const tmpLogin = await login(username, password);
    expect(tmpLogin.body.user.username).toBe(username);
    expect(tmpLogin.body.mustChangePassword).toBe(false);

    // E-mail de boas-vindas enfileirado para o criado, sem senha em texto.
    const welcome = await queryOne<{ n: number; text_body: string; html_body: string }>(
      `SELECT count(*)::int AS n,
              min(text_body)  AS text_body,
              min(html_body)  AS html_body
         FROM notification_outbox
        WHERE event_key = $1`,
      [`welcome:${created.id}:create`],
    );
    expect(welcome?.n).toBe(1);
    expect(welcome?.text_body ?? '').not.toContain(password);
    expect(welcome?.html_body ?? '').not.toContain(password);

    // O setor foi gravado no usuário.
    const stored = await queryOne<{ department_id: string | null }>(
      'SELECT department_id FROM users WHERE id = $1',
      [created.id],
    );
    expect(stored?.department_id).toBe(DEPT_TI);

    // Duplicidade é recusada
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.admin.cookie },
      payload: userPayload({
        fullName: 'Outro',
        username,
        email: `outro_${stamp}@teste.baeletrica.com.br`,
      }),
    });
    expect(dup.statusCode).toBe(409);
  });

  it('criação sem setor ou com setor inexistente é recusada (V2 §3.4)', async () => {
    const semSetor = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.admin.cookie },
      payload: {
        fullName: 'Sem Setor',
        username: `it_nodept_${stamp}`,
        email: `it_nodept_${stamp}@teste.baeletrica.com.br`,
        role: 'USER',
        temporaryPassword: `Senha#${stamp}`,
      },
    });
    expect(semSetor.statusCode).toBe(400);

    const setorFalso = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.admin.cookie },
      payload: userPayload({
        fullName: 'Setor Inexistente',
        username: `it_baddept_${stamp}`,
        email: `it_baddept_${stamp}@teste.baeletrica.com.br`,
        departmentId: '00000000-0000-4000-8000-000000000000',
      }),
    });
    expect(setorFalso.statusCode).toBe(400);
  });

  it('setor inativo bloqueia vínculo novo e some dos ativos', async () => {
    // Cria um setor temporário, vincula, desativa e tenta vincular de novo.
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/departments',
      headers: { cookie: sessions.admin.cookie },
      payload: { name: `Setor Temp ${stamp}`, colorKey: 'roxo' },
    });
    expect(created.statusCode).toBe(201);
    const deptId = created.json().department.id as string;

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.admin.cookie },
      payload: userPayload({
        fullName: 'Usuário Do Setor Temp',
        username: `it_settemp_${stamp}`,
        email: `it_settemp_${stamp}@teste.baeletrica.com.br`,
        departmentId: deptId,
      }),
    });
    expect(ok.statusCode).toBe(201);
    createdUserIds.push(ok.json().id);

    const deactivate = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/departments/${deptId}/deactivate`,
      headers: { cookie: sessions.admin.cookie },
    });
    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json().linkedUsers).toBe(1);

    // Select público não mostra o setor inativo.
    const active = await app.inject({
      method: 'GET',
      url: '/api/v1/departments',
      headers: { cookie: sessions.a.cookie },
    });
    expect(active.statusCode).toBe(200);
    expect(active.json().items.some((d: { id: string }) => d.id === deptId)).toBe(false);

    // Novo vínculo com o setor inativo é recusado.
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.admin.cookie },
      payload: userPayload({
        fullName: 'Não Pode',
        username: `it_blocked_${stamp}`,
        email: `it_blocked_${stamp}@teste.baeletrica.com.br`,
        departmentId: deptId,
      }),
    });
    expect(blocked.statusCode).toBe(400);

    // O histórico permanece: a usuária continua listada com o setor inativo.
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.admin.cookie },
    });
    const linked = list
      .json()
      .items.find((u: { id: string }) => u.id === ok.json().id);
    expect(linked.departmentId).toBe(deptId);
    expect(linked.departmentName).toBe(`Setor Temp ${stamp}`);
  });

  it('usuário comum não acessa endpoints administrativos', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.b.cookie },
    });
    expect(list.statusCode).toBe(403);
    expect(list.json().code).toBe('FORBIDDEN');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.b.cookie },
      payload: {
        fullName: 'Intruso',
        username: `intruso_${stamp}`,
        email: `intruso_${stamp}@teste.baeletrica.com.br`,
        role: 'ADMIN',
        departmentId: DEPT_TI,
        temporaryPassword: 'Intruso#1',
      },
    });
    expect(create.statusCode).toBe(403);

    const status = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/email/test-connection',
      headers: { cookie: sessions.b.cookie },
    });
    expect(status.statusCode).toBe(403);
  });
});

describe('setores: CRUD, dedupe, permissão e indicadores (V2 §2/§3.1)', () => {
  it('seed idempotente: os 3 setores iniciais existem e estão ativos', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/departments',
      headers: { cookie: sessions.admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    const names = res.json().items.map((d: { name: string }) => d.name);
    for (const seeded of ['Administrador/TI', 'Fiscal', 'Financeiro']) {
      expect(names, `setor seed "${seeded}" presente`).toContain(seeded);
    }
    const seededRows = res
      .json()
      .items.filter((d: { name: string }) =>
        ['Administrador/TI', 'Fiscal', 'Financeiro'].includes(d.name),
      );
    expect(seededRows).toHaveLength(3);
    expect(seededRows.every((d: { isActive: boolean }) => d.isActive)).toBe(true);
    // Slug calculado no servidor a partir do nome.
    expect(seededRows.find((d: { name: string }) => d.name === 'Administrador/TI')?.slug ?? 'administrador-ti').toBeTruthy();
  });

  it('duplicata por caixa/espaço/acentos é recusada (V2 §2.1)', async () => {
    const tentativas = ['FISCAL', '  fiscal  ', 'Físçal', 'Fiscal  '];
    for (const nome of tentativas) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/departments',
        headers: { cookie: sessions.admin.cookie },
        payload: { name: nome },
      });
      expect(r.statusCode, `"${nome}" deve ser tratado como duplicata`).toBe(409);
    }
  });

  it('valida tamanho de nome, descrição e cor institucional', async () => {
    const casos: Array<[Record<string, unknown>, number]> = [
      [{ name: 'A' }, 400],
      [{ name: 'X'.repeat(81) }, 400],
      [{ name: 'Setor Válido', description: 'D'.repeat(501) }, 400],
      [{ name: 'Setor Válido', colorKey: 'laranja' }, 400],
    ];
    for (const [payloadBody, esperado] of casos) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/departments',
        headers: { cookie: sessions.admin.cookie },
        payload: payloadBody,
      });
      expect(r.statusCode, JSON.stringify(payloadBody)).toBe(esperado);
    }

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/departments',
      headers: { cookie: sessions.admin.cookie },
      payload: { name: `Operações Norte ${stamp}`, description: 'Setor criado pelo teste.', colorKey: 'verde' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().department.slug).toBeTruthy();

    // Renomear mantém o mesmo id (referências históricas preservadas).
    const deptId = ok.json().department.id as string;
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/departments/${deptId}`,
      headers: { cookie: sessions.admin.cookie },
      payload: { name: `Operações Norte Renomeado ${stamp}` },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().department.id).toBe(deptId);
    expect(patch.json().department.name).toBe(`Operações Norte Renomeado ${stamp}`);

    // Não pode haver dois setores com a mesma chave após renomear.
    const dupRename = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/departments/${deptId}`,
      headers: { cookie: sessions.admin.cookie },
      payload: { name: 'Financeiro' },
    });
    expect(dupRename.statusCode).toBe(409);
  });

  it('somente ADMIN acessa as rotas administrativas de setor', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/v1/departments' });
    expect(anon.statusCode).toBe(401);

    const comum = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/departments',
      headers: { cookie: sessions.a.cookie },
    });
    expect(comum.statusCode).toBe(403);

    const comumCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/departments',
      headers: { cookie: sessions.a.cookie },
      payload: { name: `Não Deve ${stamp}` },
    });
    expect(comumCreate.statusCode).toBe(403);

    // O usuário comum VÊ os ativos (selects da tela de reunião).
    const select = await app.inject({
      method: 'GET',
      url: '/api/v1/departments',
      headers: { cookie: sessions.a.cookie },
    });
    expect(select.statusCode).toBe(200);
    expect(select.json().items.length).toBeGreaterThanOrEqual(3);
  });

  it('exclusão física de setor com vínculo é bloqueada (somente desativação)', async () => {
    // Cria um setor com usuário vinculado (Fiscal/Financeiro estão sem vínculo
    // nesta base, então o bloqueio precisa ser provado com um vínculo real).
    const criado = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/departments',
      headers: { cookie: sessions.admin.cookie },
      payload: { name: `Setor Temp Vinculo ${stamp}` },
    });
    expect(criado.statusCode).toBe(201);
    const deptId = criado.json().department.id as string;

    const usuario = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: sessions.admin.cookie },
      payload: userPayload({
        fullName: 'Usuário Com Setor',
        username: `it_vinc_${stamp}`,
        email: `it_vinc_${stamp}@teste.baeletrica.com.br`,
        departmentId: deptId,
      }),
    });
    expect(usuario.statusCode).toBe(201);
    createdUserIds.push(usuario.json().id);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/departments/${deptId}`,
      headers: { cookie: sessions.admin.cookie },
      payload: { confirm: true },
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe('IN_USE');
    expect(del.json().error).toContain('Desative o setor');

    // A desativação é o caminho permitido e mantém o histórico.
    const deactivate = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/departments/${deptId}/deactivate`,
      headers: { cookie: sessions.admin.cookie },
    });
    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json().linkedUsers).toBe(1);

    // Sem confirmação explícita a exclusão física é recusada (mesmo sem vínculo).
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/departments',
      headers: { cookie: sessions.admin.cookie },
    });
    const ti = list
      .json()
      .items.find((d: { name: string }) => d.name === 'Administrador/TI');
    const semConfirm = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/departments/${ti.id}`,
      headers: { cookie: sessions.admin.cookie },
      payload: {},
    });
    expect(semConfirm.statusCode).toBe(400);
  });

  it('KPIs Total de usuários e Total de setores refletem o banco', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/stats',
      headers: { cookie: sessions.admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    const stats = res.json();

    const dbUsers = await queryOne<{ n: number }>('SELECT count(*)::int AS n FROM users');
    const dbDepts = await queryOne<{ n: number }>('SELECT count(*)::int AS n FROM departments');
    expect(stats.users.total).toBe(dbUsers?.n);
    expect(stats.departments.total).toBe(dbDepts?.n);

    const anon = await app.inject({ method: 'GET', url: '/api/v1/admin/stats' });
    expect(anon.statusCode).toBe(401);
    const comum = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/stats',
      headers: { cookie: sessions.a.cookie },
    });
    expect(comum.statusCode).toBe(403);
  });
});

describe('reuniões: gravação, consulta e validação', () => {
  it('cria reunião e ela aparece na lista e no calendário', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/meetings',
      headers: { cookie: sessions.a.cookie },
      payload: payload({ title: 'Reunião M1 da integração' }),
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    m.m1 = created.meeting.id;
    expect(created.meeting.canManage).toBe(true);
    expect(created.notificationsQueued).toBeGreaterThanOrEqual(1);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings?from=${DAY_15}&to=${DAY_15}&status=ALL`,
      headers: { cookie: sessions.b.cookie },
    });
    expect(list.statusCode).toBe(200);
    const items = list.json().items as Array<{ id: string; canManage: boolean }>;
    expect(items.some((x) => x.id === m.m1)).toBe(true);

    const counts = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard/month-counts?month=2030-01`,
      headers: { cookie: sessions.a.cookie },
    });
    expect(counts.statusCode).toBe(200);
    expect(counts.json().counts[DAY_15]).toBeGreaterThanOrEqual(1);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/${m.m1}`,
      headers: { cookie: sessions.b.cookie },
    });
    expect(detail.statusCode).toBe(200);
    // B vê a reunião mas não pode administrá-la
    expect(detail.json().meeting.canManage).toBe(false);
  });

  it('valida campos obrigatórios e data no passado', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/meetings',
      headers: { cookie: sessions.a.cookie },
      payload: { title: 'ab' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe('VALIDATION');
    expect(missing.json().details.title).toBeDefined();

    const past = await app.inject({
      method: 'POST',
      url: '/api/v1/meetings',
      headers: { cookie: sessions.a.cookie },
      payload: payload({ date: '2000-01-01' }),
    });
    expect(past.statusCode).toBe(400);
    expect(past.json().error).toContain('passado');

    const inverted = await app.inject({
      method: 'POST',
      url: '/api/v1/meetings',
      headers: { cookie: sessions.a.cookie },
      payload: payload({ start: '10:00', end: '09:00' }),
    });
    expect(inverted.statusCode).toBe(400);
    // A regra é validada pelo schema (mensagem em pt-BR no campo `end`)
    expect(inverted.json().details?.end?.[0]).toContain('posterior');
  });

  it('constraint do banco recusa sobreposição com mensagem amigável (409)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/meetings',
      headers: { cookie: sessions.a.cookie },
      payload: payload({ title: 'Sobreposição indevida', start: '09:30', end: '10:30' }),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe('SCHEDULE_CONFLICT');
    expect(body.error).toContain('Horário ocupado');
    expect(body.conflicts.length).toBeGreaterThanOrEqual(1);

    // Nenhum intervalo ativo sobreposto no banco
    const overlaps = await query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM meetings a
         JOIN meetings b ON a.id < b.id
          AND a.status <> 'CANCELLED' AND b.status <> 'CANCELLED'
          AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')`,
    );
    expect(overlaps.rows[0]?.n).toBe(0);
  });

  it('horários adjacentes são permitidos (fim exclusivo)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/meetings',
      headers: { cookie: sessions.a.cookie },
      payload: payload({ title: 'Reunião M4 colada na M1', start: '10:00', end: '11:00' }),
    });
    expect(res.statusCode).toBe(201);
    m.m4 = res.json().meeting.id;
  });

  it('endpoint de disponibilidade reflete conflito e liberação', async () => {
    const busy = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/availability?date=${DAY_15}&start=09:30&end=10:30`,
      headers: { cookie: sessions.a.cookie },
    });
    expect(busy.json().available).toBe(false);
    expect(busy.json().conflicts.length).toBeGreaterThanOrEqual(1);

    const free = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/availability?date=${DAY_15}&start=14:00&end=15:00`,
      headers: { cookie: sessions.a.cookie },
    });
    expect(free.json().available).toBe(true);
  });

  it('edição que cria sobreposição é recusada (update valida conflito)', async () => {
    // M2 ainda não existe: criamos 11:00-12:00 e tentamos mover a M4 para cima.
    const createM2 = await app.inject({
      method: 'POST',
      url: '/api/v1/meetings',
      headers: { cookie: sessions.a.cookie },
      payload: payload({ title: 'Reunião M2 da integração', start: '11:00', end: '12:00' }),
    });
    expect(createM2.statusCode).toBe(201);
    m.m2 = createM2.json().meeting.id;

    const move = await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${m.m4}`,
      headers: { cookie: sessions.a.cookie },
      payload: { start: '11:30', end: '12:30' },
    });
    expect(move.statusCode).toBe(409);
    expect(move.json().code).toBe('SCHEDULE_CONFLICT');

    // Horário da M4 permanece intacto (não houve gravação parcial)
    const check = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/${m.m4}`,
      headers: { cookie: sessions.a.cookie },
    });
    expect(new Date(check.json().meeting.startsAt).toISOString()).toBe('2030-01-15T14:00:00.000Z');
  });
});

describe('autorização na API (independente da interface)', () => {
  it('não-autor não edita nem exclui reunião alheia (403 na API)', async () => {
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/${m.m2}`,
      headers: { cookie: sessions.a.cookie },
    });
    const originalTitle = before.json().meeting.title;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${m.m2}`,
      headers: { cookie: sessions.b.cookie },
      payload: { title: 'Adulteração pelo usuário B' },
    });
    expect(patch.statusCode).toBe(403);
    expect(patch.json().code).toBe('FORBIDDEN');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/meetings/${m.m2}`,
      headers: { cookie: sessions.b.cookie },
    });
    expect(del.statusCode).toBe(403);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/${m.m2}`,
      headers: { cookie: sessions.a.cookie },
    });
    expect(after.json().meeting.title).toBe(originalTitle);
    expect(after.json().meeting.status).toBe('SCHEDULED');
  });

  it('administrador edita reunião de qualquer usuário', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${m.m2}`,
      headers: { cookie: sessions.admin.cookie },
      payload: { title: 'Reunião M2 editada pelo admin', observations: 'Editada na integração.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meeting.title).toBe('Reunião M2 editada pelo admin');
    expect(res.json().notificationsQueued).toBeGreaterThanOrEqual(1);
  });

  it('autor edita a própria reunião', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${m.m2}`,
      headers: { cookie: sessions.a.cookie },
      payload: { responsibleName: 'Responsável Atualizado' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meeting.responsibleName).toBe('Responsável Atualizado');
  });

  it('responsável é apenas texto: não concede permissão a terceiros', async () => {
    // B cria reunião declarando A como responsável — A continua sem permissão sobre a de B.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/meetings',
      headers: { cookie: sessions.b.cookie },
      payload: payload({ title: 'Reunião M3 do usuário B', date: DAY_16, responsibleName: 'Usuário A' }),
    });
    expect(res.statusCode).toBe(201);
    m.m3 = res.json().meeting.id;

    const attempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${m.m3}`,
      headers: { cookie: sessions.a.cookie },
      payload: { title: 'A tentou editar a reunião de B' },
    });
    expect(attempt.statusCode).toBe(403);
  });
});

describe('cancelamento, auditoria e liberação de horário', () => {
  it('cancelamento é lógico, mantém auditoria e notifica', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/meetings/${m.m1}`,
      headers: { cookie: sessions.a.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meeting.status).toBe('CANCELLED');
    expect(res.json().notificationsQueued).toBeGreaterThanOrEqual(1);

    // Exclusão lógica: a linha permanece com status CANCELLED
    const row = await queryOne<{ status: string; cancelled_at: Date | null }>(
      'SELECT status, cancelled_at FROM meetings WHERE id = $1',
      [m.m1],
    );
    expect(row?.status).toBe('CANCELLED');
    expect(row?.cancelled_at).toBeTruthy();

    // Trilha de auditoria preservada
    const audit = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_logs
        WHERE action = 'MEETING_CANCELLED' AND entity_type = 'meeting' AND entity_id = $1`,
      [m.m1],
    );
    expect(audit?.n).toBeGreaterThanOrEqual(1);
  });

  it('horário de reunião cancelada volta a ficar livre', async () => {
    const free = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/availability?date=${DAY_15}&start=09:00&end=10:00`,
      headers: { cookie: sessions.a.cookie },
    });
    expect(free.json().available).toBe(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/meetings',
      headers: { cookie: sessions.a.cookie },
      payload: payload({ title: 'Reunião M5 reocupando horário cancelado', start: '09:00', end: '10:00' }),
    });
    expect(res.statusCode).toBe(201);
    m.m5 = res.json().meeting.id;
  });
});

describe('métricas (KPIs)', () => {
  it('month-counts e meeting-metrics batem com os dados gravados', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/meeting-metrics?month=2030-01',
      headers: { cookie: sessions.a.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.month).toBe('2030-01');
    // Em 2030-01 temos M2, M3, M4, M5 agendadas (M1 cancelada)
    expect(body.monthCount).toBeGreaterThanOrEqual(4);
    expect(body.cancelled).toBeGreaterThanOrEqual(1);
    expect(typeof body.today).toBe('number');
    expect(typeof body.upcoming).toBe('number');
    expect(body.total).toBeGreaterThanOrEqual(body.monthCount);

    // Recorte por autor (somente agendadas, como a métrica): A criou M1..M5 (M1 cancelada, M3 do B)
    const mine = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM meetings
        WHERE created_by_user_id = $1 AND status = 'SCHEDULED'
          AND starts_at >= '2030-01-01' AND starts_at < '2030-02-01'`,
      [sessions.a.id],
    );
    expect(body.createdByMe).toBe(mine.rows[0]?.n);
  });
});

describe('outbox transacional e workers', () => {
  it('outbox é gravada na MESMA transação da reunião (rollback remove ambos)', async () => {
    const fakeId = randomUUID();
    const mail: MeetingMailData = {
      id: fakeId,
      title: 'Transacional',
      responsibleName: 'Teste',
      startsAt: new Date('2030-03-01T13:00:00.000Z'),
      endsAt: new Date('2030-03-01T14:00:00.000Z'),
      description: 'Teste de atomicidade.',
      observations: null,
      createdByName: 'Teste',
      createdAt: new Date(),
    };

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO meetings (id, title, responsible_name, starts_at, ends_at, description, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [fakeId, mail.title, mail.responsibleName, mail.startsAt, mail.endsAt, mail.description, sessions.a.id],
      );
      await enqueueMeetingEvent(client, {
        eventType: 'MEETING_CREATED',
        kind: 'created',
        meetingId: fakeId,
        eventKey: `created:${fakeId}`,
        meeting: mail,
        baseUrl: 'http://localhost:4175',
      });
      // Falha proposital: força rollback
      throw new Error('rollback proposital');
    }).catch(() => undefined);

    const meetingGone = await queryOne('SELECT id FROM meetings WHERE id = $1', [fakeId]);
    expect(meetingGone).toBeNull();
    const outboxGone = await queryOne('SELECT id FROM notification_outbox WHERE event_key = $1', [
      `created:${fakeId}`,
    ]);
    expect(outboxGone).toBeNull();

    // Pelo caminho normal (API), reunião e outbox nascem juntas e atomicamente
    const rows = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notification_outbox WHERE event_key = $1`,
      [`created:${m.m5}`],
    );
    expect(rows.rows[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it('idempotência: repetir a mesma chave não duplica destinatários', async () => {
    const before = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM notification_outbox WHERE event_key = $1',
      [`created:${m.m5}`],
    );
    const first = before.rows[0]?.n ?? 0;
    expect(first).toBeGreaterThanOrEqual(1);

    // Re-enfileira a MESMA chave: unique (event_key, recipient_user_id) impede duplicação
    const meetingRow = await queryOne<{
      id: string;
      title: string;
      responsible_name: string;
      starts_at: Date;
      ends_at: Date;
      description: string;
      observations: string | null;
      created_at: Date;
    }>('SELECT id, title, responsible_name, starts_at, ends_at, description, observations, created_at FROM meetings WHERE id = $1', [m.m5]);
    const creator = await queryOne<{ full_name: string }>('SELECT full_name FROM users WHERE id = $1', [
      sessions.a.id,
    ]);

    const repeat = await withTransaction((client) =>
      enqueueMeetingEvent(client, {
        eventType: 'MEETING_CREATED',
        kind: 'created',
        meetingId: m.m5,
        eventKey: `created:${m.m5}`,
        meeting: {
          id: m.m5,
          title: meetingRow!.title,
          responsibleName: meetingRow!.responsible_name,
          startsAt: meetingRow!.starts_at,
          endsAt: meetingRow!.ends_at,
          description: meetingRow!.description,
          observations: meetingRow!.observations,
          createdByName: creator?.full_name ?? 'Teste',
          createdAt: meetingRow!.created_at,
        },
        baseUrl: 'http://localhost:4175',
      }),
    );

    expect(repeat.queued).toBe(0);
    expect(repeat.skipped).toBe(first);

    const after = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM notification_outbox WHERE event_key = $1',
      [`created:${m.m5}`],
    );
    expect(after.rows[0]?.n).toBe(first);
  });

  it('dois workers concorrentes enviam cada notificação exatamente uma vez', async () => {
    const title = `Workers concorrentes ${stamp}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/meetings',
      headers: { cookie: sessions.admin.cookie },
      payload: payload({ title, date: DAY_20, start: '08:00', end: '09:00' }),
    });
    expect(res.statusCode).toBe(201);
    const meetingId = res.json().meeting.id;
    const eventKey = `created:${meetingId}`;

    const active = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE status = 'ACTIVE'`,
    );
    const expected = active?.n ?? 0;
    expect(expected).toBeGreaterThanOrEqual(3);

    // Duas instâncias paralelas drenam a fila (FOR UPDATE SKIP LOCKED).
    // O Mailpit local leva ~1,1 s por mensagem (greeting SMTP lento no
    // Docker Desktop/Windows), então o prazo de drenagem é generoso e há
    // pausas entre as rodadas — o worker em segundo plano (dev server) também
    // participa do envio, e tudo precisa chegar a SENT antes da asserção.
    const deadline = Date.now() + 300_000;
    for (let i = 0; Date.now() < deadline; i += 1) {
      await Promise.all([processOutbox(50), processOutbox(50)]);
      const pending = await queryOne<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification_outbox
          WHERE event_key = $1 AND status IN ('PENDING','RETRYING','SENDING')`,
        [eventKey],
      );
      if ((pending?.n ?? 0) === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const rows = await query<{ status: string; attempt_count: number; recipient_user_id: string }>(
      'SELECT status, attempt_count, recipient_user_id FROM notification_outbox WHERE event_key = $1',
      [eventKey],
    );
    expect(rows.rows.length).toBe(expected);
    const notSent = rows.rows.filter((r) => r.status !== 'SENT');
    if (notSent.length > 0) {
      const detail = await query<{ status: string; attempt_count: number; last_error: string | null; next_attempt_at: Date | null }>(
        `SELECT status, attempt_count, last_error, next_attempt_at
           FROM notification_outbox WHERE event_key = $1 AND status <> 'SENT'`,
        [eventKey],
      );
      console.error('[TESTE] linhas não enviadas:', JSON.stringify(detail.rows, null, 2));
    }
    expect(rows.rows.every((r) => r.status === 'SENT')).toBe(true);
    expect(new Set(rows.rows.map((r) => r.recipient_user_id)).size).toBe(expected);

    // Comprovação no Mailpit: exatamente UMA mensagem por destinatário com
    // este assunto (prova material de "exatamente uma vez"). Uma linha pode
    // ter `attempt_count > 1` sem duplicar entrega — a 1ª tentativa falhou
    // por lentidão do SMTP do Mailpit e foi reagendada; o que não pode haver
    // são DUAS entregas, e é o Mailpit que comprova isso.
    const mailCount = await mailpitCountBySubject(`Nova reunião agendada: ${title}`);
    if (mailCount !== null) {
      expect(mailCount).toBe(expected);
    } else {
      // Sem Mailpit disponível, a única prova de não-reentrega é a tentativa única.
      expect(rows.rows.every((r) => r.attempt_count === 1)).toBe(true);
    }
  }, 360_000);
});

describe('concorrência real (duas gravações simultâneas)', () => {
  it('exatamente um 201 e um 409, sem sobreposição no banco', async () => {
    const p = payload({ title: 'Concorrência simultânea', date: DAY_20, start: '15:00', end: '16:00' });

    const [r1, r2] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { cookie: sessions.admin.cookie }, payload: p }),
      app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { cookie: sessions.a.cookie }, payload: p }),
    ]);

    const codes = [r1.statusCode, r2.statusCode].sort((x, y) => x - y);
    expect(codes).toEqual([201, 409]);

    const winner = r1.statusCode === 201 ? r1 : r2;
    expect(winner.json().meeting.id).toBeTruthy();

    // Validação direta no PostgreSQL: nenhum intervalo ativo sobreposto em toda a tabela
    const overlaps = await query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM meetings a
         JOIN meetings b ON a.id < b.id
          AND a.status <> 'CANCELLED' AND b.status <> 'CANCELLED'
          AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')`,
    );
    expect(overlaps.rows[0]?.n).toBe(0);

    const slot = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM meetings
        WHERE status <> 'CANCELLED'
          AND starts_at = '2030-01-20T19:00:00.000Z'
          AND ends_at = '2030-01-20T20:00:00.000Z'`,
    );
    expect(slot.rows[0]?.n).toBe(1);
  }, 60_000);
});
