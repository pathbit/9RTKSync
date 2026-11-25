---
name: proximos-passos
description: Identifica o estado atual e orienta a próxima ação útil do projeto.
---

# Próximos passos

Leia o pedido, o estado salvo e os documentos existentes. Use o idioma de
`.pbai4devs/state/agentdevkit.json` ou português quando ainda não houver escolha.
Se a CLI estiver disponível, consulte `agentdevkit next --target . --json`.
Para produto ou funcionalidade, acrescente `--intent product`; para preparar a
execução de um projeto existente, use `--intent run`. Para documentar o que
já existe, use `--intent document` e encaminhe a
[documentar-legado](../documentar-legado/SKILL.md). Trate a resposta como
orientação e confira documentos e evidências. Se o comando falhar, não estiver
disponível ou não for permitido, informe a lacuna e inspecione os arquivos.
Para produto, confira `.pbai4devs/state/configuracao/ESTADO.md` e as evidências:
se a preparação estiver pendente, encaminhe a `configurar-projeto` antes do PRD;
se não estiver comprovada, peça a confirmação necessária. Preserve documentos e
decisões existentes. Para executar projeto existente, use `preparar-dev`.
Quando `next` indicar referências externas, consulte `next --integrations`
com a mesma intenção. Use somente os artefatos pertinentes como insumo e
confira aprovações na fonte que o projeto adotou.

Ao finalizar uma etapa, destaque: resultado, pendências/bloqueios e próxima
ação com comando ou skill, no formato da
[regra de próximos passos](../../../rules/proximos-passos/RULE.md).
Faça apenas as perguntas que impedem avançar.
Continue o trabalho já autorizado; não reinicie fases concluídas nem apresente
suposições como aprovações.

Projeto novo segue preparação → PRD → UX → design (arquitetura e tecnologia) →
roadmap → spec aprovada → plano aprovado → configuração técnica → implementação
→ revisão. UX pode ser não aplicável com justificativa aprovada.
Projeto existente parte de suas evidências atuais;
instalar o kit não autoriza recriar documentos ou substituir decisões.
Se não houver pendências no escopo, diga isso claramente.
