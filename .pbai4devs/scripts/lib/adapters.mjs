import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resourcePath } from './resource-path.mjs';
import { isGeneratedOutput } from './gitignore.mjs';
import { adapterManifestHeader } from './adapter-manifest.mjs';

// agentdevkit-manifest: selective-clients-v1
const policyText = readFileSync(new URL('../../templates/clients/ADAPTERS.json', import.meta.url), 'utf8');
let policy;
try { policy = JSON.parse(policyText); }
catch {
  const error = Object.assign(new SyntaxError('JSON invalido: configuracao de adaptadores.'), { code: 'E_ADAPTER_POLICY_JSON' });
  error.stack = `${error.name}: ${error.message}`;
  throw error;
}
const kinds = new Set(['skills', 'agents', 'commands', 'rules']);
const layouts = new Set(['agrupado', 'plano', 'arquivo', 'mdc', 'agente', 'prompt', 'instrucoes', 'nenhum']);
const entryNames = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
const safeRoot = value => typeof value === 'string' && /^\.[a-z0-9][a-z0-9-]*$/.test(value) && !['.git', '.pbai4devs', '.agent-tests'].includes(value);
const stringList = value => Array.isArray(value) && value.every(item => typeof item === 'string');
if (policy.schemaVersion !== 1 || !Array.isArray(policy.adapters) || !policy.adapters.length || !stringList(policy.entrypoints) || policy.entrypoints.some(name => !entryNames.has(name))) throw new Error('Politica de clientes invalida.');
const ids = new Set(), roots = new Set(), aliases = {};
const selectionModes = ['all', 'none'];
for (const adapter of policy.adapters) {
  if (!adapter || typeof adapter.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(adapter.id) || selectionModes.includes(adapter.id) || ids.has(adapter.id) || typeof adapter.name !== 'string' || !safeRoot(adapter.root) || roots.has(adapter.root) || !adapter.formats || Object.entries(adapter.formats).some(([kind, layout]) => !kinds.has(kind) || !layouts.has(layout) || layout === 'nenhum' && kind !== 'skills')) throw new Error('Adaptador invalido.');
  if (/[\r\n]/.test(adapter.name) || typeof adapter.reason !== 'string' || /[\r\n]/.test(adapter.reason) || (adapter.discovery !== undefined && adapter.discovery !== 'antigravity')) throw new Error('Descricao ou descoberta de adaptador invalida.');
  if (adapter.skillFallback !== undefined && (!safeRoot(adapter.skillFallback) || adapter.skillFallback === adapter.root || adapter.formats.skills !== 'nenhum')) throw new Error('Fallback de skills invalido.');
  for (const field of ['aliases', 'requires', 'extraRoots', 'entrypoints', 'sources']) if (!stringList(adapter[field])) throw new Error('Lista invalida no adaptador: ' + field);
  if (adapter.extraRoots.some(root => !safeRoot(root)) || adapter.entrypoints.some(name => !entryNames.has(name)) || adapter.sources.some(url => !url.startsWith('https://'))) throw new Error('Caminho ou fonte invalida no adaptador.');
  for (const field of ['agentMetadata', 'ruleMetadata']) if (adapter[field] !== undefined && !/^[a-z0-9-]+\.ya?ml$/.test(adapter[field])) throw new Error('Metadados invalidos no adaptador.');
  ids.add(adapter.id); roots.add(adapter.root);
}
for (const adapter of policy.adapters) {
  if (adapter.requires.some(id => !ids.has(id))) throw new Error('Dependencia de adaptador desconhecida.');
  if (adapter.skillFallback && !policy.adapters.some(other => other.root === adapter.skillFallback && ['agrupado', 'plano', undefined].includes(other.formats.skills))) throw new Error('Fallback exige uma raiz com layout de skills.');
  for (const alias of adapter.aliases) {
    if (!/^[a-z][a-z0-9-]*$/.test(alias) || ids.has(alias) || selectionModes.includes(alias) || Object.hasOwn(aliases, alias)) throw new Error('Alias de adaptador invalido.');
    aliases[alias] = adapter.id;
  }
}
export const adapters = Object.freeze(policy.adapters.map(adapter => Object.freeze(adapter)));
export const availableClients = Object.freeze([
  Object.freeze({ id: 'all', name: 'Todos os clientes', aliases: Object.freeze([]) }),
  Object.freeze({ id: 'none', name: 'Somente recursos compartilhados', aliases: Object.freeze([]) }),
  ...adapters.map(({ id, name, root, aliases }) => Object.freeze({ id, name, root, aliases })),
]);
const activeRoots = new Set(adapters.flatMap(adapter => [adapter.root, ...adapter.extraRoots]));
const retiredRoots = policy.retiredRoots === undefined ? [] : policy.retiredRoots;
if (!stringList(retiredRoots) || new Set(retiredRoots).size !== retiredRoots.length
  || retiredRoots.some(root => !safeRoot(root) || activeRoots.has(root))) throw new Error('Raizes aposentadas invalidas na politica de clientes.');
