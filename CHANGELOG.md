# Histórico de versões

A numeração segue o pacote de atualização do projeto (v52, v53, v54...). Cada versão tem uma tag `vNN` no Git e, antes de cada atualização, uma branch de backup `backup/AAAA-MM-DD-descrição` com a versão anterior.

## v52 — 2026-11-04

- Atualização do repositório para o pacote v52 (ciclo de teste do modelo novo / Sistema 2).
- Admin: nova aba "Testar ciclo" e o estilo correspondente.
- Migração e SQL de análise pedagógica em etapas (`20260916_analise_pedagogica_em_etapas.sql`).
- Estrutura organizada em `src/` e `supabase/`; cópias soltas antigas e `.env.local` removidos do controle de versão (continuam na branch `backup/2026-11-04-antes-v52`).
