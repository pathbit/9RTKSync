#!/usr/bin/env node
// Definicoes versionadas por ferramenta; pacotes e estado permanecem locais.
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, realpathSync, openSync, readSync, closeSync, chmodSync, readdirSync, lstatSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, delimiter, isAbsolute, relative, extname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { projectRoot, requireNode, isMain } from '../lib/runtime.mjs';
import { validateNativeDownload, nativeRelease, validateNativeRelease, installNative, checkNative, assertNativeVersion } from '../lib/native-release.mjs';

const registry = 'https://registry.npmjs.org/';
const versionPattern = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
const json = (file, label = 'arquivo local') => {
  const text = readFileSync(file, 'utf8');
  try { return JSON.parse(text); } catch { throw new SyntaxError(`JSON invalido (${label}).`); }
};
const fail = (message, exitCode) => { const error = new Error(message); if (Number.isInteger(exitCode)) error.exitCode = exitCode; throw error; };
const failureCode = error => Number.isInteger(error?.exitCode) && error.exitCode > 0 ? error.exitCode : 1;

function selectTools(catalog, selected) {
  const grouped = Object.keys(catalog).filter(name => catalog[name].group === selected);
  const names = selected === 'all' ? Object.keys(catalog).filter(name => !catalog[name].optIn)
    : selected === 'base' ? grouped : Object.hasOwn(catalog, selected) || !grouped.length ? [selected] : grouped;
  if (!names.length) fail(`Nenhuma ferramenta definida para: ${selected}`);
  return names;
}

export function platformKey(platform = process.platform, arch = process.arch) {
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) fail(`SO/arquitetura nao suportado: ${platform}-${arch}`);
  return `${platform}-${arch}`;
}

export function validateToolConfig(name, value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || value?.name !== name) fail(`Nome de ferramenta invalido: ${name}`);
  if (typeof value.description !== 'string' || !value.description.trim() || value.description.includes('\0')) fail(`Descricao ausente ou invalida: ${name}`);
  if (value.optIn !== undefined && typeof value.optIn !== 'boolean') fail(`Selecao explicita invalida: ${name}`);
  const download = value.download;
  if (!['npm', 'github-release'].includes(download?.provider)) fail(`Download nao suportado: ${name}`);
  if (download.provider === 'npm') {
    if (download.registry !== registry || download.channel !== 'latest') fail(`Download nao suportado: ${name}`);
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(download.package || '') || !/^[\w.-]+\/[\w.-]+$/.test(download.repository || '')) fail(`Origem invalida: ${name}`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(value.group || '') || !Array.isArray(value.platforms) || !value.platforms.length || new Set(value.platforms).size !== value.platforms.length || value.platforms.some(item => !/^(?:darwin|linux|win32)-(?:arm64|x64)$/.test(item))) fail(`Grupo/plataformas invalidos: ${name}`);
  if (download.provider === 'github-release') validateNativeDownload(download, value.platforms);
  if (!Array.isArray(value.probe) || !value.probe.length || value.probe.some(item => typeof item !== 'string' || item.includes('\0')) || (value.probeInput !== undefined && (typeof value.probeInput !== 'string' || value.probeInput.includes('\0')))) fail(`Verificacao invalida: ${name}`);
  if (value.binary !== undefined && (typeof value.binary !== 'string' || !/^[\w.-]+$/.test(value.binary))) fail(`Executavel invalido: ${name}`);
  if (value.executables !== undefined) {
    if (!value.executables || typeof value.executables !== 'object' || Array.isArray(value.executables) || !Object.keys(value.executables).length) fail(`Mapa de executaveis invalido: ${name}`);
    for (const [platform, files] of Object.entries(value.executables)) {
      if (!value.platforms.includes(platform) || !/^(?:darwin|linux)-(?:arm64|x64)$/.test(platform)) fail(`Plataforma de executaveis invalida: ${name}/${platform}`);
      if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) fail(`Lista de executaveis invalida: ${name}/${platform}`);
      for (const file of files) {
        if (typeof file !== 'string' || !file || file.includes('\0') || file.includes('\\') || file.includes(':') || file.split('/').some(part => !part || part === '.' || part === '..')) fail(`Caminho de executavel deve ser relativo ao pacote: ${name}`);
      }
    }
  }
  if (value.optionalExecutables !== undefined) {
    if (download.provider !== 'npm' || !value.optionalExecutables || typeof value.optionalExecutables !== 'object' || Array.isArray(value.optionalExecutables) || !Object.keys(value.optionalExecutables).length) fail(`Mapa de executaveis opcionais invalido: ${name}`);
    for (const [platform, files] of Object.entries(value.optionalExecutables)) {
      if (!value.platforms.includes(platform) || !Array.isArray(files) || !files.length) fail(`Plataforma de executaveis opcionais invalida: ${name}/${platform}`);
      const seen = new Set();
      for (const item of files) {
        if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'file,package'
          || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(item.package || '') || seen.has(item.package)
          || typeof item.file !== 'string' || !item.file || item.file.includes('\0') || item.file.includes('\\') || item.file.includes(':')
          || item.file.split('/').some(part => !part || part === '.' || part === '..')) fail(`Executavel opcional deve ser relativo ao pacote: ${name}`);
        seen.add(item.package);
      }
    }
  }
  if (value.scripts?.entry !== 'SCRIPT.mjs' || Object.keys(value.scripts).length !== 1) fail(`Script invalido; use scripts.entry=SCRIPT.mjs: ${name}`);
  if (value.nodeMinimum !== undefined) fail(`nodeMinimum foi substituido pelo requisito comum Node >=24: ${name}`);
  const environmentKeys = new Set();
  for (const field of ['env', 'envPaths']) {
    if (value[field] === undefined) continue;
    if (!value[field] || typeof value[field] !== 'object' || Array.isArray(value[field])) fail(`${field} invalido: ${name}`);
    for (const [key, content] of Object.entries(value[field])) {
      const normalized = key.toUpperCase();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || ['HOME', 'CODEX_HOME', 'PATH'].includes(normalized)) fail(`Variavel de ambiente protegida ou invalida: ${key}`);
      if (environmentKeys.has(normalized)) fail(`Variavel de ambiente duplicada: ${key}`);
      environmentKeys.add(normalized);
      if (typeof content !== 'string' || content.includes('\0')) fail(`Valor de ambiente invalido: ${key}`);
    }
  }
  if (value.envPaths !== undefined) {
    for (const [key, location] of Object.entries(value.envPaths)) {
      if (!location || location.includes('\\') || /^[A-Za-z]:/.test(location) || location.split('/').some(part => !part || part === '.' || part === '..')) fail(`Caminho de ambiente deve ser relativo: ${key}`);
    }
  }
  let source; try { source = new URL(value.source); } catch { fail(`Documentacao invalida: ${name}`); }
  if (source.protocol !== 'https:' || source.username || source.password) fail(`Documentacao invalida: ${name}`);
  return value;
}

