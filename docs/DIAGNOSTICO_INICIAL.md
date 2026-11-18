# DIAGNÓSTICO INICIAL — Revisão V2 (Setores, Login, E-mail)

**Projeto:** Agenda Corporativa | BA Elétrica
**Data do diagnóstico:** 18/11/2026
**Escopo:** Fase 0 da Revisão V2 — reprodução dos defeitos relatados, mapeamento do fluxo atual e causa raiz, **antes** de qualquer alteração de código.

---

## 1. Ambiente e serviços verificados

| Item | Valor observado |
|---|---|
| Diretório do projeto | `C:\Users\usuario\Downloads\agenda-ba-eletrica` |
| Controle de versão | **Não é um repositório git** (`git status` indisponível) — backup manual realizado (seção 6) |
| Node.js | v24.16.0 |
| PostgreSQL | 17.12 (Docker `agenda-ba-postgres`, porta **5433**, db `agenda_ba`, usuário `agenda`) |
| Extensões PG | `plpgsql`, `btree_gist` (exclusão de sobreposição de reuniões) |
| API | porta **4175** (`npm run dev -w @agenda/api`, tsx watch), saúde: `{"status":"ok","database":"connected"}` |
| Web (Vite) | porta **5173** |
| SMTP local | Mailpit (`agenda-ba-mailpit`): SMTP **1025**, interface **8025** |
| Fuso | `America/Manaus` |
| Migrations aplicadas | `001_init.sql`, `002_username_case.sql` (nenhuma alterada após aplicação — checksums íntegros) |
| Tabelas | `users`, `meetings`, `sessions`, `auth_tokens`, `notification_outbox`, `audit_logs`, `schema_migrations` — **não existe tabela de setores/departments** |
| Dados no banco | 2 usuários (`admin`, `mytest` — ambos ADMIN/ACTIVE), 5 reuniões (4 SCHEDULED, 1 CANCELLED) |

### Variáveis de configuração relevantes (segredos mascarados)

```
APP_BASE_URL=http://192.168.0.102:4175      # LAN
DATABASE_URL=postgresql://agenda:***@localhost:5433/agenda_ba
SESSION_IDLE_TIMEOUT_MINUTES=30
SMTP_HOST=localhost  SMTP_PORT=1025  SMTP_SECURE=false  SMTP_REQUIRE_TLS=false
SMTP_USER=(vazio)    SMTP_PASS=***          # sem credencial SMTP real
SMTP_FROM_ADDRESS=agenda@baeletrica.com.br
EMAIL_RETRY_MAX_ATTEMPTS=8  EMAIL_RETRY_BASE_SECONDS=60
```

> **Observação:** o `.env` aponta para **Mailpit local** (`localhost:1025`) e não tem credenciais de um provedor SMTP real. Todo envio real para caixa externa depende de credenciais que ainda não foram fornecidas (ver `EMAIL_DIAGNOSTIC.md`).

---

## 2. Sintomas relatados × reprodução

### 2.1 Login por nome de usuário

**Fluxo atual mapeado (ponta a ponta):**

1. `LoginPage.tsx` → `onSubmit` envia `POST /api/v1/auth/login` com `{ username: identifier.trim(), password }` — **campo correto** (`username`), não há divergência frontend/backend de nome de campo.
2. Backend (`auth/routes.ts`): `identifier = body.username.trim().toLowerCase()`; busca SQL `WHERE lower(username) = $1 OR lower(email) = $1`.
3. Verificação Argon2id (`@node-rs/argon2`, `verify`) com hash dummy para usuário inexistente (evita enumeração).
4. Sessão gravada em PostgreSQL (`sessions`), cookie `agenda_session` **HttpOnly + SameSite=Lax**, expiração deslizante de 30 min, rotação por logout server-side.
5. Falha responde sempre `401 INVALID_CREDENTIALS` genérico; rate limit por IP+usuário (janelas/lockout implementados); bloqueio de 15 min após 5 tentativas.

**Reproduções executadas (API real, 18/11/2026):**

| Tentativa | Resultado | Esperado pela V2 |
|---|---|---|
| `admin` + senha correta | **200 OK** | 200 |
| `ADMIN` (maiúsculas) + senha correta | **200 OK** | 200 (caixa-insensível) |
| `José da Silva` (como cadastrado) | **200 OK** | 200 |
| `josesilva2@baeletrica.com.br` (e-mail) | **200 OK** | 200 |
| `JOSE DA SILVA` (sem acento) | **401** | 200 — mesma chave de comparação |
| `José   da   Silva` (espaços internos duplos) | **401** | 200 — colapsar espaços |
| `admin` + senha errada | 401 genérico | 401 genérico ✓ |

