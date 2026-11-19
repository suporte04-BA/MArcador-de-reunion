# Arquitetura — Agenda BA

## Visão geral

Monorepo npm workspaces com três pacotes:

- `packages/shared` — schemas zod, utilitários de data/hora (fuso America/Manaus),
  tipos compartilhados.
- `apps/api` — API Fastify (REST, sessões, e-mail, outbox).
- `apps/web` — SPA React (Vite + Tailwind v4).

A aplicação é servida pela API em produção (SPA estático + rotas `/api`); em
desenvolvimento o Vite proxya `/api`, `/uploads` e `/brand` para a API.

## Modelo de dados (PostgreSQL)

- `users`, `sessions`, `meetings`, `notification_outbox`, `audit_logs`,
  `auth_tokens`.
- Sobreposição de horários garantida por constraint GiSt na tabela `meetings`
  (intervalos `[início, fim)`; cancelada libera o horário; consecutivos ok).
- Outbox transacional: `ON CONFLICT (event_key, recipient_user_id) DO NOTHING`;
  worker com `FOR UPDATE SKIP LOCKED` e backoff exponencial.

## Autenticação e autorização

- Sessões server-side (cookie `agenda_session`, HttpOnly, SameSite=Lax).
- Permissões de edição/cancelamento/exclusão validadas na API (`canManageMeeting`),
  never only hiding buttons. "Responsável" é texto livre e não concede nada.

## E-mail

- Todos os e-mails passam pela outbox (transacional).
- HTML tabelado + texto + logo via CID (`cid:logo`).
- Convite de uso único (72h); senha temporária administrativa com troca forçada.

## Front-end

- Sem router: `?convite=`, `?redefinir=`, `?reuniao=` via `URLSearchParams`.
- Duas abas: Reuniões (todos) e Usuários (somente ADMIN).
- KPIs clicáveis abrem painel lateral; mini-calendário customizado com
  contagens; datas absolutas (dd/MM/aaaa).

## Rede

- App em `0.0.0.0`, `APP_BASE_URL` configurável (LAN).
- PostgreSQL (5433) e Mailpit (1025/8025) apenas em `localhost`.