export function toolActions(name, entry) {
  validateToolConfig(name, entry);
  const descriptions = {
    install: 'Instala ou reutiliza uma instalacao saudavel.',
    update: entry.download.provider === 'github-release' ? 'Aplica a versao revisada do catalogo com rollback.' : 'Consulta latest e atualiza com rollback em caso de falha.',
    check: 'Executa o probe local sem instalar nem consultar latest.',
    info: 'Mostra configuracao, plataforma, runtime e versao registrada.',
    run: 'Executa o CLI instalado com os argumentos informados.',
    unlock: 'Remove apenas um lock local cujo processo comprovadamente terminou.',
  };
  return Object.fromEntries(Object.entries(descriptions).map(([action, description]) => [action, {
    executor: 'node', argv: ['node', `.pbai4devs/tools/${name}/${entry.scripts.entry}`, action], description,
    ...(action === 'run' ? { requiresArguments: true } : {}),
  }]));
}

export function toolWrapper(name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) fail(`Nome de ferramenta invalido: ${name}`);
  return `#!/usr/bin/env node\nimport { main } from '../../scripts/preparar-ferramentas/SCRIPT.mjs';\n\ntry { process.exitCode = await main(['--tool', ${JSON.stringify(name)}, ...process.argv.slice(2)]); }\ncatch (error) { console.error(error.message); process.exitCode = 1; }\n`;
}