**Causa raiz (login):** a normalização aplicada é apenas `trim() + toLowerCase()`. A comparação usa `lower(username)` no PostgreSQL, que **não remove diacríticos** (`Sérgio` ≠ `sergio`) e **não colapsa espaços internos** (`José da Silva` ≠ `José   da   Silva`). Não há função única compartilhada de chave de comparação (NFKC → trim → colapsar espaços → minúsculas → remover diacríticos) exigida pela V2 §4.2. O caso `Sérgio Rodrigues` (sem acento/maiúsculas) falharia de forma idêntica — defeito confirmado mecanicamente.

**Demais constatações do fluxo de login:**
- Sessão persistida em banco: sobrevive a restart da API (verificado — cookie continuou válido entre chamadas após restart do tsx watch).
- Erros genéricos, sem enumeração de usuário: conforme.
- CSRF: hook de origem + SameSite=Lax: conforme.
- Nenhum segredo (hash/senha/token) aparece nas respostas de login inspecionadas.

### 2.2 Política de senha inconsistente entre camadas

| Camada | Regra atual | V2 exige |
|---|---|---|
| `passwordSchema` (shared, API) | **mín. 8** caracteres | **mín. 4** |
| `tempPasswordSchema` (criação de usuário, API) | **mín. 6** caracteres | **mín. 4** |
| Dicas de UI (`LoginPage`, hints "Mínimo de 8 caracteres.") | **mín. 8** | **mín. 4** |
| Criação de usuário com senha `abcd` | **400 rejeitado** (mín. 6) | aceitar (4 ≥ 4) |

**Causa raiz:** três regras divergentes (8/6/4) implementadas separadamente, sem valor único compartilhado. A V2 §3.5 exige **exatamente 4** nas duas camadas, sem elevação silenciosa.

### 2.3 Criação de usuário não corresponde ao fluxo V2

- A API exige `mode: 'INVITE' | 'TEMP_PASSWORD'`; `INVITE` cria conta **PENDING** (sem login imediato) e `TEMP_PASSWORD` força troca de senha no 1º acesso (`must_change_password=true`).
- **Não existe campo de setor** em criação/edição (coluna `department_id` inexiste).
- A V2 exige: senha inicial obrigatória (mín. 4), conta **ACTIVE imediatamente**, e-mail de boas-vindas **sem senha em texto**, troca de senha não obrigatória.
- Registro de auditoria confirma o fluxo antigo (`USER_CREATED … {"mode":"TEMP_PASSWORD"}`).

### 2.4 Setores (inexistente)

- Não há tabela `departments`, nem `department_id` em `users`/`meetings`, nem endpoints, nem UI de setores, nem coluna de setor em reuniões. Confirmedo por `\d users`, `\d meetings` e busca em `apps/`.
- Consequência: sem subaba Setores, sem KPI "Total de setores", sem setor no formulário de reunião — exatamente os itens 1–5 do estado relatado na V2 §0.

### 2.5 Envio de e-mail

**Fluxo atual mapeado:** `outbox` transacional → worker (`FOR UPDATE SKIP LOCKED`, retry exponencial, `attempt_count`, `next_attempt_at`, `last_error`, `provider_message_id`) → `sendMail()` do Nodemailer com logo por CID e anexo `.ics` em eventos de reunião.

**Reproduções executadas (18/11/2026):**

| Verificação | Resultado |
|---|---|
| `POST /api/v1/admin/email/test-connection` (`transporter.verify()`) | **200 `ok:true`** — "Servidor SMTP aceitou a conexão." |
| `POST /api/v1/admin/users/:id/send-test-email` (envio real ao usuário selecionado) | **enfileirado → `SENT`** com `provider_message_id` (`<848c6e38-…@baeletrica.com.br>`) |
| Mensagem recebida no Mailpit | **sim** — `To: josesilva2@baeletrica.com.br` (somente o destinatário selecionado), `From: agenda@baeletrica.com.br` |
| Estatísticas da outbox | 19 `SENT`, 0 pendentes/falhas |

**Causa raiz (e-mail):** o pipeline local **funciona com o Mailpit**. O relato de falha é consistente com (a) inexistência de credenciais/SMTP real no `.env` (`SMTP_USER` vazio, host `localhost`) e (b) falta de comprovação separada entre *verificar conexão* e *enviar mensagem* — a V2 §7.2 exige as duas operações distintas com evidências. **Não há como afirmar entrega em caixa externa** sem credenciais reais: etapa classificada como PENDENTE EXTERNO (ver `EMAIL_DIAGNOSTIC.md`).

