# PLANO MESTRE — AGENDA CORPORATIVA | BA ELÉTRICA

**Documento de especificação, arquitetura, UX/UI, segurança, testes e implantação**  
**Objetivo:** orientar o OpenCode AI com MiMo v2.6 a construir, testar e entregar um sistema real de agendamento de reuniões para a rede local da empresa.  
**Idioma da aplicação:** português do Brasil.  
**Fuso horário padrão:** `America/Manaus` (configurável).  
**Nome recomendado do produto:** **Agenda Corporativa**.  
**Nome curto no cabeçalho e nos e-mails:** **Agenda BA**.  
**Data desta especificação:** 17/11/2026.

---

## 0. Instrução principal ao OpenCode

Este documento não é apenas uma ideia ou protótipo visual. Ele é o contrato de implementação. O resultado deve ser uma aplicação funcional, persistente, protegida por login, acessível por outros computadores da rede local e com notificações por e-mail. Não pare depois de criar telas, não entregue somente um mockup, não substitua o banco de dados por `localStorage` e não simule envio de e-mails como se fossem reais.

Trabalhe de forma incremental: inspecione o ambiente, crie o projeto isolado, implemente cada camada, execute os testes, corrija os erros encontrados e só então avance. Ao final, deixe instruções que uma pessoa da TI consiga executar sem depender do modelo.

**Regra de honestidade dos testes:** só marque um teste como aprovado quando ele tiver sido executado e houver evidência no terminal, relatório ou teste automatizado. Se o SMTP real não estiver configurado, conclua e teste a integração em ambiente local com Mailpit, mas marque a entrega externa real como **PENDENTE DE CREDENCIAIS SMTP**, nunca como aprovada.

## 1. Contexto e resultado esperado

Construir uma aplicação web interna para que usuários cadastrados possam agendar reuniões, consultar a agenda geral e receber notificações por e-mail. Todos os usuários ativos poderão visualizar todas as reuniões. A criação de uma reunião ficará vinculada automaticamente à conta autenticada que a criou.

A aplicação deverá ter **somente duas abas principais**:

1. **Reuniões** — disponível a todos os usuários autenticados.
2. **Usuários** — disponível exclusivamente ao administrador.

Não criar uma terceira aba principal de configurações, relatórios ou notificações. Recursos secundários devem ficar dentro das duas áreas existentes ou no menu do perfil.

### 1.1 Regra central de permissão

Uma reunião só poderá ser alterada ou excluída por:

- o usuário autenticado que criou/agendou a reunião; ou
- um administrador.

O campo “Responsável pela reunião” é um nome informado no formulário e **não concede permissão**. A autoria real deve ser registrada pelo servidor a partir da sessão autenticada (`created_by_user_id`). Nunca confiar em `createdBy`, `userId`, `role` ou permissões enviadas pelo navegador.

### 1.2 Agenda compartilhada e conflito de horários

A agenda é única para toda a empresa. Duas reuniões ativas não podem ocupar intervalos que se sobreponham no mesmo dia. O sistema precisa bloquear:

- mesmo horário de início e fim;
- mesmo início com fim diferente;
- reunião que começa durante outra;
- reunião que termina durante outra;
- reunião que engloba outra;
- duas tentativas simultâneas de reserva do mesmo intervalo.

Uma reunião pode começar exatamente quando a anterior termina. Exemplo: 09:00–10:00 e 10:00–11:00 são permitidas. Não aplicar intervalo de preparação entre reuniões por padrão (`MEETING_BUFFER_MINUTES=0`). O bloqueio deve considerar reuniões ativas; reunião cancelada/excluída libera o horário.

---

## 2. Inspeção obrigatória da referência visual e da marca

Referências fornecidas:

- `https://helpdeskbaeletrica.lovable.app/admin/users`
- `https://helpdeskbaeletrica.lovable.app/tickets`

O usuário informou um acesso de demonstração para observar o sistema. As credenciais fornecidas são apenas para inspeção manual autorizada. **Não as copiar para código, `.env`, banco, documentação versionada ou testes.** Não criar uma conta com essas credenciais no novo sistema.

### 2.1 O que o agente deverá fazer

Antes de definir o tema visual:

1. Tentar abrir as duas rotas em um navegador com renderização de JavaScript.
2. Caso a página de login apareça, usar as credenciais de demonstração fornecidas pelo usuário somente para a inspeção visual.
3. Observar e registrar: logotipo, cores exatas, família tipográfica, largura do menu lateral, cabeçalho, estilo de cartões KPI, tabela, espaçamento, bordas, sombras, estados de botão, avatar, comportamento responsivo e estados vazios.
4. Inspecionar a origem do logotipo no próprio site (DOM, recursos estáticos, favicon ou SVG da aplicação) e reutilizar o arquivo oficial, respeitando sua proporção e transparência.
5. Salvar o ativo no projeto, por exemplo em `apps/web/public/brand/logo.*`, e registrar sua origem em `docs/BRAND_ASSETS.md`.
6. Se não for possível autenticar ou obter o logotipo por meios autorizados, não inventar uma logo parecida nem copiar uma imagem genérica. Usar provisoriamente o nome tipográfico “BA Elétrica” com um espaço reservado elegante e deixar explícito no relatório que o arquivo oficial da logo precisa ser disponibilizado.

### 2.2 Limitação conhecida desta análise preliminar

A consulta textual dos endereços de referência só retornou o título “Help Desk B A Elétrica”; não expôs os componentes internos nem permitiu autenticação ou extração do arquivo de logo. Portanto, esta especificação **não afirma ter validado a paleta, o menu ou a imagem exata da referência**. A inspeção visual acima é uma tarefa obrigatória do agente no ambiente em que o site possa ser renderizado.

### 2.3 Direção visual

O produto deverá parecer parte do mesmo ecossistema corporativo do Help Desk, não um template genérico. Reutilizar os tokens reais identificados na referência. Melhorar hierarquia, espaçamento, legibilidade e fluxo sem descaracterizar a marca.

Princípios:

- visual corporativo, sóbrio, limpo e contemporâneo;
- paleta baseada na identidade existente; tons neutros para superfícies e cor institucional para ações prioritárias;
- tipografia consistente, com hierarquia clara entre título, subtítulo, KPI, tabela e metadados;
- cartões KPI grandes o suficiente para leitura rápida, com números em destaque, descrição curta e comportamento clicável evidente;
- evitar excesso de gradientes, glassmorphism, sombras fortes, bordas coloridas e animações decorativas;
- não utilizar emojis como ícones; não preencher a interface com ícones genéricos;
- ícones devem ser poucos, semânticos e consistentes; preferir ícones SVG próprios ou um conjunto vetorial bem selecionado, com o mesmo peso de traço;
- avatar real do usuário quando cadastrado; na ausência de foto, usar iniciais em um círculo com cor determinística, nunca uma foto aleatória;
- animações discretas e curtas, respeitando `prefers-reduced-motion`;
- estados de carregamento, vazio, erro, sucesso e ausência de permissão desenhados, não apenas mensagens improvisadas.

