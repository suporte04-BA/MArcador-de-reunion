-- ============================================================
-- 004_normalize_key_whitespace — Revisão V2 §4.2
--
-- Corrige `agenda_normalize_key` para seguir EXATAMENTE o contrato
-- da função TypeScript compartilhada `usernameKey()`:
--
--   1. Unicode NFKC;
--   2. trim de whitespace (tabs, quebras de linha, NBSP...);
--   3. colapsar sequências de whitespace em um único espaço;
--   4. minúsculas;
--   5. remover diacríticos.
--
-- A versão anterior fazia `btrim` (somente U+0020) ANTES do NFKC e não
-- repetia o trim depois, de modo que whitespace que o NFKC normaliza
-- (ex.: U+3000 -> U+0020) ou tabs nas pontas sobravam na chave — o que
-- quebrava o login com "\tadmin" e divergia do TypeScript.
--
-- Não destrutivo: apenas substitui a definição da função e recalcula as
-- colunas geradas (`username_key`, `email_key`) das linhas existentes.
-- Nenhuma DROP TABLE e nenhum dado é apagado.
-- ============================================================

CREATE OR REPLACE FUNCTION agenda_normalize_key(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT lower(
           unaccent(
             regexp_replace(
               regexp_replace(normalize(p_input, NFKC), '^\s+|\s+$', '', 'g'),
               '\s+',
               ' ',
               'g'
             )
           )
         );
$$;

-- Força o recálculo das colunas geradas (atribuir a própria coluna de
-- entrada dispara a reavaliação da expressão GENERATED ALWAYS).
UPDATE users SET username = username, email = email;
UPDATE departments SET name = name;

-- Relatório de paridade: chave TS enviada em teste de integração é
-- conferida contra esta função; aqui apenas mostra amostras.
DO $$
DECLARE
  v integer;
BEGIN
  SELECT count(*) INTO v FROM users WHERE username_key IS NULL OR email_key IS NULL;
  IF v > 0 THEN
    RAISE EXCEPTION 'Chave normalizada nula em % usuario(s).', v;
  END IF;
  RAISE NOTICE 'OK: % usuario(s) com username_key/email_key recalculados.', (SELECT count(*) FROM users);
END $$;
