# DEPLOYMENT — Revisão V2

## Pré-requisitos

- Node.js ≥ 24
- PostgreSQL 17 (porta 5433 no dev)
- (dev) Mailpit para validação de e-mail

## Variáveis de ambiente (`.env`)

```
DATABASE_URL=postgres://agenda:change_me@localhost:5433/agenda_ba
APP_BASE_URL=http://localhost:4175
APP_TIMEZONE=America/Manaus
SESSION_SECRET=...
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="Agenda BA <noreply@baeletrica.com.br>"
EMAIL_RETRY_BASE_SECONDS=30
EMAIL_RETRY_MAX_ATTEMPTS=5
BOOTSTRAP_ADMIN_PASSWORD=...   # opcional; se ausente, prompt oculto
```

## Passos

1. Instalar dependências: `npm install`
2. Aplicar migrations: `npm run db:migrate` (idempotente; nunca edita migration aplicada)
3. (opcional) Reset total (APAGA DADOS): `npm run db:reset -- --yes`
4. Backup antes de migrar (produção): `pg_dump -Fc ... > backups/agenda_ba_YYYYMMDD.dump`
5. Build: `npm run build`
6. Provisionar admin de teste: `npm run admin:bootstrap` (senha via prompt oculto ou `BOOTSTRAP_ADMIN_PASSWORD`)
7. Iniciar: `npm run start` (API) — ou `npm run dev` para desenvolvimento
8. Validar e-mail: `POST /api/v1/admin/email/test-connection` e `POST /api/v1/admin/users/:id/send-test-email`

## Validação pós-deploy

- `npm run lint` (0 erros)
- `npm run typecheck` (0 erros)
- `npm run test` (104 testes verdes)
- Login com `Sérgio Rodrigues` (variações de caixa/acento/espaço).
- KPIs "Total de usuários" / "Total de setores" refletem o banco.
- E-mail de teste chega apenas ao destinatário selecionado (verificar Mailpit/provedor).

## Segurança

- Server-side authorization em toda rota protegida.
- Rate limit no login.
- Argon2id para senhas (nunca MD5/SHA-1/SHA-256 simples).
- Senhas/tokens/se segredos nunca em logs, arquivos ou relatórios.
- Sem `DROP TABLE` em migrations.
