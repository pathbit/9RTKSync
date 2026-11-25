// Contrato unico do seletor e do catalogo para SCRIPT.conf.
export function parseScriptConfig(text) {
  const entries = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (entries.length !== 1 || !/^executor\s*=\s*(node|playwright-mcp)$/.test(entries[0])) {
    throw new Error('SCRIPT.conf exige uma unica entrada executor=node ou executor=playwright-mcp.');
  }
  return entries[0].split('=')[1].trim();
}
