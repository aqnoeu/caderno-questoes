# Diretrizes para assistentes de código

Leia estas diretrizes antes de editar o Caderno de Questões. Elas se aplicam ao trabalho realizado por IA ou manualmente.

## Segurança e versionamento

- Antes de iniciar uma versão vNN, confira o commit atual de `main` e crie a branch `backup/AAAA-MM-DD-antes-vNN` apontando para ele.
- Trabalhe em uma branch separada, inclua o resumo da versão em `CHANGELOG.md` e verifique o build antes de publicar.
- Evite alterar a lógica, o comportamento do aluno ou a interface durante tarefas exclusivamente de formatação.
- Nunca adicione segredos, chaves de serviço ou credenciais ao código-fonte.

## Prettier (a partir da v61)

- O padrão está em `.prettierrc.json`; use a versão do Prettier fixada em `package.json`.
- Para arquivos **novos** de JavaScript, JSX, TypeScript, TSX, JSON e CSS, rode `npm run format -- caminho/do/arquivo` antes do commit. O GitHub Actions verifica novos arquivos dessas linguagens.
- Em arquivos antigos, **não reformate o arquivo inteiro só por uma alteração pequena**. Primeiro conclua a alteração funcional, rode o build e avalie a formatação em commit exclusivo; isso evita centenas de linhas alteradas por espaços.
- É possível validar um arquivo com `npm run format:check -- caminho/do/arquivo`.
- Sempre verifique o diff após usar o formatador; o Prettier não é um teste de funcionamento.
- A configuração e o procedimento completo estão em `docs/FORMATACAO_PRETTIER.md`.
