#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gitPathsOverlap } from '../lib/git-environment.mjs';
import { isMain, projectRoot, requireNode } from '../lib/runtime.mjs';
import { isGeneratedOutput } from '../lib/gitignore.mjs';
import { resourcePath, synchronize } from '../sincronizar-agentes/SCRIPT.mjs';
import { clientResourcePath } from '../lib/resource-path.mjs';
import { buildCatalog } from '../lib/catalog.mjs';
import { adapterManifest } from '../lib/adapters.mjs';
import { stateDirectory } from '../lib/state-path.mjs';
import { nativePathBoundary } from '../lib/native-paths.mjs';
import { listPackageHubFiles } from './package-source.mjs';

const assets = join(dirname(fileURLToPath(import.meta.url)), 'assets');
const owner = 'testar-maturidade';
const marker = '.maturity-case.json';
const suiteMarker = '.maturity-suite.json';
const exampleOutputMarker = '.agentdevkit-example-output.json';
const generatedCatalogs = new Set(['.pbai4devs/catalog.json', '.pbai4devs/skills.json', '.pbai4devs/agents.json', '.pbai4devs/rules.json']);
const outputIgnore = '# Exemplos gerados permanecem locais.\n*\n';
const prepareResources = root => {
  const result = synchronize({ root, localIgnores: false, output: () => {} });
  if (result.exitCode !== 0) fail('Não foi possível preparar os apontamentos do exemplo.');
};
const portable = value => value.split(sep).join('/');
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
const document = (title, body, metadata = '') => `---\ndescription: Cenário sintético de maturidade.\nfixture: true\n${metadata}---\n\n# ${title}\n\n${body.trim()}\n`;
const write = (root, file, content) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); return path; };
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const stat = file => { try { return lstatSync(file); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error; } };

function noLinks(root, target) {
  let current = root;
  for (const part of ['', ...relative(root, target).split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    if (stat(current)?.isSymbolicLink()) fail(`Caminho gerenciado não pode ser link: ${current}`);
  }
}

// The child binds its cwd to the verified parent directory. A swapped parent
// changes the inode or real path before the child can create the new directory.
const createDirectoryScript = `const fs=require('node:fs');
const [name,expected,dev,ino]=process.argv.slice(1);
const info=fs.statSync('.');
if(fs.realpathSync('.')!==expected || String(info.dev)!==dev || String(info.ino)!==ino) process.exit(73);
try { fs.mkdirSync(name, { mode: 0o700 }); } catch(error) { if(error.code==='EEXIST') process.exit(17); throw error; }
`;
function createChild(root, parent, name, { allowExisting = false } = {}) {
  if (!name || name === '.' || name === '..' || basename(name) !== name) fail('Nome de diretório inválido.');
  noLinks(root, parent);
  const info = stat(parent);
  if (!info?.isDirectory() || info.isSymbolicLink()) fail('Diretório ancestral inválido.');
  const canonical = realpathSync(parent), inside = relative(root, canonical);
  if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) fail('Diretório ancestral fora do projeto.');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['-e', createDirectoryScript, name, canonical, String(info.dev), String(info.ino)], { cwd: canonical, env, encoding: 'utf8', timeout: 30000, windowsHide: true, shell: false });
  if (result.error || result.status !== 0 && !(allowExisting && result.status === 17)) fail(`Não foi possível criar diretório exclusivo: ${result.error?.message || result.stderr?.trim() || result.status}`);
  noLinks(root, join(parent, name));
  const output = stat(join(parent, name));
  if (!output?.isDirectory() || output.isSymbolicLink()) fail('Diretório de saída inválido.');
  return output;
}
function pathWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

// The standard Darwin /var and /tmp aliases are canonicalized. A user-defined
// TMPDIR or explicit directory symlink is not trusted and remains forbidden.
function canonicalTemporaryAlias(path) {
  const requested = resolve(path), aliases = process.platform === 'darwin' ? ['/tmp', '/var'] : [];
  for (const alias of aliases) {
    if (!pathWithin(alias, requested)) continue;
    if (realpathSync(alias) !== `/private${alias}`) continue;
    return join(realpathSync(alias), relative(alias, requested));
  }
  return requested;
}

function cleanGitEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  delete env.NODE_TEST_CONTEXT;
  env.GIT_OPTIONAL_LOCKS = '0';
  return env;
}

// Synthetic child processes must never inherit a user's externally bound Git
// directory, index, or injected Git configuration.
function isolatedEnvironment() {
  const env = cleanGitEnvironment();
  // Synthetic child projects must not invoke a user's global fsmonitor hook.
  env.GIT_CONFIG_COUNT = '1';
  env.GIT_CONFIG_KEY_0 = 'core.fsmonitor';
  env.GIT_CONFIG_VALUE_0 = 'false';
  return env;
}

function assertNoBareGit(path) {
  for (let current = path; ; current = dirname(current)) {
    // A bare repository has no .git entry. Recognize its on-disk structure
    // even if a broken or spoofed Git executable reports “not a repository”.
    if (stat(join(current, 'HEAD')) && (stat(join(current, 'objects')) || (stat(join(current, 'config')) && stat(join(current, 'refs'))))) {
      fail(`Saída não pode ficar dentro de repositório Git: ${path}`);
    }
    if (dirname(current) === current) break;
  }
}

function runGit(path, args, { allowMissing = false, input } = {}) {
  const env = { ...cleanGitEnvironment(), LC_ALL: 'C', LANG: 'C' };
  // Read-only queries must evaluate the user's effective ignore configuration.
  // Do not restore variables that select a different repository or index.
  for (const [key, value] of Object.entries(process.env)) {
    if (/^GIT_CONFIG_(?:GLOBAL|SYSTEM|NOSYSTEM|COUNT|PARAMETERS|KEY_\d+|VALUE_\d+)$/i.test(key)) env[key] = value;
  }
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', path, ...args], { env, input, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, shell: false });
  if (allowMissing && result.error?.code === 'ENOENT') return null;
  if (result.error || result.signal) fail(`Não foi possível verificar Git na saída: ${result.error?.message || result.signal}`);
  return result;
}

function assertOutsideGit(path, { allowMissing = false } = {}) {
  // Inspect ancestry directly as well: Git can otherwise be influenced by
  // environment variables, ceiling directories, or malformed .git markers.
  assertNoBareGit(path);
  for (let current = path; ; current = dirname(current)) {
    if (stat(join(current, '.git'))) fail(`Saída não pode ficar dentro de repositório Git: ${path}`);
    if (dirname(current) === current) break;
  }
  const result = runGit(path, ['rev-parse', '--git-dir'], { allowMissing });
  // Without Git, ancestry checks above are the best available evidence. Refuse
  // an explicitly bound worktree, whose repository can be outside this path.
  if (!result) {
    if (Object.entries(process.env).some(([name, value]) => /^(?:GIT_DIR|GIT_WORK_TREE)$/i.test(name) && value)) fail('Não foi possível verificar Git com worktree definido externamente.');
    return;
  }
  if (result.status === 0) fail(`Saída não pode ficar dentro de repositório Git: ${path}`);
  if (result.status !== 128 || !/not a git repository/i.test(result.stderr || '')) fail(`Não foi possível verificar Git na saída: ${result.stderr?.trim() || result.status}`);
}

export function mayAliasPath(left, right, { root, platform = process.platform } = {}) {
  const a = left.split('/'), b = right.split('/');
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].normalize('NFD').toLowerCase() === b[i].normalize('NFD').toLowerCase()) continue;
    // Only rule out a match for ordinary ASCII components. Unicode case folds,
    // filesystem aliases, and unusual characters are conservatively ambiguous.
    const ordinary = part => /^[a-z0-9_.-]+$/i.test(part) && !part.endsWith('.');
    // On Windows even an ordinary ASCII name may be an arbitrary 8.3 alias.
    // A missing entry is distinct from an existing one only when their shared
    // parent is verified. Check each destination prefix so the helper can
    // establish that fact for an intermediate component.
    if (ordinary(a[i]) && ordinary(b[i])) {
      if (platform !== 'win32') return false;
      for (let length = 1; length <= b.length; length++) {
        if (!gitPathsOverlap(left, b.slice(0, length).join('/'), { root, platform, allowMissingTarget: true })) return false;
      }
      return true;
    }
  }
  return true;
}