// Installation state may still own paths in retired roots. Only resolveAdapters
// supplies roots for a new manifest.
export const adapterRoots = Object.freeze([...activeRoots, ...retiredRoots]);

export function normalizeClients(input, { stored = false } = {}) {
  if (input === undefined) return ['all'];
  const values = typeof input === 'string' ? [input] : input;
  if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string')) throw new Error('Selecione ao menos um cliente valido.');
  const selected = new Set();
  for (const value of values) for (const part of value.split(',')) {
    const requested = part.trim().toLowerCase(), id = aliases[requested] ?? requested;
    const retired = stored && id === 'gemini';
    if (!retired && !availableClients.some(client => client.id === id)) throw new Error('Cliente desconhecido: ' + (part || '(vazio)'));
    selected.add(id);
  }
  for (const mode of selectionModes) if (selected.has(mode)) {
    if (selected.size !== 1) throw new Error(mode + ' nao pode ser combinado com outros clientes.');
    return [mode];
  }
  return adapters.filter(adapter => selected.has(adapter.id)).map(adapter => adapter.id);
}

export function resolveAdapters(input, options) {
  const clients = normalizeClients(input, options), all = clients.includes('all');
  const requested = all ? adapters.map(adapter => adapter.id) : clients.filter(id => id !== 'none');
  const selected = new Set(requested);
  for (const id of selected) for (const required of adapters.find(adapter => adapter.id === id).requires) selected.add(required);
  const resolved = adapters.filter(adapter => selected.has(adapter.id));
  const clientRoots = new Set(resolved.flatMap(adapter => [adapter.root, ...adapter.extraRoots]));
  const skillRoots = [...new Set(resolved.map(adapter => adapter.skillFallback))]
    .filter(root => root && !clientRoots.has(root));
  const roots = [...skillRoots, ...clientRoots];
  const selectedEntries = new Set([...policy.entrypoints, ...adapters.filter(adapter => requested.includes(adapter.id)).flatMap(adapter => adapter.entrypoints)]);
  const entrypoints = [...entryNames].filter(name => selectedEntries.has(name));
  return { clients, adapters: resolved, roots, skillRoots, entrypoints };
}

