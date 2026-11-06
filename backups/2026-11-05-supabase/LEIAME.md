# Backup do Supabase em 05/11/2026 (antes da v53)

- **Banco:** cópia completa das tabelas, das definições de função, das políticas e dos agendamentos no schema `backup_20261105` do próprio projeto (não exposto à API). Para consultar: `select * from backup_20261105.questions;`.
- **Funções publicadas:** `analyze-essays` e `correct-essay` são idênticas ao código de `supabase/functions/` da v52. `process-system2-queue` publicada era a versão anterior à v52 (código em `backup/2026-11-04-antes-v52`). `bright-action` e `rapid-action` estão em `edge-functions/`.