function sourcePath(root, name) {
  const file = resolve(root, name); const child = relative(root, file);
  if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) fail(`Caminho fora da raiz: ${name}`);
  let current = root;
  for (const part of child.split(sep).filter(Boolean)) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) fail(`Fonte de ferramenta nao pode ser um link: ${name}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return file;
}

function storagePath(root, name, kind) {
  const file = sourcePath(root, name);
  let item;
  try { item = lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (item && !(kind === 'directory' ? item.isDirectory() : item.isFile())) fail(`Caminho local exige ${kind}: ${name}`);
  return file;
}

export function loadCatalog(root = projectRoot) {
  root = realpathSync(root);
  const home = sourcePath(root, '.pbai4devs/tools'); const catalog = Object.create(null);
  if (!existsSync(home)) return catalog;
  for (const item of readdirSync(home, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.name.startsWith('.') || ['bin', 'npm-cache'].includes(item.name)) continue;
    const folder = sourcePath(root, join('.pbai4devs/tools', item.name));
    if (!lstatSync(folder).isDirectory()) continue;
    const file = sourcePath(root, join('.pbai4devs/tools', item.name, 'TOOL.json'));
    if (!existsSync(file) || !lstatSync(file).isFile()) fail(`TOOL.json ausente ou invalido: ${item.name}`);
    const entry = validateToolConfig(item.name, json(file, 'TOOL.json'));
    const script = sourcePath(root, join('.pbai4devs/tools', item.name, entry.scripts.entry));
    if (!existsSync(script) || !lstatSync(script).isFile()) fail(`Script ausente ou invalido: ${item.name}/${entry.scripts.entry}`);
    if (readFileSync(script, 'utf8').replace(/\r\n?/g, '\n') !== toolWrapper(item.name)) fail(`Apontamento de ferramenta divergente: ${item.name}; use toolWrapper(nome).`);
    catalog[item.name] = entry;
  }
  return catalog;
}

export function validateRelease(name, entry, release, platform = platformKey()) {
  if (entry.download.provider === 'github-release') return validateNativeRelease(entry, release, platform);
  const expected = entry.download.package;
  const repository = typeof release.repository === 'string' ? release.repository : release.repository?.url;
  if (release.name !== expected || !versionPattern.test(release.version || '')) fail(`Nome/versao invalido no registro: ${name}`);
  const origin = new URL(repository?.replace(/^git\+/, '').replace(/\.git$/, ''));
  if (origin.protocol !== 'https:' || origin.hostname !== 'github.com' || origin.pathname !== `/${entry.download.repository}`) fail('Repositorio de origem divergente.');
  const tarball = new URL(release.dist?.tarball);
  if (tarball.origin !== registry.slice(0, -1) || !decodeURIComponent(tarball.pathname).startsWith(`/${expected}/-/`) || tarball.search || tarball.hash || !release.dist?.integrity?.startsWith('sha512-')) fail('Tarball ou integridade invalida.');
  return release;
}

function npmCli(runtime, environment) {
  const candidates = [join(dirname(runtime.file), 'node_modules/npm/bin/npm-cli.js'), join(dirname(runtime.file), '../lib/node_modules/npm/bin/npm-cli.js'), environment.npm_execpath];
  for (const entry of (environment.PATH || '').split(delimiter)) for (const name of ['npm', 'npm.cmd']) {
    const file = join(entry, name);
    if (existsSync(file)) candidates.push(realpathSync(file), join(entry, 'node_modules/npm/bin/npm-cli.js'));
  }
  const cli = candidates.find(file => file && file.endsWith('npm-cli.js') && existsSync(file));
  if (!cli) fail('npm nao encontrado junto do Node; siga os pre-requisitos do projeto.');
  return cli;
}

export function binaryInvocation(prefix, name, args = [], binaryName = name.split('/').at(-1), node = process.execPath) {
  const base = join(prefix, 'node_modules', name); const pkg = json(join(base, 'package.json'), 'package.json');
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binaryName];
  if (typeof bin !== 'string' || !bin || bin.includes('\0')) fail(`Executavel ausente ou invalido: ${name}`);
  const binary = resolve(base, bin); const traversal = relative(base, binary);
  if (isAbsolute(traversal) || traversal === '..' || traversal.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) fail('Executavel fora do pacote.');
  const resolved = relative(realpathSync(prefix), realpathSync(binary));
  if (isAbsolute(resolved) || resolved === '..' || resolved.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) fail('Executavel fora da instalacao local.');
  const header = Buffer.alloc(128); const handle = openSync(binary, 'r');
  try { readSync(handle, header, 0, header.length, 0); } finally { closeSync(handle); }
  return /^#![^\n]*\bnode\b/.test(header.toString()) || ['.js', '.mjs', '.cjs'].includes(extname(binary)) ? [node, [binary, ...args]] : [binary, args];
}

export function toolEnvironment(entry, local, runtime) {
  const environment = Object.assign(Object.create(null), process.env);
  if (entry.download?.provider === 'github-release') {
    for (const key of Object.keys(environment)) if (/token|secret|password|(?:^|_)auth(?:_|$)|^(?:semgrep|opengrep)_/i.test(key)) delete environment[key];
  }
  const set = (key, value) => {
    if (process.platform === 'win32') for (const existing of Object.keys(environment)) if (existing.toUpperCase() === key.toUpperCase()) delete environment[existing];
    environment[key] = value;
  };
  for (const [key, value] of Object.entries(entry.env || {})) set(key, value);
  for (const [key, location] of Object.entries(entry.envPaths || {})) {
    let directory = resolve(local);
    for (const part of ['', ...location.split('/')]) {
      if (part) directory = join(directory, part);
      try { if (lstatSync(directory).isSymbolicLink()) fail(`Caminho de ambiente nao pode ser um link: ${key}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    set(key, resolve(local, location));
  }
  if (runtime) { const path = environment.PATH || environment.Path || ''; set('PATH', `${dirname(runtime.file)}${path ? delimiter + path : ''}`); }
  return environment;
}

function execute(prefix, entry, args, capture = false, input, environment, runtime) {
  const native = entry.download.provider === 'github-release';
  const [file, options] = native ? [checkNative(prefix, entry, runtime.platform || platformKey()).file, args]
    : binaryInvocation(prefix, entry.download.package, args, entry.binary || entry.name, runtime.file);
  const result = spawnSync(file, options, { stdio: capture ? 'pipe' : 'inherit', cwd: capture ? prefix : undefined, input, env: environment, encoding: 'utf8', timeout: capture ? 30000 : undefined, windowsHide: true });
  if (result.error) throw result.error;
  if (capture && result.status !== 0) fail(`${entry.name}: ${result.stderr?.trim().slice(0, 400) || result.stdout?.trim().slice(0, 400) || `falha ${result.status}`}`, result.status ?? 1);
  if (capture && native) assertNativeVersion(`${result.stdout || ''}\n${result.stderr || ''}`, entry.download.version);
  return result.status ?? 1;
}

