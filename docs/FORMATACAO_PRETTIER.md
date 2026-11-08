# Padronização de código — v61

O projeto adota o Prettier como formatador único para JavaScript, JSX, TypeScript, TSX, JSON e CSS. A instalação não modifica as funções ou a interface existente.

## Instalação

```bash
npm ci
```

## Como usar

Formate **somente o arquivo novo ou o conjunto de arquivos que está trabalhando**:

```bash
npm run format -- src/novo-modulo.jsx
```

Confira um arquivo sem modificá-lo:

```bash
npm run format:check -- src/novo-modulo.jsx
```

O Prettier não faz refatoração nem verifica se o programa funciona. Depois, confira o diff e rode:

```bash
npm run build
```

## Adoção gradual

- **Arquivos novos:** precisam estar formatados. O GitHub Actions confere automaticamente arquivos novos de JS, JSX, TS, TSX, JSON e CSS em pull requests.
- **Arquivos legados:** não são formatados em massa nesta versão. Modificações pequenas podem manter a formatação histórica para evitar diffs extensos; uma formatação completa, quando necessária, deverá ocorrer em commit separado e revisado.
- **Arquivos de terceiros, minificados e gerados:** não devem ser formatados manualmente.
- O arquivo `package-lock.json` não é formatado: é gerenciado pelo npm.

## Procedimento padrão para ChatGPT, Claude e demais colaboradores

1. Verificar a versão atual e criar o backup GitHub correspondente antes de iniciar uma nova versão.
2. Implementar e revisar mudanças em branch de desenvolvimento.
3. Aplicar Prettier aos arquivos novos e aos arquivos que tenham sido escolhidos para migração de estilo.
4. Rodar `npm run build`, conferir o diff e atualizar `CHANGELOG.md`.
5. Publicar apenas após conferir o resultado da pré-visualização.

As instruções comuns também estão em `AGENTS.md`, com um lembrete em `CLAUDE.md`.
