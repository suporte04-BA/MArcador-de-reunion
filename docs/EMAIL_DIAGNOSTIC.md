# EMAIL_DIAGNOSTIC — Revisão V2

## Diagnóstico inicial (Fase 0)

- `POST /api/v1/admin/email/test-connection` → 200 `{ ok: true }` (transporter.verify()).
- `POST /api/v1/admin/users/:id/send-test-email` → outbox `SENT` com Message-ID.
- Mailpit (`localhost:8025`) recebeu apenas o destinatário selecionado (19 SENT, 0 failed) — prova de envio individual.
- Sem credenciais SMTP reais → status **PENDENTE EXTERNO** para envio a provedores externos.

## Separação de responsabilidades (V2 §7)

- `verifySmtpConnection()` (transporter.verify()) ≠ `sendMail()` (sendMail). Endpoints distintos: `email/test-connection` (verificação) e `send-test-email` (envio real).
- `email/test-connection` exige `Content-Type: application/json` (415 caso contrário).

## Outbox (V2 §7)

- Tabela `notification_outbox` com status `PENDING/SENDING/SENT/RETRYING/FAILED`.
- `FOR UPDATE SKIP LOCKED` garante envio único por dois workers concorrentes (teste de integração comprova 1 entrega/destinatário, inclusive no Mailpit).
- Idempotência via `ON CONFLICT (event_key, recipient_user_id) DO NOTHING`.
- Retentativas com backoff exponencial (`EMAIL_RETRY_BASE_SECONDS`, teto 60 min).
- Falha de SMTP NÃO desfaz o cadastro nem impede login (conta permanece ACTIVE; UI mostra aviso e oferece reenvio).

## Logo CID

- Logo oficial via anexo com `cid:logo` (ver `logoAttachment()` em `apps/api/src/email/mailer.ts`). HTML referencia `cid:logo`; sem o anexo a imagem quebraria.

## Conteúdo dos e-mails (V2)

- Boas-vindas (`WELCOME`): NUNCA contém senha nem token; apenas nome de usuário, e-mail, setor e situação.
- Convite/redefinição: token de uso único (72h/60min); nenhuma senha enviada.
- Reunião: inclui setor da reunião (`departmentName`) em todas as notificações.
- E-mail de teste: enviado somente ao usuário selecionado (`confirm: true` obrigatório).

## Rate limit e segurança

- Login com rate limit por IP + identificador normalizado.
- Erros genéricos (`INVALID_CREDENTIALS`) para usuário inexistente, senha errada ou conta inativa — sem enumeração.
- Sanitização de erros SMTP (`sanitizeError`) remove credenciais.

## Status de entrega externa

- **PENDENTE EXTERNO**: envio real para provedores externos depende de credenciais SMTP reais (`SMTP_HOST/PORT/USER/PASS`). Configurar em `.env` e executar `test-connection` + `send-test-email` para validar.
- Mailpit (dev) comprova o pipeline completo (verify + send + CID + per-recipient) em ambiente local.
