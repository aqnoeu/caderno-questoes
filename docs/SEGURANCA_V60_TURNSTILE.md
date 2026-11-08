# v60 — Proteção contra cadastros automatizados (preparação)

**Estado:** implementação em `security/v60-anti-bot`. **NÃO ativada nem publicada.** A `main` permanece na v59. Backup: `backup/2026-11-08-antes-v60`.

## Objetivo

Adicionar Cloudflare Turnstile ao formulário existente, sem mudar os campos, botões ou navegação. A verificação é gerenciada e só solicita interação quando o serviço julgar necessário. Bots que chamarem diretamente o endpoint do Supabase só serão bloqueados **depois** que o CAPTCHA estiver ativado no Supabase Auth; a presença do widget no frontend, isoladamente, não constitui proteção.

## Ordem de ativação segura (evita bloquear usuários reais)

1. No [Cloudflare Turnstile](https://dash.cloudflare.com/), crie um widget de modo **Managed**. Autorize `caderno-questoes.vercel.app` e os domínios efetivamente usados em produção. Adicione domínios de preview apenas se for testar nesses ambientes; para testes locais, siga a documentação do Turnstile.
2. Guarde a **site key** (pública) e a **secret key** (privada). **Nunca** envie a secret key para variáveis `VITE_*`, `.env.example`, GitHub, logs ou o navegador.
3. Na Vercel, configure `VITE_TURNSTILE_SITE_KEY` com a **site key** no ambiente **Preview** para testar primeiro. Deixe a produção atual como está. Uma nova compilação é necessária para aplicar a variável.
4. Faça o deploy de Preview da branch `security/v60-anti-bot` e confirme que o desafio Turnstile é carregado. Para testar um fluxo real de cadastro/login validado pelo backend, é preferível um **projeto Supabase de staging**; não ative o CAPTCHA no Supabase de produção enquanto o frontend v59 ainda estiver em produção.
5. Quando a versão preparada estiver pronta para entrar em produção, planeje uma janela de transição curta. Configure a variável também para **Production**, publique a versão nova e imediatamente habilite **Enable CAPTCHA protection → Cloudflare Turnstile** no [Supabase Auth — Bot and Abuse Protection](https://supabase.com/dashboard/project/nzmlnwhlrilcpttpahfd/auth/protection) usando a **secret key**. Durante essa transição, a proteção pode não estar efetiva; após ativar o Supabase, versões antigas sem token deixam de conseguir autenticar.
6. Teste **criação de conta**, **login**, **login após erro de senha**, **confirmação por e-mail**, **logout**, navegação e sessão já autenticada em navegadores diferentes. Certifique-se de que tentativas sem CAPTCHA sejam recusadas pelo Supabase quando a proteção estiver ativada.
7. Monitore logs de Auth, volume de cadastros e erros 400/429; ajuste regras sem bloquear usuários legítimos. Para desativar a integração, primeiro desative o CAPTCHA no Supabase e só depois remova a variável pública do frontend.

## Observações importantes

- A variável `VITE_TURNSTILE_SITE_KEY` é opcional **antes da ativação**. Sem ela, a interface da branch funciona como a v59 **mas sem o benefício anti-bot**.
- A proteção não substitui limites nativos do Supabase Auth e não impede, sozinha, ataques de negação de serviço ou requisições diretas a outros endpoints.
- As Edge Functions administrativas já fazem verificações de identidade/administrador; não foram alteradas nesta etapa.
- A autenticação da v60 passa a enviar `options.captchaToken` ao Supabase em cadastro e login, quando disponível. Tokens expiram e são redefinidos após cada tentativa.
- Se o script da Cloudflare estiver indisponível, novas tentativas de login/cadastro poderão ficar temporariamente indisponíveis na versão protegida. Esse é um trade-off de segurança; monitorar e documentar recuperação.
- O bloqueio contra automações **somente é real depois** da configuração da secret key no Supabase Auth.

Referência: [Supabase — Enable CAPTCHA Protection](https://supabase.com/docs/guides/auth/auth-captcha).
