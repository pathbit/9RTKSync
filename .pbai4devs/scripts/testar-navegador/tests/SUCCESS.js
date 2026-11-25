async (page) => {
  page.__agentsRequest = {
    fixtureHtml: '<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prova dos agentes</title></head><body><main><h1>Prova dos agentes</h1><form><label>Nome<input name="nome" required></label><button type="submit">Confirmar</button></form><p role="status" data-testid="resultado"></p></main><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.querySelector("[role=status]").textContent="Ola, "+e.target.nome.value}</script></body></html>',
    title: 'Prova dos agentes',
    steps: [
      { action: 'visible', role: 'heading', name: 'Prova dos agentes' },
      { action: 'fill', label: 'Nome', value: 'Agente' },
      { action: 'click', role: 'button', name: 'Confirmar' },
      { action: 'text', testId: 'resultado', value: 'Ola, Agente' }
    ]
  };
  return { fixture: 'ready', next: '.pbai4devs/scripts/testar-navegador/SCRIPT.js' };
}
