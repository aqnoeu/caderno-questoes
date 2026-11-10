# Histórico de versões

A numeração segue o pacote de atualização do projeto (v52, v53, v54...). Cada versão tem uma tag `vNN` no Git e, antes de cada atualização, uma branch de backup `backup/AAAA-MM-DD-descrição` com a versão anterior.

## Exclusão administrativa de cadernos

- Adiciona exclusão em Gerenciar cadernos, preservando o acervo e bloqueando a operação quando há planejamento ou sessões de Revanche vinculadas.

## Timer da revisão de importações

- Confere automaticamente as questões pendentes pelo Groq, com intervalo configurável e opção de pausa.

## Cartões na revisão de importações

- Usa a grade, os cartões e os filtros do Controle de Conteúdo na revisão de importações.

## Revisão de importações

- Adiciona a fila administrativa de questões externas com conferência de preenchimento para objetivas, discursivas e peças.

## Fila de promoção — 2026-11-09

- Separa questões aguardando promoção das que já estão no acervo.

## Navegação do aluno no desktop — 2026-11-09

- Exibe os rótulos do menu superior, incluindo Planejamento, e adiciona um atalho em Perfil.

## Sugestões de objetivas — 2026-11-09

- Alunos podem sugerir questões objetivas com alternativas e gabarito. Após aprovação administrativa, a questão pode seguir ao Filtro de IA.

## Uso e limites de IA — 2026-11-09

- Painel administrativo com chamadas, tokens informados, erros de cota e limites por provedor e modelo. A coleta começa após a atualização das funções.

## Pix e campanhas de apoio — 2026-11-09

- Página de apoio com título e mensagem editáveis, chave Pix aleatória opcional e campanhas independentes com envio pela central ou em pop-up.

## Sugestões de questões — 2026-11-09

- Alunos podem sugerir discursivas e peças com espelho. A administração aprova o envio antes da análise por IA e revisa os critérios antes do cadastro.

## v61 — 2026-11-08

- Prettier 3.6.2 instalado como dependência de desenvolvimento, com configuração única para JavaScript, JSX, TypeScript, JSON e CSS; comandos `npm run format -- arquivo` e `npm run format:check -- arquivo`.
- Verificação automática em pull requests para **novos arquivos de código**, sem exigir reformatação imediata do acervo já existente.
- Instruções compartilhadas para IA e colaboradores em `AGENTS.md` e `CLAUDE.md`; guia em `docs/FORMATACAO_PRETTIER.md`.
- Nenhuma mudança na lógica, nos componentes, no Supabase, na integração de IA ou na interface.
- Backup anterior: branch `backup/2026-11-08-antes-v61`.

## v59 — 2026-11-07

- Segunda IA gratuita (Groq) nas tarefas auxiliares do desafio diário: gerar afirmações a partir das questões cadastradas e sugerir/montar as questões do dia. A Groq responde primeiro; se falhar, atingir o limite ou devolver algo inválido, o Gemini assume automaticamente.
- Continuam somente no Gemini, sem troca de modelo: correção de redações, as três etapas do Modelo novo (inclusive a análise de cada alternativa), a classificação das questões importadas de PDF e a leitura do espelho das discursivas.
- A atribuição por função fica em segredos do Supabase: `GROQ_API_KEY` (chave), `GROQ_MODEL` (padrão `llama-3.3-70b-versatile`) e `AI_ROTA_DESAFIO` (`auto` padrão, `groq` só Groq para testar, `gemini` só Gemini). Sem a chave da Groq, tudo segue no Gemini como antes.
- Cada afirmação gerada guarda qual IA a produziu (coluna `ai_model`) e a ficha mostra "gerada por Groq/Gemini"; as já existentes foram marcadas como Gemini. A mensagem ao sugerir o desafio também informa a IA usada.
- Para a Groq a lista de candidatos da sugestão é menor (limite de texto por minuto do plano gratuito); o Gemini recebe a lista completa.
- Migração `20261108_v59_registro_ia_usada.sql`; funções `generate-challenge-statements` e `compose-daily-challenge` atualizadas. Backup: branch `backup/2026-11-07-antes-v59`.

## v58 — 2026-11-07

- Banco de afirmações do desafio (aprovadas e em aprovação): linhas padronizadas, com botões do mesmo tamanho e alinhados (em coluna no computador, em 2 colunas no celular).
- Busca por um ou vários IDs ao mesmo tempo (separados por espaço, vírgula ou com "#"), nas duas listas; a busca por texto continua. IDs que não aparecem na lista são avisados, dizendo se estão em outra lista.
- Seleção em lote: caixa de seleção em cada linha, "Selecionar tudo" / "Desmarcar tudo" (sobre o que está exibido). Em aprovação: Aprovar, Rejeitar e Copiar para conferir em lote. Nas aprovadas: Marcar disponível/indisponível, Copiar para conferir, Devolver para aprovação e Rejeitar em lote.
- Lista "Rejeitadas": as rejeitadas ficam guardadas e podem voltar para aprovação (nada é apagado).
- Registro interno contra repetição: cada afirmação tem uma "impressão digital" única do texto (ignora acentos, maiúsculas e pontuação), valendo também para as rejeitadas; o mesmo vale para a origem (questão + resposta). A geração por IA ainda pula afirmações muito parecidas com as existentes (exceto o par certa/errada da mesma questão), e o cadastro manual e em lote avisa e ignora as repetidas.
- Migração `20261107_v58_registro_afirmacoes_sem_repeticao.sql`; função `generate-challenge-statements` atualizada. Backup: branch `backup/2026-11-07-antes-v58`.