function assertIgnoredOutput(parent, sourceRoot, outputRoot, expectedTop) {
  if (Object.entries(process.env).some(([key, value]) => /^GIT_INDEX_FILE$/i.test(key) && value)) fail('Saída local não permite índice Git alternativo.');
  if (Object.entries(process.env).some(([key, value]) => /^(?:GIT_DIR|GIT_WORK_TREE|GIT_COMMON_DIR|GIT_CEILING_DIRECTORIES)$/i.test(key) && value)) fail('Saída local não permite repositório Git definido externamente.');
  assertNoBareGit(parent);
  const repository = runGit(parent, ['rev-parse', '--show-toplevel']);
  let topName = repository.stdout.endsWith('\n') ? repository.stdout.slice(0, -1) : repository.stdout;
  if (process.platform === 'win32' && topName.endsWith('\r')) topName = topName.slice(0, -1);
  if (repository.status !== 0 || !topName) fail('Saída local exige repositório Git válido.');
  const top = realpathSync.native(topName), gitMarker = stat(join(top, '.git'));
  if (!gitMarker || gitMarker.isSymbolicLink() || !pathWithin(top, sourceRoot) || !pathWithin(top, outputRoot) || (expectedTop && expectedTop !== top)) fail('Saída local deve permanecer no mesmo repositório da origem.');
  const target = portable(relative(top, outputRoot));
  // Git needs a trailing slash to recognize an absent directory. Once the
  // output exists, check the directory itself without the slash: otherwise
  // its own .gitignore can mask removal of the project's protection.
  const ignoredTarget = stat(outputRoot) ? target : `${target}/`;
  const ignored = runGit(top, ['check-ignore', '--no-index', '--verbose', '-z', '--stdin'], { input: `${ignoredTarget}\0` });
  if (ignored.status !== 0 && ignored.status !== 1) fail(`Não foi possível verificar ignore no Git: ${ignored.stderr?.trim() || ignored.status}`);
  if (ignored.status !== 0) fail(`Saída local precisa estar ignorada pelo Git: ${outputRoot}`);
  const match = ignored.stdout.split('\0');
  if (match.length !== 5 || match[4] !== '' || !match[0] || !/^[1-9]\d*$/.test(match[1]) || !match[2] || match[2].startsWith('!') || match[3] !== ignoredTarget) fail('Resposta Git inválida ao verificar ignore.');
  // The permitted root is relative to the project, which may itself be a
  // subdirectory of the Git worktree. Keep the full worktree-relative target
  // for comparison, including its project prefix.
  const projectRootName = portable(relative(sourceRoot, outputRoot)).split('/')[0];
  if (!/^(?:tmp|temp|\.agent-tests|examples)$/i.test(projectRootName)) fail('Raiz de saída local inválida.');
  // Filtering pathspecs can hide filesystem-specific Unicode aliases. Inspect
  // the whole index and fail closed when segment equivalence cannot be proved.
  const indexed = runGit(top, ['ls-files', '--cached', '-z']);
  if (indexed.status !== 0) fail('Não foi possível verificar o índice Git.');
  if (indexed.stdout && !indexed.stdout.endsWith('\0')) fail('Resposta Git inválida ao verificar índice.');
  if (indexed.stdout.split('\0').filter(Boolean).some(name => mayAliasPath(name, target, { root: top }))) fail(`Saída local contém arquivos ou caminhos ambíguos no índice Git: ${outputRoot}`);
  return top;
}

export const SCENARIOS = [
  { id: 'somente-agentes', title: 'Somente agentes', expected: 'preparacao', complete: false, app: false, planning: 'none', note: 'Recursos compartilhados, sem produto ou aplicação.' },
  { id: 'descoberta', title: 'Descoberta de produto', expected: 'descoberta', complete: false, app: false, planning: 'draft', note: 'PRD em rascunho; nenhuma stack é iniciada.' },
  { id: 'planejado', title: 'Produto planejado', expected: 'planejado', complete: false, app: false, planning: 'ready', note: 'PRD/design aprovados no cenário e UX não aplicável; ainda sem código.' },
  { id: 'app-inicial', title: 'Aplicação inicial', expected: 'implementacao', complete: false, app: true, planning: 'none', note: 'API funcional, mas contrato de estrutura incompleto.' },
  { id: 'app-configurada', title: 'Aplicação configurada', expected: 'configurado', complete: true, app: true, planning: 'ready', configured: true, note: 'Estrutura e planejamento completos; testes reais de API.' },
  { id: 'manutencao', title: 'Manutenção de aplicação', expected: 'manutencao', complete: true, app: true, planning: 'ready', configured: true, released: true, note: 'Aplicação configurada com release publicada sintética.' },
  { id: 'legado', title: 'Aplicação legada', expected: 'implementacao', complete: false, app: true, planning: 'none', layout: 'legacy', note: 'Pastas, comandos e configurações antigas são preservados.' },
  { id: 'monorepo', title: 'Monorepo com dois módulos', expected: 'implementacao', complete: false, app: true, planning: 'ready', layout: 'monorepo', note: 'Dois módulos e caminhos com espaços/acentos; sem impor src na raiz.' },
];

function manifest(root) {
  const state = join(root, stateDirectory(root), 'agentdevkit.json');
  const file = join(root, '.pbai4devs/espelhos.conf');
  if (existsSync(file)) return readFileSync(file, 'utf8');
  return adapterManifest(root, { clients: existsSync(state) ? json(state).clients : ['none'] });
}

export function registeredRoots(root) {
  const names = manifest(root).split(/\r?\n/)
    .filter(line => /^(?:agente|gitignore)\|/.test(line)).map(line => line.split('|')[1]);
  for (const name of names) if (!/^\.[a-z0-9][a-z0-9.-]*$/i.test(name) || ['.git', '.pbai4devs', '.agent-tests'].includes(name.toLowerCase())) fail(`Raiz de agente inválida: ${name}`);
  return [...new Set(names)];
}

export function resourceTargets(root, source, kind = 'skills') {
  const geminiPath = value => /^\.gemini(?:[\\/]|$)/i.test(value);
  const rows = manifest(root).split(/\r?\n/)
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.split('|'))
    .filter(([type, target, primary]) => !geminiPath(target) && !(type === 'fallback' && geminiPath(primary)));
  const targets = [], suppressed = new Set();
  const rule = kind === 'rules' ? buildCatalog(root).catalog.rules.find(entry => entry.path === source) : undefined;
  for (const [type, fallback, primary, resource] of rows) {
    if (type !== 'fallback' || resource !== kind) continue;
    const primaryRow = rows.find(([entry, target]) => entry === 'agente' && target === primary);
    const fallbackRow = rows.find(([entry, target]) => entry === 'agente' && target === fallback);
    if (!primaryRow || !fallbackRow) fail(`Fallback sem cliente: ${fallback}`);
    const primaryFormat = rows.find(([entry, target, scope]) => entry === 'formato' && target === primary && scope === kind)?.[3] || primaryRow[2] || 'agrupado';
    const primaryTarget = `${primary}/${resourcePath(source, kind, primaryFormat)}`;
    const boundary = nativePathBoundary(root, primaryTarget, [], { preserveRootAliases: true });
    const info = boundary ? null : stat(join(root, primaryTarget));
    if (boundary || (info && !info.isFile())) {
      suppressed.add(primaryTarget);
      targets.push(`${fallback}/${resourcePath(source, kind, fallbackRow[2] || 'agrupado')}`);
    }
  }
  for (const [type, agent, layout = 'agrupado'] of rows) {
    if (type !== 'agente') continue;
    const override = rows.find(([entry, target, resource]) => entry === 'formato' && target === agent && resource === kind)?.[3];
    if (override === 'nenhum') continue;
    const format = override || layout;
    const defaultTarget = `${agent}/${resourcePath(source, kind, format)}`;
    const explicitMetadata = rows.some(([entry, target, origin, metadata]) => entry === 'nativo' && target === defaultTarget && origin === source && metadata);
    const relativeTarget = clientResourcePath(source, kind, format, agent, rule, explicitMetadata);
    if (relativeTarget === null) continue;
    const target = `${agent}/${relativeTarget}`;
    if (!suppressed.has(target)) targets.push(target);
  }
  for (const [type, target, origin] of rows) if (type === 'nativo' && origin === source) targets.push(target);
  return [...new Set(targets)];
}

