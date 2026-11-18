-- ============================================================
-- 003_departments — Revisão V2 (setores, login e e-mail)
-- Agenda Corporativa | BA Elétrica
--
-- Não destrutivo: nenhuma DROP TABLE, nenhuma alteração de dado
-- existente. Mantém integridade dos usuários/reuniões já gravados.
--
-- Conteúdo:
--   1. Extensão `unaccent` + funções imutáveis de chave normalizada;
--   2. Tabela `departments` (setores da empresa);
--   3. Seed idempotente dos 3 setores iniciais;
--   4. `users.department_id` e `meetings.department_id` (NULLABLE);
--   5. Chaves normalizadas de username/e-mail (unicidade V2 §9);
--   6. Relatório de backfill (quantos registros estão sem setor).
--
-- `department_id` permanece NULLABLE nesta fase. A coluna só passa a
-- NOT NULL depois que o relatório da seção 6 provar que não resta
-- nenhum usuário/reunião sem classificação (Revisão V2 §2.3, item 6).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

-- ------------------------------------------------------------
-- Chave de comparação compartilhada (V2 §4.2):
--   NFKC -> trim -> colapsar espaços internos -> minúsculas ->
--   remover diacríticos (unaccent)
-- Usada por: login, unicidade de username e unicidade de setor.
-- O nome exibido NUNCA passa por esta função (preserva caixa/acento).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION agenda_normalize_key(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT regexp_replace(
           lower(unaccent(normalize(btrim(p_input), NFKC))),
           '\s+',
           ' ',
           'g'
         );
$$;

-- ------------------------------------------------------------
-- Slug interno do setor: derivado do nome no servidor.
-- O cliente nunca envia slug (V2 §2.1).
--   'Administrador/TI' -> 'administrador-ti'
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION agenda_slugify(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT trim(
           both '-' from
           regexp_replace(
             lower(unaccent(normalize(btrim(p_input), NFKC))),
             '[^a-z0-9]+',
             '-',
             'g'
           )
         );
$$;

-- --------------------------- Setores ---------------------------
CREATE TABLE IF NOT EXISTS departments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               varchar(80)  NOT NULL,
  normalized_name    varchar(100) NOT NULL UNIQUE,
  slug               varchar(100) NOT NULL UNIQUE,
  description        varchar(500),
  color_key          varchar(30),
  is_active          boolean      NOT NULL DEFAULT true,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_by_user_id uuid REFERENCES users(id),
  CONSTRAINT departments_name_len CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  CONSTRAINT departments_desc_len CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT departments_color_len CHECK (color_key IS NULL OR char_length(color_key) <= 30)
);

CREATE INDEX IF NOT EXISTS departments_active_idx ON departments (is_active, name);

-- ------------------------------------------------------------
-- Seed idempotente — exatamente os 3 setores da Revisão V2 §2.
--   * "upsert" por chave normalizada (ON CONFLICT DO NOTHING);
--   * roda 2 vezes sem duplicar (teste 11.1);
--   * preserva edição/manual já feita pelo administrador;
--   * registra o administrador ativo como autor quando houver.
-- ------------------------------------------------------------
INSERT INTO departments (name, normalized_name, slug, description, color_key, is_active, created_by_user_id, updated_by_user_id)
SELECT v.name,
       v.normalized_name,
       v.slug,
       v.description,
       v.color_key,
       true,
       a.id,
       a.id
FROM (
  VALUES
    ('Administrador/TI',
     agenda_normalize_key('Administrador/TI'),
     agenda_slugify('Administrador/TI'),
     'Administracao, suporte e infraestrutura de TI.'::varchar(500),
     NULL::varchar(30)),
    ('Fiscal',
     agenda_normalize_key('Fiscal'),
     agenda_slugify('Fiscal'),
     'Fiscalizacao e conformidade.'::varchar(500),
     NULL::varchar(30)),
    ('Financeiro',
     agenda_normalize_key('Financeiro'),
     agenda_slugify('Financeiro'),
     'Financeiro, contas e orcamento.'::varchar(500),
     NULL::varchar(30))
) AS v(name, normalized_name, slug, description, color_key)
LEFT JOIN (
  SELECT id FROM users
  WHERE role = 'ADMIN' AND status = 'ACTIVE'
  ORDER BY created_at
  LIMIT 1
) AS a ON true
ON CONFLICT (normalized_name) DO NOTHING;

-- Verificação dura: se qualquer setor do seed faltar, a migration falha
-- alto em vez de entregar catálogo incompleto.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(v.name, ', ' ORDER BY v.name)
    INTO missing
  FROM (VALUES ('Administrador/TI'), ('Fiscal'), ('Financeiro')) AS v(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM departments d
    WHERE d.normalized_name = agenda_normalize_key(v.name)
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Seed de setores incompleto. Ausentes: %', missing;
  END IF;
END $$;

-- ------------------------------------------------------------
-- Vínculo organizacional (nullable nesta fase).
-- ON DELETE: padrão NO ACTION impede exclusão física de setor com
-- vínculo (a interface só oferece desativação — V2 §2.2).
-- ------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);

CREATE INDEX IF NOT EXISTS users_department_idx
  ON users (department_id);

CREATE INDEX IF NOT EXISTS meetings_department_idx
  ON meetings (department_id, starts_at);

-- ------------------------------------------------------------
-- Chaves normalizadas (V2 §9 — unicidade sem diferenciar caixa,
-- espaços repetidos ou acentos).
-- Colunas GERATED: o servidor recalcula sempre; o cliente não envia.
-- ------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username_key varchar(120)
  GENERATED ALWAYS AS (agenda_normalize_key(username)) STORED;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_key varchar(254)
  GENERATED ALWAYS AS (agenda_normalize_key(email)) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_norm_key
  ON users (username_key);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_norm_key
  ON users (email_key);

-- ------------------------------------------------------------
-- Relatório de backfill (V2 §2.3, itens 3 e 6).
-- Sem inferência de setor a partir de cargo/nome: quem não tem
-- evidência permanece sem setor até classificação administrativa.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_users      integer;
  v_meetings   integer;
  v_users_ok   integer;
  v_mtg_ok     integer;
BEGIN
  SELECT count(*) INTO v_users      FROM users;
  SELECT count(*) INTO v_users_ok   FROM users    WHERE department_id IS NOT NULL;
  SELECT count(*) INTO v_meetings   FROM meetings;
  SELECT count(*) INTO v_mtg_ok     FROM meetings WHERE department_id IS NOT NULL;

  RAISE NOTICE
    'RELATORIO BACKFILL SETORES: usuarios %/% classificados (% pendentes); reunioes %/% classificadas (% pendentes)',
    v_users_ok, v_users, v_users - v_users_ok,
    v_mtg_ok, v_meetings, v_meetings - v_mtg_ok;

  IF v_users - v_users_ok > 0 OR v_meetings - v_mtg_ok > 0 THEN
    RAISE NOTICE
      'ATENCAO: ainda existem registros sem setor. NAO aplicar NOT NULL em department_id ate o relatorio zerar.';
  ELSE
    RAISE NOTICE
      'OK: todos os usuarios e reunioes estao classificados. NOT NULL em department_id pode ser avaliado.';
  END IF;
END $$;
