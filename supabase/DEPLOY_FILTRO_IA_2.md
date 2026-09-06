# Ativação do Filtro de IA 2.0

1. No Supabase, abra **Edge Functions** e crie a função `process-system2-queue`.
2. Copie o conteúdo de `supabase/functions/process-system2-queue/index.ts` para o editor da função e publique com **Verify JWT desativado**. A função valida administradores e a chamada agendada por uma chave interna, portanto não deve ficar exposta a processamento livre.
3. Confirme que o segredo `GEMINI_API_KEY` já está configurado em **Edge Functions → Secrets**. A função usa a mesma chave das análises já existentes.
4. No SQL Editor, execute todo o arquivo `supabase/EXECUTAR_NO_SUPABASE_FILTRO_IA_2.sql`.
5. No site, entre em **Painel administrativo → Filtro de IA 2.0**, defina o limite diário e o intervalo e ative a fila.

Depois de ativada, o servidor verifica a fila a cada 5 minutos. Ele processa no máximo uma questão por intervalo; questões com resultado consistente viram `approved` e aparecem no **Controle 2.0**. Respostas incompletas, de baixa confiança ou com erro vão para **Revisão necessária**.