### 2.4 Referência de layout a respeitar

A inspiração funcional e visual é o Help Desk existente: navegação administrativa clara, tabelas profissionais, avatar junto à autoria e cartões KPI organizados. Não copiar telas inteiras nem introduzir módulos de chamados. Adaptar a linguagem visual ao contexto de agenda.

---

## 3. Arquitetura recomendada

Priorizar uma arquitetura simples de manter, local e sem dependência de APIs pagas.

### 3.1 Stack de referência

- **Frontend:** React + TypeScript + Vite.
- **Estilo e componentes:** Tailwind CSS com componentes próprios bem padronizados; usar biblioteca acessível apenas onde agregar valor.
- **Calendário:** FullCalendar com views Month, TimeGrid e List, configurado em pt-BR, ou componente próprio equivalente se houver incompatibilidade comprovada. Desabilitar sobreposição visual e seleção de intervalos ocupados na camada de UI, mas nunca depender somente do calendário para proteger a agenda.
- **Backend:** Node.js 24 LTS + TypeScript + Fastify (ou Express se o repositório já usar esse padrão e houver justificativa técnica documentada).
- **Banco:** PostgreSQL 18, persistente em volume, com migrations versionadas.
- **Acesso a dados:** Prisma com migration SQL complementar para a restrição de intervalo, ou consultas SQL tipadas. A migration PostgreSQL que bloqueia sobreposições é obrigatória.
- **E-mail:** Nodemailer via SMTP configurável por variáveis de ambiente.
- **Fila de e-mail:** padrão transactional outbox no PostgreSQL e worker de envio com retentativas; Redis não é obrigatório para este porte.
- **Testes:** Vitest para unidade, integração real com PostgreSQL e Playwright para ponta a ponta. Adicionar axe-core ou ferramenta equivalente para verificações de acessibilidade.
- **Ambiente local:** Docker Compose para PostgreSQL e Mailpit em desenvolvimento; aplicação pode rodar em Node no host ou em container.

Não atualizar dependências cegamente. Antes da instalação, verificar a compatibilidade entre versões, usar versões estáveis e registrar o lockfile. A máquina já pode possuir Node 24; preferir essa linha LTS se compatível.

### 3.2 Organização sugerida do repositório

```text
agenda-ba-eletrica/
  apps/
    web/
      src/
        app/
        components/
        features/
          auth/
          meetings/
          users/
          dashboard/
        styles/
      public/
        brand/
    api/
      src/
        modules/
          auth/
          users/
          meetings/
          notifications/
          audit/
        plugins/
        workers/
        config/
  packages/
    shared/
      src/
        schemas/
        types/
        date-time/
  database/
    migrations/
    seeds/
  tests/
    e2e/
    integration/
  docs/
    BRAND_ASSETS.md
    ARCHITECTURE.md
    TEST_REPORT.md
    DEPLOYMENT.md
  storage/
    avatars/              # persistente, não versionar
  docker-compose.yml
  .env.example
  .gitignore
  README.md
```

Se escolher estrutura diferente, documentar a razão e preservar a separação lógica entre interface, API, domínio, persistência e notificações.

### 3.3 Princípios de execução local

- Aplicação hospedada em um único computador/servidor da rede, acessível pelos demais via navegador.
- Servidor web escutando em `0.0.0.0`, não somente `127.0.0.1`.
- Endereço público interno configurável por `APP_BASE_URL`; não fixar IP no código.
- Porta configurável por `APP_PORT`.
- Banco de dados e arquivos persistem após reiniciar o computador/containers.
- Não exigir login em serviços externos para abrir a agenda.
- O envio de e-mail exige acesso de saída a um servidor SMTP ou relay autorizado. A interface da agenda continua funcionando na LAN se a Internet cair; os e-mails ficam em fila e são reenviados quando o SMTP voltar.
- Não expor PostgreSQL, Mailpit ou painel de desenvolvimento para toda a rede. Somente a aplicação deverá ser acessível aos usuários.

---

## 4. Perfis, autenticação e autorização

### 4.1 Perfis

**Administrador (`ADMIN`)**

- acessa as abas Reuniões e Usuários;
- visualiza todas as reuniões;
- pode criar, editar, cancelar/excluir qualquer reunião;
- cria, edita, ativa, desativa e consulta usuários;
- reenvia convite/ativação e solicita redefinição de senha;
- envia e-mail de teste para um usuário individual;
- visualiza o estado da configuração de e-mail e o resultado dos envios;
- consulta trilha de auditoria das operações relevantes.

**Usuário (`USER`)**

- acessa apenas Reuniões;
- consulta todas as reuniões ativas e o histórico de canceladas conforme filtro;
- cria reuniões;
- altera ou exclui somente as reuniões criadas por sua própria conta;
- não administra usuários;
- não altera o responsável real (`created_by_user_id`) nem seu perfil de acesso.

### 4.2 Regra de autorização no servidor

Criar uma função central de autorização, por exemplo:

`canManageMeeting(sessionUser, meeting) = sessionUser.role === 'ADMIN' || meeting.createdByUserId === sessionUser.id`

Aplicar essa verificação em todas as operações de leitura sensível, atualização, cancelamento e exclusão. Não confiar em botões ocultos ou rotas protegidas somente pelo frontend. A API deverá retornar `403` quando o usuário não tiver permissão.

### 4.3 Login e credenciais

- Sem cadastro público. Contas criadas exclusivamente pelo administrador.
- Login por usuário (username) e senha; e-mail também poderá ser aceito se for único e documentado.
- Senhas armazenadas somente com Argon2id e salt individual. Nunca texto puro, Base64 ou SHA-256 simples.
- Convite de primeiro acesso por token aleatório, de uso único, com expiração. O usuário define sua própria senha ao ativar a conta.
- Não enviar senha permanente em texto simples por e-mail. O e-mail deverá conter o nome de usuário e um link de ativação protegido; a pessoa define sua senha no primeiro acesso.
- Redefinição de senha via token de uso único, com expiração, invalidação após uso e resposta que não revele se um e-mail existe.
- Forçar troca de senha quando houver senha temporária criada por procedimento administrativo.
- Não armazenar nem exibir senha atual ao administrador.
- Criar um comando CLI seguro para bootstrap do primeiro administrador; não deixar usuário/senha padrão dentro do repositório.
- Limitar tentativas de login, aplicar atraso progressivo ou bloqueio temporário e registrar falhas sem registrar senha.
- Sessões no servidor; cookie `HttpOnly`, `SameSite=Lax` (ou política mais restritiva compatível), expiração e rotação de identificador após login/alteração de privilégio. `Secure` quando servido por HTTPS.
- Proteger ações mutáveis contra CSRF e validar origem conforme arquitetura.
- Sair invalida a sessão no servidor.

### 4.4 Usuários desativados

Desativar não significa apagar o histórico. Usuário inativo não poderá autenticar nem receber novas notificações. Reuniões antigas continuarão associadas à conta original e ao nome/avatar histórico disponível. Se o criador for desativado, o administrador continuará sendo capaz de administrar a reunião.

---

