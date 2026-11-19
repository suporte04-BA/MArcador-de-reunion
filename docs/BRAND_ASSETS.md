# Ativos de marca — Agenda BA

## Logo oficial

- Arquivo: `apps/api/public/brand/logo-ba.png` (servido em `/brand/logo-ba.png`).
- Usado no cabeçalho da aplicação e nos e-mails (CID `logo`).
- Não inventar ou substituir a logo; mantê-la sincronizada com o Help Desk /
  BA Elétrica.

## Uso nos e-mails

- O HTML referencia `cid:logo`; o worker da outbox anexa a imagem como inline
  (`logo-ba.png`, Content-ID `logo`) em todas as mensagens.
- Anexo da mensagem: apenas a logo via CID (`cid:logo`). O anexo `.ics`
  (`reuniao.ics`) foi removido — é desnecessário para os e-mails.
