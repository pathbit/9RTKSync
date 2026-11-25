#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isMain, projectRoot, requireNode } from '../lib/runtime.mjs';
import { buildCatalog } from '../lib/catalog.mjs';
import { isGeneratedOutput } from '../lib/gitignore.mjs';
import { canonicalEntrypoint, extractManagedBlock, managedBlockDigest } from '../lib/managed-content.mjs';
import { extractTomlManagedBlock, tomlManagedBlockDigest } from '../lib/managed-toml.mjs';
import { stateDirectory } from '../lib/state-path.mjs';

const fail = message => { throw new Error(message); };
const normalize = value => value.split(sep).join('/');
const excluded = new Set(['node_modules', '.git', 'opencode-loop', '.agent-tests']);
const toolState = new Set(['bin', '.cache', 'npm-cache']);
const auxiliary = ['templates', 'scripts', 'tools', 'external-skills', 'adapters', 'state', 'estado', 'tests', 'docs'];

function checkedStat(root, location) {
  let item;
  try { item = lstatSync(location); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
  if (item.isSymbolicLink()) fail(`Link simbolico: ${normalize(relative(root, location))}`);
  return item;
}

function checkedPath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /[\\\x00-\x1f\x7f:]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) fail(`Caminho gerenciado invalido: ${path}`);
  let location = root;
  for (const part of path.split('/')) { location = join(location, part); checkedStat(root, location); }
  return location;
}

function ownership(root) {
  const stateRoot = stateDirectory(root);
  const file = checkedPath(root, `${stateRoot}/agentdevkit.json`);
  const derivedFile = checkedPath(root, `${stateRoot}/derived.json`);
  if (!checkedStat(root, file) && !checkedStat(root, derivedFile)) return null;
  const readState = location => {
    try { return JSON.parse(readFileSync(location, 'utf8')); }
    catch { fail(`Estado invalido: ${normalize(relative(root, location))}`); }
  };
  const state = checkedStat(root, file) ? readState(file) : { schemaVersion: 1, files: {}, blocks: {} };
  const validMap = value => value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash));
  if (state?.schemaVersion !== 1 || !validMap(state.files) || !validMap(state.blocks)) fail('Estado de propriedade invalido.');
  const files = { ...state.files };
  const blocks = { ...state.blocks };
  if (checkedStat(root, derivedFile)) {
    const derived = readState(derivedFile);
    if (derived?.schemaVersion !== 1 || !validMap(derived.entries) || Object.keys(derived.entries).some(path => !canonicalEntrypoint(path))
      || !validMap(derived.files ?? {}) || !validMap(derived.blocks ?? {}) || !validMap(derived.removedFiles ?? {})
      || !Array.isArray(derived.removedBlocks ?? []) || (derived.removedBlocks ?? []).some(path => typeof path !== 'string')
      || !validMap(derived.outputs ?? {}) || Object.keys(derived.outputs ?? {}).some(path => !/^\.[a-z0-9][a-z0-9-]*\/(?:skills|rules|agents)\.json$/.test(path))) fail('Estado de entradas derivadas invalido.');
    for (const [path, hash] of Object.entries(derived.removedFiles ?? {})) {
      const [nativeRoot, scope] = path.split('/');
      if (!/^\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(nativeRoot) || ['.git', '.pbai4devs', '.agent-tests'].includes(nativeRoot.toLowerCase())
        || !scope || [...auxiliary, 'workflows'].includes(scope.toLowerCase()) || ['readme.md', 'instructions.md'].includes(basename(path).toLowerCase())
        || !(/\.(?:md|mdc)$/i.test(path) || path.startsWith('.gemini/commands/') && path.endsWith('.toml'))) fail('Registro de arquivos removidos invalido.');
      const location = checkedPath(root, path);
      if (state.files[path] && state.files[path] !== hash) fail(`Registro de arquivos removidos divergente: ${path}`);
      if (state.files[path] !== hash || derived.files?.[path] || derived.blocks?.[path] || derived.entries?.[path]) continue;
      if (checkedStat(root, location)) fail(`Arquivo removido foi recriado; revise o conteúdo: ${path}`);
      delete files[path];
    }
    Object.assign(files, derived.entries, derived.outputs, derived.files);
    for (const [path, hash] of Object.entries({ ...derived.entries, ...derived.files })) {
      const location = checkedPath(root, path);
      if (checkedStat(root, location)?.isFile() && createHash('sha256').update(readFileSync(location)).digest('hex') === hash) delete blocks[path];
    }
    for (const path of derived.removedBlocks ?? []) { checkedPath(root, path); delete blocks[path]; }
    Object.assign(blocks, derived.blocks);
  }
  for (const path of Object.keys(blocks)) delete files[path];
  for (const path of [...Object.keys(files), ...Object.keys(blocks)]) {
    const location = checkedPath(root, path);
    if (!checkedStat(root, location)?.isFile()) fail(`Arquivo gerenciado ausente: ${path}`);
  }
  return { files, blocks };
}