## v57 — 2026-11-07

- Afirmações geradas pela IA: botão "Copiar rascunhos para conferir em outra IA" (todos os rascunhos) e "Copiar para conferir" em cada ficha. O texto copiado traz no topo o comando para o revisor (conferir a veracidade com a legislação vigente na data, citar fundamento, responder CONFERE / NÃO CONFERE / INCERTO, apontar problemas de redação e sugerir dificuldade) e, abaixo, as afirmações com ID, resposta, explicação e fundamento indicados. Se o navegador não permitir copiar, o texto aparece numa caixa para copiar manualmente.
- Somente acréscimos de interface; nenhuma regra de estilo existente mudou.

## v56 — 2026-11-07

- "Gerar com IA" (afirmações do desafio): agora adapta uma questão por vez, com barra de progresso e porcentagem ("Adaptando a questão 2 de 5… 40%"). Os rascunhos aparecem na lista conforme ficam prontos e a lista se atualiza ao final mesmo se houver erro. Evita esperas longas numa única chamada.
- "Sugerir com IA" (desafio do dia): barra de progresso animada enquanto a IA escolhe.
- `generate-challenge-statements`: novo parâmetro `exclude_ids` para não repetir questões já puladas.
- Reaproveitada a barra de progresso já existente no Filtro de IA; só foram acrescentadas regras de estilo.

## v55 — 2026-11-06

- Desafio diário: agora pode ter 5 (como antes) ou 10 questões. O tamanho é guardado em cada desafio (`daily_challenges.question_count`); os desafios já existentes continuam com 5 e o ranking segue por desafio. Banco, função de resposta, trava de publicação e telas do aluno e do administrador deixaram de ter o 5 fixo.
- Nova função `generate-challenge-statements` (só administrador): adapta questões já cadastradas (acervo atual ou Modelo novo aprovadas) em afirmações de Sim/Não. Pula enunciados negativos ("assinale a incorreta"), anulados e sem gabarito. As afirmações entram como rascunho, ligadas à questão de origem, e só valem após aprovação.
- Nova função `compose-daily-challenge` (só administrador): a IA escolhe as questões do dia entre as aprovadas, equilibrando Sim/Não e disciplinas, evitando repetição recente e priorizando as que os alunos mais erram; se a IA falhar, usa uma escolha por regra. Salva como rascunho para o administrador revisar e publicar.
- Tela "Desafios diários": seção "Afirmações geradas pela IA" (gerar, aprovar, editar, rejeitar), seletor de tamanho (5 ou 10) e botão "Sugerir com IA". Só foram acrescentadas regras de estilo; nenhuma existente mudou.
- Migração `20261106_v55_desafio_rascunhos_ia_e_dez_questoes.sql`. Backup: branch `backup/2026-11-06-antes-v55` e schema `backup_20261106` no banco.

## v54 — 2026-11-06

- Modelo novo (Filtro de IA e Controle de Conteúdo): as questões agora aparecem em fichas em grade, no mesmo formato do sistema atual, com mais informações (status, dificuldade, etapas da análise, gabarito, concurso, banca, ano/edição, nº de alternativas, confiança ou tentativas da IA, data de cadastro, ID, alertas de extração, erro da IA).
- Filtros iguais aos do sistema atual: abas por concurso, busca por texto/número/ID, disciplina e dificuldade.
- "Ler e revisar" abre a ficha em largura total para edição, como antes. Nenhuma regra de estilo existente foi alterada; só foram acrescentadas regras novas para as fichas.

## v53 — 2026-11-05

- Auditoria e limpeza: removidos 3 zips antigos, 3 cópias soltas de `main-*.jsx`, 2 SQLs avulsos e componentes sem uso (`EssayAdminLegacy`, `EssayStudyLegacy`, `LegacyStudy`, `System2QuestionCard`). O visual não mudou (CSS e JS gerados idênticos aos da v52).
- Banco: a migração da v52 (análise em etapas) não estava aplicada no Supabase; foi aplicada. Nenhuma questão ou usuário foi apagado.
- `correct-essay`: enunciado, espelho e critérios agora vêm do banco; limite mensal (4) controlado de forma atômica no banco (`reserve_essay_correction` / `refund_essay_correction`, migração `20261105_v53_ajustes_banco.sql`); resposta do aluno isolada no prompt contra injeção.
- `analyze-essays` e `analyze-questions`: restritas ao administrador, com limite de itens e nova tentativa em caso de alta demanda. `analyze-questions` passou a existir no repositório.
- `process-system2-queue`: modelo configurável (`GEMINI_MODEL`), chave enviada por cabeçalho, nova tentativa, CORS restrito.
- Funções de teste antigas `bright-action` e `rapid-action` neutralizadas (respondem 410); cópias em `backup/2026-11-05-antes-v53`.

## v52 — 2026-11-04

- Atualização do repositório para o pacote v52 (ciclo de teste do modelo novo / Sistema 2).
- Admin: nova aba "Testar ciclo" e o estilo correspondente.
- Migração e SQL de análise pedagógica em etapas (`20260916_analise_pedagogica_em_etapas.sql`).
- Estrutura organizada em `src/` e `supabase/`; cópias soltas antigas e `.env.local` removidos do controle de versão (continuam na branch `backup/2026-11-04-antes-v52`).
