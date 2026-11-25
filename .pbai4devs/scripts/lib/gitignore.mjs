import { createHash } from 'node:crypto';
import { safeGitEnvironment, assertUnredirectedGitEnvironment, canonicalGitPath, gitOutputLines, gitPathKey, gitPathsOverlap, ordinaryGitComponent, possibleWindowsShortName } from './git-environment.mjs';
import { inspectLegacyExclude } from './legacy-exclude.mjs';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyLegacyExcludeMigration } from './legacy-exclude-write.mjs';

// Update only the reserved block; external rules remain byte a byte.
export const ignoreBegin = '# BEGIN AGENT IGNORE';
export const ignoreEnd = '# END AGENT IGNORE';

const outputDirectories = new Set(['.git', '.agent-tests', '.cache', 'node_modules', '__pycache__', 'opencode-loop', 'sessions', 'logs', 'testresults', 'test-results', 'blob-report', 'tmp', 'temp']);
const localFiles = new Set(['auth.json', 'credentials.json', 'history.jsonl', '.ds_store', 'thumbs.db', 'desktop.ini']);
const acceptedVisibility = new Set(['artifact-unprotected', 'artifact-coverage-unverified', 'artifact-ignore-ambiguous', 'output-visible']);
export const isBlockingLocalIgnore = item => !acceptedVisibility.has(item.code);

// Same name as ignored local outputs; does not delete fixtures/cache No .template files.
export function isGeneratedOutput(path, directory = false) {
  const parts = path.replaceAll('\\', '/').split('/');
  const sharedSource = parts[0]?.toLowerCase() === '.pbai4devs';
  const downloadedSource = ['tools', 'external-skills'].includes(parts[1]?.toLowerCase());
  return parts.some((part, index) => {
    const name = part.toLowerCase();
    const folder = index < parts.length - 1 || directory;
    const localFile = localFiles.has(name) || /\.(?:log|swp|swo)$|~$|^\._/.test(name) || /\.local\.(?:jsonc?|toml|ya?ml)$/.test(name);
    const secretEnv = /^\.env(?:\.|$)/.test(name) && !/^\.env\.(?:example|sample|template|.*\.example)$/.test(part);
    return /^\.playwright/.test(name) || (folder && (outputDirectories.has(name) || name === '.local' && (!sharedSource || downloadedSource) || name.startsWith('playwright'))) || (!folder && (localFile || secretEnv));
  });
}

