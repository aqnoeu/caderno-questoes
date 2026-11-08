-- v59: registra qual IA gerou cada afirmação do desafio. Só adiciona coluna; nada é apagado.
alter table public.challenge_questions add column if not exists ai_model text;
-- Tudo o que já foi gerado até aqui veio do Gemini.
update public.challenge_questions set ai_model = 'gemini:gemini-3.6-flash' where ai_generated and ai_model is null;
