---
description: Modelos dos arquivos de configuração compartilhados da raiz.
status: modelo
---

# Configuração da raiz

Copie apenas na fase de configuração e preserve decisões existentes:

| Modelo | Destino | Ajustar quando |
| --- | --- | --- |
| [EditorConfig][editor] | `.editorconfig` | Formatação mudar. |
| [Atributos Git][atributos] | `.gitattributes` | Texto/binário mudar. |
| [Ambiente](env.example.template) | `.env.example` | Configuração mudar. |

Use o [gitignore](../gitignore/TEMPLATE.md) e o
[ambiente local](../ambiente-local/TEMPLATE.md) para os demais arquivos.
Versione exemplos sem credenciais; documente variáveis, obrigatoriedade e
valores padrão reais. Teste que o setup funciona a partir do exemplo.

[editor]: editorconfig.template
[atributos]: gitattributes.template
