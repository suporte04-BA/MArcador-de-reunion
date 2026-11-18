# USER_SECTOR_GUIDE — Revisão V2

## Conceitos

- **Setor** (`department_id`) é organizacional: `Administrador/TI`, `Fiscal`, `Financeiro` etc.
- **Perfil** (`role`) é de acesso: `ADMIN` ou `USER`.
- Setor **não** concede permissão. Um usuário de `Administrador/TI` com role `USER` continua sem acesso administrativo. ADMIN é concedido apenas por um ADMIN existente, via "Acesso administrativo".

## Criar/editar usuário

1. Aba **Usuários** → subaba **Usuários** → "Cadastrar usuário".
2. Campos obrigatórios: nome completo, nome de usuário, e-mail, **Setor** (select dos ativos), senha inicial (mín. 4) + confirmação.
3. "Acesso administrativo" (perfil ADMIN/USER) é independente do setor.
4. A conta nasce **ACTIVE**; o usuário entra imediatamente. O e-mail de boas-vindas NÃO contém senha.

## Setores (subaba Setores)

- Criar: nome 2–80 chars, descrição ≤ 500, cor institucional, status.
- Duplicatas ignoram caixa, espaços repetidos e acentos (`Fiscal` = `FISCAL` = ` fiscal ` = `Físçal`).
- Renomear preserva referências históricas (mesmo id).
- Desativar mantém histórico e bloqueia novos vínculos; reuniões antigas continuam exibindo o setor desativado.
- Exclusão física apenas para setores sem vínculos (manutenção restrita); setores do seed são protegidos.

## Reuniões

- "Setor da reunião" é obrigatório na criação (select dos setores ativos; pré-seleciona o setor do usuário logado).
- Setor aparece em tabela, calendário, detalhe, filtros, KPIs e e-mails.
- Permissão de edição/cancelamento: `ADMIN` ou `created_by_user_id === user` (o setor não altera isso).

## KPIs (área Usuários)

- "Total de usuários" e "Total de setores" lado a lado, com contagens reais do banco.
- Clicáveis: abrem a subaba correspondente (Usuários/Setores).

## Login

- Por nome de usuário (preserva caixa/acentos na exibição) ou e-mail.
- Aceita variações de caixa, espaços repetidos e acentos: `Sérgio Rodrigues`, `SERGIO RODRIGUES`, `Sergio   Rodrigues`, `sergio rodrigues` resolvem para a mesma conta.
- Senha mínima: 4 caracteres (frontend e backend).
- Erros genéricos (sem revelar se o usuário existe).