## 5. Modelo funcional da reunião

### 5.1 Campos do formulário

Campos apresentados ao usuário:

| Campo | Obrigatório | Regra |
|---|---:|---|
| Assunto / título | Sim | Identifica a reunião nas KPIs, calendário e e-mail. Limite razoável de tamanho. |
| Responsável pela reunião | Sim | Texto digitado pelo usuário; não altera permissões. |
| Data | Sim | Data local, formato visual `dd/MM/aaaa`. |
| Hora de início | Sim | Horário 24h. |
| Hora de término | Sim | Deve ser posterior ao início. |
| Descrição | Sim | Finalidade/pauta da reunião. |
| Observações | Não | Campo complementar. |
| Quem agendou | Automático | Nome, foto/iniciais e ID do usuário autenticado; somente leitura. |

A reunião também terá metadados internos: ID, estado, criado em, atualizado em, criado por, atualizado por, cancelado em e cancelado por.

**Não confundir “Responsável pela reunião” com “Agendado por”.** Mostrar os dois separadamente no detalhe e na tabela.

### 5.2 Fluxo de agendamento

1. Usuário clica em “Agendar reunião”.
2. Abre formulário amplo, organizado em blocos, com assunto, responsável, data, horário inicial, horário final, descrição e observações.
3. O mini calendário permite escolher data e mostra marcações nos dias que possuem reuniões.
4. Ao selecionar uma data e um horário, a aplicação consulta a disponibilidade da agenda.
5. Horários ocupados aparecem desabilitados ou visualmente identificados; a pessoa ainda pode digitar horário manualmente, mas o servidor valida novamente.
6. Ao salvar, o backend valida os dados e a permissão, verifica conflitos e insere a reunião em transação.
7. A reunião aparece imediatamente no calendário, na lista e nas KPIs.
8. Uma notificação é criada na outbox para cada usuário ativo, incluindo o organizador, conforme a regra padrão “todos são avisados”.
9. Mostrar confirmação de agendamento e status da fila de notificações sem atrasar a gravação da reunião.

### 5.3 Validações

- todos os campos obrigatórios preenchidos;
- data/hora válida e interpretada em `America/Manaus` por padrão;
- início anterior ao término;
- não permitir agendamento com início no passado;
- normalizar espaços e validar limites de caracteres;
- descrição e observações renderizadas como texto seguro, com escape contra XSS;
- aceitar acentos e caracteres brasileiros;
- validar tamanho e tipo de avatar no módulo de usuários;
- conflito verificado no backend e no banco;
- mensagem compreensível informando que aquele intervalo já está ocupado e sugerindo escolher outro horário.

Não impor horário comercial ou duração mínima arbitrária sem necessidade. Se no futuro houver regra de antecedência, intervalo mínimo ou expediente, implementá-la como configuração explícita, não como regra escondida.

### 5.4 Semântica exata de conflito

Para intervalos `[início, fim)`, existe conflito quando:

`novo_inicio < existente_fim AND novo_fim > existente_inicio`

Exemplos obrigatórios:

| Reunião já marcada | Nova reunião | Resultado |
|---|---|---|
| 09:00–10:00 | 09:00–10:00 | Bloquear |
| 09:00–10:00 | 09:30–10:30 | Bloquear |
| 09:00–10:00 | 08:30–09:15 | Bloquear |
| 09:00–10:00 | 08:00–11:00 | Bloquear |
| 09:00–10:00 | 10:00–11:00 | Permitir |
| 09:00–10:00 | 08:00–09:00 | Permitir |
| cancelada 09:00–10:00 | 09:00–10:00 | Permitir |

Ao editar uma reunião, ela não deve conflitar consigo mesma. Verificar contra as outras reuniões ativas.

### 5.5 Proteção contra duas gravações simultâneas

Não basta fazer `SELECT` e depois `INSERT`, pois duas solicitações paralelas podem passar na checagem ao mesmo tempo. Implementar a trava de integridade no PostgreSQL por constraint de exclusão GiST sobre o intervalo, usando range temporal e ignorando registros cancelados.