export function registryRoots(root) {
  checkedStat(root, join(root, '.pbai4devs'));
  const file = join(root, '.pbai4devs/espelhos.conf');
  checkedStat(root, file);
  const rows = readFileSync(file, 'utf8')
    .split(/\r?\n/).filter(line => /^(?:agente|documento)\|/.test(line))
    .map(line => line.split('|'));
  return { agents: rows.filter(row => row[0] === 'agente').map(row => row[1]), paths: rows.map(row => row[1]) };
}

function walk(root, location, files, { skipTools = true } = {}) {
  const path = normalize(relative(root, location));
  if (/^examples\/generated(?:\/|$)/i.test(path)) return;
  const item = checkedStat(root, location);
  if (!item) return;
  if (location === join(root, '.pbai4devs/external-skills/.local')) return;
  if (skipTools && location === join(root, '.pbai4devs/tools')) return;
  if (isGeneratedOutput(normalize(relative(root, location)), item.isDirectory())) return;
  if (item.isDirectory()) {
    if (excluded.has(basename(location))) return;
    for (const child of readdirSync(location).sort()) walk(root, join(location, child), files, { skipTools });
  } else if (item.isFile() && ['.md', '.mdc'].includes(extname(location).toLowerCase())) files.add(location);
}

export function collectMarkdown(root, registry = registryRoots(root), { installed = ownership(root) } = {}) {
  const agents = join(root, '.pbai4devs');
  checkedStat(root, agents);
  for (const directory of readdirSync(agents, { withFileTypes: true })) {
    const location = join(agents, directory.name);
    const item = checkedStat(root, location);
    if (isGeneratedOutput(normalize(relative(root, location)), item?.isDirectory())) continue;
    if (item?.isDirectory() && !checkedStat(root, join(location, 'README.md'))?.isFile()) fail(`README ausente: .pbai4devs/${directory.name}/`);
  }
  const files = new Set();
  if (installed) {
    walk(root, agents, files);
    for (const path of Object.keys(installed.files)) {
      const file = checkedPath(root, path);
      if (['.md', '.mdc'].includes(extname(path).toLowerCase())) files.add(file);
    }
  } else {
    const rootMarkdown = readdirSync(root).filter(name => ['.md', '.mdc'].includes(extname(name).toLowerCase()));
    const sources = ['.pbai4devs', 'docs', 'src', 'bin', 'tests', 'scripts', 'examples',
      '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE', ...rootMarkdown];
    for (const name of [...sources, ...registry.paths]) walk(root, resolve(root, name), files);
  }
  const tools = join(agents, 'tools');
  if (checkedStat(root, tools)) {
    const guide = join(tools, 'README.md');
    if (!checkedStat(root, guide)?.isFile()) fail('README ausente: .pbai4devs/tools/');
    walk(root, guide, files);
    for (const item of readdirSync(tools, { withFileTypes: true })) {
      if (toolState.has(item.name) || item.name.startsWith('.')) continue;
      if (!checkedStat(root, join(tools, item.name))?.isDirectory()) continue;
      const file = join(tools, item.name, 'README.md');
      const guide = checkedStat(root, file);
      if (checkedStat(root, join(tools, item.name, 'TOOL.json')) && !guide?.isFile()) fail(`README ausente: .pbai4devs/tools/${item.name}/`);
      if (guide) walk(root, file, files);
    }
  }
  return [...files].sort();
}

export function checkFrontmatter(text, file) {
  const lines = text.replaceAll('\r', '').split('\n');
  const closing = lines.indexOf('---', 1);
  const first = closing > 0 ? lines.slice(closing + 1).find(line => line.trim()) : undefined;
  if (lines[0] !== '---' || closing < 1 || !first?.startsWith('# ')) fail(`Frontmatter/H1 invalido: ${file}`);
}

function withoutFences(text) {
  let fence;
  return text.split(/\r?\n/).map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}

