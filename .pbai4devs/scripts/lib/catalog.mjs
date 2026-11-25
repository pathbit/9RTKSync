// Indexes derived from the versioned sources; do not read local installations or caches.
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { loadCatalog as loadTools, toolActions } from '../preparar-ferramentas/SCRIPT.mjs';
import { validateCatalog as validateExternalCatalog } from '../gerenciar-skills-externas/SCRIPT.mjs';
import { requireNode } from './runtime.mjs';
import { isGeneratedOutput } from './gitignore.mjs';
import { parseScriptConfig } from './script-config.mjs';

const kinds = { skills: 'SKILL.md', agents: 'AGENT.md', commands: 'COMMAND.md', rules: 'RULE.md', templates: 'TEMPLATE.md' };
const excluded = new Set(['.git', 'node_modules', '.local', '.cache', 'opencode-loop']);
const generated = new Set(['.pbai4devs/catalog.json', '.pbai4devs/skills.json', '.pbai4devs/agents.json', '.pbai4devs/rules.json']);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = values => [...new Set(values)].sort(compare);
const fail = message => { throw new Error(message); };
const stat = file => { try { return lstatSync(file); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error; } };

function scanner(root) {
  const absolute = path => join(root, ...path.split('/'));
  function safe(path, required = false) {
    if (typeof path !== 'string' || !path || /^[A-Za-z]:/.test(path) || /[|\\\x00-\x1f\x7f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) fail(`Caminho de catalogo invalido: ${path}`);
    let current = root;
    for (const part of path.split('/')) {
      if (stat(current)?.isDirectory() && readdirSync(current).some(name => name.toLowerCase() === part.toLowerCase() && name !== part)) fail(`Caminhos diferem somente por maiusculas/minusculas: ${path}`);
      current = join(current, part);
      if (stat(current)?.isSymbolicLink()) fail(`Link simbolico no catalogo: ${path}`);
    }
    if (required && !stat(current)) fail(`Referencia ausente no catalogo: ${path}`);
    return current;
  }
  function walk(path) {
    const info = stat(safe(path));
    if (!info) return [];
    if (!info.isDirectory()) fail(`Pasta de catalogo invalida: ${path}`);
    const result = [];
    for (const name of readdirSync(absolute(path)).sort(compare)) {
      const child = `${path}/${name}`, item = stat(safe(child));
      if (excluded.has(name.toLowerCase()) || isGeneratedOutput(child, item.isDirectory()) || (path.startsWith('.pbai4devs/tools/') && ['versions', 'bin'].includes(name))) continue;
      if (item.isDirectory()) result.push(...walk(child));
      else if (item.isFile()) result.push(child);
      else fail(`Tipo de arquivo nao suportado no catalogo: ${child}`);
    }
    return result;
  }
  const readBytes = path => readFileSync(safe(path, true));
  const read = path => readBytes(path).toString('utf8').replace(/\r\n?/g, '\n');
  const json = path => {
    const value = read(path);
    try { return JSON.parse(value); } catch { fail(`JSON invalido: ${path}`); }
  };
  return { absolute, safe, walk, read, readBytes, json };
}

function metadata(text, path, required = true, fields = ['name', 'description']) {
  const lines = text.split('\n');
  if (lines[0] !== '---') { if (required) fail(`Frontmatter YAML ausente: ${path}`); return {}; }
  const end = lines.indexOf('---', 1);
  if (end < 0) fail(`Frontmatter YAML sem fechamento: ${path}`);
  const result = {};
  for (let i = 1; i < end; i++) {
    const match = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!match || !fields.includes(match[1])) continue;
    const key = match[1]; let value = match[2].trim();
    if (Object.hasOwn(result, key)) fail(`Metadado duplicado ${key}: ${path}`);
    if (/^[>|][-+]?$/.test(value)) {
      const block = [];
      while (i + 1 < end && (/^\s/.test(lines[i + 1]) || !lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(' ');
    } else if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { fail(`Metadado invalido ${key}: ${path}`); }
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'")) fail(`Metadado invalido ${key}: ${path}`);
      value = value.slice(1, -1).replace(/''/g, "'");
    } else if (/^[\[{]|^(?:null|true|false)$/.test(value)) fail(`Metadado deve ser texto ${key}: ${path}`);
    if (typeof value !== 'string' || !value.trim()) fail(`Metadado vazio ${key}: ${path}`);
    result[key] = value.replace(/\s+/g, ' ').trim();
  }
  return result;
}

function ruleScope(meta, path) {
  if (!['always_on', 'model_decision', 'glob', 'manual'].includes(meta.trigger)) fail(`Trigger de regra ausente ou invalido: ${path}`);
  if (meta.globs && meta.glob && meta.globs !== meta.glob) fail(`Glob e globs conflitantes: ${path}`);
  const globs = meta.globs || meta.glob;
  if (meta.trigger === 'glob' && !globs) fail(`Regra glob exige globs: ${path}`);
  return { trigger: meta.trigger, ...(globs ? { globs } : {}) };
}

function localLinks(text, path, scan) {
  const clean = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  const raw = [...clean.matchAll(/\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\)/g)].map(match => match[1]);
  raw.push(...[...clean.matchAll(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm)].map(match => match[1]));
  const references = [];
  for (let href of raw) {
    href = href.replace(/^<|>$/g, '');
    if (!href || href.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue;
    let location;
    try { location = decodeURIComponent(href.split(/[?#]/)[0]); } catch { fail(`Link invalido em ${path}: ${href}`); }
    if (!location) continue;
    if (location.startsWith('/') || location.includes('\\')) fail(`Link deve ser relativo em ${path}: ${href}`);
    const target = posix.normalize(posix.join(posix.dirname(path), location)).replace(/\/+$/, '');
    if (!generated.has(target)) scan.safe(target, true);
    references.push(target);
  }
  return sorted(references);
}

function registry(paths) {
  const values = sorted(paths);
  return '{\n  "entries": [\n' + values.map((path, index) => `    {"path": ${JSON.stringify(path)}}${index < values.length - 1 ? ',' : ''}\n`).join('') + '  ]\n}\n';
}

export function buildCatalog(root, { captureRuleInputs = false } = {}) {
  requireNode(); root = realpathSync(resolve(root));
  const scan = scanner(root);
  const ruleInputs = captureRuleInputs ? new Map() : null;
  const catalog = { schemaVersion: 1, skills: [], agents: [], commands: [], rules: [], templates: [], tools: [], scripts: [], externalSkills: [] };
  for (const [kind, principal] of Object.entries(kinds)) {
    const files = scan.walk(`.pbai4devs/${kind}`);
    const mains = files.filter(path => posix.basename(path) === principal);
    for (const path of mains) {
      const folder = posix.dirname(path);
      const bytes = kind === 'rules' && ruleInputs ? scan.readBytes(path) : null;
      if (bytes) ruleInputs.set(path, bytes);
      const text = bytes ? bytes.toString('utf8').replace(/\r\n?/g, '\n') : scan.read(path);
      const meta = metadata(text, path, true, kind === 'rules' ? ['name', 'description', 'trigger', 'globs', 'glob'] : undefined);
      const title = text.match(/^# (.+)$/m)?.[1];
      if (!title) fail(`Titulo ausente: ${path}`);
      if (!meta.description) fail(`Descricao ausente: ${path}`);
      const entry = { id: folder.slice(`.pbai4devs/${kind}/`.length), name: meta.name || posix.basename(folder), description: meta.description, path, assets: files.filter(file => file !== path && file.startsWith(folder + '/')) };
      if (kind === 'rules') Object.assign(entry, ruleScope(meta, path));
      if (kind === 'commands') entry.references = localLinks(text, path, scan);
      catalog[kind].push(entry);
    }
  }
  const tools = loadTools(root);
  for (const name of Object.keys(tools).sort(compare)) {
    const config = tools[name];
    const path = `.pbai4devs/tools/${name}/TOOL.json`;
    const entryPath = `.pbai4devs/tools/${name}/${config.scripts.entry}`;
    if (!stat(scan.safe(entryPath, true))?.isFile()) fail(`Script de ferramenta nao e arquivo: ${entryPath}`);
    const folder = posix.dirname(path);
    const assets = scan.walk(folder).filter(file => file !== path && !file.slice(folder.length + 1).match(/^(?:versions|bin)\/|^(?:CURRENT\.json|package-lock\.json)$/));
    catalog.tools.push({ id: name, name: config.name, description: config.description, path, assets, group: config.group, entry: entryPath, actions: toolActions(name, config) });
  }
  const scriptFiles = scan.walk('.pbai4devs/scripts');
  const sharedAssets = scriptFiles.filter(path => path.startsWith('.pbai4devs/scripts/lib/'));
  const directories = sorted(scriptFiles.filter(path => /^\.pbai4devs\/scripts\/[^/]+\/SCRIPT\.(?:mjs|cjs|js|conf)$/.test(path)).map(path => posix.dirname(path)));
  for (const folder of directories) {
    const name = posix.basename(folder);
    const config = `${folder}/SCRIPT.conf`;
    const configInfo = stat(scan.safe(config)); const hasConfig = Boolean(configInfo);
    if (hasConfig && !configInfo.isFile()) fail(`SCRIPT.conf deve ser um arquivo: ${config}`);
    const executor = hasConfig ? parseScriptConfig(scan.read(config)) : 'node';
    const path = executor === 'playwright-mcp' ? `${folder}/SCRIPT.js`
      : ['mjs', 'cjs', 'js'].map(extension => `${folder}/SCRIPT.${extension}`).find(candidate => stat(scan.safe(candidate))) || `${folder}/SCRIPT.mjs`;
    if (!stat(scan.safe(path, true))?.isFile()) fail(`Entrada de script nao e arquivo: ${path}`);
    const readme = `${folder}/README.md`;
    const meta = stat(scan.safe(readme))?.isFile() ? metadata(scan.read(readme), readme, false) : {};
    const assets = sorted([...scriptFiles.filter(file => file !== path && file.startsWith(folder + '/')), ...sharedAssets]);
    catalog.scripts.push({ id: name, name, description: meta.description || `Automação ${name}.`, path, assets, support: { modules: sharedAssets.filter(file => file.endsWith('.mjs')), tests: assets.filter(file => /\/tests\//.test(file) && !/\/SMOKE[^/]*\.mjs$/.test(file)), smokes: assets.filter(file => /\/SMOKE[^/]*\.mjs$/.test(file)) }, executor, argv: executor === 'node' ? ['node', path] : [], ...(hasConfig ? { configuration: config } : {}) });
  }
  const externalFile = '.pbai4devs/external-skills/CATALOG.json';
  if (stat(scan.safe(externalFile))) {
    const external = validateExternalCatalog(scan.json(externalFile));
    for (const item of external.skills) {
      const manager = '.pbai4devs/scripts/gerenciar-skills-externas/SCRIPT.mjs';
      const actions = stat(scan.safe(manager))?.isFile() ? Object.fromEntries(['discover', 'install', 'check', 'update', 'read'].map(action => [action, { executor: 'node', argv: ['node', manager, action, item.id] }])) : null;
      catalog.externalSkills.push({ id: item.id, name: item.name, description: item.use, path: externalFile, assets: [], repository: item.repository, commit: item.commit, upstreamPath: item.path, license: item.license, status: item.status, ...(actions ? { actions } : {}), ...(item.notes ? { notes: item.notes } : {}), ...(item.licenseSource ? { licenseSource: item.licenseSource } : {}) });
    }
  }
  for (const kind of Object.keys(catalog).filter(key => Array.isArray(catalog[key]))) catalog[kind].sort((a, b) => compare(a.id, b.id));
  const outputs = new Map([['.pbai4devs/catalog.json', JSON.stringify(catalog, null, 2) + '\n']]);
  outputs.set('.pbai4devs/skills.json', registry(catalog.skills.map(entry => posix.dirname(entry.path))));
  outputs.set('.pbai4devs/rules.json', registry(catalog.rules.map(entry => entry.path)));
  outputs.set('.pbai4devs/agents.json', registry(catalog.agents.map(entry => entry.path)));
  return { catalog, outputs, ...(ruleInputs ? { ruleInputs } : {}) };
}