Direção de migration (ajustar à modelagem final):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE meetings
  ADD CONSTRAINT meetings_no_active_overlap
  EXCLUDE USING gist (
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status <> 'CANCELLED');
```

Se houver mais de um recurso/sala no futuro, incluir a chave do recurso na constraint. Nesta versão a agenda é global, portanto todas as reuniões ativas compartilham o mesmo bloqueio.

Capturar a violação da constraint e transformar em resposta de domínio HTTP `409 Conflict` com mensagem amigável. O teste concorrente deverá provar que, de duas tentativas simultâneas para intervalos que se cruzam, somente uma é gravada.

---

## 6. Navegação e experiência de uso

### 6.1 Estrutura visual

- Navegação principal com duas opções: **Reuniões** e **Usuários** (Usuários apenas para ADMIN).
- Logo da BA Elétrica e nome “Agenda BA” no topo/menu, seguindo a identidade observada na referência.
- Perfil no canto superior com avatar, nome, alteração de senha e sair.
- Conteúdo em área central com largura confortável e comportamento responsivo.
- Não criar sub-abas principais adicionais. Filtros, visões e detalhes podem ser controles locais dentro da aba Reuniões.

### 6.2 Aba Reuniões — painel inicial

Cabeçalho:

- título “Agenda de Reuniões”;
- subtítulo curto explicando que a agenda é compartilhada;
- botão principal e visualmente destacado “Agendar reunião”.

KPIs recomendadas (cards de tamanho confortável):

1. **Reuniões de hoje** — quantidade do dia e próximo horário.
2. **Próximas reuniões** — quantidade futura e a próxima reunião.
3. **Reuniões do mês** — total do mês selecionado.
4. **Agendadas por mim** — reuniões criadas pelo usuário autenticado no mês.

Cada card é clicável e abre um painel lateral/modal de detalhamento com a lista correspondente. Cada item na lista do KPI deve mostrar data, início–fim, assunto, responsável e quem agendou; clicar abre o detalhe completo da reunião. Incluir ação para limpar filtro/voltar à agenda geral.

**KPI não pode ser apenas decorativo.** O número deve corresponder à consulta real do banco e a lista deve respeitar filtros, permissões e estados.

### 6.3 Mini calendário e agenda do dia

- Calendário mensal compacto, em pt-BR, com navegação de mês.
- Dias com reuniões exibem indicador discreto e quantidade, sem excesso de bolinhas coloridas.
- Selecionar um dia filtra a agenda do dia.
- Ao lado ou logo abaixo, painel “Agenda do dia” mostra horários em ordem crescente, com início e fim destacados.
- O evento exibe assunto, responsável, agendado por, horário e estado.
- Dias passados podem ser consultados; criação em data passada é bloqueada.
- Calendário em tela pequena deve manter seleção e leitura simples; pode virar lista semanal sem criar uma terceira aba de navegação.

### 6.4 Lista/tabela de reuniões

Colunas sugeridas:

- data;
- horário (início–fim);
- assunto;
- responsável;
- agendado por (avatar + nome);
- situação;
- ação (abrir detalhe; editar/excluir somente se autorizado).

Recursos:

- ordenação por data/hora;
- filtros de período, estado e “Agendadas por mim”;
- pesquisa por assunto ou responsável;
- paginação ou carregamento incremental real;
- estado vazio com convite para criar a primeira reunião, caso tenha permissão;
- cabeçalho e filtros utilizáveis no celular, sem tabela espremida.

O avatar mostrado na linha representa **quem agendou**, não necessariamente o responsável digitado. Sem imagem cadastrada, mostrar iniciais.

### 6.5 Detalhe da reunião

Abrir modal amplo ou drawer acessível, contendo:

- assunto;
- data completa;
- hora de início e de término;
- duração calculada;
- responsável;
- descrição;
- observações, se existirem;
- avatar/nome de quem agendou;
- datas de criação e última atualização;
- estado atual e informação de cancelamento, se aplicável.

Ações disponíveis:

- **Editar** e **Excluir/Cancelar** para criador ou administrador;
- somente **Fechar** para os demais;
- confirmação explícita antes da exclusão/cancelamento;
- após alterar horário, atualizar calendário/KPIs e disparar notificação para todos;
- ao cancelar/excluir, retirar o bloqueio do horário, manter registro histórico e notificar todos.

### 6.6 Formulário de nova reunião

O fluxo de criação deve ser o destaque da página e exigir o mínimo de cliques. Usar drawer largo ou página/modal com boa hierarquia visual, não um formulário minúsculo.

Layout em blocos:

1. **Identificação:** assunto e responsável.
2. **Quando:** mini calendário/data e horário de início/fim, lado a lado em telas largas.
3. **Pauta:** descrição em área maior.
4. **Complemento:** observações opcionais.
5. **Autoria:** usuário atual com avatar/nome, bloqueado para edição.

Durante a seleção, apresentar disponibilidade contextual: “Livre” ou “Conflita com reunião existente”. Não mostrar falsa disponibilidade se a consulta falhar. Exibir erro de conflito sem apagar o conteúdo já digitado.

### 6.7 Aba Usuários — somente administrador

KPIs:

1. Total de usuários.
2. Usuários ativos.
3. Convites pendentes.
4. Usuários sem e-mail válido/pendência de contato.

Cada KPI deve filtrar ou detalhar a tabela quando clicado.

Tabela de usuários:

- avatar/foto ou iniciais;
- nome completo;
- nome de usuário;
- e-mail;
- perfil (Administrador/Usuário);
- estado (Ativo/Inativo/Pendente);
- data de cadastro/último acesso, se disponível;
- ações.

Ações:

- cadastrar usuário;
- editar nome, username, e-mail e perfil;
- ativar/desativar;
- reenviar convite;
- enviar e-mail de teste **somente para o usuário selecionado**;
- solicitar redefinição de senha;
- atualizar foto/avatar.

Validações:

- username normalizado e único;
- e-mail normalizado e único;
- bloquear desativação do último administrador ativo;
- não permitir que usuário comum alcance endpoints administrativos;
- ao alterar e-mail, exigir revalidação ou registrar mudança e enviar aviso;
- não exibir senha, hash, token ou segredo na tabela.

### 6.8 Cadastro e primeiro acesso

Fluxo recomendado:

1. Admin cadastra nome, username, e-mail e perfil.
2. Sistema gera token aleatório criptograficamente seguro, salva somente seu hash e prazo de expiração.
3. E-mail de convite apresenta a marca, o username e botão “Ativar meu acesso”.
4. Usuário define senha no formulário seguro.
5. Token é invalidado após uso ou expiração.
6. Usuário passa a acessar a agenda.

Se o envio de e-mail falhar, o registro deve continuar pendente e o admin poderá reenviar convite depois. Não mostrar senha padrão para todos.

---

## 7. Notificações por e-mail

### 7.1 Eventos que disparam e-mail

Enviar e-mail a **todos os usuários ativos** quando:

- uma reunião for criada;
- uma reunião tiver data, horário, assunto, responsável, descrição ou observações alteradas;
- uma reunião for cancelada/excluída.

Incluir o criador na lista por padrão, pois a regra funcional informada é que todos sejam avisados. Não disparar notificação duplicada por retry.

### 7.2 Tipos de mensagem

1. Convite de primeiro acesso.
2. Nova reunião agendada.
3. Reunião alterada.
4. Reunião cancelada.
5. E-mail de teste solicitado pelo administrador.
6. Recuperação/redefinição de senha.

Cada tipo terá assunto próprio e texto explícito sobre o motivo do recebimento.

### 7.3 Padrão de design do e-mail

E-mail deve parecer uma comunicação oficial da empresa, não um template genérico.

Estrutura recomendada:

- fundo externo discreto;
- cartão central com largura de leitura confortável;
- logotipo oficial da BA Elétrica no cabeçalho;
- título claro, por exemplo “Nova reunião agendada”;
- bloco de resumo com assunto, data, início, término e responsável;
- descrição e observações em área legível;
- identificação de quem agendou;
- botão principal “Abrir reunião na Agenda BA” apontando para `APP_BASE_URL`;
- endereço/base da intranet em texto quando apropriado;
- rodapé institucional indicando por que o usuário recebeu a mensagem.

Requisitos técnicos:

- HTML compatível com clientes comuns de e-mail, priorizando tabelas e CSS inline para o layout;
- versão alternativa em texto simples (multipart/alternative);
- responsivo em celular;
- datas completas e absolutas (ex.: terça-feira, 17/11/2026, 09:00–10:00), sem depender de palavras como “hoje”;
- idioma `pt-BR`;
- texto alternativo para logo;
- não incluir conteúdo só como imagem;
- não carregar logo a partir de endereço `localhost` ou IP privado: muitos clientes de e-mail não conseguem acessá-lo. Preferir a logo embutida como imagem inline CID no MIME ou URL HTTPS acessível conforme a política da empresa;
- opcional recomendado: anexo `.ics` para adicionar a reunião ao calendário, com timezone correto e identificador estável; validar importação antes de marcar como concluído.

### 7.4 SMTP e segurança

Configurar por variáveis de ambiente, nunca diretamente no código:

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM_NAME=Agenda BA | BA Elétrica
SMTP_FROM_ADDRESS=
APP_BASE_URL=http://IP-DO-SERVIDOR:PORTA
APP_TIMEZONE=America/Manaus
```

- `SMTP_PASS` deve ficar apenas no `.env` local, protegido e ignorado pelo Git.
- Não desativar validação de certificado TLS em produção.
- Não escrever credenciais nem conteúdo sensível nos logs.
- Para Gmail/Google Workspace, usar configuração autorizada para a conta/domínio e autenticação adequada; não tentar contornar política de segurança da conta.
- Configurar SPF, DKIM e DMARC no domínio remetente conforme o provedor de e-mail. Sem autenticação adequada, mensagens podem ser rejeitadas ou ir para spam.

### 7.5 Fila confiável (transactional outbox)

A criação da reunião e das notificações deve ser consistente:

1. Na mesma transação que grava a reunião, gravar uma linha de outbox para cada destinatário/evento.
2. Worker busca pendências de modo seguro para múltiplas instâncias (ex.: `FOR UPDATE SKIP LOCKED`), marca tentativa e envia.
3. Em sucesso, registra estado `SENT`, data/hora e identificador do provedor quando disponível.
4. Em falha transitória, reagenda com backoff exponencial e limite configurado.
5. Em falha permanente, marca `FAILED` e permite reenvio administrativo.
6. Uma chave de idempotência por reunião + versão/evento + destinatário impede duplicação.
7. Falha de SMTP não desfaz a reunião já gravada.

Estados visíveis: `PENDING`, `SENDING`, `SENT`, `RETRYING`, `FAILED`. No painel, diferenciar “servidor SMTP aceitou” de “entregue na caixa de entrada”. O sistema não pode alegar que chegou à caixa do usuário sem confirmação técnica disponível.

### 7.6 Testes de e-mail pela aba Usuários

Na linha de cada usuário, incluir ação “Enviar e-mail de teste”. Ao clicar:

- pedir confirmação com o endereço de destino claramente apresentado;
- enviar somente para o usuário selecionado;
- usar assunto “Teste de e-mail — Agenda BA”;
- informar que a mensagem foi solicitada pelo administrador;
- registrar resultado, hora, destinatário e erro sanitizado;
- mostrar “Aceito pelo SMTP” somente se o servidor aceitar a mensagem;
- mostrar “Falhou” com orientação acionável se conexão/autenticação falhar;
- não enviar a todos os usuários a partir desse botão.

Adicionar também teste de configuração SMTP para o administrador, com destino digitado e validado, sem expor a senha SMTP.

### 7.7 SMTP real versus ambiente de teste

- **Desenvolvimento:** Mailpit em container, com interface web local para inspecionar HTML, texto, anexos e cabeçalhos sem enviar para destinatários reais.
- **Homologação/produção:** SMTP real fornecido pela empresa/provedor.
- O relatório deve separar claramente: “pipeline testado no Mailpit” e “envio real aceito por SMTP”.
- Se não houver credenciais SMTP, deixar a integração pronta, testar a conexão com Mailpit e apontar as variáveis que faltam. Não inventar contas, senhas ou remetentes.

---

## 8. Modelo de dados sugerido

### 8.1 `users`

- `id` UUID/ULID;
- `full_name`;
- `username` normalizado, único;
- `email` normalizado, único;
- `password_hash` Argon2id, nullable enquanto convite pendente;
- `role` (`ADMIN` ou `USER`);
- `status` (`PENDING`, `ACTIVE`, `INACTIVE`);
- `avatar_path` opcional;
- `email_verified_at` opcional;
- `must_change_password` boolean;
- `created_at`, `updated_at`, `last_login_at`.

### 8.2 `meetings`

- `id` UUID/ULID;
- `title`;
- `responsible_name`;
- `starts_at` timestamptz;
- `ends_at` timestamptz;
- `description`;
- `observations` nullable;
- `status` (`SCHEDULED`, `CANCELLED`);
- `created_by_user_id` FK obrigatória;
- `updated_by_user_id` FK opcional;
- `created_at`, `updated_at`;
- `cancelled_at`, `cancelled_by_user_id` opcionais.

### 8.3 `notification_outbox`

- `id`;
- `event_type`;
- `meeting_id`;
- `meeting_version` ou `event_key`;
- `recipient_user_id`;
- `recipient_email_snapshot`;
- `status`;
- `attempt_count`;
- `next_attempt_at`;
- `last_error_sanitized`;
- `provider_message_id`;
- `sent_at`, `created_at`, `updated_at`;
- chave única idempotente.

Guardar o e-mail de destino usado no momento do evento para rastreabilidade; respeitar proteção de dados e retenção.

### 8.4 `auth_tokens` / `invitations`

- hash do token;
- usuário;
- finalidade (`INVITE`, `PASSWORD_RESET`);
- expiração;
- usado em;
- criado em.

Nunca persistir token puro.

### 8.5 `sessions`

Armazenamento de sessões no servidor, com hash/verificador do identificador conforme implementação, expiração e revogação.

### 8.6 `audit_logs`

Registrar eventos como login administrativo, criação/edição/cancelamento de reunião, alteração de usuário, convite, desativação e tentativa de ação negada. Guardar ator, ação, entidade, ID, timestamp e metadados mínimos. Nunca armazenar senhas, tokens completos, segredo SMTP ou identificador bruto de sessão.

### 8.7 Índices

Criar índices para:

- `meetings(starts_at, ends_at)`;
- `meetings(created_by_user_id, starts_at)`;
- `meetings(status, starts_at)`;
- username/email normalizados;
- `notification_outbox(status, next_attempt_at)`;
- `audit_logs(created_at, actor_user_id)`.

---

## 9. API sugerida

Usar rotas versionadas, por exemplo `/api/v1`.

### Autenticação

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/activate-invitation`
- `POST /auth/request-password-reset`
- `POST /auth/complete-password-reset`
- `POST /auth/change-password`

### Reuniões

- `GET /meetings?from=&to=&status=&createdByMe=&q=`
- `GET /meetings/:id`
- `GET /meetings/availability?date=&start=&end=`
- `POST /meetings`
- `PATCH /meetings/:id`
- `DELETE /meetings/:id` (cancelamento lógico com auditoria e e-mail)
- `GET /dashboard/meeting-metrics?month=`

### Usuários — ADMIN

- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/:id`
- `POST /admin/users/:id/activate`
- `POST /admin/users/:id/deactivate`
- `POST /admin/users/:id/resend-invitation`
- `POST /admin/users/:id/send-test-email`
- `POST /admin/email/test-connection`
- `GET /admin/email/status`
- `GET /admin/audit`

Validar autorização, schema, limites e rate limit no backend. Não devolver `password_hash`, tokens ou segredos em nenhuma rota.

---

## 10. Requisitos de segurança e privacidade

- Autenticação obrigatória em toda página/API de dados.
- Autorização no servidor, negação por padrão e privilégio mínimo.
- Hash Argon2id para senha.
- Sessões seguras e proteção CSRF.
- TLS/HTTPS recomendado para uso real da LAN, especialmente para transmissão de senha; HTTP apenas para desenvolvimento controlado.
- Rate limit em login, convite, recuperação e envio de e-mail de teste.
- Validação de entrada no backend (schema tipado); validação do frontend é apenas conveniência.
- Queries parametrizadas/ORM; nunca concatenar SQL com entrada do usuário.
- Escape de conteúdo renderizado; sanitizar qualquer Markdown/HTML se futuramente for aceito.
- Upload de avatar com limite de tamanho, MIME detectado no servidor e nomes aleatórios; nunca confiar apenas na extensão.
- CORS restrito à origem da aplicação.
- Cabeçalhos de segurança e política de conteúdo compatível.
- Segredos em `.env`, fora do Git e com permissões restritas.
- Logs sanitizados; nunca logar senha, sessão, token completo, segredo SMTP ou conteúdo desnecessário.
- Backup com acesso restrito; testar restauração.
- Não expor a interface Mailpit nem painel de banco à rede de usuários.
- Não criar porta administrativa oculta nem senha mestra compartilhada.
- Ao desativar usuário, invalidar sessões ativas.

