# Relatório de Testes — Agenda BA

Data da execução: 17/11/2026 (ambiente Windows 11, Node 24, Docker Desktop).

## Resumo

| Suíte | Resultado |
|---|---|
| ESLint (flat config) | 0 erros |
| TypeScript (api + web + e2e) | 0 erros |
| Build (shared + api + web) | OK (web: 389 kB JS / 34 kB CSS) |
| Vitest (unitários + integração) | 81/81 aprovados |
| Playwright E2E (desktop + mobile) | 18/18 aprovados |

## Vitest (6 arquivos)

- `packages/shared/src/date-time` — 21 testes (incluindo `isExclusionViolation`-adjacente? não; data/hora).
- `packages/shared/src/schemas` — 14 testes (schemas zod).
- `apps/api/src/email/templates` — 10 testes.
- `apps/api/src/plugins/auth` — 6 testes (auth plugin).
- `apps/api/src/modules/meetings/service` — 7 testes (`isExclusionViolation` positivo/negativo incluindo 40P01; `conflictMessage`).
- `apps/api/tests/integration` — 23 testes (PostgreSQL real): agenda, conflito GiSt, concorrência, outbox, e-mail.

Tempo total: ~60 s (integração ~57 s por causa do greeting SMTP lento do Mailpit).

## Playwright E2E (18 testes)

Projeto `desktop` (1440×900): 15 testes — `admin.spec.ts` (4), `auth.spec.ts` (3),
`meetings.spec.ts` (8, incluindo o describe aninhado de leitura). Projeto `mobile`
(Pixel 7): 3 testes (smoke de autenticação e shell). `workers: 1`,
`timezoneId: America/Manaus`, `locale: pt-BR`.

Cenários cobertos:

- Login inválido → alerta `role="alert"` e permanência na tela de login.
- Login válido → exatamente duas abas (Reuniões, Usuários), logo BA Elétrica,
  rodapé com `Fuso horário America/Manaus`.
- Teclado: Enter envia o login; Escape fecha o drawer.
- Criação de reunião com selo `Livre — este horário está disponível.`, autoria
  (`Agendado por @usuário` + avatar/iniciais), e e-mail para todos os ativos.
- KPI "Próximas reuniões" abre painel lateral com data, início–fim, assunto,
  responsável e agendador; ação `Limpar filtro / agenda geral`.
- Conflito de horário: HTTP 409 `SCHEDULE_CONFLICT` com mensagem
  `Horário ocupado: ...` na API e aviso amigável na UI.
- Horários consecutivos permitidos; cancelamento libera o horário (reocupação
  imediata) e dispara e-mail `Reunião cancelada:`.
- Permissões: autor edita pela UI; admin edita reunião alheia (PATCH 200);
  usuário comum recebe 403 na API e não vê botões de gestão.
- Mini-calendário: seleção de dia, agenda do dia, contagem sr-only, datas
  absolutas (sem "hoje"/"amanhã"), `Voltar à agenda geral`.
- Usuário comum: aba Usuários oculta + 403 na API.
- Cadastro por convite: e-mail `Ative seu acesso — Agenda BA` com link
  `?convite=`, validade 72 h, logo via CID, sem senha.
- KPI "Convites pendentes" filtra a tabela (aria-pressed).
- E-mail de teste: confirmação exibe o destino; Mailpit recebe a mensagem
  `Teste de e-mail — Agenda BA` somente para o destinatário selecionado.
- Senha temporária: login sinaliza `mustChangePassword=true`; troca com campo
  "atual" vazio aceita; nova senha funciona; temporária deixa de valer.
- Mobile (Pixel 7): smoke de login e shell (3 testes).

## Verificação de e-mail (Mailpit)

Validado via API do Mailpit (`http://localhost:8025/api/v1/...`) em execuções
reais:

- Convite: assunto `Ative seu acesso - Agenda BA`, HTML com `cid:logo`,
  anexo inline `logo-ba.png` (Content-ID `logo`), link `APP_BASE_URL/?convite=`,
  menção a "72 horas", nenhuma senha no corpo.
- Criação: assunto `Nova reunião agendada: <título>`, HTML com `cid:logo` e
  `/?reuniao=`, texto com título e responsável.
- Cancelamento: assunto `Reunião cancelada: <título>`, HTML com `cid:logo`.
- Teste individual: assunto `Teste de e-mail - Agenda BA`, destinatário único
  (lista `To` com exatamente um endereço = usuário selecionado).
- Texto + HTML em todas as mensagens; logo via CID (sem imagem quebrada);
  nenhum anexo `.ics` (removido por decisão — desnecessário).

## Concorrência

- Teste de integração "dois workers concorrentes" (FOR UPDATE SKIP LOCKED):
  todas as linhas da outbox terminam `SENT` com `attempt_count = 1`; sem envio
  duplicado; Mailpit recebe exatamente uma mensagem por destinatário.
- Constraint GiSt capturada no PostgreSQL e convertida em HTTP 409 amigável;
  deadlock 40P01 também tratado como conflito (coberto por teste unitário).

## Pendências declaradas

- **SMTP real não testado**: apenas Mailpit (localhost:1025) foi validado. O
  botão "Testar conexão SMTP" e a configuração de SMTP real ficam para
  validação em ambiente com servidor SMTP acessível; o código sanitiza
  credenciais e reporta falha sem vazar segredos.
- Greeting SMTP do Mailpit no Windows/Docker leva ~1 s por mensagem; prazos de
  drenagem da outbox ajustados para 180 s (teste) / 90 s (integração) com
  polling de 500 ms.

## Comandos de reprodução

```powershell
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```