async function prepareExecutables(prefix, entry, platform, pkg, lock, fetchOptional) {
  const files = entry.executables?.[platform] || [];
  const optional = entry.optionalExecutables?.[platform] || [];
  if (!files.length && !optional.length) return;
  const within = (base, file) => { const child = relative(base, file); return !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`); };
  const stage = realpathSync(prefix);
  const packageRoot = realpathSync(join(prefix, 'node_modules', entry.download.package));
  if (!within(stage, packageRoot)) fail(`Pacote fora do staging: ${entry.name}`);
  const declared = optional.filter(item => Object.hasOwn(pkg.optionalDependencies || {}, item.package));
  const targets = [];
  const collect = (base, file, label) => {
    const target = realpathSync(join(base, file));
    if (!within(base, target)) fail(`Executavel fora do pacote: ${label}`);
    const info = lstatSync(target);
    if (!info.isFile()) fail(`Executavel nao e arquivo regular: ${label}`);
    targets.push({ target, mode: (info.mode & 0o777) | 0o111 });
  };
  // Older releases contain all of their binaries in the main package. Newer
  // releases declare a host package; inspect every legacy file that exists so
  // the upstream launcher cannot prefer an unchecked file over that package.
  for (const file of files) {
    let exists = false;
    try { lstatSync(join(packageRoot, file)); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists || !declared.length) collect(packageRoot, file, `${entry.name}/${file}`);
  }
  if (declared.length) {
    let installed = 0;
    for (const item of declared) {
      const version = pkg.optionalDependencies[item.package];
      if (!versionPattern.test(version || '')) fail(`Versao de executavel opcional invalida: ${item.package}`);
      const directory = sourcePath(prefix, join('node_modules', item.package));
      try { lstatSync(directory); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const optionalRoot = realpathSync(directory);
      if (!within(realpathSync(join(prefix, 'node_modules')), optionalRoot)) fail(`Pacote opcional fora de node_modules: ${item.package}`);
      const manifest = json(join(optionalRoot, 'package.json'), 'package.json');
      const record = lock.packages?.[`node_modules/${item.package}`];
      const official = await fetchOptional(item.package, version);
      const tarball = new URL(official.dist?.tarball);
      if (official.name !== item.package || official.version !== version || tarball.origin !== registry.slice(0, -1)
        || !decodeURIComponent(tarball.pathname).startsWith(`/${item.package}/-/`) || tarball.search || tarball.hash
        || !official.dist?.integrity?.startsWith('sha512-') || manifest.name !== item.package || manifest.version !== version
        || record?.version !== version || record.integrity !== official.dist.integrity || record.resolved !== official.dist.tarball) fail(`Pacote opcional instalado nao corresponde ao registro oficial: ${item.package}`);
      collect(optionalRoot, item.file, `${item.package}/${item.file}`); installed++;
    }
    if (!installed) fail(`Executavel opcional ausente para ${entry.name}/${platform}; instale as dependencias opcionais.`);
  }
  if (process.platform !== 'win32') for (const { target, mode } of targets) chmodSync(target, mode);
}

export class ToolManager {
  constructor({ root = projectRoot, catalog, fetchRelease, fetchOptional, install, npm = npmCli, nodeVersion = process.versions.node, platform = process.platform, arch = process.arch } = {}) {
    this.root = resolve(root); this.home = join(this.root, '.pbai4devs/tools'); this.target = `${platform}-${arch}`;
    this.nodeVersion = nodeVersion; this.npm = npm;
    this.catalog = catalog ?? loadCatalog(this.root);
    for (const [name, entry] of Object.entries(this.catalog)) validateToolConfig(name, entry);
    this.fetchRelease = fetchRelease || (async (name, entry) => {
      if (entry.download.provider === 'github-release') return nativeRelease(entry, this.target);
      const response = await fetch(`${entry.download.registry}${encodeURIComponent(entry.download.package)}/${entry.download.channel}`, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) fail(`Registro indisponivel: HTTP ${response.status}`);
      return response.json();
    });
    this.fetchOptional = fetchOptional || (async (name, version) => {
      const response = await fetch(`${registry}${encodeURIComponent(name)}/${version}`, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) fail(`Registro indisponivel para ${name}: HTTP ${response.status}`);
      return response.json();
    });
    this.installPackage = install || (async (prefix, packageName, version, entry, runtime) => {
      if (entry.download.provider === 'github-release') return installNative(prefix, entry, this.target);
      const environment = toolEnvironment(entry, this.local(entry.name), runtime);
      // npm resolves cwd but not --prefix, yielding invalid lock paths when
      // ancestors are aliases such as macOS /var -> /private/var.
      const npmPrefix = realpathSync(storagePath(this.root, prefix, 'directory'));
      const result = spawnSync(runtime.file, [this.npm(runtime, environment), 'install', '--prefix', npmPrefix, '--cache', join(this.home, '.cache/npm'), '--registry', entry.download.registry, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--save-exact', `${packageName}@${version}`], {
        cwd: npmPrefix, encoding: 'utf8', timeout: 180000,
        env: { ...environment, npm_config_engine_strict: 'true', npm_config_update_notifier: 'false', PUPPETEER_SKIP_DOWNLOAD: 'true', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }
      });
      if (result.error || result.status !== 0) fail(`npm: ${result.error?.message || result.stderr?.trim() || result.status}`, result.status ?? 1);
    });
  }
  entry(name) {
    if (!Object.hasOwn(this.catalog, name)) fail(`Ferramenta desconhecida: ${name}`);
    return this.catalog[name];
  }
  runtime(name) {
    const entry = this.entry(name);
    if (!entry.platforms.includes(this.target)) fail(`Plataforma nao suportada por ${name}: ${this.target}`);
    requireNode(24, this.nodeVersion);
    return { file: process.execPath, version: process.version, platform: this.target };
  }
  preflight(names) {
    const issues = [];
    for (const name of names) try { this.runtime(name); } catch (error) { issues.push(`${name}: ${error.message}`); }
    if (issues.length) fail(`Pre-requisitos indisponiveis; nenhuma ferramenta foi alterada:\n${issues.join('\n')}`);
  }
  checkNpm() {
    requireNode(24, this.nodeVersion);
    const runtime = { file: process.execPath, version: process.version };
    const environment = { ...toolEnvironment({}, this.home, runtime), npm_config_update_notifier: 'false' };
    let file;
    try { file = realpathSync(this.npm(runtime, environment)); }
    catch (error) { fail(`npm indisponivel: ${error.message}. Instale Node.js 24+ com npm: https://nodejs.org/en/download .`); }
    if (!lstatSync(file).isFile()) fail(`npm nao e um arquivo: ${file}`);
    const result = spawnSync(runtime.file, [file, '--version'], { cwd: this.root, env: environment, encoding: 'utf8', timeout: 15000, windowsHide: true });
    const version = result.stdout?.trim();
    if (result.error || result.status !== 0 || !versionPattern.test(version || '')) fail(`npm indisponivel: ${result.error?.message || result.stderr?.trim() || version || result.status}. Instale Node.js 24+ com npm: https://nodejs.org/en/download .`, result.status || 1);
    return { path: file, version };
  }
  async setup(selected = 'all') {
    const names = selectTools(this.catalog, selected);
    const explicit = !['all', 'base'].includes(selected) && Object.hasOwn(this.catalog, selected);
    const results = new Map(names.map(name => [name, null])); const compatible = [];
    let npm = null;
    for (const name of names) {
      if (this.entry(name).platforms.includes(this.target)) compatible.push(name);
      else results.set(name, { name, status: explicit ? 'failed' : 'not-applicable', phase: 'platform', exitCode: explicit ? 1 : null, reason: `Plataforma nao suportada: ${this.target}` });
    }
    try { if (compatible.length) { this.preflight(compatible); npm = this.checkNpm(); } }
    catch (error) { for (const name of compatible) results.set(name, { name, status: 'failed', phase: 'preflight', exitCode: failureCode(error), reason: error.message }); }
    if (npm) for (const name of compatible) {
      let phase = 'install';
      try {
        const installed = await this.install(name); phase = 'check';
        const checked = this.check(name);
        results.set(name, { name, status: 'passed', phase, exitCode: 0, version: checked.version, changed: installed.changed });
      } catch (error) { results.set(name, { name, status: 'failed', phase, exitCode: failureCode(error), reason: error.message }); }
    }
    const entries = [...results.values()];
    const summary = { passed: entries.filter(item => item.status === 'passed').length, failed: entries.filter(item => item.status === 'failed').length, notApplicable: entries.filter(item => item.status === 'not-applicable').length };
    return { mode: 'setup', selection: selected, platform: this.target, node: process.version, nodePath: process.execPath, npm, results: entries, summary, status: summary.failed ? 'failed' : summary.passed ? 'passed' : 'not-applicable', exitCode: summary.failed ? 1 : 0 };
  }
  local(name) { this.entry(name); return join(this.home, name, '.local'); }
  storage(name) {
    const local = this.local(name), tool = join(this.home, name);
    for (const path of [this.home, tool, local, join(local, 'versions'), join(tool, 'versions'), join(this.home, '.cache'), join(this.home, '.cache/npm'), join(this.home, 'npm-cache')]) storagePath(this.root, path, 'directory');
    for (const path of [join(local, 'CURRENT.json'), join(tool, 'CURRENT.json')]) storagePath(this.root, path, 'file');
    return { local, tool };
  }
  current(name) {
    const { local, tool: legacy } = this.storage(name);
    const base = existsSync(join(local, 'CURRENT.json')) ? local : legacy;
    const file = join(base, 'CURRENT.json');
    if (!existsSync(file)) fail(`Ferramenta ausente: ${name}; execute install ${name}.`);
    const info = json(file, 'CURRENT.json');
    if (info.name !== name || info.platform !== this.target || !versionPattern.test(info.version || '')) fail(`Instalacao incompativel: ${name}`);
    const prefix = storagePath(this.root, join(base, 'versions', `${info.version}-${this.target}`), 'directory');
    return { ...info, layout: base === local ? 'local' : 'legacy', prefix };
  }
  check(name) {
    const entry = this.entry(name); const runtime = this.runtime(name); const info = this.current(name);
    if (entry.download.provider === 'github-release') {
      const receipt = checkNative(info.prefix, entry, this.target);
      if (receipt.version !== info.version || receipt.binarySha256 !== info.binarySha256) fail(`Versao local divergente: ${name}`);
    } else {
      const pkg = json(join(info.prefix, 'node_modules', entry.download.package, 'package.json'), 'package.json');
      if (pkg.name !== entry.download.package || pkg.version !== info.version) fail(`Versao local divergente: ${name}`);
    }
    execute(info.prefix, entry, entry.probe, true, entry.probeInput, toolEnvironment(entry, this.local(name), runtime), runtime);
    return info;
  }
  info(name) {
    const config = this.entry(name); let installed = null; let issue; let runtime = null;
    try { runtime = this.runtime(name); } catch (error) { issue = error.message; }
    try { const current = this.current(name); installed = { version: current.version, platform: current.platform, layout: current.layout }; }
    catch (error) { issue ??= error.message; }
    return { ...config, platform: this.target, supported: runtime !== null, runtime: runtime ? { path: runtime.file, version: runtime.version } : null, installed, ...(issue ? { issue } : {}) };
  }
  launchers(name, { verifyOnly = false } = {}) {
    this.entry(name);
    const bin = storagePath(this.root, join(this.home, 'bin'), 'directory');
    const launcher = storagePath(this.root, join(bin, `${name}.mjs`), 'file');
    const content = Buffer.from(`#!/usr/bin/env node\nimport { main } from '../../scripts/preparar-ferramentas/SCRIPT.mjs';\ntry { process.exitCode = await main(['run', ${JSON.stringify(name)}, ...process.argv.slice(2)]); }\ncatch (error) { console.error(error.message); process.exitCode = 1; }\n`);
    if (existsSync(launcher)) {
      if (lstatSync(launcher).size !== content.length || !readFileSync(launcher).equals(content)) fail(`Atalho local divergente; arquivo preservado: ${launcher}`);
      return;
    }
    if (verifyOnly) return;
    mkdirSync(bin, { recursive: true });
    writeFileSync(launcher, content, { flag: 'wx', mode: 0o755 });
  }
  migrate(name) {
    const { local, tool } = this.storage(name);
    const legacyState = join(tool, 'CURRENT.json'); const legacyVersions = join(tool, 'versions');
    if (existsSync(legacyState)) {
      if (existsSync(join(local, 'CURRENT.json')) || (existsSync(join(local, 'versions')) && readdirSync(join(local, 'versions')).length)) fail(`Layouts local e antigo coexistem: ${name}; revise antes de migrar.`);
      if (!existsSync(legacyVersions)) fail(`Versoes antigas ausentes: ${name}`);
      if (existsSync(join(local, 'versions'))) rmdirSync(join(local, 'versions'));
      renameSync(legacyVersions, join(local, 'versions'));
      try { renameSync(legacyState, join(local, 'CURRENT.json')); }
      catch (error) { renameSync(join(local, 'versions'), legacyVersions); throw error; }
    }
    const oldCache = join(this.home, 'npm-cache');
    if (existsSync(oldCache)) {
      const cache = storagePath(this.root, join(this.home, '.cache'), 'directory'); mkdirSync(cache, { recursive: true });
      const destination = storagePath(this.root, join(cache, existsSync(join(cache, 'npm')) ? `npm-legacy-${randomUUID()}` : 'npm'), 'directory');
      try { renameSync(oldCache, destination); }
      catch (error) { if (error.code !== 'ENOENT' || existsSync(oldCache)) throw error; }
    }
  }
  async withLock(name, action) {
    const { local } = this.storage(name);
    mkdirSync(local, { recursive: true }); const lock = storagePath(this.root, join(local, '.update-lock'), 'directory');
    try { mkdirSync(lock); } catch (error) {
      if (error.code === 'EEXIST') {
        const status = this.lockStatus(name);
        fail(status.state === 'stale' ? `Lock orfao: ${name}; use unlock ${name}.` : `Atualizacao em andamento ou lock indeterminado: ${name}`);
      }
      throw error;
    }
    try { writeFileSync(storagePath(this.root, join(lock, 'owner.json'), 'file'), JSON.stringify({ pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() }), { flag: 'wx' }); return await action(); }
    finally { rmSync(storagePath(this.root, lock, 'directory'), { recursive: true, force: true }); }
  }
  lockStatus(name) {
    const lock = sourcePath(this.root, join(this.local(name), '.update-lock'));
    if (!existsSync(lock)) return { state: 'missing', lock };
    try {
      if (!lstatSync(lock).isDirectory()) return { state: 'indeterminate', lock };
      const ownerFile = sourcePath(this.root, join(lock, 'owner.json'));
      if (!lstatSync(ownerFile).isFile()) return { state: 'indeterminate', lock };
      const owner = json(ownerFile, 'owner.json');
      if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0 || owner.pid > 2147483647 || owner.hostname !== hostname()) return { state: 'indeterminate', lock };
      try { process.kill(owner.pid, 0); return { state: 'active', lock, pid: owner.pid }; }
      catch (error) { return { state: error.code === 'ESRCH' ? 'stale' : 'indeterminate', lock, pid: owner.pid }; }
    } catch { return { state: 'indeterminate', lock }; }
  }
  unlock(name) {
    const lock = sourcePath(this.root, join(this.local(name), '.update-lock'));
    if (!existsSync(lock)) return { name, removed: false, state: 'missing' };
    const recovery = join(lock, 'recovery.json'), token = randomUUID(); let claimed = false, moved = false;
    try {
      const handle = openSync(recovery, 'wx');
      try { writeFileSync(handle, JSON.stringify({ token })); claimed = true; } finally { closeSync(handle); }
      const ownerFile = sourcePath(this.root, join(lock, 'owner.json'));
      const ownerSnapshot = readFileSync(ownerFile, 'utf8');
      const status = this.lockStatus(name);
      if (status.state !== 'stale') fail(`Lock ${status.state}: ${name}; nenhum lock foi removido.`);
      if (json(sourcePath(this.root, recovery)).token !== token || readFileSync(ownerFile, 'utf8') !== ownerSnapshot) fail(`Lock mudou durante a recuperacao: ${name}.`);
      const retired = sourcePath(this.root, join(this.local(name), `.unlocked-${token}`));
      renameSync(lock, retired); moved = true;
      rmSync(retired, { recursive: true });
      return { name, removed: true, state: 'stale' };
    } finally {
      if (claimed && !moved) {
        try { if (json(recovery).token === token) unlinkSync(recovery); } catch { /* O dono pode ter concluido e removido o lock. */ }
      }
    }
  }
  async install(name) { this.preflight([name]); this.launchers(name, { verifyOnly: true }); return this.withLock(name, async () => {
    this.migrate(name);
    let installed;
    try { installed = this.check(name); } catch { /* Ausente ou quebrado: preparar uma instalacao. */ }
    if (installed) { this.launchers(name); return { ...installed, changed: false }; }
    return this.updateLocked(name);
  }); }
  async update(name) { this.preflight([name]); this.launchers(name, { verifyOnly: true }); return this.withLock(name, async () => { this.migrate(name); return this.updateLocked(name); }); }
  commitState(name, temporary) {
    const { local } = this.storage(name);
    renameSync(storagePath(this.root, temporary, 'file'), storagePath(this.root, join(local, 'CURRENT.json'), 'file'));
  }
  async updateLocked(name) {
    const entry = this.entry(name); const runtime = this.runtime(name); const release = validateRelease(name, entry, await this.fetchRelease(name, entry), this.target);
    const { local } = this.storage(name);
    const target = storagePath(this.root, join(local, 'versions', `${release.version}-${this.target}`), 'directory');
    let installed;
    try { installed = this.check(name); } catch { /* Ausente ou quebrado: reparar em staging. */ }
    if (installed?.version === release.version) { this.launchers(name); return { ...installed, changed: false }; }
    mkdirSync(storagePath(this.root, join(local, 'versions'), 'directory'), { recursive: true });
    const stage = mkdtempSync(join(local, '.stage-'));
    const temporary = storagePath(this.root, join(local, `CURRENT.${randomUUID()}.json`), 'file'); let previous; let moved = false;
    try {
      if (entry.download.provider === 'github-release') {
        for (const location of Object.values(entry.envPaths || {})) mkdirSync(storagePath(this.root, join(local, location), 'directory'), { recursive: true });
      }
      await this.installPackage(stage, entry.download.package, release.version, entry, runtime);
      this.storage(name); storagePath(this.root, stage, 'directory');
      let receipt;
      if (entry.download.provider === 'github-release') receipt = checkNative(stage, entry, this.target);
      else {
        const pkg = json(join(stage, 'node_modules', entry.download.package, 'package.json'), 'package.json'); const lock = json(join(stage, 'package-lock.json'), 'package-lock.json');
        if (pkg.name !== entry.download.package || pkg.version !== release.version || lock.packages?.[`node_modules/${entry.download.package}`]?.integrity !== release.dist.integrity) fail('Pacote instalado nao corresponde ao registro.');
        await prepareExecutables(stage, entry, this.target, pkg, lock, this.fetchOptional);
      }
      execute(stage, entry, entry.probe, true, entry.probeInput, toolEnvironment(entry, local, runtime), runtime);
      this.storage(name); storagePath(this.root, target, 'directory');
      const info = { name, ...(receipt ? { provider: 'github-release', binarySha256: receipt.binarySha256, archiveSha256: receipt.archiveSha256 } : { package: entry.download.package }), version: release.version, platform: this.target, node: runtime.version, nodePath: runtime.file, source: entry.source, tarball: receipt ? release.url : release.dist.tarball, integrity: receipt ? `sha256-${Buffer.from(receipt.archiveSha256, 'hex').toString('base64')}` : release.dist.integrity, checkedAt: new Date().toISOString() };
      writeFileSync(storagePath(this.root, temporary, 'file'), `${JSON.stringify(info, null, 2)}\n`, { flag: 'wx' });
      this.launchers(name);
      if (existsSync(target)) { previous = storagePath(this.root, `${target}.previous-${randomUUID()}`, 'directory'); renameSync(storagePath(this.root, target, 'directory'), previous); }
      try { renameSync(storagePath(this.root, stage, 'directory'), storagePath(this.root, target, 'directory')); moved = true; this.commitState(name, temporary); }
      catch (error) { if (moved) rmSync(storagePath(this.root, target, 'directory'), { recursive: true, force: true }); if (previous) renameSync(storagePath(this.root, previous, 'directory'), storagePath(this.root, target, 'directory')); throw error; }
      return { ...info, layout: 'local', prefix: target, changed: true };
    } finally { rmSync(storagePath(this.root, stage, 'directory'), { recursive: true, force: true }); rmSync(storagePath(this.root, temporary, 'file'), { force: true }); }
  }
  run(name, args) {
    const entry = this.entry(name), runtime = this.runtime(name), current = this.current(name);
    if (entry.download.provider === 'github-release' && checkNative(current.prefix, entry, this.target).binarySha256 !== current.binarySha256) fail(`Recibo local divergente: ${name}`);
    return execute(current.prefix, entry, args, false, undefined, toolEnvironment(entry, this.local(name), runtime), runtime);
  }
}

