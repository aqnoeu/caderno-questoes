# Histórico de versões

A numeração segue o pacote de atualização do projeto (v52, v53, v54...). Cada versão tem uma tag `vNN` no Git e, antes de cada atualização, uma branch de backup `backup/AAAA-MM-DD-descrição` com a versão anterior.

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