**Detalhe adicional:** o endpoint `test-connection` responde `415` se chamado sem `Content-Type: application/json` (corpo `{}`) — comportamento do Fastify, registrado para o teste de UI correspondente.

### 2.6 Conta administrativa de teste

- A auditoria mostra que o usuário **"Sérgio Rodrigues" já existiu e foi excluído** em 18/11/2026 08:08 (`USER_DELETED`). O banco atual **não possui** essa conta — o bootstrap (Fase 3) deverá **recriá-la** com os dados da V2 §5.
- Contas existentes: `admin` (ADMIN/ACTIVE) e `mytest` (ADMIN/ACTIVE).

---

## 3. Causas-raiz consolidadas

| # | Sintoma | Causa raiz | Evidência |
|---|---|---|---|
| 1 | Login falha com variações de acento/espaço | Normalização sem NFKC/colapso de espaços/remoção de diacríticos; comparação via `lower()` puro | Reprodução 401 em `JOSE DA SILVA` e `José   da   Silva` |
| 2 | Política de senha divergente (8/6) | Regras duplicadas em camadas diferentes, sem fonte única | 400 ao criar usuário com senha de 4 caracteres |
| 3 | Sem setores | Tabela/colunas/endpoints/UI inexistentes (nunca implementados) | `\d users`, `\d meetings`, grep no código |
| 4 | Usuário não nasce ativo / exige troca de senha | Contrato `INVITE`/`TEMP_PASSWORD` antigo da V2 anterior | Resposta `201` com `must_change_password=true` |
| 5 | E-mail "não comprovado" | SMTP real não configurado (Mailpit-only) + verificação e envio não separados na UI | `.env` sem `SMTP_USER`; verify OK somente com Mailpit |
| 6 | Conta Sérgio Rodrigues inexistente | Registro excluído em 18/11/2026 | `audit_logs: USER_DELETED Sérgio Rodrigues` |

---

## 4. O que NÃO está defeituoso (não reescrever)

- Contrato de campo de login (`username` no payload) — consistente nas duas pontas.
- Sessão server-side em PostgreSQL + cookie HttpOnly — conforme V2 §4.4.
- Erros de login genéricos + rate limit + lockout progressivo — conforme V2 §3.5/§4.5.
- Hash Argon2id com salt único — conforme OWASP (não trocar por MD5/SHA).
- Fila transacional outbox com `SKIP LOCKED`, retry exponencial e idempotência por `event_key` — conforme V2 §7.5.
- Constraint de sobreposição de reuniões (`EXCLUDE USING gist` com `tstzrange … '[)' WHERE status <> 'CANCELLED'`) — conforme Plano Mestre; preservar.
- Proteção CSRF (origem + SameSite) e guarda `requireAdmin`/`requireAuth` em toda rota protegida.

---

## 5. Plano de correção (fases V2)

1. **Fase 1** — migration `003_departments.sql`: tabela `departments`, seed idempotente dos 3 setores, `department_id` nullable + backfill com relatório; `NOT NULL` só após prova de classificação total.
2. **Fase 2** — chave de normalização única compartilhada (`usernameKey`) usada em criação/login/unicidade; password mín. 4 nas duas camadas; contrato de criação → `ACTIVE` imediato.
3. **Fase 3** — `scripts/bootstrap-admin` idempotente com senha via `BOOTSTRAP_ADMIN_PASSWORD`/prompt oculto (nunca em arquivo/log); provisionar Sérgio Rodrigues.
4. **Fase 4** — subabas Usuários/Setores, KPIs clicáveis reais, CRUD de setores, formulário de usuário com setor + "Acesso administrativo" separado.
5. **Fase 5** — setor obrigatório em reuniões (form, tabela, detalhe, filtros, KPIs, e-mails).
6. **Fase 6** — separar verify × envio de teste, validar Mailpit de ponta a ponta, classificar SMTP real como pendência externa se não houver credenciais.
7. **Fase 7** — testes completos (lint/typecheck/vitest/integração/E2E/build) + documentação final.

---

## 6. Preservação de dados (executado nesta fase)

- **Backup:** `backups/agenda_ba_20261118_084432.dump` (pg_dump custom format, 46.442 bytes) gerado **antes** de qualquer alteração.
- Nenhum `DROP TABLE` previsto; migrations serão aditivas e não destrutivas.
- Migrations já aplicadas não serão editadas (checksum é verificado na execução).