---

## 11. Acessibilidade, responsividade e qualidade de UX

Meta de implementação: WCAG 2.2 nível AA para fluxos principais.

Checklist:

- contraste de texto e controles;
- foco de teclado claramente visível;
- navegação sem mouse;
- labels associados a inputs;
- erros associados ao campo correspondente e descritos em texto;
- não depender somente de cor para indicar ocupado/cancelado;
- alvos de toque com tamanho adequado;
- suporte a zoom/reflow;
- diálogos com foco inicial, contenção e retorno de foco;
- tabelas com cabeçalhos acessíveis;
- calendário operável por teclado e alternativa em lista;
- datas e horários anunciáveis de modo compreensível;
- respeito à preferência por movimento reduzido.

Testar larguras: 1440px, 1280px, 1024px, 768px, 390px e 360px. O uso prioritário é desktop corporativo, mas o celular não poderá quebrar formulários, botões ou tabela.

---

## 12. Testes obrigatórios — não pular

### 12.1 Testes unitários

- schema de criação/edição;
- validação de início menor que fim;
- data no passado;
- normalização de username/e-mail;
- regra de permissão (ADMIN, autor, outro usuário);
- cálculo das KPIs por dia/mês/autor;
- formatação de datas em `America/Manaus`;
- renderização dos templates HTML e texto;
- chave de idempotência da outbox.

### 12.2 Testes de integração com PostgreSQL real

- criar usuários e autenticar;
- gravar reunião e consultar calendário/lista;
- constraint bloqueia sobreposição;
- horários adjacentes são permitidos;
- reunião cancelada libera intervalo;
- update de reunião valida conflito;
- usuário não consegue modificar reunião alheia mesmo chamando API diretamente;
- admin consegue modificar reunião de qualquer usuário;
- creator consegue modificar sua reunião;
- exclusão lógica mantém auditoria;
- outbox é gravada na mesma transação da reunião;
- dois workers não enviam a mesma notificação duas vezes.

### 12.3 Testes de concorrência

Executar duas requisições paralelas para criar reuniões que se sobrepõem. Resultado esperado: exatamente uma gravação bem-sucedida; a outra retorna conflito `409`. Validar diretamente no PostgreSQL que não existem intervalos ativos sobrepostos.

### 12.4 Testes ponta a ponta — Playwright

Cenário com três contas de teste (criar apenas no banco de teste):

- Admin: administra usuários e reuniões.
- Usuário A: cria uma reunião.
- Usuário B: visualiza, mas não altera/exclui a reunião de A.

Fluxos:

1. Login inválido e login válido.
2. Usuário A cria reunião completa com observações.
3. Reunião aparece na agenda e nas KPIs.
4. Usuário B consulta o detalhe e recebe acesso negado em tentativa direta de edição/exclusão.
5. Usuário A edita a própria reunião.
6. Admin edita reunião de A.
7. Admin cancela/exclui reunião e horário fica livre.
8. Tentativa de intervalo igual/sobreposto é recusada com mensagem compreensível.
9. Intervalos consecutivos são aceitos.
10. KPI de mês abre lista correta e cada item abre detalhe.
11. Usuário comum não vê aba Usuários e não acessa endpoint administrativo.
12. Admin cadastra usuário, envia convite de teste e reenvia.
13. Admin envia e-mail de teste para um único usuário.
14. Interface funciona nos tamanhos desktop e mobile definidos.
15. Teclado permite chegar aos controles, operar formulário e fechar modal.

### 12.5 Testes de e-mail no Mailpit

Subir Mailpit em desenvolvimento e confirmar:

- convite de primeiro acesso;
- reunião criada;
- reunião alterada;
- reunião cancelada;
- e-mail de teste individual;
- versão HTML e alternativa texto;
- logo CID é renderizada;
- link aponta para o `APP_BASE_URL` correto;
- data, horário e timezone corretos;
- nenhuma senha permanente aparece;
- repetição do worker não duplica e-mail;
- falha de SMTP gera retry e não perde a reunião.

O Mailpit comprova o pipeline local e permite revisar o conteúdo, mas **não comprova entrega em Gmail/Outlook**.

### 12.6 Teste de e-mail real

Somente depois que a empresa fornecer configuração SMTP válida:

1. testar DNS/conexão/STARTTLS;
2. enviar mensagem de teste para um endereço autorizado;
3. confirmar aceitação pelo servidor SMTP;
4. verificar cabeçalhos SPF/DKIM/DMARC quando aplicável;
5. confirmar recebimento na caixa de destino manualmente;
6. registrar o resultado no relatório sem salvar credenciais.

Se os dados SMTP não estiverem disponíveis, registrar a pendência e fornecer instruções precisas para preenchimento do `.env`. Não afirmar que o teste real foi executado.

### 12.7 Gates de qualidade antes da entrega

Executar e corrigir até passar:

- instalação limpa;
- migrations do zero;
- seed/CLI de primeiro administrador;
- ESLint;
- TypeScript `noEmit`;
- testes unitários;
- testes de integração;
- testes E2E;
- build de produção;
- inicialização em modo produção;
- verificação de segurança de autorização;
- inspeção visual nas larguras definidas;
- teste de backup e restauração.

---

## 13. Implantação na rede local

### 13.1 Configuração de rede

- Instalar no servidor escolhido da rede.
- Reservar IP no DHCP ou usar nome DNS interno estável.
- Definir `APP_BASE_URL` com o endereço alcançável pelos demais computadores, não `localhost`.
- Aplicação escuta em `0.0.0.0`.
- Liberar somente a porta HTTP/HTTPS da aplicação no firewall, idealmente restrita à sub-rede corporativa.
- Não liberar PostgreSQL (5432) nem Mailpit (8025/1025) para estações dos usuários.
- Testar a abertura a partir de pelo menos dois computadores diferentes.

### 13.2 Docker Compose

Serviços previstos:

- `web/api` ou um serviço integrado de aplicação;
- `postgres` com volume persistente;
- `mailpit` somente no perfil de desenvolvimento/teste.

Se o host de produção não usar Docker, fornecer alternativa com Node e PostgreSQL instalados nativamente.

### 13.3 Comandos esperados

O agente deve entregar e testar comandos reais equivalentes a:

```bash
# desenvolvimento
npm install
npm run db:migrate
npm run admin:create
npm run dev

# validação
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build

# operação local
 docker compose up -d --build
 docker compose ps
 docker compose logs -f app
```

Os scripts finais devem corresponder ao `package.json` real. Não deixar comandos fictícios no README.

### 13.4 Backup e recuperação

Entregar script ou procedimento para:

- backup do PostgreSQL;
- backup dos avatares e ativos locais necessários;
- retenção configurável;
- restauração em uma instalação limpa;
- teste de integridade após restaurar.

---

