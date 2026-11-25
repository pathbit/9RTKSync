---
description: Utilitários mínimos compartilhados das automações Node.js.
---

# Utilitários

`runtime.mjs` centraliza o requisito Node.js 24+, a raiz do repositório e a
identificação do arquivo executado. Não instala runtimes nem configura a
máquina.
Também procura executáveis opcionais no PATH sem iniciar um shell.

`managed-content.mjs` delimita os blocos Markdown que o kit pode gerenciar.
`managed-toml.mjs` lê blocos de instalações antigas do Gemini CLI para validar
e retirar referências cuja propriedade foi registrada.
`managed-toml-parser.mjs` usa `smol-toml.cjs` para validar o documento antes
de localizar o prompt e reconhecer seu bloco gerenciado. O bundle é
[smol-toml 1.9.1](https://github.com/squirrelchat/smol-toml),
distribuído com `smol-toml.LICENSE` (BSD-3-Clause), sem dependência do projeto
consumidor. A retirada de um bloco pode reserializar o valor do prompt TOML.

`gitignore.mjs` detecta regras conflitantes e coordena a migração local.
`legacy-exclude.mjs` reconhece o bloco exato da versão 0.0.21 com uma única
worktree. `legacy-exclude-write.mjs` grava uma cópia privada do original antes
de publicar as regras preservadas. Conflitos ficam pendentes para revisão.

`collectErrorDiagnostics`, em `error-reporting.mjs`, coleta dados próprios sem
executar getters ou traps de proxies; dados inseguros ou além do limite são
sinalizados como truncados. Outros acessos a erros não estão cobertos.

`recovery-effects.mjs` classifica as opções analisadas para que a CLI aplique
a barreira de recuperação antes de despachar. `plugins list` e `plugins info`
são consultas. `tools` e as ações `plugins install` e `plugins check` são
opacas. O planejamento pode usar estágio privado.

`project-recovery.mjs` inspeciona, inicia, conclui e resolve operações no diário
compartilhado pela CLI e pelo sync direto. Os módulos `recovery-store.mjs`,
`recovery-records.mjs` e `recovery-backup.mjs` cuidam do armazenamento,
dos registros e da verificação dos backups.

`adapters.mjs` lê a política de clientes e gera `espelhos.conf`.
`adapter-manifest.mjs` fornece o cabeçalho canônico que o inspetor também
usa para reconhecer a seleção sem clientes.

`claude-legacy-exact.mjs` reconhece apenas um formato legado exato de referência
Claude. O reconhecimento não atribui propriedade nem comprova ativação da regra.

`catalog.mjs` identifica erros de sintaxe de JSON externo pelo caminho, sem
incluir trechos do conteúdo. Outros diagnósticos não são abrangidos.
Em erros de sintaxe, os leitores JSON locais de `preparar-ferramentas` e
`gerenciar-skills-externas` informam o tipo do arquivo sem copiar seu conteúdo
ou caminho. Erros de leitura mantêm seu código e mensagem; outros parsers não
estão abrangidos.

`xattr-probe.mjs` consulta atributos e ACLs específicos no macOS e detecta
atributos listáveis no Linux. Resultados inconclusivos não provam ausência.
`native-metadata.mjs` trata o preparo, a verificação e a publicação de
substituições com metadados, inclusive DACL e fluxos alternativos em NTFS.

`file-owner.mjs` identifica arquivos POSIX cujo proprietário mudaria ou cuja
leitura pelo proprietário não pode ser presumida. Grupos, ACLs e mudanças
concorrentes exigem verificações adicionais.

`state-path.mjs` identifica o estado atual ou legado sem dividir dados; duas
pastas simultâneas ou links simbólicos exigem resolver o conflito antes do uso.