export function localLinkTargets(text) {
  const content = withoutFences(text);
  const targets = [...content.matchAll(/\]\((<[^>]*>|[^)]*)\)/g)].map(match => match[1]);
  for (const match of content.matchAll(/^\s{0,3}\[[^\]^][^\]]*\]:\s*(<[^>]+>|\S+)/gm)) targets.push(match[1]);
  return targets.map(value => {
    const raw = value.trim();
    const target = raw.startsWith('<') ? raw.slice(1, raw.indexOf('>')) : raw.split(/\s+["']/)[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
    const file = target.split(/[?#]/)[0];
    if (!file) return null;
    try { return decodeURIComponent(file); }
    catch { fail(`Link com codificacao invalida: ${target}`); }
  }).filter(Boolean);
}

export function checkManagedBlocks(root, blocks) {
  for (const [path, expected] of Object.entries(blocks)) {
    const toml = extname(path).toLowerCase() === '.toml';
    if (!toml && !['.md', '.mdc'].includes(extname(path).toLowerCase())) continue;
    const file = checkedPath(root, path), bytes = readFileSync(file);
    if ((toml ? tomlManagedBlockDigest(bytes) : managedBlockDigest(bytes)) !== expected) fail(`Bloco AgentDevKit alterado ou ausente: ${path}`);
    const block = toml ? extractTomlManagedBlock(bytes) : extractManagedBlock(bytes);
    const imports = [...block.matchAll(/^@(?:\{([^}\r\n]+)\}|([^\r\n]+))$/gm)]
      .filter(match => !match[2]?.startsWith('['))
      .map(match => ({ target: match[1] || match[2], base: match[1] ? root : dirname(file) }));
    for (const { target, base } of [...localLinkTargets(block).map(target => ({ target, base: dirname(file) })), ...imports]) {
      const destination = resolve(base, target), local = normalize(relative(root, destination));
      if (!local || isAbsolute(local) || local === '..' || local.startsWith('../')) fail(`Referencia fora do projeto: ${path}`);
      if (canonicalEntrypoint(local)) {
        // The user's root entry may be an existing link; do not follow it.
        const item = lstatSync(destination);
        if (!item.isFile() && !item.isSymbolicLink()) fail(`Referencia indisponivel: ${path}`);
      } else if (!checkedStat(root, checkedPath(root, local))?.isFile()) fail(`Referencia indisponivel: ${path}`);
    }
  }
}

export function checkMarkdown(root, files, { virtualPaths = new Set() } = {}) {
  for (const file of files) {
    const label = normalize(relative(root, file));
    const text = readFileSync(file, 'utf8');
    checkFrontmatter(text, label);
    for (const target of localLinkTargets(text)) {
      const destination = resolve(dirname(file), target);
      if (!existsSync(destination) && !virtualPaths.has(normalize(relative(root, destination)))) fail(`Link ausente: ${label} -> ${target}`);
    }
  }
}

function checkDocumentationLanguages(root, files) {
  if (!existsSync(join(root, 'docs/maintainers/languages.md'))) return;
  const paths = new Set(files.map(file => normalize(relative(root, file))));
  for (const source of paths) {
    if (source === 'README.en.md' || source === 'README.es.md' || /^docs\/(en|es)\//.test(source)) continue;
    for (const language of ['en', 'es']) {
      const translated = source === 'README.md' ? `README.${language}.md`
        : `docs/${language}/${source.replace(/^docs\//, '').replace(/^\.pbai4devs\//, 'kit/').replace(/^\.github\//, 'github/')}`;
      if (!paths.has(translated)) fail(`Missing ${language} documentation for ${source}: ${translated}`);
    }
  }
}

export function resourcePaths(text) {
  const result = new Set();
  for (const match of text.matchAll(/(?<![\w/.-])\.pbai4devs\/(?:scripts|tools|commands|templates)\/[^\s`'"\[\])]+/g)) {
    let path = match[0].replace(/[.,;:]+$/, '');
    if (/[<>{}$*]/.test(path) || path.split('/').includes('...')) continue;
    try { path = decodeURIComponent(path.split(/[?#]/)[0]); } catch { fail(`Referencia com codificacao invalida: ${path}`); }
    if (path.split('/').some(part => ['.local', '.cache', 'node_modules'].includes(part)) || /^\.pbai4devs\/tools\/(?:bin|npm-cache)(?:\/|$)/.test(path)) continue;
    result.add(path.replace(/\/$/, ''));
  }
  return [...result].sort();
}

export function checkResourceReferences(root, files) {
  for (const file of files) for (const path of resourcePaths(readFileSync(file, 'utf8'))) {
    const location = resolve(root, path); const child = relative(root, location);
    if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`) || path.split('/').some(part => part === '..')) fail(`Referencia fora do projeto: ${path}`);
    let current = root;
    for (const part of child.split(sep)) { current = join(current, part); if (!checkedStat(root, current)) fail(`Recurso ausente: ${normalize(relative(root, file))} -> ${path}`); }
    if (/\.(?:mjs|cjs|js|md|mdc|json)$/.test(path) && !checkedStat(root, location).isFile()) fail(`Recurso deve ser arquivo: ${path}`);
  }
}

export function checkCatalog(root, build = buildCatalog) {
  const result = build(root);
  for (const [path, expected] of result.outputs) {
    const file = resolve(root, path); const child = relative(root, file);
    if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) fail(`Saida de catalogo fora do projeto: ${path}`);
    if (!checkedStat(root, file)?.isFile() || readFileSync(file, 'utf8') !== expected) fail(`Catalogo divergente: ${path}; execute sincronizar-agentes.`);
  }
  return result.catalog;
}

export function checkAgentExtras(root, agents, { installed = null } = {}) {
  for (const agent of agents) {
    if (installed) {
      const files = Object.keys(installed.files).filter(path => path.startsWith(`${agent}/`));
      if (files.some(path => auxiliary.some(name => path === `${agent}/${name}` || path.startsWith(`${agent}/${name}/`)))) fail(`Auxiliar gerenciado indevido em ${agent}`);
      if (files.some(path => ['README.md', 'INSTRUCTIONS.md'].includes(basename(path)))) fail(`Guia gerenciado indevido em ${agent}`);
      continue;
    }
    for (const name of auxiliary) if (existsSync(join(root, agent, name))) fail(`Auxiliar indevido em ${agent}/${name}`);
    const files = new Set();
    walk(root, join(root, agent), files);
    if ([...files].some(file => ['README.md', 'INSTRUCTIONS.md'].includes(basename(file)))) fail(`Guia indevido em ${agent}`);
  }
}

export function checkSynchronization(root, run = spawnSync) {
  const result = run(process.execPath, [join(root, '.pbai4devs/scripts/sincronizar-agentes/SCRIPT.mjs'), '--check'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(result.stderr?.trim() || result.stdout?.trim() || 'Espelhos divergentes.');
}

export function checkLint(root, files, run = spawnSync) {
  const current = join(root, '.pbai4devs/tools/markdownlint-cli2/.local/CURRENT.json');
  const legacy = join(root, '.pbai4devs/tools/markdownlint-cli2/CURRENT.json');
  if (!existsSync(current) && !existsSync(legacy)) return ['markdownlint-cli2=missing; verificacao nativa de estrutura e links executada.'];
  const script = join(root, '.pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs');
  const batches = [[]];
  let size = 0;
  for (const file of files) {
    if (process.platform === 'win32' && size && size + file.length + 3 > 12000) {
      batches.push([]);
      size = 0;
    }
    batches.at(-1).push(file);
    size += file.length + 3;
  }
  return batches.flatMap(batch => {
    const result = run(process.execPath, [script, 'run', 'markdownlint-cli2', ...batch], { cwd: root, encoding: 'utf8', timeout: 60000 });
    if (result.error) throw result.error;
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (result.status !== 0) fail(output.split('\n').filter(line => !line.startsWith('Finding:')).join('\n') || 'Markdown lint failed.');
    return output.split('\n').filter(line => /^(?:Linting:|Summary:)/.test(line));
  });
}

export function verifyResources({ root = projectRoot, sourceOnly = false, synchronize = checkSynchronization, lint = checkLint, catalogCheck = checkCatalog } = {}) {
  requireNode();
  const installed = sourceOnly ? null : ownership(root);
  const built = sourceOnly ? buildCatalog(root) : null;
  if (!sourceOnly) { synchronize(root); catalogCheck(root); }
  const registry = sourceOnly ? { agents: [], paths: [] } : registryRoots(root);
  const files = collectMarkdown(root, registry, { installed });
  const virtualPaths = new Set(sourceOnly ? [...built.outputs.keys(), '.pbai4devs/espelhos.conf'] : []);
  checkMarkdown(root, files, { virtualPaths });
  if (sourceOnly) checkDocumentationLanguages(root, files);
  if (installed) checkManagedBlocks(root, installed.blocks);
  checkResourceReferences(root, files);
  checkAgentExtras(root, registry.agents, { installed });
  return { files, messages: [...lint(root, files), 'recursos=passed'] };
}

export function main(args = process.argv.slice(2), options = {}) {
  requireNode();
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log('Uso: node .pbai4devs/scripts/verificar-recursos/SCRIPT.mjs [--source-only]'); return 0; }
  if (args.length && !(args.length === 1 && args[0] === '--source-only')) fail('Opcao invalida; use --help.');
  if (args.includes('--source-only')) options = { ...options, sourceOnly: true };
  for (const message of verifyResources(options).messages) console.log(message);
  return 0;
}

if (isMain(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