export function validateIgnoreClients(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('clients.json deve conter um objeto.');
  const names = new Set();
  for (const [name, settings] of Object.entries(value)) {
    if (!/^\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || ['.git', '.pbai4devs', '.agent-tests'].includes(name.toLowerCase()) || names.has(name.toLowerCase())) throw new Error(`Cliente .gitignore invalido: ${name}`);
    names.add(name.toLowerCase());
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(key => !['resources', 'allow'].includes(key))) throw new Error(`Configuracao .gitignore invalida: ${name}`);
    if (settings.resources !== undefined && typeof settings.resources !== 'boolean') throw new Error(`resources deve ser booleano: ${name}`);
    const allow = settings.allow === undefined ? [] : settings.allow;
    if (!Array.isArray(allow) || new Set(allow).size !== allow.length) throw new Error(`allow deve ser uma lista sem duplicados: ${name}`);
    for (const path of allow) {
      if (typeof path !== 'string' || !path || /[\\:*?\[\]!#<>|\x00-\x1f\x7f]/.test(path) || path.trim() !== path || path.replace(/\/$/, '').split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Caminho allow deve ser relativo e literal: ${name}`);
    }
  }
  return value;
}

export function renderClientIgnore(template, settings = {}) {
  const token = '{{ALLOWLIST}}';
  if (!template.includes(token)) return template;
  if (template.split(token).length !== 2) throw new Error('agents.ignore exige um unico {{ALLOWLIST}}.');
  const allowed = [...(settings.resources === false ? [] : ['skills/', 'agents/', 'commands/', 'rules/']), ...(settings.allow ?? [])];
  const directories = allowed.filter(path => path.endsWith('/'));
  const patterns = new Set();
  for (const path of allowed) {
    const directory = path.endsWith('/');
    const parts = path.replace(/\/$/, '').split('/');
    for (let end = 1; end < parts.length; end++) {
      const ancestor = parts.slice(0, end).join('/') + '/';
      patterns.add(`!/${ancestor}`);
      if (!directories.some(value => ancestor.startsWith(value))) patterns.add(`/${ancestor}*`);
    }
    if (directory) patterns.add(`!/${parts.join('/')}/`);
    else patterns.add(`!/${path}`);
  }
  return template.replace(token, [...patterns].join('\n'));
}

const localStat = file => { try { return lstatSync(file); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error; } };
const localRead = file => localStat(file) ? readFileSync(file, 'utf8') : null;
const localMode = file => { const item = localStat(file); return item ? item.mode & 0o777 : null; };
const portable = path => path.split(sep).join('/');

function checkedLocalPath(file) {
  let current = resolve(file);
  while (true) {
    if (localStat(current)?.isSymbolicLink()) throw new Error(`Link simbolico em exclusao local: ${file}`);
    const parent = dirname(current); if (parent === current) break; current = parent;
  }
  const item = localStat(file);
  if (item && !item.isFile()) throw new Error(`Exclusao local exige arquivo regular: ${file}`);
  return file;
}

function localBlock(current, first, last, body) {
  const text = current ?? '';
  const begins = [...text.matchAll(new RegExp(`^${first}\\r?$`, 'gm'))];
  const ends = [...text.matchAll(new RegExp(`^${last}\\r?$`, 'gm'))];
  if (begins.length !== ends.length || begins.length > 1 || begins.length && begins[0].index > ends[0].index) throw new Error('Bloco de exclusao local invalido.');
  const block = body === null ? '' : `${first}\n${body.trimEnd()}\n${last}\n`;
  if (!begins.length) return block ? text + (text && !text.endsWith('\n') ? '\n' : '') + block : text;
  const start = begins[0].index;
  const offset = ends[0].index + ends[0][0].length;
  const finish = offset + (text[offset] === '\n' ? 1 : 0);
  return text.slice(0, start) + block + text.slice(finish);
}

function gitCommand(root, args, input, encoding = 'utf8') {
  const env = safeGitEnvironment();
  // Git diagnostics are parsed internally; do not depend on the caller's locale.
  env.LC_ALL = 'C';
  env.LANGUAGE = 'C';
  return spawnSync('git', [...(['ls-files', 'rm'].includes(args[0]) ? ['--literal-pathspecs'] : []), '-C', root, '-c', 'core.fsmonitor=false', ...args], { input, encoding, env, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
}

export function noGitRepository(root, result) {
  if (result.signal) return false;
  const unavailable = result.error?.code === 'ENOENT';
  const notRepository = !result.error && result.status === 128
    && /not a git repository/i.test(String(result.stderr || ''));
  if (!unavailable && !notRepository) return false;
  // A failed Git probe must never hide a repository or linked worktree.
  for (let current = resolve(root); ; current = dirname(current)) {
    if (localStat(join(current, '.git'))) return false;
    if (dirname(current) === current) return true;
  }
}

// Compare exact bytes first. Only accept Git's plain text CRLF conversion when
// effective attributes prove it applies and no custom transformation can run.
// This deliberately does not invoke hash-object or repository-defined filters.
export function indexContentMatches(root, path, working, indexed) {
  if (working.equals(indexed)) return true;
  const attributes = gitCommand(root, ['check-attr', '-z', 'text', 'eol', 'filter', 'working-tree-encoding', 'ident', '--', path]);
  if (attributes.status !== 0) return false;
  const parts = attributes.stdout.split('\0');
  const values = {};
  for (let i = 0; i + 2 < parts.length; i += 3) values[parts[i + 1]] = parts[i + 2];
  const absent = value => value === 'unspecified' || value === 'unset';
  if (!absent(values.filter) || !absent(values['working-tree-encoding']) || !absent(values.ident) || values.text === 'unset') return false;
  const config = gitCommand(root, ['config', '--bool', 'core.autocrlf']);
  if (config.status !== 0 && config.status !== 1) return false;
  const textEnabled = values.text === 'set' || values.text === 'auto' || ['lf', 'crlf'].includes(values.eol) || config.status === 0 && config.stdout.trim() === 'true';
  if (!textEnabled || !working.includes(13) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(working.toString('latin1'))) return false;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(working);
    if (text.replaceAll('\r\n', '').includes('\r')) return false;
    return Buffer.from(text.replaceAll('\r\n', '\n')).equals(indexed);
  } catch { return false; }
}

function checkedOutput(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /[\\\x00-\x1f\x7f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Saida local invalida: ${path}`);
  return path;
}

function escapePattern(path) { return path.replace(/[\\!#*?\[\] ]/g, '\\$&'); }

function rootProbes(root, roots) {
  return roots.filter(path => { const item = localStat(join(root, path)); return !item || item.isDirectory() && !item.isSymbolicLink(); }).map(path => `${path}/.agentdevkit-ignore-probe`);
}

function artifactPolicy(templateFile) {
  const adjacent = join(dirname(templateFile), 'agents.ignore');
  const source = checkedLocalPath(localStat(adjacent) ? adjacent : fileURLToPath(new URL('../../templates/gitignore/agents.ignore', import.meta.url)));
  const content = readFileSync(source, 'utf8');
  const section = content.split(/^## Resultados e arquivos temporarios\r?$/m)[1]?.split(/^## /m)[0];
  const patterns = section?.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (!patterns?.length || patterns.some(pattern => !pattern.startsWith('**/') || /[!\\\x00-\x1f]/.test(pattern) || pattern.split('/').includes('..'))) throw new Error('Secao de artefatos invalida em agents.ignore.');
  return patterns;
}

function privateClientPolicy(templateFile, roots) {
  const adjacent = join(dirname(templateFile), 'agents.ignore');
  const source = checkedLocalPath(localStat(adjacent) ? adjacent : fileURLToPath(new URL('../../templates/gitignore/agents.ignore', import.meta.url)));
  const section = readFileSync(source, 'utf8').split(/^## Estado local, caches e credenciais conhecidas\r?$/m)[1]?.split(/^## /m)[0];
  const patterns = section?.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (!patterns?.length || patterns.some(pattern => !/^(?:!?\*\*\/|\/)/.test(pattern) || /[\\\x00-\x1f]/.test(pattern) || pattern.split('/').includes('..'))) throw new Error('Secao de estado local invalida em agents.ignore.');
  const rules = [], probes = [];
  for (const root of roots) for (const pattern of patterns) {
    const negative = pattern.startsWith('!'), rule = pattern.replace(/^!/, '').replace(/^\//, '');
    rules.push(`${negative ? '!' : ''}/${escapePattern(root)}/${rule}`);
    if (negative) continue;
    const witness = lower => rule.replace(/^\*\*\//, '').replace(/\[([^\]]+)\]/g, (_match, letters) => lower ? letters[0].toLowerCase() : letters[0]).replace(/\*/g, 'agentdevkit-private-probe').replace(/\?/g, 'x');
    for (const variant of new Set([witness(false), witness(true)])) {
      probes.push(`${root}/${variant}${variant.endsWith('/') ? '.agentdevkit-ignore-probe' : ''}`);
      if (rule.startsWith('**/')) probes.push(`${root}/.agentdevkit-ignore-probes/${variant}${variant.endsWith('/') ? '.agentdevkit-ignore-probe' : ''}`);
    }
  }
  return { rules, probes };
}

function safeIgnoreProbe(root, path) {
  let parent = root;
  for (const part of path.split('/').slice(0, -1)) {
    parent = join(parent, part);
    const item = localStat(parent);
    if (item && (!item.isDirectory() || item.isSymbolicLink())) return false;
  }
  return true;
}

function artifactProbes(root, patterns) {
  const probes = new Set();
  for (const pattern of patterns) {
    const stem = pattern.slice(3).replace(/\/$/, '').replace(/\[([^\]]+)\]/g, (_match, letters) => letters[0]).replace(/\?/g, 'x');
    const names = stem.includes('*') ? ['', '-mcp', '-report', '-cache', '-agentdevkit'].map(suffix => stem.replace(/\*/g, suffix)) : [stem];
    for (const name of names) for (const variant of new Set([name, name.toLowerCase()])) {
      const leaves = stem.includes('*') ? ['.agentdevkit-artifact-probe', '.cache/.agentdevkit-artifact-probe'] : ['.agentdevkit-artifact-probe'];
      for (const leaf of leaves) for (const path of [`${variant}/${leaf}`, `.agentdevkit-ignore-probes/${variant}/${leaf}`]) {
        let parent = root, safe = true;
        for (const part of path.split('/').slice(0, -1)) {
          parent = join(parent, part); const item = localStat(parent);
          if (item && (!item.isDirectory() || item.isSymbolicLink())) { safe = false; break; }
        }
        if (safe) probes.add(path);
      }
    }
  }
  return [...probes];
}

const matchesComponent = (part, pattern) => posix.matchesGlob(`x${part}`, `x${pattern.replace(/[{}()]/g, '\\$&')}`);

function matchesParts(parts, pattern) {
  const cache = new Map();
  function match(part, glob) {
    const key = `${part}:${glob}`; if (cache.has(key)) return cache.get(key);
    const expected = pattern[glob];
    const result = glob === pattern.length ? part === parts.length
      : expected === '**' ? match(part, glob + 1) || part < parts.length && match(part + 1, glob)
        : part < parts.length && matchesComponent(parts[part], expected) && match(part + 1, glob + 1);
    cache.set(key, result); return result;
  }
  return match(0, 0);
}

function artifactPath(path, patterns, directory = false) {
  const parts = path.split('/');
  return patterns.some(pattern => {
    const rule = pattern.slice(3).replace(/\/$/, '');
    return parts.some((part, index) => (index < parts.length - 1 || directory || !pattern.endsWith('/'))
      && (rule.includes('/') ? matchesParts(parts.slice(0, index + 1), ['**', ...rule.split('/')])
        : matchesComponent(part, rule)));
  });
}

function visibleArtifactProbes(root, location, patterns) {
  const listed = gitCommand(location.top, ['--literal-pathspecs', '-c', 'core.excludesFile=', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', location.prefix ? `${location.prefix}/` : '.']);
  if (listed.error || listed.status !== 0) throw new Error(listed.error?.message || listed.stderr || 'Falha ao conferir artefatos existentes.');
  const paths = listed.stdout.split('\0').filter(Boolean), prefix = location.prefix ? `${location.prefix}/` : '';
  const probes = new Set(paths.filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length)).filter(path => artifactPath(path, patterns) && safeIgnoreProbe(root, path)));
  const ignores = new Set(paths.filter(path => path.startsWith(prefix) && (path === '.gitignore' || path.endsWith('/.gitignore')) && safeIgnoreProbe(root, path.slice(prefix.length))));
  let ancestor = root;
  while (true) {
    ignores.add(portable(relative(location.top, join(ancestor, '.gitignore'))));
    if (ancestor === location.top) break;
    ancestor = dirname(ancestor);
  }
  for (const path of ignores) {
    const file = join(location.top, path), item = localStat(file);
    if (!item?.isFile() || item.isSymbolicLink()) continue;
    // Git resolves precedence; these literals only add witnesses for named exceptions.
    for (const line of readFileSync(checkedLocalPath(file), 'utf8').split(/\r?\n/)) {
      if (!line.startsWith('!') || line.length === 1) continue;
      const rule = line.slice(1).replace(/(?<!\\) +$/, ''), directory = rule.endsWith('/') || rule.endsWith('/**');
      const literal = rule.replace(/(?:\/\*\*)+\/?$/, '').replace(/\/$/, '').replace(/^\//, '');
      if (/(^|[^\\])[*?\[]/.test(literal)) continue;
      const ruleBase = !rule.startsWith('/') && !literal.includes('/') && relative(dirname(file), root).split(sep)[0] !== '..' ? root : dirname(file);
      const candidate = portable(relative(root, resolve(ruleBase, literal.replace(/\\(.)/g, '$1'))));
      if (!candidate || candidate === '..' || candidate.startsWith('../') || !artifactPath(candidate, patterns, directory)) continue;
      const probe = checkedOutput(directory ? `${candidate}/.agentdevkit-artifact-probe` : candidate);
      if (safeIgnoreProbe(root, probe)) probes.add(probe);
    }
  }
  return [...probes];
}

// Existing unignored private files and literal/mixed-case root exceptions must
// not slip through merely because a synthetic wildcard used another spelling.
function visiblePrivateProbes(root, location, clientRoots) {
  const listed = gitCommand(location.top, ['--literal-pathspecs', '-c', 'core.excludesFile=', 'ls-files', '--others', '--exclude-standard', '-z', '--', location.prefix ? `${location.prefix}/` : '.']);
  if (listed.error || listed.status !== 0) throw new Error(listed.error?.message || listed.stderr || 'Falha ao conferir arquivos privados.');
  const prefix = location.prefix ? `${location.prefix}/` : '', roots = [...clientRoots, '.pbai4devs'];
  const clientMatches = part => roots.some(client => gitPathsOverlap(client, part, { root }));
  const probes = new Set(listed.stdout.split('\0').filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length))
    .filter(path => clientMatches(path.split('/')[0]) && isGeneratedOutput(path) && safeIgnoreProbe(root, path)));
  const ignore = join(root, '.gitignore'), item = localStat(ignore);
  if (item?.isFile() && !item.isSymbolicLink()) for (const line of readFileSync(ignore, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.startsWith('!') || line.length === 1) continue;
    const rule = line.slice(1), directory = rule.endsWith('/');
    const witness = rule.replace(/^\//, '').replace(/\*\*\//g, '').replace(/\[([^\]]+)\]/g, (_m, letters) => letters[0]).replace(/\*/g, '').replace(/\?/g, 'x').replace(/\/$/, '');
    if (!witness || /[\\\x00-\x1f]/.test(witness)) continue;
    const candidates = clientMatches(witness.split('/')[0]) ? [witness] : roots.map(client => `${client}/${witness}`);
    for (const path of candidates) {
      const probe = checkedOutput(directory ? `${path}/.agentdevkit-ignore-probe` : path);
      if (isGeneratedOutput(path, directory) && safeIgnoreProbe(root, probe)) probes.add(probe);
    }
  }
  return [...probes];
}

// A generic extension exception is ordinary project configuration. Existing
// private files still go through Git's effective ignore checks separately.
function genericFileException(rule, file, root, clientRoots, artifacts) {
  const parts = rule.replace(/^\//, '').split('/'), leaf = parts.pop();
  const extension = /^\*\.([a-z0-9_-]+)$/i.exec(leaf)?.[1];
  if (!extension || parts.some(part => /[*?\[\]\\]/.test(part) && !['*', '**'].includes(part))) return false;
  const base = portable(relative(root, dirname(file)));
  const scope = [...base.split('/'), ...parts].filter(part => part && part !== '.' && part !== '..' && part !== '*' && part !== '**');
  if (scope.some(part => part === '.pbai4devs' || clientRoots.some(client => gitPathsOverlap(client, part, { root })))) return false;
  return !scope.some((part, index) => isGeneratedOutput(part, true) || artifactPath(scope.slice(0, index + 1).join('/'), artifacts, true));
}

function literalGlobName(value) {
  // An ASCII case pair such as [Pp] denotes one case-insensitive name.
  const name = value.replace(/\[([a-z])\1\]/gi, '$1').toLowerCase();
  return ordinaryGitComponent(name) ? name : null;
}

function directoryExceptionIssue(rule, finalRules, clientRoots, artifacts) {
  if (!rule.endsWith('/')) return 'ignore-ambiguous';
  const parts = rule.slice(0, -1).split('/');
  const names = parts.filter((part, index) => part !== '**' || index === 0 || index === parts.length - 1)
    .map(literalGlobName);
  const artifactNames = artifacts.map(pattern => pattern.slice(3).replace(/\/$/, ''));
  if (process.platform !== 'win32' && names.every(Boolean) && artifactNames.every(name => !name.includes('/'))) {
    // An interior globstar varies the path, never the directory name opened
    // by a rule such as Packages/build/ or src/**/build/.
    // Keep exceptions scoped to a client or naming a private directory visible.
    const disjoint = names.every(name => !clientRoots.includes(name) && name !== '.pbai4devs' && name !== 'cache'
      && !isGeneratedOutput(name, true) && !isGeneratedOutput(name) && !artifactPath(name, artifacts, true));
    return disjoint ? null : 'ignore-ambiguous';
  }

  // The Visual Studio rule requires at least one character before .cache,
  // so it cannot open the private directory .cache itself. A prefix-glob
  // artifact such as .playwright* still intersects. Report that overlap as an
  // artifact warning. Visible private files remain blocking in Git's probes.
  if (parts.length !== 1 || !parts[0].startsWith('?*.') || literalGlobName(parts[0].slice(3)) !== 'cache') return 'ignore-ambiguous';
  const matchesCacheSuffix = name => name.length > '.cache'.length && name.endsWith('.cache');
  const playwright = 'playwright'.replace(/[a-z]/g, letter => `[${letter.toUpperCase()}${letter}]`);
  if (clientRoots.some(matchesCacheSuffix)) return 'ignore-ambiguous';
  if (!finalRules.has(`**/.${playwright}*`) || !finalRules.has(`**/${playwright}*/`)) return 'artifact-ignore-ambiguous';
  const covered = artifacts.every((pattern, index) => {
    const name = literalGlobName(artifactNames[index]);
    return Boolean(name && !matchesCacheSuffix(name)) || finalRules.has(pattern);
  });
  return covered ? null : 'artifact-ignore-ambiguous';
}

// Wildcard negations may expose files that do not exist yet. Inspect client
// ignores directly, even when an old rule currently hides the entire client.
function ambiguousExceptions(root, location, clientRoots, artifacts) {
  const files = [];
  const visit = directory => {
    const item = localStat(directory);
    if (!item?.isDirectory() || item.isSymbolicLink()) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && entry.name === '.gitignore') files.push(path);
      else if (entry.isDirectory()) {
        const local = portable(relative(root, path)), client = clientRoots.includes(local.split('/')[0]);
        const downloaded = entry.name === 'node_modules' || /^\.pbai4devs\/(?:tools\/(?:npm-cache|bin)|external-skills\/[^/]+)$/.test(local);
        const gitPath = location.prefix ? `${location.prefix}/${local}/` : `${local}/`;
        const ignoredDownload = downloaded && gitCommand(location.top, ['-c', 'core.excludesFile=', 'check-ignore', '--no-index', '-q', '--', gitPath]).status === 0;
        const protectedDir = entry.name === '.git' || artifactPath(local, artifacts, true)
          || ignoredDownload || (client || local.startsWith('.pbai4devs/')) && isGeneratedOutput(local, true);
        if (!protectedDir) visit(path);
      }
    }
  };
  visit(root);
  let ancestor = dirname(root);
  while (root !== location.top && (ancestor === location.top || !relative(location.top, ancestor).startsWith(`..${sep}`))) {
    files.push(join(ancestor, '.gitignore'));
    if (ancestor === location.top) break;
    ancestor = dirname(ancestor);
  }
  const rootIgnore = join(root, '.gitignore');
  const conflicts = [];
  for (const file of files) {
    const item = localStat(file);
    if (!item?.isFile() || item.isSymbolicLink()) continue;
    const lines = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    const finalRules = new Set(lines.slice(lines.findLastIndex(line => line.startsWith('!')) + 1));
    for (const line of lines) {
      if (!line.startsWith('!')) continue;
      const rule = line.slice(1).replace(/^\/?(?:\*\*\/)?/, '');
      if (/^\.env\.(?:example|sample|template|\*\.example)$/.test(rule)) continue;
      const wildcard = /(^|[^\\])[*?\[]/.test(line);
      const scope = portable(relative(dirname(file), root));
      if (scope && !scope.startsWith('..') && !/^!\/?\*\*\//.test(line) && rule.includes('/')) {
        const parts = rule.split('/'), project = scope.split('/');
        if (project.some((part, index) => parts[index] && !/[*?\[]/.test(parts[index]) && parts[index] !== part && parts.slice(0, index).every(value => value && !/[*?\[]/.test(value)))) continue;
      }
      if (!wildcard) {
        if (file !== rootIgnore && isGeneratedOutput(portable(relative(root, join(dirname(file), rule))), rule.endsWith('/'))) {
          conflicts.push({ code: 'ignore-ambiguous', path: `${portable(relative(root, file))}: ${line}` });
        }
        continue;
      }
      if (genericFileException(rule, file, root, clientRoots, artifacts)) continue;
      const code = file === rootIgnore ? directoryExceptionIssue(rule, finalRules, clientRoots, artifacts) : 'ignore-ambiguous';
      if (code) conflicts.push({ code, path: `${portable(relative(root, file))}: ${line}` });
    }
  }
  return conflicts;
}

function localIgnoreSource(location, source) {
  const path = resolve(location.top, source);
  if (path === location.exclude) return true;
  const inside = relative(location.top, path);
  return basename(path) === '.gitignore' && !isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`);
}

function ignoreMatches(location, probes, { useGlobal = false } = {}) {
  const root = join(location.top, location.prefix);
  if (probes.some(path => !safeIgnoreProbe(root, path))) throw new Error('Probe atravessa caminho simbolico.');
  const paths = probes.map(path => location.prefix ? `${location.prefix}/${path}` : path);
  const result = gitCommand(location.top, [...(useGlobal ? [] : ['-c', 'core.excludesFile=']), 'check-ignore', '--verbose', '--no-index', '--stdin', '-z'], paths.join('\0') + '\0');
  if (result.error || ![0, 1].includes(result.status)) throw new Error(result.error?.message || result.stderr || 'Falha ao conferir exclusoes Git.');
  const values = result.stdout.split('\0'), matches = new Map();
  for (let index = 0; index + 3 < values.length; index += 4) matches.set(values[index + 3], { source: values[index], line: Number(values[index + 1]), pattern: values[index + 2] });
  return { paths, matches };
}

// A nested .gitignore cannot reopen a project hidden by an ignored ancestor.
// Detect this before claiming that its client exceptions are effective.
function ignoredProjectAncestors(location) {
  if (!location.prefix) return [];
  const segments = location.prefix.split('/');
  const paths = segments.map((_part, index) => segments.slice(0, index + 1).join('/'));
  const result = gitCommand(location.top, ['check-ignore', '--verbose', '--no-index', '--stdin', '-z'], `${paths.join('\0')}\0`);
  if (result.error || ![0, 1].includes(result.status)) throw new Error(result.error?.message || result.stderr || 'Falha ao conferir ancestrais Git.');
  const values = result.stdout.split('\0'), ignored = [];
  for (let index = 0; index + 3 < values.length; index += 4) {
    if (!values[index + 2].startsWith('!')) ignored.push(`Ancestral Git ignorado: ${values[index + 3]}/; reabra-o no .gitignore do repositorio pai`);
  }
  return ignored;
}

function localRoot(value) {
  const missing = []; let parent = resolve(value);
  while (!localStat(parent)) { missing.unshift(parent.slice(dirname(parent).length + 1)); parent = dirname(parent); }
  if (!localStat(parent).isDirectory() || localStat(parent).isSymbolicLink()) throw new Error('Raiz local exige diretorio real.');
  const canonical = canonicalGitPath(parent);
  return { root: join(canonical, ...missing), parent: canonical };
}

function gitIgnoreLocation({ parent, root }) {
  const info = gitCommand(parent, ['rev-parse', '--show-toplevel', '--git-path', 'info/exclude']);
  if (info.error || info.status !== 0 || info.signal) {
    if (noGitRepository(parent, info)) return null;
    throw new Error(`Nao foi possivel localizar Git: ${info.error?.message || info.stderr}`);
  }
  const lines = gitOutputLines(info.stdout), [reportedTop, reportedExclude] = lines;
  if (lines.length !== 2 || !reportedTop || !reportedExclude) throw new Error('Localizacao Git invalida.');
  const exclude = resolve(parent, reportedExclude);
  const top = canonicalGitPath(reportedTop);
  const prefix = relative(top, root);
  if (isAbsolute(prefix) || prefix === '..' || prefix.startsWith(`..${sep}`)) throw new Error('Projeto fora da arvore Git.');
  checkedLocalPath(exclude);
  const canonicalExclude = localStat(exclude) ? canonicalGitPath(exclude) : join(localRoot(dirname(exclude)).root, basename(exclude));
  return { top, exclude: checkedLocalPath(canonicalExclude), prefix: portable(prefix) };
}

function inspectLegacyMigration(root, location) {
  return inspectLegacyExclude(root, location, () => {
    const listed = gitCommand(root, ['worktree', 'list', '--porcelain', '-z']);
    if (listed.error || listed.signal || listed.status !== 0) return null;
    const worktrees = listed.stdout.split('\0').filter(line => line.startsWith('worktree '));
    if (worktrees.length > 1) return false;
    if (!worktrees.length) return null;
    try { return canonicalGitPath(worktrees[0].slice('worktree '.length)) === root ? true : null; }
    catch { return null; }
  });
}

export function planLegacyIgnoreMigration(target) {
  assertUnredirectedGitEnvironment();
  const resolved = localRoot(target);
  return inspectLegacyMigration(resolved.root, gitIgnoreLocation(resolved));
}

export function assertLegacyIgnoreMigration(plan) {
  const expected = plan?.legacyMigration;
  if (!expected || !Buffer.isBuffer(expected.before) || !Buffer.isBuffer(expected.after)) {
    throw new Error('Plano de migração de exclusão legada inválido.');
  }
  const { edit } = planLegacyIgnoreMigration(plan.root);
  if (!edit || expected.path !== edit.path || expected.mode !== edit.mode
    || !expected.before.equals(edit.before) || !expected.after.equals(edit.after)) {
    throw new Error('Exclusão legada ou worktree mudou após o planejamento; arquivos preservados.');
  }
}

// The patterns come from the hub; only the concrete names of the derivatives are calculated.
export function planLocalIgnore(root, { outputs = [], templateRoot } = {}) {
  assertUnredirectedGitEnvironment();
  const resolved = localRoot(root); root = resolved.root;
  const localTemplate = join(root, '.pbai4devs/templates/gitignore/local.ignore');
  const templateFile = checkedLocalPath(templateRoot ? join(templateRoot, '.pbai4devs/templates/gitignore/local.ignore') : localStat(localTemplate) ? localTemplate : fileURLToPath(new URL('../../templates/gitignore/local.ignore', import.meta.url)));
  const template = readFileSync(templateFile, 'utf8');
  const artifacts = artifactPolicy(templateFile);
  if (template.split('{{OUTPUTS}}').length !== 2) throw new Error('local.ignore exige um unico {{OUTPUTS}}.');
  if (template.split('{{ROOTS}}').length > 2) throw new Error('local.ignore permite um unico {{ROOTS}}.');
  // Client roots are ignored locally. Projects can explicitly opt in to a
  // complete client with a literal negation in their own root .gitignore.
  const localPolicy = join(templateRoot || root, '.pbai4devs/templates/clients/ADAPTERS.json');
  const policyText = readFileSync(checkedLocalPath(localStat(localPolicy) ? localPolicy : fileURLToPath(new URL('../../templates/clients/ADAPTERS.json', import.meta.url))), 'utf8');
  let policy;
  try { policy = JSON.parse(policyText); }
  catch { throw new SyntaxError('JSON invalido: configuracao de adaptadores.'); }
  const roots = [...new Set(policy.adapters.flatMap(adapter => [adapter.root, ...(adapter.extraRoots || [])]))];
  const retiredRoots = policy.retiredRoots === undefined ? [] : policy.retiredRoots;
  if (!Array.isArray(retiredRoots) || new Set(retiredRoots).size !== retiredRoots.length
    || retiredRoots.some(path => roots.includes(path))) throw new Error('Raiz de cliente aposentada invalida para exclusao.');
  // Retiring an adapter must not stop detecting private files left in its old
  // root. Only active roots are eligible for an opt-in to derived resources.
  const clientRoots = [...roots, ...retiredRoots];
  if (clientRoots.some(path => typeof path !== 'string' || !/^\.[a-z0-9][a-z0-9-]*$/.test(path) || ['.git', '.pbai4devs', '.agent-tests'].includes(path))) throw new Error('Raiz de cliente invalida para exclusao.');
  const privateClients = privateClientPolicy(templateFile, clientRoots);
  const outputPaths = [...new Set(outputs.map(checkedOutput))];
  const paths = [...new Set([...outputPaths, ...template.split(/\r?\n/).filter(line => line.startsWith('/')).map(line => checkedOutput(line.slice(1)))])]
    .filter(path => !roots.some(client => path === client || path.startsWith(`${client}/`))).sort();
  const location = gitIgnoreLocation(resolved);
  const legacy = inspectLegacyMigration(root, location);
  const projectIgnore = join(root, '.gitignore'), projectIgnoreStat = localStat(projectIgnore);
  const literalExceptions = projectIgnoreStat?.isFile() && !projectIgnoreStat.isSymbolicLink()
    ? new Set(readFileSync(projectIgnore, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) : new Set();
  const requestedRoots = location ? roots.filter(client => literalExceptions.has(`!/${client}/`) || literalExceptions.has(`!${client}/`)) : [];
  const optCandidates = requestedRoots.filter(client => safeIgnoreProbe(root, `${client}/.agentdevkit-opt-in-probe`));
  // A later rule or an ancestor can override a literal negation. Consult Git
  // before accepting it, including when the client folder does not yet exist.
  const optProbes = optCandidates.map(client => `${client}/.agentdevkit-opt-in-probe`);
  const optMatches = location && optProbes.length ? ignoreMatches(location, optProbes) : { paths: [], matches: new Map() };
  const optedRoots = optCandidates.filter((_client, index) => {
    const match = optMatches.matches.get(optMatches.paths[index]);
    return !match || match.pattern.startsWith('!');
  });
  const listed = location ? gitCommand(location.top, ['ls-files', '-z'], undefined, null) : null;
  if (listed && (listed.error || listed.status !== 0)) throw new Error(listed.error?.message || listed.stderr || 'Falha ao consultar indice Git.');
  const privateRoots = [...clientRoots, '.pbai4devs'];
  let indexed = '';
  try { if (listed) indexed = new TextDecoder('utf-8', { fatal: true }).decode(listed.stdout); }
  catch { throw new Error('Indice Git contem caminho nao UTF-8; alteracoes recusadas.'); }
  const prefixParts = location?.prefix ? location.prefix.split('/') : [];
  const trackedOutputs = listed ? indexed.split('\0').filter(Boolean).flatMap(path => {
    const parts = path.split('/');
    if (parts.length <= prefixParts.length || prefixParts.some((_part, index) => !gitPathsOverlap(prefixParts.slice(0, index + 1).join('/'), parts.slice(0, index + 1).join('/'), { root: location.top }))) return [];
    const local = parts.slice(prefixParts.length).join('/');
    const reported = parts.slice(0, prefixParts.length).join('/') === (location?.prefix || '') ? local : path;
    return artifactPath(local, artifacts) || privateRoots.some(client => gitPathsOverlap(client, parts[prefixParts.length], { root })) && isGeneratedOutput(local) ? [reported] : [];
  }) : [];
  return { root, status: location ? 'git' : 'no-git', worktreeScope: Boolean(location), worktreeLocation: location,
    location: null, clientRoots, optedRoots, artifacts, edits: [], protectedOutputs: [], protectedHashes: {},
    unprotectedOutputs: outputPaths, trackedOutputs,
    legacyMigration: legacy.edit ?? null, legacyMigrationStatus: legacy.status };

}

export function checkLocalIgnore(plan, { replacedBlocks = [] } = {}) {
  assertUnredirectedGitEnvironment();
  replacedBlocks.forEach(item => {
    const path = canonicalGitPath(checkedLocalPath(resolve(item.path))), inside = relative(localRoot(plan.root).root, path);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`) || !Number.isInteger(item.firstLine) || !Number.isInteger(item.lastLine) || item.firstLine < 1 || item.lastLine < item.firstLine || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Faixa de ignore gerenciado invalida.');
    const content = readFileSync(checkedLocalPath(path), 'utf8');
    const lines = [...content.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].filter(match => match[0]);
    if (item.lastLine > lines.length) throw new Error('Faixa de ignore fora do arquivo.');
    const first = lines[item.firstLine - 1], last = lines[item.lastLine - 1];
    const block = content.slice(first.index, last.index + last[0].replace(/[\r\n]+$/, '').length);
    if (createHash('sha256').update(block).digest('hex') !== item.sha256) throw new Error('Bloco de ignore mudou antes da verificacao.');

  });
  if (!plan.worktreeLocation) return { ok: false, status: plan.status, missing: [], pending: [], trackedOutputs: plan.trackedOutputs, changed: 0 };
    const pending = [];
    const choices = plan.artifacts.map(pattern => ({ pattern, probes: artifactProbes(plan.root, [pattern]) }));
    const existing = visibleArtifactProbes(plan.root, plan.worktreeLocation, plan.artifacts);
    const privateFiles = visiblePrivateProbes(plan.root, plan.worktreeLocation, plan.clientRoots);
    const outputProbes = plan.unprotectedOutputs.filter(path => safeIgnoreProbe(plan.root, path));
    for (const path of plan.unprotectedOutputs) if (!safeIgnoreProbe(plan.root, path)) pending.push({ code: 'output-unavailable', path });
    const probes = [...new Set([...choices.flatMap(choice => choice.probes), ...existing, ...privateFiles, ...outputProbes])];
    const checks = probes.length ? ignoreMatches(plan.worktreeLocation, probes) : { paths: [], matches: new Map() };
    const projectIgnore = join(plan.root, '.gitignore'), projectIgnoreStat = localStat(projectIgnore);
    const explicitPatterns = projectIgnoreStat?.isFile() && !projectIgnoreStat.isSymbolicLink()
      ? new Set(readFileSync(projectIgnore, 'utf8').split(/\r?\n/)) : new Set();
    const unignored = new Set(probes.filter((_path, index) => {
      const match = checks.matches.get(checks.paths[index]);
      return !match || match.pattern.startsWith('!');
    }));
    for (const choice of choices) {
      const sample = choice.probes.find(path => unignored.has(path)) ?? existing.find(path => unignored.has(path) && artifactPath(path, [choice.pattern]));
      if (sample) pending.push({ code: 'artifact-unprotected', path: sample, pattern: choice.pattern });
      else if (!explicitPatterns.has(choice.pattern)) pending.push({ code: 'artifact-coverage-unverified', path: choice.pattern, pattern: choice.pattern });
    }
    for (const path of outputProbes) if (unignored.has(path)) pending.push({ code: 'output-visible', path });
    const privateChecks = privateFiles.length ? ignoreMatches(plan.worktreeLocation, privateFiles, { useGlobal: true }) : { paths: [], matches: new Map() };
    for (const [index, path] of privateFiles.entries()) {
      const match = privateChecks.matches.get(privateChecks.paths[index]);
      if (!match || match.pattern.startsWith('!')) pending.push({ code: 'private-file-visible', path });
    }
    pending.push(...ambiguousExceptions(plan.root, plan.worktreeLocation, plan.clientRoots, plan.artifacts));
    const currentShared = localRead(checkedLocalPath(plan.worktreeLocation.exclude)) ?? '';
    if (/^# BEGIN AGENTDEVKIT LOCAL [a-f0-9]{16}\r?$/m.test(currentShared.replace(/^\uFEFF/, ''))) {
      const migration = planLegacyIgnoreMigration(plan.root);
      pending.push({ code: 'shared-ignore-legacy', path: plan.worktreeLocation.exclude, migration: migration.status });
    }
  return { ok: !plan.trackedOutputs.length && !pending.some(isBlockingLocalIgnore), status: plan.status, missing: [], pending, trackedOutputs: plan.trackedOutputs, changed: 0 };
}

export function assertLocalIgnoreUnchanged(plan) {
  assertUnredirectedGitEnvironment();
  if (!Array.isArray(plan.edits) || plan.edits.length) throw new Error('Alterar exclusoes Git foi desabilitado; arquivos preservados.');
  if (plan.legacyMigration) {
    assertLegacyIgnoreMigration(plan);
    const lock = plan.legacyMigration.path + '.lock';
    try { lstatSync(lock); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    throw Object.assign(new Error('Git info/exclude is locked.'), { code: 'EEXIST', path: lock });
  }
}

export function applyLocalIgnore(plan, { validate, migrateLegacy = false } = {}) {
  assertLocalIgnoreUnchanged(plan);
  const checked = checkLocalIgnore(plan);
  validate?.();
  const migration = migrateLegacy ? applyLegacyExcludeMigration(plan, assertLegacyIgnoreMigration) : null;
  return { status: plan.status, changed: migration ? 1 : 0, trackedOutputs: plan.trackedOutputs,
    pending: migration ? checkLocalIgnore(plan).pending : checked.pending, ...(migration ? { migration } : {}) };
}

export function planUntrack(root, expectedHashes = {}, { gitlinkBoundaries = [] } = {}) {
  assertUnredirectedGitEnvironment();
  root = localRoot(root).root;
  const candidates = Object.keys(expectedHashes).map(checkedOutput).sort();
  const boundaries = gitlinkBoundaries.map(checkedOutput);
  for (const hash of Object.values(expectedHashes)) if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Hash de ownership invalido para desindexar.');
  if ((!candidates.length && !boundaries.length) || !localStat(root)) return { root, paths: [], hashes: {}, index: '', conflicts: [], ...(boundaries.length ? { gitlinkConflicts: [] } : {}) };
  const topResult = gitCommand(root, ['rev-parse', '--show-toplevel']);
  if (topResult.error || topResult.status !== 0 || topResult.signal) {
    if (noGitRepository(root, topResult)) return { root, paths: [], hashes: {}, index: '', conflicts: [] };
    throw new Error(topResult.error?.message || topResult.stderr || 'Falha ao localizar repositorio Git.');
  }
  const topLines = topResult.status === 0 ? gitOutputLines(topResult.stdout) : [];
  if (topResult.status === 0 && (topLines.length !== 1 || !topLines[0])) throw new Error('Localizacao Git invalida.');
  const top = topResult.status === 0 ? canonicalGitPath(topLines[0]) : root;
  const local = relative(top, root);
  if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) throw new Error('Projeto fora da arvore Git.');
  const rootPrefix = topResult.status === 0 ? portable(local) : '';
  const rootParts = rootPrefix ? rootPrefix.split('/') : [];
  const result = gitCommand(top, ['ls-files', '--stage', '-z'], undefined, null);
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(result.error?.message || result.stderr || 'Falha ao ler indice Git.');
  }
  const conflicts = [];
  let indexText;
  try { indexText = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout); }
  catch { throw new Error('Indice Git contem caminho nao UTF-8; alteracoes recusadas.'); }
  const records = indexText.split('\0').filter(Boolean);
  const gitlinkConflicts = new Set(); let gitlinkCoversRoot = false;
  for (const record of records) {
    const tab = record.indexOf('\t');
    if (tab < 0 || !/^160000 [a-f0-9]+ [0-3]$/.test(record.slice(0, tab))) continue;
    const indexed = record.slice(tab + 1);
    if (rootPrefix && indexed.split('/').length <= rootParts.length && gitPathsOverlap(indexed, rootPrefix, { root: top, allowMissingTarget: true })) gitlinkCoversRoot = true;
    for (const boundary of boundaries) {
      const full = rootPrefix ? `${rootPrefix}/${boundary}` : boundary;
      if (gitPathsOverlap(indexed, full, { root: top, allowMissingTarget: true })) gitlinkConflicts.add(boundary);
    }
  }
  if (gitlinkCoversRoot) conflicts.push(...candidates);
  const folded = new Map(), prefixes = new Map();
  for (const path of candidates) {
    const key = gitPathKey(path);
    folded.set(key, [...(folded.get(key) || []), path]);
    const parts = key.split('/');
    for (let count = 1; count <= parts.length; count++) {
      const parent = parts.slice(0, count).join('/');
      prefixes.set(parent, [...(prefixes.get(parent) || []), path]);
    }
  }
  const uncertain = part => !ordinaryGitComponent(part) || process.platform === 'win32' && possibleWindowsShortName(part);
  const uncertainCandidates = candidates.filter(path => path.split('/').some(uncertain));
  const matches = new Map();
  for (const record of records) {
    const position = record.indexOf('\t'), indexedPath = record.slice(position + 1), indexedParts = indexedPath.split('/');
    if (position < 0) continue;
    if (indexedParts.length <= rootParts.length || rootParts.some((_part, index) => !gitPathsOverlap(rootParts.slice(0, index + 1).join('/'), indexedParts.slice(0, index + 1).join('/'), { root: top }))) continue;
    const path = indexedParts.slice(rootParts.length).join('/');
    const key = gitPathKey(path), parts = key.split('/'), related = new Set(prefixes.get(key) || []);
    for (let count = 1; count < parts.length; count++) for (const candidate of folded.get(parts.slice(0, count).join('/')) || []) related.add(candidate);
    const possible = path.split('/').some(uncertain) ? candidates : uncertainCandidates;
    for (const candidate of possible) if (gitPathsOverlap(path, candidate, { root, allowMissingTarget: true })) related.add(candidate);
    for (const candidate of related) {
      matches.set(candidate, [...(matches.get(candidate) || []), { record, path, prefixExact: indexedParts.slice(0, rootParts.length).join('/') === rootPrefix }]);
    }
  }
  const paths = [...matches.keys()].filter(path => {
    const file = checkedLocalPath(join(root, path));
    const entries = matches.get(path);
    const match = entries.length === 1 && entries[0].record.match(/^\d+ ([a-f0-9]+) 0\t/);
    const blob = match ? gitCommand(root, ['cat-file', 'blob', match[1]], undefined, null) : null;
    const data = localStat(file) ? readFileSync(file) : null;
    const owned = data && createHash('sha256').update(data).digest('hex') === expectedHashes[path];
    const indexOwned = entries[0]?.prefixExact && entries[0]?.path === path && blob?.status === 0 && data && indexContentMatches(root, path, data, blob.stdout);
    if (!owned || !indexOwned) conflicts.push(path);
    return owned && indexOwned;
  });
  // Records are relative to the Git root, while paths are relative to the
  // project. Retain the matched records rather than comparing those names.
  const selectedRecords = new Set(paths.flatMap(path => matches.get(path).map(entry => entry.record)));
  const index = records.filter(record => selectedRecords.has(record)).join('\0');
  return { root, paths, hashes: Object.fromEntries(paths.map(path => [path, expectedHashes[path]])), index, conflicts: [...new Set(conflicts)], ...(boundaries.length ? { gitlinkConflicts: [...gitlinkConflicts] } : {}) };
}

export function applyUntrack(plan) {
  if (plan?.paths?.length || plan?.conflicts?.length) throw new Error('Alterar o indice Git foi desabilitado; indice preservado.');
  return { removed: [] };
}

export function restoreUntrack(plan) {
  if (plan?.paths?.length) throw new Error('Alterar o indice Git foi desabilitado; indice preservado.');
  return { restored: [], preserved: [] };
}

export function mergeGitignore(current, template) {
  if (typeof current !== 'string' || typeof template !== 'string' || current.includes('\0') || template.includes('\0')) throw new Error('Conteudo .gitignore invalido.');
  const body = template.replace(/\r\n?/g, '\n').replace(/\n*$/, '');
  if (!body.trim() || body.split('\n').some(line => [ignoreBegin, ignoreEnd].includes(line.trim()))) throw new Error('Template .gitignore vazio ou com marcadores reservados.');
  const markers = [];
  const lines = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  for (const match of current.matchAll(lines)) {
    const value = match[1].trim();
    if ([ignoreBegin, ignoreEnd].includes(value)) markers.push({ value, start: match.index, end: match.index + match[0].length });
  }
  const block = `${ignoreBegin}\n${body}\n${ignoreEnd}\n`;
  if (!markers.length) {
    const separator = !current || /(?:\r\n|\n|\r){2}$/.test(current) ? '' : /(?:\r\n|\n|\r)$/.test(current) ? '\n' : '\n\n';
    return { text: current + separator + block, hasBlock: false };
  }
  if (markers.length !== 2 || markers[0].value !== ignoreBegin || markers[1].value !== ignoreEnd) throw new Error('Marcadores .gitignore incompletos, duplicados ou fora de ordem.');
  return { text: current.slice(0, markers[0].start) + block + current.slice(markers[1].end), hasBlock: true };
}