function copyAllowed(relativePath, directory = false) {
  const parts = portable(relativePath).split('/');
  const name = parts.at(-1);
  if (parts[0] === '.pbai4devs' && ['bin', 'src', 'release', 'tests', 'DEVELOPMENT.md'].includes(parts[1])) return false;
  if (isGeneratedOutput(relativePath, directory)) return false;
  if (parts.some(part => ['.git', '.local', '.cache', 'node_modules', 'logs', '.agent-tests', '__pycache__', '.ssh', '.gnupg'].includes(part.toLowerCase()))) return false;
  if (/^\.playwright/i.test(name) || /\.log$/i.test(name) || name === '.DS_Store') return false;
  if (/^\.env(?:\.|$)/i.test(name) && !/^\.env\.(?:.*\.)?(?:example|sample|template)$/i.test(name)) return false;
  if (/^(?:\.?auth|\.?credentials|secrets?)(?:\.(?:jsonc?|json5|ya?ml|toml|ini|conf))?$/i.test(name)) return false;
  if (/^(?:\.netrc|\.npmrc|\.pypirc|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?)$/i.test(name)) return false;
  if (/\.(?:pem|p12|pfx|key|jks|keystore)$/i.test(name) || /\.local\.(?:jsonc?|json5|ya?ml|toml|ini|conf)$/i.test(name)) return false;
  if (parts[0] === '.pbai4devs' && parts[1] === 'tools') {
    if (parts.length === 2) return true;
    if (parts.length === 3) return parts[2] === 'README.md' || !['bin', 'npm-cache'].includes(parts[2]);
    return parts.length === 4 && ['TOOL.json', 'SCRIPT.mjs', 'README.md'].includes(parts[3]);
  }
  if (parts[0] === '.pbai4devs' && parts[1] === 'external-skills') return parts.length === 2 || (parts.length === 3 && ['README.md', 'CATALOG.json'].includes(parts[2]));
  return true;
}

export function copyAgentStructure(sourceRoot, destination, { archiveCatalogs = false, archiveOverrides = new Set(), archiveEntrypoints = false, packageFiles } = {}) {
  const roots = packageFiles ? ['.pbai4devs'] : ['.pbai4devs', ...registeredRoots(sourceRoot)];
  const stateFile = packageFiles ? null : join(sourceRoot, stateDirectory(sourceRoot), 'agentdevkit.json');
  const stateInfo = stateFile ? stat(stateFile) : null;
  if (stateInfo && (!stateInfo.isFile() || stateInfo.isSymbolicLink())) fail('Estado da instalação deve ser arquivo regular.');
  const installation = stateInfo ? json(stateFile) : null;
  if (stateInfo && (!installation || !installation.blocks || typeof installation.blocks !== 'object' || Array.isArray(installation.blocks))) fail('Estado da instalação deve registrar os blocos gerenciados.');
  function managedEntry(name) {
    if (!installation) return false;
    const expected = installation.blocks[name];
    if (typeof expected !== 'string') return false;
    const content = readFileSync(join(sourceRoot, name), 'utf8');
    const begin = '<!-- BEGIN AGENTDEVKIT -->', end = '<!-- END AGENTDEVKIT -->';
    if (content.split(begin).length !== 2 || content.split(end).length !== 2) return false;
    const start = content.indexOf(begin), finish = content.indexOf(end);
    return finish > start && digest(content.slice(start, finish + end.length)) === expected;
  }
  const files = []; const entrypoints = {}; const omittedEntrypoints = []; const catalogSnapshots = []; const overriddenSnapshots = []; const seenSources = new Set(); let skipped = 0;
  function copy(file, targetFile = file, inventoried = false) {
    const source = join(sourceRoot, file);
    const item = stat(source);
    if (inventoried && !item?.isFile()) fail('O inventário do pacote mudou durante a cópia.');
    if (!item) return;
    if (!copyAllowed(file, item.isDirectory())) { skipped++; return; }
    if (item.isSymbolicLink()) fail(`A cópia recusa links simbólicos: ${file}`);
    if (item.isDirectory()) {
      mkdirSync(join(destination, targetFile), { recursive: true });
      for (const name of readdirSync(source).sort()) copy(join(file, name), join(targetFile, name));
    } else if (item.isFile()) {
      seenSources.add(portable(file));
      if (archiveCatalogs && generatedCatalogs.has(portable(file))) {
        targetFile = `.agent-tests/testar-maturidade/original-catalogs/${basename(file)}`;
        catalogSnapshots.push({ source: portable(file), snapshot: targetFile });
      } else if (archiveOverrides.has(portable(file))) {
        targetFile = `.agent-tests/testar-maturidade/original-files/${portable(file)}`;
        overriddenSnapshots.push({ source: portable(file), snapshot: targetFile });
      }
      const target = join(destination, targetFile); mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target); files.push(portable(targetFile));
    } else fail(`Arquivo não regular na origem: ${file}`);
  }
  if (packageFiles) {
    for (const file of packageFiles) {
      noLinks(sourceRoot, join(sourceRoot, file));
      copy(file, file, true);
    }
  } else {
    for (const file of [...roots, 'README.md', '.gitignore', '.gitattributes', '.editorconfig', '.dockerignore', '.env.example', '.env.sample', '.env.template', 'Makefile']) copy(file);
  }
  for (const name of packageFiles ? [] : ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    const installed = stat(join(sourceRoot, name));
    if (!installed) continue;
    if (installed.isSymbolicLink()) { omittedEntrypoints.push(name); skipped++; continue; }
    if (!installed.isFile()) fail(`Entrada de agente deve ser arquivo regular: ${name}`);
    const template = `.pbai4devs/templates/entrypoints/${name}`;
    const selected = managedEntry(name) && stat(join(sourceRoot, template)) ? template : name;
    const info = stat(join(sourceRoot, selected));
    if (info && !info.isFile()) fail(`Entrada de agente deve ser arquivo regular: ${selected}`);
    if (archiveEntrypoints && selected !== name) {
      const snapshot = `.agent-tests/testar-maturidade/original-files/${name}`;
      copy(name, snapshot); overriddenSnapshots.push({ source: name, snapshot });
    }
    copy(selected, name);
    if (info) entrypoints[name] = selected;
  }
  // A fixture can create files belonging to an unselected client; archive
  // those source files as well, without traversing symbolic-link ancestors.
  for (const path of packageFiles ? [] : archiveOverrides) if (!seenSources.has(path)) {
    noLinks(sourceRoot, join(sourceRoot, path));
    copy(path);
  }
  const sourceDigest = digest(files.map(file => `${file}\0${digest(readFileSync(join(destination, file)))}`).join('\n'));
  return { roots, copiedFiles: files.length, skipped, files, sourceDigest, entrypoints, omittedEntrypoints, catalogSnapshots, overriddenSnapshots, toolDefinitions: files.filter(file => /^\.pbai4devs\/tools\/[^/]+\/TOOL\.json$/.test(file)).length };
}

