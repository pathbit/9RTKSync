async (page) => {
  const request = page.__agentsRequest;
  delete page.__agentsRequest;
  if (!request || (!request.url && !request.fixtureHtml)) throw new Error('Defina page.__agentsRequest com URL ou fixtureHtml.');
  if (!request.steps?.some(step => ['visible', 'text'].includes(step.action))) throw new Error('Informe ao menos uma verificacao observavel.');
  const viewports = request.viewports || [{ width: 1280, height: 800 }, { width: 390, height: 844 }];
  if (!viewports.length || viewports.some(size => !(size.width > 0 && size.height > 0))) throw new Error('Viewports invalidos.');
  const errors = [];
  const cleanUrl = value => { try { const url = new URL(value); return url.origin === 'null' ? url.protocol + url.pathname : url.origin + url.pathname; } catch { return value; } };
  const onConsole = message => { if (message.type() === 'error') errors.push({ type: 'console', message: message.text().slice(0, 300) }); };
  const onPage = error => errors.push({ type: 'page', message: error.message.slice(0, 300) });
  const onRequest = req => errors.push({ type: 'network', url: cleanUrl(req.url()), message: req.failure()?.errorText });
  const onResponse = response => { if (response.status() >= 400) errors.push({ type: 'http', status: response.status(), url: cleanUrl(response.url()) }); };
  const locate = step => {
    if (step.testId) return page.getByTestId(step.testId);
    if (step.role && step.name) return page.getByRole(step.role, { name: step.name, exact: true });
    if (step.label) return page.getByLabel(step.label, { exact: true });
    throw new Error('Informe role/name, label ou testId observado na interface.');
  };
  const results = [];
  page.setDefaultTimeout(Math.min(request.timeout || 10000, 30000));
  page.on('console', onConsole); page.on('pageerror', onPage);
  page.on('requestfailed', onRequest); page.on('response', onResponse);
  try {
    for (const viewport of viewports) {
      errors.length = 0;
      const result = { viewport, passed: false, steps: 0 };
      try {
        await page.setViewportSize(viewport);
        if (request.fixtureHtml) await page.setContent(request.fixtureHtml, { waitUntil: 'domcontentloaded' });
        else {
          const response = await page.goto(request.url, { waitUntil: 'domcontentloaded' });
          if (!response || !response.ok()) throw new Error(`Navegacao falhou: ${response?.status()}`);
        }
        if (request.title && await page.title() !== request.title) throw new Error('Titulo divergente.');
        for (const step of request.steps || []) {
          const locator = locate(step);
          switch (step.action) {
            case 'fill': await locator.fill(step.value); break;
            case 'click': await locator.click(); break;
            case 'press': await locator.press(step.key); break;
            case 'select': await locator.selectOption(step.value); break;
            case 'check': await locator.setChecked(step.checked !== false); break;
            case 'visible': await locator.waitFor({ state: 'visible' }); break;
            case 'text':
              const escaped = step.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              await locator.filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) }).waitFor({ state: 'visible' });
              if ((await locator.innerText()).trim() !== step.value) throw new Error('Texto divergente.');
              break;
            default: throw new Error(`Acao desconhecida: ${step.action}`);
          }
          result.steps++;
        }
        if (errors.length) throw new Error('Erros de console, pagina ou rede.');
        result.passed = true;
      } catch (error) { result.failure = error.message.slice(0, 300); }
      result.errors = [...errors]; results.push(result);
    }
  } finally {
    page.off('console', onConsole); page.off('pageerror', onPage);
    page.off('requestfailed', onRequest); page.off('response', onResponse);
  }
  return { mode: request.fixtureHtml ? 'fixture' : 'application', passed: results.every(x => x.passed), browser: page.context().browser()?.browserType().name(), version: page.context().browser()?.version(), url: cleanUrl(page.url()), results };
}
