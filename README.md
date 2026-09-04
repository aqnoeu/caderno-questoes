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

`supabase/EXECUTAR_NO_SUPABASE_desafio_diario.sql`

Copie somente esse arquivo inteiro para uma nova query do SQL Editor, dê a ela o nome **Desafio Diário — banco e segurança** e clique em **Run**. Não execute novamente os arquivos antigos de `essay_correction_credits` ou `essay_credit_requests`: eles já existem no seu projeto. A query cria o banco separado do Desafio Diário, políticas de acesso, tentativa única por usuário, ranking e a validação protegida das respostas. Sem ela, a nova tela aparecerá, mas não haverá desafio disponível.