function fixtureOverrides(scenario, nativeRoots) {
  const paths = ['README.md', '.pbai4devs/.gitignore', ...nativeRoots.map(root => `${root}/.gitignore`), '.pbai4devs/state/configuracao/ESTADO.md', '.pbai4devs/estado/configuracao/ESTADO.md'];
  if (scenario.planning !== 'none' || scenario.app) paths.push('.pbai4devs/state/README.md', '.pbai4devs/estado/README.md');
  if (scenario.configured) paths.push('.dockerignore', '.env.example', 'Makefile');
  if (scenario.layout === 'legacy') paths.push('Makefile', '.github/workflows/legacy.yml', '.vscode/settings.json');
  return new Set(paths);
}

function planning(root, scenario) {
  const stateRoot = stateDirectory(root);
  const state = `${stateRoot}/configuracao/ESTADO.md`;
  rmSync(join(root, state), { force: true });
  if (scenario.planning === 'none' && !scenario.app) return;
  write(root, `${stateRoot}/README.md`, document('Estado dos exemplos', 'Dados sintéticos deste cenário, sem aprovação real de produto.'));
  let paths = { prd: null, ux_ui: null, design: null, releases: null, specs: null };
  if (scenario.planning !== 'none') {
    for (const folder of ['docs', 'docs/produto', 'docs/design']) write(root, `${folder}/README.md`, document('Documentos do cenário', 'Entradas sintéticas para testar a classificação de maturidade.'));
    paths.prd = 'docs/produto/PRD.md';
    write(root, paths.prd, document('Produto de exemplo', 'Problema e escopo sintéticos. Aprovação é dado de teste, não decisão humana.', `status: ${scenario.planning === 'ready' ? 'aprovado' : 'rascunho'}\n`));
    if (scenario.planning === 'ready') {
      paths.ux_ui = 'docs/produto/UX.md'; paths.design = 'docs/design/DESIGN.md';
      write(root, paths.ux_ui, document('UX do cenário', 'API sem interface visual: não aplicação justificada apenas para o cenário.', 'status: nao-aplicavel\n'));
      write(root, paths.design, document('Design do cenário', 'Node HTTP sem dependências. Decisão sintética para os testes.', 'status: aprovado\n'));
    }
  }
  if (scenario.released) {
    paths.releases = 'docs/releases';
    write(root, 'docs/releases/README.md', document('Releases de exemplo', 'Histórico sintético do cenário.'));
    write(root, 'docs/releases/1.0.0/README.md', document('Release 1.0.0', 'Documentos sintéticos desta versão.'));
    write(root, 'docs/releases/1.0.0/RELEASE.md', document('Release 1.0.0', 'Publicação sintética para classificar a manutenção.', 'status: publicado\n'));
  }
  if (scenario.configured) {
    paths.specs = 'docs/specs';
    write(root, 'docs/specs/README.md', document('Specs do cenário', 'Incrementos sintéticos aprovados apenas como dados de teste.'));
    write(root, 'docs/specs/http-api/README.md', document('API de exemplo', 'Spec e provas do incremento sintético.'));
    write(root, 'docs/specs/http-api/SPEC.md', document('API HTTP do cenário', '## Critérios de aceite\n\n| Critério | Resultado |\n| --- | --- |\n| AC-001 | GET /health retorna HTTP 200 e status ok. |\n| AC-002 | POST /sum calcula valores e rejeita entrada inválida. |\n\n## Plano de verificação\n\nExecutar os testes Node da API e guardar o log em .agent-tests/.', 'status: aprovado\n'));
  }
  const values = Object.entries(paths).map(([key, value]) => `  ${key}: ${value ?? 'null'}`).join('\n');
  write(root, state, document('Configuração do cenário', 'Somente fixture; não certifica configuração nem aprovação de produção.', `preparacao: concluido\nconfiguracao_tecnica: ${scenario.configured ? 'concluido' : 'pendente'}\ndocumentos:\n${values}\n`));
}

function application(root, scenario) {
  if (!scenario.app) return { tests: [], scope: [], protected: [], criteria: ['AC-001'] };
  const monorepo = scenario.layout === 'monorepo'; const legacy = scenario.layout === 'legacy';
  const server = monorepo ? 'apps/painel com espaços/src/server.mjs' : legacy ? 'legacy/server.mjs' : 'src/server.mjs';
  const test = monorepo ? 'apps/painel com espaços/tests/api.test.mjs' : legacy ? 'checks/legacy.test.mjs' : 'tests/api.test.mjs';
  let serverText = readFileSync(join(assets, 'server.mjs'), 'utf8');
  if (monorepo) serverText = serverText.replace('const add = (left, right) => left + right;', "import { add } from '../../../packages/cálculo/src/index.mjs';");
  write(root, server, serverText);
  let imported = portable(relative(dirname(test), server)); if (!imported.startsWith('.')) imported = './' + imported;
  write(root, test, readFileSync(join(assets, 'http-api.test.mjs.template'), 'utf8').replace('__SERVER_IMPORT__', imported));
  const tests = [test]; const scope = [server, test]; const preserved = [];
  const scripts = legacy ? { 'dev:old': 'node legacy/server.mjs', 'test:legacy': 'node --test checks/legacy.test.mjs' } : { start: `node "${server}"`, test: `node --test "${test}"` };
  write(root, 'package.json', JSON.stringify({ name: `maturity-${scenario.id}`, version: '1.0.0', private: true, type: 'module', ...(monorepo ? { workspaces: ['apps/*', 'packages/*'] } : {}), scripts }, null, 2) + '\n');
  if (monorepo) {
    write(root, 'apps/painel com espaços/package.json', JSON.stringify({ name: 'painel', private: true, type: 'module', scripts: { start: 'node src/server.mjs', test: 'node --test tests/api.test.mjs' } }, null, 2) + '\n');
    write(root, 'packages/cálculo/package.json', JSON.stringify({ name: 'calculo', private: true, type: 'module', scripts: { test: 'node --test tests/index.test.mjs' } }, null, 2) + '\n');
    write(root, 'packages/cálculo/src/index.mjs', readFileSync(join(assets, 'calculator.mjs')));
    const calculatorTest = 'packages/cálculo/tests/index.test.mjs';
    write(root, calculatorTest, readFileSync(join(assets, 'calculator.test.mjs.template')));
    tests.push(calculatorTest); scope.push('packages/cálculo/src/index.mjs', calculatorTest);
    const manifest = json(join(root, 'package.json'));
    manifest.scripts.test = `node --test ${tests.map(file => JSON.stringify(file)).join(' ')}`;
    write(root, 'package.json', JSON.stringify(manifest, null, 2) + '\n');
    preserved.push('package.json', 'apps/painel com espaços/package.json', 'packages/cálculo/package.json');
  }
  if (legacy) {
    write(root, 'config/legacy.json', '{"mode":"preserve-original-layout"}\n');
    write(root, '.github/workflows/legacy.yml', 'name: Legacy fixture\non: workflow_dispatch\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo legacy-command-preserved\n');
    write(root, '.vscode/settings.json', '{"legacy.setting":"preserve"}\n');
    write(root, 'Makefile', 'legacy-test:\n\tnode --test checks/legacy.test.mjs\n');
    preserved.push(server, test, 'config/legacy.json', '.github/workflows/legacy.yml', '.vscode/settings.json', 'Makefile', 'package.json');
  }
  if (scenario.configured) {
    // Published packages and existing projects need not contain these files;
    // create only the missing synthetic fixtures, never replace copied content.
    for (const [file, content] of Object.entries({
      '.gitignore': '# Arquivos temporários do cenário sintético.\nnode_modules/\n.agent-tests/\n',
      '.gitattributes': '* text=auto\n',
      '.editorconfig': 'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\n',
    })) if (!stat(join(root, file))) write(root, file, content);
    write(root, '.dockerignore', '.git\n.agent-tests\nnode_modules\n');
    write(root, '.env.example', 'PORT=3000\n');
    write(root, 'Dockerfile', 'FROM node:24-alpine\nWORKDIR /app\nCOPY package.json ./\nCOPY src ./src\nEXPOSE 3000\nCMD ["node", "src/server.mjs"]\n');
    write(root, 'infra/compose/compose.local.yml', 'services:\n  app:\n    build: ../..\n    environment:\n      PORT: "3000"\n    ports:\n      - "127.0.0.1:39001:3000"\n    healthcheck:\n      test: ["CMD", "node", "-e", "fetch(\'http://127.0.0.1:3000/health\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]\n      interval: 5s\n      timeout: 3s\n      retries: 5\n');
    write(root, 'Makefile', 'include .env.example\n.PHONY: help doctor setup up down logs test lint build\nhelp:\n\t@echo doctor setup up down logs test lint build\ndoctor:\n\tnode --version\n\tdocker compose -f infra/compose/compose.local.yml config --quiet\nsetup:\n\tnode --version\nup:\n\tdocker compose -f infra/compose/compose.local.yml up -d --wait\ndown:\n\tdocker compose -f infra/compose/compose.local.yml down\nlogs:\n\tdocker compose -f infra/compose/compose.local.yml logs --tail=100\ntest:\n\tnode --test tests/api.test.mjs\nlint:\n\tnode --check src/server.mjs\nbuild:\n\tnode --check src/server.mjs\n');
  }
  return { tests, scope, protected: preserved, criteria: monorepo ? ['AC-001', 'AC-002', 'AC-003'] : ['AC-001', 'AC-002'], spec: scenario.configured ? 'docs/specs/http-api/SPEC.md' : null };
}

