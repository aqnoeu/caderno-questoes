# Histórico de versões

A numeração segue o pacote de atualização do projeto (v52, v53, v54...). Cada versão tem uma tag `vNN` no Git e, antes de cada atualização, uma branch de backup `backup/AAAA-MM-DD-descrição` com a versão anterior.

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