const help = 'Uso: setup [all|grupo|nome]; [install|update|check|info] [base|all|grupo|nome]; list; unlock <nome>; run <nome> [argumentos]; --tool <nome> <acao> [argumentos].';
const focusedHelp = name => `${name}: setup | install | update | check | info | unlock | run [argumentos]\nsetup instala e verifica; unlock recupera lock local orfao; check verifica; info mostra a configuracao; run executa.`;
export async function main(input = process.argv.slice(2), manager) {
  requireNode();
  const args = [...input]; let focused;
  if (args[0] === '--tool') { args.shift(); focused = args.shift(); if (!focused) fail('Falta o nome de --tool.'); }
  const aliases = { '--setup': 'setup', '--update': 'update', '--check': 'check', '--run': 'run', '--info': 'info', '--install': 'install' };
  const supplied = args.shift(); const mode = aliases[supplied] || supplied || 'help';
  if (['help', '--help', '-h'].includes(mode)) { console.log(focused ? focusedHelp(focused) : help); return 0; }
  manager ??= new ToolManager();
  if (focused) manager.entry(focused);
  if (mode === 'unlock') {
    const name = focused || args.shift(); if (!name || args.length) fail('Use unlock <nome> para uma unica ferramenta.');
    console.log(JSON.stringify(manager.unlock(name))); return 0;
  }
  if (mode === 'run') { const name = focused || args.shift(); if (!name) fail('Uso: run <ferramenta> [argumentos]'); return manager.run(name, args); }
  if (mode === 'list') {
    if (focused || args.length) fail('list nao aceita argumentos.');
    for (const name of Object.keys(manager.catalog)) {
      const info = manager.info(name);
      console.log(JSON.stringify({ name, group: info.group, platform: info.platform, supported: info.supported, installed: info.installed?.version || null, ...(info.issue ? { issue: info.issue } : {}) }));
    }
    return 0;
  }
  if (mode === 'setup') {
    const selected = focused || args.shift() || 'all'; if (args.length) fail('Argumentos excedentes.');
    const { results, ...summary } = await manager.setup(selected);
    for (const result of results) console.log(JSON.stringify({ event: 'tool', ...result }));
    console.log(JSON.stringify({ event: 'summary', ...summary }));
    return summary.exitCode;
  }
  if (!['install', 'update', 'check', 'info'].includes(mode)) fail(help);
  const selected = focused || args.shift() || 'base'; if (args.length) fail('Argumentos excedentes.');
  const names = selectTools(manager.catalog, selected);
  if (mode === 'install' || mode === 'update') manager.preflight?.(names);
  for (const name of names) {
    if (mode === 'info') { console.log(JSON.stringify(manager.info(name))); continue; }
    const info = await manager[mode](name);
    console.log(`${name}=${info.version}; platform=${info.platform}; ${info.changed ? 'updated' : 'ready'}`);
  }
  return 0;
}
if (isMain(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