function gitInit(root) {
  const result = spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '--template=', '-q', root], { env: isolatedEnvironment(), encoding: 'utf8' });
  if (result.error || result.status !== 0) fail(`Git init: ${result.error?.message || result.stderr}`);
  const gitDir = stat(join(root, '.git'));
  if (!gitDir?.isDirectory() || gitDir.isSymbolicLink()) fail('Git init não criou um repositório local regular no exemplo.');
}

export function createExampleOutput({ sourceRoot = projectRoot, outputRoot, prefix = 'agentdevkit-maturity-', allowMissingGit = false } = {}) {
  requireNode(); sourceRoot = realpathSync.native(resolve(sourceRoot));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-$/.test(prefix)) fail('Prefixo de saída inválido.');
  let base = canonicalTemporaryAlias(outputRoot ?? tmpdir());
  // Check the spelling supplied by the caller before resolving existing
  // ancestors, so canonicalization cannot silently accept a symlink.
  noLinks(parse(base).root, base);
  let existingBase = base;
  while (!stat(existingBase) && dirname(existingBase) !== existingBase) existingBase = dirname(existingBase);
  const before = stat(existingBase), canonicalBase = realpathSync.native(existingBase);
  noLinks(parse(base).root, base);
  const after = stat(existingBase), canonicalInfo = stat(canonicalBase);
  if (!before || !after || !canonicalInfo || before.dev !== after.dev || before.ino !== after.ino || before.dev !== canonicalInfo.dev || before.ino !== canonicalInfo.ino) fail('Caminho ancestral alterado durante a validação.');
  base = join(canonicalBase, relative(existingBase, base));
  const parent = outputRoot === undefined ? base : dirname(base);
  const guardRoot = parse(parent).root;
  noLinks(guardRoot, parent);
  const withinSource = pathWithin(sourceRoot, base);
  const localOutput = outputRoot !== undefined && withinSource;
  const localName = portable(relative(sourceRoot, base));
  if (withinSource && (!localOutput || !/^(?:tmp|temp|\.agent-tests)(?:\/|$)|^examples\/generated(?:\/|$)/i.test(localName))) fail('Saída local permitida somente em tmp, temp, .agent-tests ou examples/generated.');
  let existingParent = parent;
  while (!stat(existingParent) && dirname(existingParent) !== existingParent) existingParent = dirname(existingParent);
  const existingInfo = stat(existingParent);
  if (!existingInfo?.isDirectory() || existingInfo.isSymbolicLink()) fail(`A pasta pai da saída deve ser um diretório: ${existingParent}`);
  if (!localOutput && existingParent !== parent) fail(`A pasta pai da saída deve existir: ${parent}`);
  const repository = localOutput ? assertIgnoredOutput(existingParent, sourceRoot, base) : (assertOutsideGit(parent, { allowMissing: allowMissingGit }), null);
  if (outputRoot !== undefined && stat(base)?.isSymbolicLink()) fail(`Saída não pode ser link simbólico: ${base}`);
  if (outputRoot !== undefined && stat(base)) fail(`Pasta de saída já existe; escolha um destino novo: ${base}`);
  for (let current = existingParent; ; current = dirname(current)) {
    if (stat(join(current, suiteMarker)) || stat(join(current, marker)) || stat(join(current, exampleOutputMarker))) fail('Saída não pode ficar dentro de uma execução anterior.');
    if (dirname(current) === current) break;
  }
  // Create only absent local ancestors after the complete destination and
  // index have passed preflight; existing directories are never replaced.
  // Recheck the ignore and index around each creation. If a concurrent process
  // creates a component, createChild fails rather than adopting its contents.
  if (localOutput && existingParent !== parent) {
    let current = existingParent;
    for (const part of relative(existingParent, parent).split(sep).filter(Boolean)) {
      assertIgnoredOutput(current, sourceRoot, base, repository);
      createChild(guardRoot, current, part);
      current = join(current, part);
      assertIgnoredOutput(current, sourceRoot, base, repository);
    }
  }
  const name = outputRoot === undefined ? `${prefix}${randomUUID()}` : basename(base);
  const created = createChild(guardRoot, parent, name);
  outputRoot = join(parent, name);
  const canonicalOutput = realpathSync(outputRoot);
  const markerContent = JSON.stringify({ owner, version: 1 }, null, 2) + '\n';
  let protectedOutput = false;
  const verifyOutput = (path = outputRoot) => {
    noLinks(guardRoot, path);
    const current = stat(outputRoot);
    if (!current?.isDirectory() || current.dev !== created.dev || current.ino !== created.ino || realpathSync(outputRoot) !== canonicalOutput) fail('Diretório de saída alterado durante a execução.');
    if (localOutput) assertIgnoredOutput(outputRoot, sourceRoot, outputRoot, repository);
    else assertOutsideGit(outputRoot, { allowMissing: allowMissingGit });
    if (protectedOutput) for (const [name, content] of [[exampleOutputMarker, markerContent], ['.gitignore', outputIgnore]]) {
      const file = join(outputRoot, name), info = stat(file);
      if (!info?.isFile() || info.isSymbolicLink() || readFileSync(file, 'utf8') !== content) fail(`Proteção da saída alterada durante a execução: ${name}`);
    }
  };
  verifyOutput();
  writeFileSync(join(outputRoot, exampleOutputMarker), markerContent, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(outputRoot, '.gitignore'), outputIgnore, { flag: 'wx', mode: 0o600 });
  protectedOutput = true;
  verifyOutput();
  return { outputRoot, verifyOutput };
}

