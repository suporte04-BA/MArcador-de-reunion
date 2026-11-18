# Agenda BA — Agenda Corporativa

Sistema web de agendamento de reuniões compartilhado para a rede local da BA
Elétrica / Help Desk. Todos os usuários ativos visualizam a agenda e recebem
aviso por e-mail em criação, alteração e cancelamento de reuniões.

## Stack

- **Monorepo** npm workspaces: `packages/shared`, `apps/api`, `apps/web`.
- **API**: Node.js 24 + TypeScript 5.9, Fastify 5, PostgreSQL (`pg`), Argon2id,
  nodemailer, zod.
- **Web**: React 19 + Vite 8 + Tailwind CSS v4.
- **Banco**: PostgreSQL 17 (`postgres:17-alpine`).
- **E-mail local**: Mailpit (SMTP 1025, UI/API 8025).
- **Testes**: Vitest + Playwright.

## Como rodar (desenvolvimento)

1. Subir a infraestrutura (PostgreSQL 5433 + Mailpit):

   ```powershell
   docker compose up -d
   ```

2. Instalar dependências e rodar a migração:

   ```powershell
   npm install
   npm run db:migrate
   ```

3. Criar o administrador inicial (somente na primeira vez):

   ```powershell
   npm run admin:create
   ```

   Credenciais padrão: `admin` / `AgendaBA#2026adm` (troque em produção).

4. Configurar `.env` (copie de `.env.example` e ajuste `APP_BASE_URL` para o IP
   da máquina na LAN, ex.: `http://192.168.0.102:4175`).

5. Rodar a aplicação (API :4175 + Vite :5173):

   ```powershell
   npm run dev
   ```

6. Acessar:

   - Na própria máquina: `http://localhost:5173` (dev) ou `http://localhost:4175`.
   - Na LAN: `http://192.168.0.102:4175` (ou `:5173` em dev).

## Comandos de qualidade

```powershell
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

## Usuários

- `admin` / `AgendaBA#2026adm` — administrador (troca de senha recomendada).
- `mytest` / `bababa` — usuário de demonstração (troca de senha forçada no
  primeiro acesso).
- Novos usuários são criados pelo administrador na aba **Usuários**, via convite
  por e-mail (link de uso único, 72h) ou senha temporária (troca forçada).

## E-mail

- Desenvolvimento/teste: Mailpit em `http://localhost:8025`.
- Produção: configure SMTP real em `.env` (`SMTP_HOST`, `SMTP_PORT`, …).
  O botão **Testar conexão SMTP** valida a entrega.

## Fuso horário e idioma

- Idioma: pt-BR.
- Fuso: `America/Manaus` (configurável por `APP_TIMEZONE`).
- Datas e horários são sempre absolutos (dd/MM/aaaa, HH:MM) — nunca relativos.

## Segurança

- Sessões server-side (cookie `agenda_session`, HttpOnly, SameSite=Lax).
- Senhas nunca são enviadas por e-mail; convites de uso único (72h) ou senha
  temporária administrativa com troca forçada.
- Apenas quem agendou (ou um administrador) edita/cancela/exclui — validado
  na API (HTTP 403).
- Zero sobreposição de horários garantida por constraint GiSt no PostgreSQL.
- PostgreSQL e Mailpit **não** são expostos à rede (apenas `localhost`).

## Documentação

- `docs/ARCHITECTURE.md` — arquitetura e decisões.
- `docs/BRAND_ASSETS.md` — ativos de marca (logo).
- `docs/TEST_REPORT.md` — relatório de testes com evidências.
- `docs/PLANO_MESTRE.md` — especificação completa.