export function changeClientSelection(current, action, clients) {
  if (!['add', 'remove'].includes(action) || clients.some(client => selectionModes.includes(client))) {
    throw new Error('Escolha IDs individuais para adicionar ou remover clientes.');
  }
  if (current.includes('all') && action === 'add') return current;
  const selected = new Set(resolveAdapters(current.length ? current : ['none']).adapters.map(adapter => adapter.id));
  for (const client of clients) {
    if (action === 'add') selected.add(client);
    else selected.delete(client);
  }
  return selected.size ? normalizeClients([...selected]) : ['none'];
}
const principal = { skills: 'SKILL.md', agents: 'AGENT.md', commands: 'COMMAND.md', rules: 'RULE.md' };
const stat = path => { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

function checked(root, relative) {
  let path = root;
  for (const part of relative.split('/')) {
    if (!part || part === '.' || part === '..') throw new Error(`Caminho de adaptador invalido: ${relative}`);
    if (stat(path)?.isDirectory() && readdirSync(path).some(name => name.toLowerCase() === part.toLowerCase() && name !== part)) throw new Error(`Capitalizacao ambigua: ${relative}`);
    path = join(path, part);
    if (stat(path)?.isSymbolicLink()) throw new Error(`Link simbolico no adaptador: ${relative}`);
  }
  return path;
}

function sources(root, kind) {
  const result = [];
  function visit(relative) {
    const path = checked(root, relative);
    const item = stat(path);
    if (!item) return;
    if (!item.isDirectory()) throw new Error(`Diretorio de recursos invalido: ${relative}`);
    for (const name of readdirSync(path).sort()) {
      const child = `${relative}/${name}`, file = checked(root, child), info = stat(file);
      if (isGeneratedOutput(child, info.isDirectory())) continue;
      if (info.isDirectory()) visit(child);
      else if (info.isFile() && name === principal[kind]) result.push(child);
    }
  }
  visit(`.pbai4devs/${kind}`);
  return result;
}

export function adapterManifest(root, { clients } = {}) {
  const selection = resolveAdapters(clients);
  root = realpathSync(resolve(root));
  if (!selection.adapters.length) return adapterManifestHeader;
  const rows = [];
  const resources = Object.fromEntries(Object.keys(principal).map(kind => [kind, sources(root, kind)]));
  for (const skillRoot of selection.skillRoots) {
    const layout = adapters.find(adapter => adapter.root === skillRoot).formats.skills || 'agrupado';
    rows.push(`agente|${skillRoot}|${layout}`);
    for (const kind of kinds) if (kind !== 'skills') rows.push(`formato|${skillRoot}|${kind}|nenhum`);
  }
  for (const adapter of selection.adapters) {
    rows.push(`# ${adapter.id}: ${adapter.reason}`, `agente|${adapter.root}|agrupado`);
    for (const [kind, mode] of Object.entries(adapter.formats)) rows.push(`formato|${adapter.root}|${kind}|${mode}`);
    if (adapter.skillFallback) rows.push(`fallback|${adapter.root}|${adapter.skillFallback}|skills`);
    if (adapter.discovery) rows.push(`descoberta|${adapter.root}|${adapter.discovery}`);
    for (const [kind, key] of [['agents', 'agentMetadata'], ['rules', 'ruleMetadata']]) {
      if (!adapter[key]) continue;
      for (const source of resources[kind]) {
        const metadata = `${source.slice(0, source.lastIndexOf('/'))}/${adapter[key]}`;
        if (!stat(checked(root, metadata))?.isFile()) continue;
        const target = `${adapter.root}/${resourcePath(source, kind, adapter.formats[kind] || 'agrupado')}`;
        rows.push(`nativo|${target}|${source}|${metadata}`);
      }
    }
  }
  if (selection.roots.includes('.vscode')) rows.push('gitignore|.vscode');
  return adapterManifestHeader + rows.join('\n') + '\n';
}

// Only configures the policy. Caller decides when planejar/aplicar the sync.
export function writeAdapterManifest(root, { clients } = {}) {
  const selection = resolveAdapters(clients);
  root = realpathSync(resolve(root));
  const relative = '.pbai4devs/espelhos.conf';
  const file = checked(root, relative), content = adapterManifest(root, { clients: selection.clients });
  const info = stat(file);
  if (info && !info.isFile()) throw new Error('espelhos.conf deve ser arquivo regular.');
  const result = { clients: selection.clients, roots: selection.roots, entrypoints: selection.entrypoints };
  if (info && readFileSync(file, 'utf8') === content) return { changed: [], ...result };
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${randomUUID()}`;
  try { writeFileSync(temporary, content, { flag: 'wx' }); renameSync(temporary, file); }
  finally { rmSync(temporary, { force: true }); }
  return { changed: [relative], ...result };
}
