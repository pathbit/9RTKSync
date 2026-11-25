---
description: Preparo do servidor MCP local do dotcontext e conexão explícita por cliente.
---

# Dotcontext MCP

O plugin instala [`@dotcontext/mcp`, do projeto de Vinicius Lana][source],
sob a [licença MIT][license]. O binário `dotcontext-mcp` usa `--help` para
a verificação de instalação. O servidor atende via stdio quando o cliente o
inicia com `serve`.

```console
npx @pathbit/agentdevkit plugins install dotcontext-mcp
npx @pathbit/agentdevkit plugins check dotcontext-mcp
```

A instalação exige seleção explícita. Conectar o servidor requer uma ação
separada no cliente escolhido. As etapas acima apenas preparam o pacote e
o atalho local do kit. A ativação de hooks é uma operação própria do
dotcontext. A licença da distribuição traz o aviso de copyright da
AI Coders Academy.

## Conectar por stdio

Use o atalho `.pbai4devs/tools/bin/dotcontext-mcp.mjs` diretamente como
processo do servidor. Assim, stdin e stdout levam as mensagens MCP. Passe a
raiz do projeto em `--repo-path` para o servidor trabalhar no destino indicado,
inclusive quando o cliente abrir o processo em outro diretório.

Escolha um cliente e acrescente a entrada ao arquivo existente, preservando
os demais servidores e configurações. Substitua `/projeto` e `/caminho/node`
pelos caminhos absolutos do projeto e do Node 24+ na sua máquina.

| Cliente | Arquivo e chave da entrada |
| --- | --- |
| [Claude Code][claude] | `.mcp.json` na raiz, em `mcpServers.dotcontext`. |
| [Cursor][cursor] | `.cursor/mcp.json`, em `mcpServers.dotcontext`. |
| [VS Code][vscode] | `.vscode/mcp.json`, em `servers.dotcontext`. |

Para esses clientes, use os seguintes campos na entrada `dotcontext`.

```json
{
  "type": "stdio",
  "command": "/caminho/node",
  "args": [
    "/projeto/.pbai4devs/tools/bin/dotcontext-mcp.mjs",
    "serve",
    "--repo-path",
    "/projeto"
  ]
}
```

No [Codex][codex], inclua a tabela em `.codex/config.toml` no projeto
confiável.

```toml
[mcp_servers.dotcontext]
command = "/caminho/node"
args = [
  "/projeto/.pbai4devs/tools/bin/dotcontext-mcp.mjs",
  "serve",
  "--repo-path",
  "/projeto",
]
```

Confirme no cliente que o servidor aparece como conectado e que as ferramentas
de contexto e do fluxo PREVC estão visíveis, incluindo `workflow-init` e
`workflow-status`. A ação explícita `context init` do dotcontext cria o
scaffold do projeto e pode acrescentar instruções e regras de ignore.
As ações do MCP seguem o [contrato do dotcontext][source].

[Ferramentas](../README.md)

[source]: https://github.com/vinilana/dotcontext#mcp-server-setup
[license]: https://github.com/vinilana/dotcontext/blob/3a2733eba50cb13cf4913eb08de4e879e2cb5e23/LICENSE
[claude]: https://code.claude.com/docs/en/mcp
[cursor]: https://cursor.com/docs/mcp
[vscode]: https://code.visualstudio.com/docs/agent-customization/mcp-servers
[codex]: https://developers.openai.com/codex/mcp
