import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findNpmCli } from '../lib/npm.mjs';

const packageName = '@pathbit/agentdevkit';
const hubPrefix = '.pbai4devs/';
const localHubPaths = /^(?:(?:espelhos\.conf|(?:catalog|skills|agents|rules)\.json)$|estado\/|state\/(?!README\.md$))/i;

export function listPackageHubFiles(root) {
  const manifest = join(root, 'package.json');
  if (!lstatSync(manifest).isFile()) throw new Error('O manifesto do pacote deve ser um arquivo regular.');
  const metadata = JSON.parse(readFileSync(manifest, 'utf8'));
  if (metadata?.name !== packageName) throw new Error('--source-only exige as fontes do pacote AgentDevKit.');
  const npm = findNpmCli();
  if (!npm) throw new Error('--source-only exige npm disponível.');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:npm_|node_options$|node_test_context$)/i.test(key)));
  const result = spawnSync(process.execPath, [npm, 'pack', '--dry-run', '--json', '--offline',
    '--ignore-scripts', '--workspaces=false', '--logs-max=0', '--no-update-notifier'], {
    cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Não foi possível inventariar as fontes publicáveis.', { cause: result.error });
  }
  const entries = JSON.parse(result.stdout);
  if (!Array.isArray(entries) || entries.length !== 1 || entries[0]?.name !== packageName || !Array.isArray(entries[0].files)) {
    throw new Error('Inventário do pacote inválido.');
  }
  const files = new Set();
  for (const entry of entries[0].files) {
    const path = entry?.path;
    if (typeof path !== 'string' || /[\\\x00-\x1f:]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Caminho inválido no inventário do pacote.');
    }
    if (path.startsWith(hubPrefix) && !localHubPaths.test(path.slice(hubPrefix.length))) files.add(path);
  }
  if (!files.size) throw new Error('Inventário do pacote sem fontes do hub.');
  return [...files].sort();
}