## 14. Critérios objetivos de aceite

O projeto só poderá ser considerado concluído quando:

- [ ] Existem exatamente duas abas principais: Reuniões e Usuários (esta última somente Admin).
- [ ] Login, logout, ativação de conta e troca/recuperação de senha funcionam.
- [ ] O primeiro administrador é criado por procedimento seguro, sem senha padrão fixa.
- [ ] Usuários cadastrados conseguem entrar e ver a agenda compartilhada.
- [ ] O formulário contém todos os campos obrigatórios solicitados e observações opcionais.
- [ ] “Agendado por” é automático, com avatar/foto ou iniciais.
- [ ] Somente criador ou Admin edita/cancela/exclui uma reunião, validado no servidor.
- [ ] Conflitos são bloqueados também no banco, inclusive sob concorrência.
- [ ] Reuniões consecutivas sem sobreposição são permitidas.
- [ ] Reunião cancelada libera o horário e permanece rastreável.
- [ ] KPIs são reais, clicáveis e abrem detalhes/listas corretos.
- [ ] Mini calendário mostra eventos e filtra a agenda do dia.
- [ ] A tabela mostra data, início, fim, responsável e quem agendou com avatar.
- [ ] Criação/alteração/cancelamento gera notificação para todos os usuários ativos.
- [ ] A aba Usuários permite criar e administrar contas.
- [ ] E-mail de teste individual funciona no Mailpit e registra o resultado.
- [ ] Templates incluem a marca/logo oficial ou a pendência da logo está documentada.
- [ ] E-mails incluem HTML e texto simples; SMTP real foi comprovado ou está explicitamente pendente.
- [ ] A aplicação abre em outro computador da LAN usando o IP/nome do servidor.
- [ ] Dados permanecem após reiniciar serviços e máquina.
- [ ] Backup e restauração foram testados.
- [ ] Relatório final informa exatamente o que passou, falhou ou depende de credenciais externas.

---

## 15. Plano de execução por fases para o OpenCode/MiMo

### Fase 0 — Diagnóstico e preservação

- Verificar Windows/PowerShell, Node, npm, Docker, Git e disponibilidade de PostgreSQL.
- Verificar o diretório Downloads e se já existe projeto com o mesmo nome.
- Criar diretório isolado; não alterar projetos Help Desk, Zabbix, Trilium ou outros existentes.
- Fazer `git init` e primeiro commit somente depois de `.gitignore` e `.env.example` seguros.
- Tentar inspecionar referência e extrair logo conforme seção 2.
- Criar `docs/ARCHITECTURE.md` com decisões reais.

### Fase 1 — Base e ambiente

- Estruturar workspace e aplicações.
- Adicionar configuração tipada e validação de env.
- Criar Docker Compose com PostgreSQL e Mailpit em perfil dev.
- Criar migrations e seeds de teste separados de produção.
- Fazer a aplicação iniciar e responder health check.

### Fase 2 — Domínio e segurança

- Implementar entidades e migrations.
- Implementar login, sessões, Argon2id, convite e recuperação.
- Criar autorização central e testes de bypass.
- Implementar constraint de não sobreposição no PostgreSQL.
- Implementar trilha de auditoria mínima.

### Fase 3 — Reuniões

- Implementar API, schemas e validações.
- Implementar criação/edição/cancelamento.
- Implementar consultas de agenda, métricas e disponibilidade.
- Implementar testes de conflito e concorrência antes de avançar.

### Fase 4 — Interface

- Aplicar identidade visual encontrada.
- Criar layout responsivo com as duas abas.
- Implementar KPIs clicáveis, mini calendário, agenda do dia, tabela e detalhe.
- Implementar formulário de reunião com UX de disponibilidade.
- Implementar controle visual por permissão sem depender dele para segurança.

### Fase 5 — Usuários e e-mails

- Implementar CRUD administrativo, convites e ativação.
- Implementar outbox/worker e retentativas.
- Criar templates transacionais HTML/texto, logo CID e links internos.
- Implementar e-mail de teste individual na tabela de usuários.
- Testar tudo no Mailpit.
- Testar SMTP real apenas se os dados forem fornecidos.

### Fase 6 — Verificação completa

- Rodar todos os testes definidos.
- Corrigir falhas de UI, API, banco, segurança e e-mail.
- Executar E2E com três perfis.
- Testar concorrência.
- Testar em computadores diferentes da LAN e em tamanhos mobile/desktop.
- Testar backup e restauração.
- Produzir `docs/TEST_REPORT.md` com logs resumidos, cenários, resultados e pendências.

### Fase 7 — Entrega operacional

- Produzir README em pt-BR com instalação, inicialização, atualização, backup e recuperação.
- Produzir `.env.example` sem segredos.
- Fornecer procedimento de primeiro administrador.
- Fornecer instruções para configurar SMTP real e firewall.
- Mostrar URL local com base no IP real detectado; se não puder detectá-lo, explicar como descobrir.
- Deixar um comando único de inicialização quando tecnicamente possível.
- Confirmar que o projeto está em Downloads e que o servidor pode ser acessado por outro computador.

---

## 16. Variáveis de ambiente esperadas

Criar `.env.example` com nomes/documentação, nunca valores reais:

```env
NODE_ENV=development
APP_HOST=0.0.0.0
APP_PORT=4175
APP_BASE_URL=http://192.168.0.X:4175
APP_TIMEZONE=America/Manaus

DATABASE_URL=postgresql://agenda:change_me@localhost:5432/agenda_ba
SESSION_SECRET=change_me_with_random_secret
SESSION_IDLE_TIMEOUT_MINUTES=30

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM_NAME=Agenda BA | BA Elétrica
SMTP_FROM_ADDRESS=

MEETING_BUFFER_MINUTES=0
EMAIL_RETRY_MAX_ATTEMPTS=8
EMAIL_RETRY_BASE_SECONDS=60
AVATAR_MAX_BYTES=2097152
```

A aplicação deve falhar com mensagem clara se variável obrigatória estiver ausente. Não incluir credenciais de demonstração do Help Desk neste arquivo.

---

## 17. Conteúdo mínimo do README e da documentação

README deve conter:

- propósito e arquitetura;
- pré-requisitos;
- instalação no Windows e opção Docker;
- como configurar `.env`;
- migrations;
- criação do primeiro Admin;
- iniciar/parar/reiniciar;
- acessar a partir de outros PCs;
- configurar firewall;
- configurar SMTP;
- testar e-mail com Mailpit;
- backup/restauração;
- atualização segura;
- resolução de problemas comuns.

`docs/TEST_REPORT.md` deverá conter data, versão/commit, ambiente, comandos executados e resultado de cada critério. Nunca escrever “100% funcionando” sem evidência.

---

## 18. Prompt de execução para colar no OpenCode AI com MiMo v2.6

Use o texto abaixo como instrução principal. Mantenha este documento disponível no diretório Downloads para o agente ler por inteiro.

