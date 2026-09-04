# Caderno de Questões

Aplicação React/Vite conectada ao Supabase.

## Executar

1. Instale Node.js 20 ou superior.
2. Copie `.env.example` para `.env.local` e informe a chave pública.
3. Execute `npm install`.
4. Execute `npm run dev`.

O PDF é processado no navegador e não é armazenado. PDFs somente com imagens ainda exigem OCR.

## Atualização do Supabase: Desafio Diário

Antes de publicar esta versão, abra o **SQL Editor** do seu projeto no Supabase e execute o conteúdo de:

`supabase/migrations/20260904_daily_challenges.sql`

Ela cria o banco separado do Desafio Diário, políticas de acesso, tentativa única por usuário, ranking e a validação protegida das respostas. Sem essa migration, a nova tela aparecerá, mas não haverá desafio disponível.
