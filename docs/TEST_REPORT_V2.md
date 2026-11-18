# TEST_REPORT_V2 — Revisão V2

## Ambiente

- Node v24.16.0, PostgreSQL 17 (Docker :5433), API :4175, Vite :5173, Mailpit :1025/:8025.
- Backup pré-mudança: `backups/agenda_ba_20261118_084432.dump` (46.442 bytes).

## Comandos executados

| Comando | Resultado |
|---|---|
| `npm run lint` | PASSOU (0 erros) |
| `npm run typecheck` | PASSOU (0 erros) |
| `npm run build` | PASSOU |
| `npm run test` | PASSOU (104/104) |
| `npm run db:migrate` | PASSOU (migrations 003, 004 aplicadas) |
| `npm run admin:bootstrap` | NÃO EXECUTADO (senha fornecida pelo operador via terminal) |

## Suítes

- `packages/shared` (normalization 13 + schemas 14 + date-time 21) = 48 testes.
- `apps/api` units (templates 10, service 7, auth 6) = 23 testes.
- `apps/api` integration = 33 testes (login normalizado, paridade TS↔SQL, senha min 4, setores CRUD/dedupe/permissão/KPIs, reuniões com setor, outbox idempotência e concorrência, autorização).

## Status por requisito

| Requisito | Status |
|---|---|
| Duas abas principais (Reuniões, Usuários) | PASSOU |
| Sub-abas Usuários/Setores | PASSOU |
| Setor ≠ role (department_id independente) | PASSOU |
| Seed 3 setores idempotente | PASSOU |
| Sector CRUD + dedupe case/acento/espaço | PASSOU |
| Soft-delete, sem exclusão física com vínculos | PASSOU |
| Usuário: username único normalizado, e-mail único, setor obrigatório | PASSOU |
| Senha min 4 (frontend + backend) | PASSOU |
| Argon2id | PASSOU |
| Status ACTIVE imediato | PASSOU |
| "Acesso administrativo" independente | PASSOU |
| Login por username normalizado (Sérgio Rodrigues) | PASSOU |
| Reunião: setor obrigatório, pré-seleção | PASSOU |
| Setor em tabela/calendário/detalhe/filtros/KPIs/e-mails | PASSOU |
| Permissão ADMIN ou created_by | PASSOU |
| KPIs Total de usuários / Total de setores lado a lado, contagens reais, clicáveis | PASSOU |
| Bootstrap idempotente Sérgio Rodrigues | NÃO EXECUTADO (operador roda) |
| SMTP verify() vs sendMail() separados | PASSOU |
| E-mail de teste apenas ao selecionado | PASSOU |
| Outbox per-recipient, retries, idempotência | PASSOU |
| Logo CID | PASSOU |
| Sem senha em e-mail | PASSOU |
| Sem DROP TABLE / migrations não-destrutivas | PASSOU |
| Backup pré-migração | PASSOU |
| Autorização server-side em rotas protegidas | PASSOU |
| Erros genéricos de login | PASSOU |
| Rate limiting | PASSOU |

## Pendências externas

- **PENDENTE EXTERNO**: envio real a provedores externos depende de credenciais SMTP reais (`SMTP_HOST/PORT/USER/PASS`). Pipeline validado via Mailpit (verify + send + CID + per-recipient).
- **NÃO EXECUTADO**: `npm run admin:bootstrap` — a ser rodado pelo operador com a senha administrativa (via prompt oculto ou `BOOTSTRAP_ADMIN_PASSWORD`).

## Testes E2E

- `e2e/admin.spec.ts`, `e2e/meetings.spec.ts`, `e2e/auth.spec.ts` atualizados para o contrato V2 (departmentId obrigatório, senha min 4, conta ativa imediata). Execução via Playwright não rodada nesta sessão (requer dev server + browser).