> Você é o engenheiro responsável por implementar o projeto **Agenda Corporativa / Agenda BA** seguindo integralmente o arquivo `PLANO_MESTRE_AGENDA_CORPORATIVA_BA_ELETRICA.md`. Leia o documento inteiro antes de editar arquivos. Trabalhe em `%USERPROFILE%\Downloads\agenda-ba-eletrica`, criando o diretório se necessário. Não modifique outros projetos. Não entregue somente planejamento, wireframe ou protótipo: implemente a aplicação funcional, banco persistente, autenticação, autorização, agenda, KPIs, calendário, gestão de usuários, notificações por e-mail, implantação LAN e documentação.
>
> Primeiro inspecione o ambiente e a referência visual; tente abrir as rotas do Help Desk com renderização real e reutilizar a logo oficial. Se não conseguir visualizar a aplicação ou obter o ativo, registre essa limitação, não invente a logo e continue com um espaço reservado de marca profissional.
>
> Siga a arquitetura indicada, priorizando Node 24 LTS, React/TypeScript, PostgreSQL, SMTP via Nodemailer, transactional outbox e Mailpit. Implemente o bloqueio de sobreposição com constraint PostgreSQL, não apenas com JavaScript. Os intervalos são `[início, fim)`: reuniões consecutivas são permitidas; qualquer sobreposição entre reuniões ativas é recusada; canceladas liberam o horário.
>
> As únicas abas principais são Reuniões e Usuários, esta última exclusiva do Admin. Todos veem reuniões; somente o criador autenticado ou Admin pode editar/cancelar/excluir. “Responsável” é um nome digitado e não determina autoria. A autoria vem da sessão do servidor. Todas as verificações devem existir na API e ser cobertas por testes diretos.
>
> Todos os usuários ativos recebem notificação quando uma reunião é criada, alterada ou cancelada. A aba Usuários precisa permitir cadastro, convite/ativação, administração e e-mail de teste individual. Nunca envie senha permanente em texto simples; use convite de uso único para o próprio usuário definir a senha. Nunca grave segredos no Git.
>
> Implemente as KPIs clicáveis, mini calendário, agenda diária, tabela com data/início/fim/responsável/avatar de quem agendou, detalhes completos e formulário destacado. Use pt-BR e `America/Manaus` por padrão. Preserve uma experiência corporativa refinada e responsiva, respeitando a logo e paleta oficiais quando puder inspecioná-las.
>
> Faça os testes por fases. Use Mailpit para provar o fluxo de e-mail local e conferir HTML, texto, logo CID, links e anexos. Só declare SMTP real testado se houver credenciais válidas e o servidor aceitar a mensagem; caso contrário, marque claramente como pendência externa. Rode lint, typecheck, unitários, integração PostgreSQL, Playwright, concorrência, build e teste de acesso em outro computador da LAN quando possível. Corrija as falhas reais antes de encerrar.
>
> Não pare para pedir escolhas cosméticas ou decisões já definidas. Adote os padrões deste documento. Se alguma dependência externa estiver ausente, conclua o que puder, documente precisamente o bloqueio e deixe instruções operacionais para resolver. Atualize `README.md`, `.env.example`, `docs/ARCHITECTURE.md`, `docs/BRAND_ASSETS.md` e `docs/TEST_REPORT.md`. No final, apresente resumo da arquitetura, caminho do projeto, comando de inicialização, URL LAN, testes realmente executados, resultado do e-mail local/real, pendências e procedimento para criar usuários. Não afirme que algo foi testado sem executar.

---

## 19. Fontes técnicas e referências consultadas

A implementação deve conferir a documentação oficial atual antes de fixar versões ou copiar configurações.

1. **OWASP — Authentication Cheat Sheet**: autenticação, sessões e práticas seguras.  
   https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
2. **OWASP — Password Storage Cheat Sheet**: hash de senha; recomenda algoritmos próprios para armazenamento, incluindo Argon2id.  
   https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
3. **OWASP — Authorization Cheat Sheet**: privilégio mínimo e negação por padrão.  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
4. **OWASP — Session Management Cheat Sheet**: ciclo de vida, rotação e proteção de sessões.  
   https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
5. **OWASP — CSRF Prevention Cheat Sheet**: proteção das operações que alteram dados.  
   https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
6. **PostgreSQL 18 — Range Types**: intervalos e exclusion constraints para impedir sobreposições.  
   https://www.postgresql.org/docs/current/rangetypes.html
7. **PostgreSQL — Constraints**: constraints de exclusão e integridade no banco.  
   https://www.postgresql.org/docs/current/ddl-constraints.html
8. **FullCalendar v7 — Documentation**: calendários, TimeGrid, acessibilidade e seleção de intervalos.  
   https://fullcalendar.io/docs
9. **FullCalendar — eventOverlap**: impedir sobreposição na interação do calendário. Essa regra é UX complementar, não substitui a constraint no banco.  
   https://fullcalendar.io/docs/eventOverlap
10. **W3C — WCAG 2.2**: critérios de acessibilidade, foco, contraste, teclado e tamanho de alvos.  
    https://www.w3.org/TR/WCAG22/
11. **Node.js — Releases**: escolher uma linha LTS suportada, em vez de versão Current/EOL.  
    https://nodejs.org/en/about/previous-releases
12. **Nodemailer — SMTP Transport**: configuração SMTP, TLS/STARTTLS e requisitos de conexão.  
    https://nodemailer.com/smtp
13. **Google — Diretrizes para remetentes de e-mail**: autenticação do domínio, TLS e práticas de entrega para Gmail.  
    https://support.google.com/mail/answer/81126?hl=pt-BR
14. **Postmark — Transactional Email Best Practices**: e-mails responsivos, texto simples, datas precisas e clareza para notificações transacionais.  
    https://postmarkapp.com/guides/transactional-email-best-practices
15. **OWASP — Logging Cheat Sheet**: evitar registrar senhas, tokens, sessões e segredos.  
    https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

---

## 20. Decisões já tomadas para evitar ambiguidades

- Nome do produto: **Agenda Corporativa**, marca curta **Agenda BA**.
- Duas abas principais apenas: **Reuniões** e **Usuários** (Admin).
- Agenda global e compartilhada por toda a empresa; não há salas paralelas nesta primeira versão.
- Todos os usuários ativos visualizam todas as reuniões.
- Todos os usuários ativos recebem e-mail em criação, alteração e cancelamento.
- O autor real é a conta que clicou em salvar; “responsável” é texto independente.
- Criador e Admin são os únicos que podem alterar ou cancelar/excluir.
- Intervalos consecutivos são permitidos; qualquer interseção é bloqueada.
- Cancelamento/exclusão é lógico, auditável e libera o horário.
- Convite seguro em vez de senha permanente enviada por e-mail.
- Mailpit comprova o fluxo local; SMTP externo só é considerado validado com credenciais e aceitação real.
- Fuso padrão `America/Manaus`, configurável por ambiente.
- Sem APIs pagas obrigatórias; a única dependência externa funcional para envio real é um SMTP/relay autorizado.
- A identidade visual e a logo devem vir do Help Desk real. Se não for possível extrair, a pendência será declarada, nunca mascarada.

**Fim do plano mestre.**
