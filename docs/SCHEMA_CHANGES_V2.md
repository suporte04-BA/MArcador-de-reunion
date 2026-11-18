# SCHEMA_CHANGES_V2 — Revisão V2

## Migrations aplicadas

- `database/migrations/003_departments.sql` (checksum `c3dd7661…`, aplicada 2026-11-18)
- `database/migrations/004_normalize_key_whitespace.sql` (aplicada 2026-11-18)

Nenhuma `DROP TABLE`. Todas as mudanças são aditivas (colunas novas, tabelas novas, índices, funções).

## Funções SQL (IMMUTABLE)

- `agenda_normalize_key(text)` — NFKC → trim → colapsar espaços → minúsculas → `unaccent` → NFC. Usada em colunas geradas.
- `agenda_slugify(text)` — aplica `agenda_normalize_key` e substitui sequências não-alfanuméricas por `-`.

## Nova tabela `departments`

| coluna | tipo | regra |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| name | varchar(80) | CHECK `char_length(name) BETWEEN 2 AND 80` |
| normalized_name | varchar(120) | UNIQUE, gerado por `agenda_normalize_key(name)` |
| slug | varchar(120) | UNIQUE, gerado por `agenda_slugify(name)` |
| description | varchar(500) | CHECK ≤ 500 |
| color_key | varchar(30) | cor institucional (enum no app) |
| is_active | boolean | default true |
| created_at/updated_at | timestamptz | default now() |
| created_by_user_id / updated_by_user_id | uuid FK → users | nullable |

Índices: `departments_normalized_name_key` (unique), `departments_slug_key` (unique).

Seed idempotente (`ON CONFLICT (normalized_name) DO NOTHING`) dos 3 setores: `Administrador/TI`, `Fiscal`, `Financeiro` (ativos, sem acentos nas chaves).

## Alterações em `users`

- `department_id uuid NULL FK → departments` (nullable até backfill; NOT NULL não aplicado — 3 usuários legados permanecem NULL até classificação pelo admin).
- `username_key varchar(120) GENERATED ALWAYS AS (agenda_normalize_key(username)) STORED` + índice unique `users_username_norm_key`.
- `email_key varchar(254) GENERATED ALWAYS AS (agenda_normalize_key(email)) STORED` + índice unique `users_email_norm_key`.
- Índice `users_department_idx`.
- Índice legado `users_username_ci_key ON lower(username)` preservado (não-destrutivo).

## Alterações em `meetings`

- `department_id uuid NULL FK → departments`.
- Índice `meetings_department_idx`.

## Backfill

Todas as 5 reuniões e 3 usuários legados permanecem com `department_id IS NULL` (relatório de backfill na migration: 5/3). A regra de negócio exige setor em novos registros (validado na API); registros antigos continuam legíveis com setor nulo/desativado.

## Paridade JS ↔ SQL

`usernameKey()`, `departmentKey()`, `departmentSlug()` (TypeScript) espelham `agenda_normalize_key()`/`agenda_slugify()`. Prova por teste de integração (`apps/api/tests/integration.test.ts` — "chave normalizada do TypeScript é idêntica à do PostgreSQL") comparando amostras, incluindo `Straße`, `Łukasz`, `Administrador/TI`.

## Bootstrap seguro

`apps/api/src/config/bootstrap-admin.ts` (`npm run admin:bootstrap`) provisiona `Sérgio Rodrigues` (username `Sérgio Rodrigues`, e-mail `suporte04@baeletrica.com.br`, setor `Administrador/TI`, role ADMIN, status ACTIVE) de forma idempotente. A senha vem de `BOOTSTRAP_ADMIN_PASSWORD` ou prompt oculto; nunca é gravada/logada.