export function prepareExamples({ sourceRoot = projectRoot, outputRoot, scenarios = SCENARIOS, initializeGit = true, renderResources = prepareResources, sourceOnly = false } = {}) {
  requireNode(); sourceRoot = realpathSync(resolve(sourceRoot));
  const ids = new Set();
  if (!Array.isArray(scenarios) || !scenarios.length) fail('Selecione pelo menos um cenário.');
  for (const scenario of scenarios) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scenario.id) || ids.has(scenario.id)) fail('Cenários devem ter IDs únicos e seguros.');
    ids.add(scenario.id);
  }
  const packageFiles = sourceOnly ? listPackageHubFiles(sourceRoot) : undefined;
  const sourceMode = sourceOnly ? 'package-source' : 'project';
  const createdOutput = createExampleOutput({ sourceRoot, outputRoot, allowMissingGit: !initializeGit });
  outputRoot = createdOutput.outputRoot;
  const verifyOutput = createdOutput.verifyOutput;
  const guarded = (path, operation) => { verifyOutput(path); const value = operation(); verifyOutput(path); return value; };
  guarded(outputRoot, () => write(outputRoot, suiteMarker, JSON.stringify({ owner, version: 1 }, null, 2) + '\n'));
  guarded(outputRoot, () => writeIndex(outputRoot, [], 'preparing'));
  const examples = [];
  for (const scenario of scenarios) {
    const destination = join(outputRoot, scenario.id);
    guarded(outputRoot, () => mkdirSync(destination));
    guarded(destination, () => write(destination, marker, JSON.stringify({ owner, version: 1, id: scenario.id }, null, 2) + '\n'));
    const copied = guarded(destination, () => copyAgentStructure(sourceRoot, destination, {
      archiveCatalogs: true,
      archiveOverrides: fixtureOverrides(scenario, sourceOnly ? [] : registeredRoots(sourceRoot)),
      archiveEntrypoints: true, packageFiles,
    }));
    guarded(destination, () => {
      // This belongs to the new fixture. The source .gitignore is not changed.
      const directory = join(destination, '.agent-tests'), ignore = join(directory, '.gitignore');
      noLinks(destination, directory);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      noLinks(destination, ignore);
      writeFileSync(ignore, '*\n', { flag: 'wx', mode: 0o600 });
    });
    guarded(destination, () => planning(destination, scenario));
    const app = guarded(destination, () => application(destination, scenario));
    guarded(destination, () => write(destination, 'README.md', document(scenario.title, `${scenario.note}\n\nEste é um exemplo gerado, não um teste no projeto original. Estados de aprovação/publicação são dados de teste.\nRevisão do gate é simulação contratual, não revisão humana.\nCatálogos originais e arquivos substituídos pela fixture ficam em \`.agent-tests/testar-maturidade/\`; os catálogos operacionais são regenerados.\n\nOs scripts dos agentes foram copiados, sem pacotes ou credenciais conhecidas.\nO filtro não detecta segredos em conteúdo arbitrário.\n${app.tests.length ? `\nPara repetir os testes: \`${scenario.layout === 'legacy' ? 'npm run test:legacy' : 'npm test'}\`.\nO harness executa os testes Node diretamente, sem instalar dependências.\nO teste abre HTTP em porta efêmera e encerra o servidor.\n` : '\nNão há aplicação; a prova real exercita os scripts copiados.\n'}`, `fase: ${scenario.expected}\n`)));
    guarded(destination, () => renderResources(destination));
    if (initializeGit) guarded(destination, () => gitInit(destination));
    examples.push({ ...scenario, root: destination, copied, application: app });
  }
  guarded(outputRoot, () => write(outputRoot, 'REPORT.json', JSON.stringify({ owner, version: 1, sourceMode, status: 'prepared', scenarios: [...ids], copies: examples.map(example => ({ id: example.id, omittedEntrypoints: example.copied.omittedEntrypoints, catalogSnapshots: example.copied.catalogSnapshots, overriddenSnapshots: example.copied.overriddenSnapshots })), results: [] }, null, 2) + '\n'));
  guarded(outputRoot, () => writeIndex(outputRoot, examples, 'prepared'));
  Object.defineProperty(examples, 'verifyOutput', { value: verifyOutput });
  return examples;
}

function writeIndex(outputRoot, examples, status) {
  const rows = examples.map(item => `| [${item.id}](${item.id}/README.md) | ${item.expected} | ${item.status || 'prepared'} |`).join('\n');
  const progress = status === 'preparing' ? '\nPreparação em andamento nesta execução.\n' : '';
  write(outputRoot, 'README.md', document('Exemplos de maturidade', `Projetos sintéticos com cópias locais da estrutura de agentes; não são testes no projeto original.\nCatálogos operacionais são regenerados e suas cópias originais ficam em cada \`.agent-tests/testar-maturidade/\`.\nNenhum resultado certifica produção, revisão humana ou outros sistemas operacionais.\n${progress}\n| Cenário | Nível esperado | Resultado |\n| --- | --- | --- |${rows ? '\n' + rows : ''}\n\nRelatório: \`REPORT.json\`. Logs e evidências por projeto ficam em \`.agent-tests/\`.\nCada execução usa uma pasta nova e preserva as anteriores.\n`, `status: ${status}\n`));
}

function hashes(root, files) { return Object.fromEntries(files.map(file => [file, digest(readFileSync(join(root, file)))])); }

function managedHashes(root, roots) {
  const result = {};
  function visit(relativePath) {
    const full = join(root, relativePath); if (!existsSync(full)) return;
    const info = lstatSync(full); if (info.isSymbolicLink()) fail(`Espelho simbólico: ${relativePath}`);
    if (info.isDirectory()) for (const name of readdirSync(full).sort()) visit(join(relativePath, name));
    else if (info.isFile()) result[portable(relativePath)] = digest(readFileSync(full));
  }
  for (const file of [...roots, '.pbai4devs/catalog.json', '.pbai4devs/skills.json', '.pbai4devs/rules.json', '.pbai4devs/agents.json']) visit(file);
  return result;
}

function pointer(root, roots) {
  const entry = json(join(root, '.pbai4devs/skills.json')).entries[0]?.path;
  if (!entry) fail('Catálogo copiado não contém uma skill para provar reparação.');
  for (const file of resourceTargets(root, `${entry}/SKILL.md`)) if (roots.includes(file.split('/')[0]) && existsSync(join(root, file))) return file;
  fail('Nenhum apontamento copiado encontrado.');
}

export function verifySyncRepair(root, roots, run) {
  const sync = '.pbai4devs/scripts/sincronizar-agentes/SCRIPT.mjs';
  const clients = roots.filter(path => path !== '.pbai4devs');
  const kind = clients.length ? 'pointer' : 'catalog';
  const path = clients.length ? pointer(root, clients) : '.pbai4devs/catalog.json';
  const file = join(root, path), before = readFileSync(file);
  rmSync(file);
  run(sync, ['--check'], 1, 'sync-damage-detected');
  run(sync, [], 0, 'sync-repair');
  const proof = run(sync, ['--check'], 0, 'sync-repaired');
  if (!readFileSync(file).equals(before)) fail(`Sincronização não restaurou os bytes de ${path}.`);
  return { kind, path, log: proof.log };
}

