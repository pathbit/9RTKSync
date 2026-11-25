async (page) => {
  page.__agentsRequest = {
    fixtureHtml: '<!doctype html><html><body><h1>Falha esperada</h1><script>console.error("erro de prova")</script></body></html>',
    viewports: [{ width: 1280, height: 800 }],
    steps: [{ action: 'visible', role: 'heading', name: 'Falha esperada' }]
  };
  return { fixture: 'failure-ready', expected: 'passed=false', next: '.pbai4devs/scripts/testar-navegador/SCRIPT.js' };
}