export function runner(root, logRoot, commands) {
  return (script, args = [], expected = 0, label = script.replaceAll('/', '-')) => {
    const command = [script, ...args];
    const environment = isolatedEnvironment();
    const result = spawnSync(process.execPath, command, { cwd: root, env: environment, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const log = write(root, `${logRoot}/${String(commands.length + 1).padStart(2, '0')}-${label}.log`, output || `(sem saída; status ${result.status})\n`);
    commands.push({ command: [process.execPath, ...command], status: result.status, expected, log: portable(relative(root, log)) });
    if (result.error || result.status !== expected) fail(`${label}: esperado ${expected}, recebido ${result.status}: ${result.error?.message || output.slice(-2000)}`);
    return { ...result, output, log: portable(relative(root, log)) };
  };
}

function resourceLifecycle(example, run) {
  const root = example.root; const sync = '.pbai4devs/scripts/sincronizar-agentes/SCRIPT.mjs';
  const initial = `${example.id}-lifecycle-probe`; const renamed = `${initial}-renamed`;
  const folder = name => `.pbai4devs/skills/projeto/${name}`;
  const source = name => `${folder(name)}/SKILL.md`;
  const catalogPath = '.pbai4devs/catalog.json'; const registryPath = '.pbai4devs/skills.json';
  const before = { catalog: readFileSync(join(root, catalogPath), 'utf8'), registry: readFileSync(join(root, registryPath), 'utf8') };
  const rows = readFileSync(join(root, '.pbai4devs/espelhos.conf'), 'utf8').split(/\r?\n/).filter(line => line.startsWith('agente|')).map(line => line.split('|'));
  const pointers = name => resourceTargets(root, source(name));
  const skill = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nLIFECYCLE_SOURCE_ONLY\n`;
  const assertEntry = (name, description) => {
    const entry = json(join(root, catalogPath)).skills.find(item => item.path === source(name));
    if (!entry || entry.name !== name || entry.description !== description) fail(`Catálogo não refletiu ${name}.`);
    if (!json(join(root, registryPath)).entries.some(item => item.path === folder(name))) fail(`Registro nativo não refletiu ${name}.`);
    for (const file of pointers(name)) {
      const text = readFileSync(join(root, file), 'utf8');
      if (!text.includes(`name: ${name}`) || !text.includes(description) || text.includes('LIFECYCLE_SOURCE_ONLY')) fail(`Apontamento incorreto: ${file}`);
    }
  };
  if (existsSync(join(root, folder(initial))) || existsSync(join(root, folder(renamed)))) fail('A skill temporária já existe na cópia.');
  write(root, source(initial), skill(initial, 'Criada pelo teste de ciclo.'));
  run(sync, ['--check'], 1, 'lifecycle-create-detected'); run(sync, [], 0, 'lifecycle-create-sync');
  assertEntry(initial, 'Criada pelo teste de ciclo.');
  write(root, source(initial), skill(initial, 'Descrição alterada pelo teste.'));
  run(sync, ['--check'], 1, 'lifecycle-edit-detected'); run(sync, [], 0, 'lifecycle-edit-sync');
  assertEntry(initial, 'Descrição alterada pelo teste.');
  renameSync(join(root, folder(initial)), join(root, folder(renamed)));
  write(root, source(renamed), skill(renamed, 'Recurso renomeado pelo teste.'));
  run(sync, ['--check'], 1, 'lifecycle-rename-detected'); run(sync, [], 0, 'lifecycle-rename-sync');
  assertEntry(renamed, 'Recurso renomeado pelo teste.');
  if (pointers(initial).some(file => existsSync(join(root, file))) || json(join(root, catalogPath)).skills.some(item => item.path === source(initial))) fail('Renomeação preservou o recurso antigo.');
  rmSync(join(root, folder(renamed)), { recursive: true });
  run(sync, ['--check'], 1, 'lifecycle-delete-detected'); run(sync, [], 0, 'lifecycle-delete-sync');
  if (pointers(renamed).some(file => existsSync(join(root, file)))) fail('Remoção preservou apontamentos antigos.');
  if (readFileSync(join(root, catalogPath), 'utf8') !== before.catalog || readFileSync(join(root, registryPath), 'utf8') !== before.registry) fail('O ciclo não restaurou os catálogos originais.');
  const corrupted = '{"tampered":true}\n'; write(root, catalogPath, corrupted);
  run(sync, ['--check'], 1, 'catalog-drift-detected');
  const blocked = run(sync, ['--force'], 2, 'catalog-drift-preserved');
  if (!blocked.output.includes('Conteudo proprio preservado')) fail('A colisão não informou a preservação do catálogo.');
  if (readFileSync(join(root, catalogPath), 'utf8') !== corrupted) fail('Sincronização alterou o JSON sintético sem ownership.');
  write(root, catalogPath, before.catalog); // Restore only the content this fixture deliberately changed.
  rmSync(join(root, catalogPath)); run(sync, ['--check'], 1, 'catalog-missing-detected');
  run(sync, [], 0, 'catalog-missing-repaired'); run(sync, ['--check'], 0, 'lifecycle-clean');
  if (readFileSync(join(root, catalogPath), 'utf8') !== before.catalog || readFileSync(join(root, registryPath), 'utf8') !== before.registry) fail('Catálogos não foram restaurados após corrupção/remoção.');
  return { status: 'passed', operations: ['create', 'edit-description', 'rename', 'delete', 'protect-modified-json', 'remove-json'], clients: rows.length, sourceRestored: true };
}

function reviewContract(example, run, proof) {
  const id = `maturity-${example.id}`; const execution = 'contract';
  const script = '.pbai4devs/scripts/revisar-entrega/SCRIPT.mjs';
  const scope = example.application.scope.length ? example.application.scope : ['README.md'];
  const args = ['prepare', '--id', id, '--execution', execution, ...(example.application.spec ? ['--spec', example.application.spec] : []), ...scope.flatMap(file => ['--scope', file])];
  const prepared = run(script, args, 0, 'review-prepare');
  const reportFile = JSON.parse(prepared.stdout).report;
  run(script, ['check', reportFile], 1, 'review-pending-denied');
  const report = json(join(example.root, reportFile));
  const evidence = `.agent-tests/${id}/${execution}/proof.log`;
  write(example.root, evidence, readFileSync(join(example.root, proof.log)));
  for (const item of report.documentation) Object.assign(item, { decision: 'no-impact', reason: 'Documento de cenário sintético inspecionado para simulação contratual do gate.' });
  report.validation = example.application.criteria.map(criterion => ({ criterion, method: proof.method, prerequisite: 'Node.js 24+; somente fixtures locais, sem pacotes externos.', assertion: criterion === 'AC-001' ? (example.app ? 'GET /health retorna HTTP 200 e status ok.' : proof.assertion) : criterion === 'AC-002' ? 'POST /sum calcula 2+3 e rejeita entrada inválida.' : 'O módulo cálculo valida soma e cancelamento.', evidence: [evidence], status: 'passed' }));
  report.review = { status: 'approved', reviewer: 'testar-maturidade:simulacao-contratual-sem-revisao-humana', findings: [] };
  report.simulation = { kind: 'gate-contract-test', humanReview: false, productApproval: false };
  const save = () => write(example.root, reportFile, JSON.stringify(report, null, 2) + '\n');
  report.validation[0].status = 'failed'; save();
  const failed = run(script, ['check', reportFile], 1, 'review-failed-denied');
  if (!failed.output.includes('Criterio sem prova')) fail('O gate não recusou o critério falho pelo motivo esperado.');
  report.validation[0].status = 'passed'; save();
  run(script, ['check', reportFile], 1, 'review-unsealed-denied');
  run(script, ['seal', reportFile], 0, 'review-seal');
  run(script, ['check', reportFile], 0, 'review-positive');
  const changed = scope[0]; const original = readFileSync(join(example.root, changed));
  try {
    write(example.root, changed, Buffer.concat([original, Buffer.from('\n/* maturity stale probe */\n')]));
    const stale = run(script, ['check', reportFile], 1, 'review-stale-denied');
    if (!stale.output.includes('mudaram depois do snapshot')) fail('O gate não recusou alteração posterior pelo motivo esperado.');
  } finally { write(example.root, changed, original); }
  run(script, ['check', reportFile], 0, 'review-restored');
  return { status: 'passed', type: 'contract-simulation', humanReview: false, spec: example.application.spec || null, report: reportFile, evidence, rejected: ['pending', 'failed', 'unsealed', 'stale'] };
}

export function testExample(example) {
  const commands = []; const logRoot = '.agent-tests/maturity';
  const run = runner(example.root, logRoot, commands);
  const result = { id: example.id, expected: example.expected, status: 'failed', copied: { files: example.copied.copiedFiles, roots: example.copied.roots, skipped: example.copied.skipped, sourceDigest: example.copied.sourceDigest, entrypoints: example.copied.entrypoints, omittedEntrypoints: example.copied.omittedEntrypoints, catalogSnapshots: example.copied.catalogSnapshots, overriddenSnapshots: example.copied.overriddenSnapshots }, commands, limits: ['Cenário sintético: não testa o projeto original no local.', 'Executado somente no SO/runtime deste host.', 'Estado de produto e revisão do gate são dados sintéticos.', 'Build Docker, UI e implantação não são exercitados.', 'Cópia exclui credenciais por nomes conhecidos, sem varredura semântica de segredos.'] };
  if (example.copied.omittedEntrypoints?.length) result.limits.push(`Entradas simbólicas não copiadas: ${example.copied.omittedEntrypoints.join(', ')}.`);
  const preserved = hashes(example.root, example.application.protected);
  try {
    const sync = '.pbai4devs/scripts/sincronizar-agentes/SCRIPT.mjs';
    run(sync, [], 0, 'sync-prepare-copy');
    run(sync, ['--check'], 0, 'sync-initial');
    result.syncRepair = verifySyncRepair(example.root, example.copied.roots, run);
    const before = managedHashes(example.root, example.copied.roots);
    run(sync, [], 0, 'sync-idempotent');
    if (JSON.stringify(before) !== JSON.stringify(managedHashes(example.root, example.copied.roots))) fail('A segunda sincronização alterou os arquivos gerenciados.');
    if (['somente-agentes', 'manutencao'].includes(example.id)) result.resourceLifecycle = resourceLifecycle(example, run);
    const resourceCheck = run('.pbai4devs/scripts/verificar-recursos/SCRIPT.mjs', [], 0, 'resources-check');
    if (!resourceCheck.output.includes('recursos=passed') || !resourceCheck.output.includes('markdownlint-cli2=missing')) fail('Verificação nativa/linter ausente não foi reportada como esperado.');
    result.resourceCheck = { status: 'passed', markdownlint: 'not-installed-expected', log: resourceCheck.log };
    const catalog = run('.pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs', ['list'], 0, 'tool-catalog');
    const tools = catalog.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (!tools.length || tools.length !== example.copied.toolDefinitions || tools.some(tool => tool.installed !== null)) fail('O catálogo deve conter somente as definições copiadas, sem pacotes instalados.');
    const absent = run('.pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs', ['check', 'base'], 1, 'tools-absent-expected');
    if (!absent.output.includes('Ferramenta ausente')) fail('O check negativo não falhou pela ausência esperada da ferramenta.');
    const diagnosis = JSON.parse(run('.pbai4devs/scripts/diagnosticar-ambiente/SCRIPT.mjs', [], 0, 'diagnosis').stdout);
    if (diagnosis.runtime?.name !== 'node') fail('Diagnóstico não reconheceu Node.');
    const inspection = JSON.parse(run('.pbai4devs/scripts/inspecionar-projeto/SCRIPT.mjs', [], 0, 'inspection').stdout);
    run('.pbai4devs/scripts/inspecionar-projeto/SCRIPT.mjs', ['--check'], example.complete ? 0 : 1, 'inspection-contract');
    if (inspection.maturity?.level !== example.expected || inspection.contract?.complete !== example.complete) fail(`Maturidade/contrato divergente: ${JSON.stringify(inspection.maturity)}; complete=${inspection.contract?.complete}`);
    if (example.layout === 'monorepo') {
      for (const file of ['apps/painel com espaços/package.json', 'packages/cálculo/package.json']) if (!inspection.manifests.includes(file)) fail(`Monorepo não detectou ${file}`);
      if (existsSync(join(example.root, 'src'))) fail('O cenário monorepo não deve criar scaffold src na raiz.');
    }
    let proof = { log: result.syncRepair.log, method: 'node .pbai4devs/scripts/sincronizar-agentes/SCRIPT.mjs --check', assertion: `A sincronização restaura ${result.syncRepair.path} com os bytes originais e passa em sync --check.` };
    if (example.app) {
      const tested = run('--test', example.application.tests, 0, 'http-tests');
      for (const criterion of example.application.criteria) if (!tested.output.includes(criterion)) fail(`Teste real não registrou ${criterion}.`);
      proof = { log: tested.log, method: `node --test ${example.application.tests.map(file => JSON.stringify(file)).join(' ')}` };
      result.applicationProof = { type: 'real-http', assertions: example.application.criteria, log: tested.log, serverLifetime: 'portas efêmeras, fechadas por t.after' };
    }
    result.reviewGate = reviewContract(example, run, proof);
    if (JSON.stringify(preserved) !== JSON.stringify(hashes(example.root, example.application.protected))) fail('Código ou configuração preexistente do cenário foi alterado.');
    result.preserved = example.application.protected;
    result.maturity = inspection.maturity; result.structure = inspection.contract;
    result.status = 'passed';
  } catch (error) { result.error = error.message; }
  write(example.root, `${logRoot}/REPORT.json`, JSON.stringify(result, null, 2) + '\n');
  return result;
}

export function runExamples(options = {}) {
  const examples = prepareExamples(options);
  const results = examples.map(example => { examples.verifyOutput(example.root); const result = testExample(example); examples.verifyOutput(example.root); console.log(`${example.id}=${result.status}${result.error ? ': ' + result.error : ''}`); return result; });
  const outputRoot = dirname(examples[0].root);
  const report = { owner, version: 1, sourceMode: options.sourceOnly ? 'package-source' : 'project', status: results.every(item => item.status === 'passed') ? 'passed' : 'failed', platform: process.platform, arch: process.arch, node: process.version, results, limits: ['Provas reais somente das operações descritas e APIs locais.', 'Pareceres do gate são simulações explícitas, sem revisão humana.', 'Não certifica produção nem sistemas operacionais não executados.'] };
  examples.verifyOutput();
  write(outputRoot, 'REPORT.json', JSON.stringify(report, null, 2) + '\n');
  examples.verifyOutput();
  writeIndex(outputRoot, examples.map(example => ({ ...example, status: results.find(result => result.id === example.id).status })), report.status);
  examples.verifyOutput();
  return { outputRoot, report };
}

export function main(args = process.argv.slice(2)) {
  requireNode(); const [mode = 'help', ...rest] = args;
  if (['help', '--help', '-h'].includes(mode)) { console.log('Uso: testar-maturidade prepare|run [--source-only] [--case <id>] [--output <caminho-novo>]. A saída padrão fica na pasta temporária do sistema, fora de Git; destinos locais explícitos precisam estar ignorados.'); return 0; }
  if (!['prepare', 'run'].includes(mode)) fail('Use prepare ou run.');
  let scenarios = SCENARIOS, outputRoot, selected, sourceOnly = false;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--source-only' && !sourceOnly) { sourceOnly = true; continue; }
    const value = rest[++i];
    if (!value || value.startsWith('--')) fail('Use --source-only, --case <id> e/ou --output <caminho-novo>.');
    if (flag === '--case' && selected === undefined) selected = value;
    else if (flag === '--output' && outputRoot === undefined) outputRoot = value;
    else fail('Use --source-only, --case <id> e/ou --output <caminho-novo> uma única vez.');
  }
  if (selected !== undefined) { scenarios = SCENARIOS.filter(item => item.id === selected); if (!scenarios.length) fail('Cenário desconhecido.'); }
  if (mode === 'prepare') { const examples = prepareExamples({ scenarios, outputRoot, sourceOnly }); console.log(`prepared=${examples.length}\noutput=${dirname(examples[0].root)}`); return 0; }
  const result = runExamples({ scenarios, outputRoot, sourceOnly }); console.log(`output=${result.outputRoot}`);
  return result.report.status === 'passed' ? 0 : 1;
}

if (isMain(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
