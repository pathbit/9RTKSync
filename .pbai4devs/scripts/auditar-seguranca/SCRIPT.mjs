#!/usr/bin/env node
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gitPathsOverlap } from '../lib/git-environment.mjs';
import { isMain, projectRoot, requireNode } from '../lib/runtime.mjs';
import { ToolManager } from '../preparar-ferramentas/SCRIPT.mjs';
import { validateOsvDatabase } from './database-zip.mjs';

const checks = Object.freeze({ secrets: 'gitleaks', dependencies: 'osv-scanner', sast: 'opengrep' });
const ecosystemNames = ['npm', 'Go', 'PyPI', 'Maven', 'NuGet', 'Packagist', 'crates.io', 'RubyGems', 'Hex', 'Pub', 'Conan', 'Hackage'];
const ecosystems = new Map(ecosystemNames.map(name => [name.toLowerCase(), name]));
const discardedDirectories = new Set(['.git', '.agent-tests', 'node_modules', 'tmp', 'temp', '.cache', '.local', 'coverage', '__pycache__']);
const scannerConfiguration = new Set(['.semgrepignore', '.gitleaksignore', '.gitleaks.toml', 'osv-scanner.toml', '.osv-scanner.toml']);
const opengrepRules = new Set(['pbai-eval-input', 'pbai-shell-input', 'pbai-sql-input', 'pbai-tls-verification-disabled']);
const digest = value => createHash('sha256').update(value).digest('hex');
const portable = value => value.split(sep).join('/');
const fail = message => { const error = new Error(message); error.publicMessage = message; throw error; };
const stat = path => { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const parseJson = text => { try { return JSON.parse(text); } catch { fail('A ferramenta nao produziu JSON valido.'); } };
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9@._:/+ -]{1,180}$/.test(value) ? value : 'unknown';

export function parseArgs(input) {
  const args = [...input], command = args.shift() || 'help';
  if (['help', '--help', '-h'].includes(command)) {
    if (args.length) fail('Ajuda nao recebe argumentos.');
    return { command: 'help' };
  }
  if (!['run', 'check', 'update-data'].includes(command)) fail('Use run, check ou update-data.');
  const result = { command, checks: Object.keys(checks), target: '.', includeHistory: false, ecosystems: [], output: null };
  const seen = new Set();
  while (args.length) {
    const key = args.shift();
    if (seen.has(key)) fail('Opcao repetida.');
    seen.add(key);
    if (key === '--include-history') result.includeHistory = true;
    else if (['--checks', '--target', '--output', '--ecosystems'].includes(key)) {
      const value = args.shift();
      if (typeof value !== 'string' || !value || value.startsWith('--') || /[\x00-\x1f]/.test(value)) fail('Valor de opcao invalido.');
      if (key === '--checks') {
        result.checks = [...new Set(value.split(','))];
        if (!result.checks.length || result.checks.some(name => !Object.hasOwn(checks, name))) fail('Checks aceitos: secrets,dependencies,sast.');
      } else if (key === '--ecosystems') {
        result.ecosystems = [...new Set(value.split(',').map(name => ecosystems.get(name.toLowerCase())))];
        if (!result.ecosystems.length || result.ecosystems.includes(undefined)) fail('Ecossistema OSV nao autorizado.');
      } else result[key === '--target' ? 'target' : 'output'] = value;
    } else fail('Opcao desconhecida.');
  }
  if (command !== 'run' && (seen.has('--target') || result.includeHistory || result.output)) fail('Target, historico e output pertencem a run.');
  if (command !== 'update-data' && result.ecosystems.length) fail('Ecossistemas pertencem a update-data.');
  if (command === 'update-data' && (!result.ecosystems.length || seen.has('--checks'))) fail('Use update-data --ecosystems npm,Go.');
  if (result.includeHistory && !result.checks.includes('secrets')) fail('Historico exige secrets.');
  return result;
}

export function safePath(root, input, { directory = false, mustExist = false } = {}) {
  if (typeof input !== 'string' || /[\x00-\x1f]/.test(input)) fail('Caminho invalido.');
  const full = resolve(root, input), child = relative(root, full);
  if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) fail('Caminho fora da raiz autorizada.');
  let current = root;
  if (!stat(root)?.isDirectory() || stat(root).isSymbolicLink()) fail('Raiz deve ser um diretorio real.');
  for (const part of child.split(sep).filter(Boolean)) {
    current = join(current, part);
    const item = stat(current);
    if (item?.isSymbolicLink()) fail('Links simbolicos nao sao aceitos como caminho de execucao.');
    if (item && current !== full && !item.isDirectory()) fail('Ancestral nao e um diretorio.');
  }
  const item = stat(full);
  if (mustExist && !item) fail('Caminho inexistente.');
  if (item && directory && !item.isDirectory()) fail('Caminho deve ser um diretorio.');
  return full;
}

function mkdirSafe(root, input) {
  const full = safePath(root, input, { directory: true });
  let current = root;
  for (const part of relative(root, full).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (!stat(current)) mkdirSync(current, { mode: 0o700 });
    if (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink()) fail('Diretorio local inseguro.');
  }
  return full;
}

export function sanitizedEnvironment(environment = process.env) {
  const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TMP', 'TEMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TZ', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']);
  const clean = Object.fromEntries(Object.entries(environment).filter(([key]) => allowed.has(key.toUpperCase())));
  return { ...clean, SEMGREP_ENABLE_VERSION_CHECK: '0', OPENGREP_ENABLE_VERSION_CHECK: '0', SEMGREP_SEND_METRICS: 'off',
    DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', CI: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false' };
}

function queryGit(root, args, { encoding = 'utf8', input } = {}) {
  // A different index or worktree would make an ignore check describe another
  // project. Refuse it explicitly instead of silently discarding the setting.
  if (Object.entries(process.env).some(([key, value]) => /^(?:GIT_DIR|GIT_WORK_TREE|GIT_COMMON_DIR|GIT_INDEX_FILE|GIT_CEILING_DIRECTORIES|GIT_DISCOVERY_ACROSS_FILESYSTEM|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_NAMESPACE)$/i.test(key) && value)) {
    fail('Ambiente Git redirecionado; remova as variaveis de repositorio ou indice e execute novamente.');
  }
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:GIT_OPTIONAL_LOCKS|LC_ALL)$/i.test(key)) delete env[key];
  env.GIT_OPTIONAL_LOCKS = '0'; env.LC_ALL = 'C';
  return spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: root, env, encoding, input, windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024,
  });
}

// Git terminates this response with one newline; path names may themselves end
// in spaces, so trim() would change the repository being verified.
function gitPath(result) {
  if (result.status !== 0 || result.error || result.signal || !result.stdout.endsWith('\n')) return null;
  return result.stdout.slice(0, -1);
}

export function mayAliasIndexPath(left, right, { root, platform = process.platform } = {}) {
  const a = left.split('/'), b = right.split('/');
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].normalize('NFD').toLowerCase() === b[i].normalize('NFD').toLowerCase()) continue;
    // Filesystems can fold Unicode and unusual components beyond JS lowercase.
    // Reject uncertain aliases; distinguish only ordinary ASCII names.
    const ordinary = value => /^[a-z0-9_.-]+$/i.test(value) && !value.endsWith('.');
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

function assertIgnored(root, path, temporary) {
  const where = portable(relative(root, path));
  if (!where.startsWith('.agent-tests/')) fail('Relatorios devem ficar dentro de .agent-tests.');
  const git = queryGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (git.status === 0 && git.stdout.trim() === 'true') {
    const top = queryGit(root, ['rev-parse', '--show-toplevel']);
    let repository;
    try { const value = gitPath(top); if (value !== null) repository = realpathSync(value); } catch { /* Refuse unverifiable worktrees. */ }
    const inside = repository && relative(repository, root);
    if (!repository || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) fail('Nao foi possivel confirmar a raiz Git deste projeto.');
    const ignored = queryGit(root, ['check-ignore', '--no-index', '-q', '--', where]);
    const work = '.agent-tests/security';
    const ignoredWork = queryGit(root, ['check-ignore', '--no-index', '-q', '--', `${work}/`]);
    const tracked = queryGit(repository, ['ls-files', '--cached', '--full-name', '-z'], { encoding: null });
    const entries = tracked.stdout?.toString('utf8');
    if (ignored.status !== 0 || ignoredWork.status !== 0 || tracked.status !== 0 || ignored.error || ignoredWork.error || tracked.error || ignored.signal || ignoredWork.signal || tracked.signal || !Buffer.isBuffer(tracked.stdout) || !Buffer.from(entries).equals(tracked.stdout) || (entries && !entries.endsWith('\0'))) fail('O destino de evidencias precisa estar ignorado e fora do indice Git.');
    const output = portable(relative(repository, path));
    const workPath = portable(relative(repository, join(root, work)));
    const tempPath = portable(relative(repository, temporary));
    const overlaps = entries.split('\0').filter(Boolean).some(name => {
      return mayAliasIndexPath(name, output, { root: repository }) || (name.split('/').length <= workPath.split('/').length && mayAliasIndexPath(name, workPath, { root: repository })) || mayAliasIndexPath(name, tempPath, { root: repository });
    });
    if (overlaps) fail('O destino de evidencias precisa estar ignorado e fora do indice Git.');
  } else fail('Prepare a protecao local de artefatos antes de auditar.');
}

function readStable(root, path) {
  safePath(root, path, { mustExist: true });
  const first = lstatSync(path);
  if (!first.isFile()) fail('Fonte deve ser um arquivo regular.');
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = fstatSync(descriptor);
    if (opened.dev !== first.dev || opened.ino !== first.ino || !opened.isFile()) fail('Fonte mudou durante a leitura.');
    const bytes = readFileSync(descriptor), after = fstatSync(descriptor);
    if (after.size !== first.size || after.mtimeMs !== first.mtimeMs) fail('Fonte mudou durante a leitura.');
    return bytes;
  } finally { closeSync(descriptor); }
}

// Ignore local generated examples only when Git confirms both the ignore and
// an absence of tracked paths. An unreadable or ambiguous index keeps the tree
// in scope; an explicitly selected generated directory is scanned normally.
function untrackedIgnoredExamples(root, directory) {
  try {
    const local = portable(relative(root, directory));
    if (local.toLowerCase() !== 'examples/generated') return false;
    const ignored = queryGit(root, ['-c', 'core.excludesFile=', 'check-ignore', '--no-index', '--verbose', '--stdin', '-z'], { encoding: null, input: `${local}/\0` });
    if (ignored.error || ignored.signal || ignored.status !== 0 || !Buffer.isBuffer(ignored.stdout)) return false;
    const ignoredText = ignored.stdout.toString('utf8');
    if (!Buffer.from(ignoredText, 'utf8').equals(ignored.stdout)) return false;
    const [source, line, pattern, checked, trailing, ...extra] = ignoredText.split('\0');
    if (extra.length || trailing !== '' || !/^\d+$/.test(line || '') || !pattern || pattern.startsWith('!')
      || checked !== `${local}/` || !source || source.split('/').at(-1) !== '.gitignore') return false;
    const top = gitPath(queryGit(root, ['rev-parse', '--show-toplevel']));
    if (top === null) return false;
    const repository = realpathSync(top), candidate = portable(relative(repository, directory));
    if (!candidate || isAbsolute(candidate) || candidate === '..' || candidate.startsWith('../')) return false;
    const tracked = queryGit(repository, ['ls-files', '--cached', '--full-name', '-z'], { encoding: null });
    if (tracked.error || tracked.signal || tracked.status !== 0 || !Buffer.isBuffer(tracked.stdout)) return false;
    const entries = tracked.stdout.toString('utf8');
    if (!Buffer.from(entries, 'utf8').equals(tracked.stdout) || (entries && !entries.endsWith('\0'))) return false;
    const paths = entries.split('\0').filter(Boolean);
    if (!paths.includes(source)) return false;
    const sourceFile = safePath(repository, source, { mustExist: true }), sourceInfo = stat(sourceFile);
    if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size > 10 * 1024 * 1024) return false;
    const indexed = queryGit(repository, ['--literal-pathspecs', 'ls-files', '--stage', '--full-name', '-z', '--', source], { encoding: null });
    if (indexed.error || indexed.signal || indexed.status !== 0 || !Buffer.isBuffer(indexed.stdout)) return false;
    const indexText = indexed.stdout.toString('utf8');
    if (!Buffer.from(indexText, 'utf8').equals(indexed.stdout)) return false;
    const match = /^(100644|100755) ([a-f0-9]{40}|[a-f0-9]{64}) 0\t([^\0]+)\0$/.exec(indexText);
    if (!match || match[3] !== source) return false;
    const blob = queryGit(repository, ['cat-file', 'blob', match[2]], { encoding: null });
    if (blob.error || blob.signal || blob.status !== 0 || !Buffer.isBuffer(blob.stdout)
      || !readStable(repository, sourceFile).equals(blob.stdout)) return false;
    return !paths.some(path => mayAliasIndexPath(path, candidate, { root: repository }));
  } catch { return false; }
}

export function snapshotSources(root, target, destination, { maxFiles = 20000, maxFileBytes = 10 * 1024 * 1024, maxTotalBytes = 256 * 1024 * 1024 } = {}) {
  const files = [], entries = [], excluded = []; let bytes = 0;
  const walk = (folder, prefix = '') => {
    for (const name of readdirSync(folder).sort()) {
      const key = prefix ? `${prefix}/${name}` : name, source = join(folder, name), info = lstatSync(source);
      entries.push({ path: key, type: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'special', mode: info.mode,
        ...(info.isSymbolicLink() ? { target: readlinkSync(source) } : {}) });
      if (info.isSymbolicLink()) { excluded.push({ path: key, reason: 'symbolic-link' }); continue; }
      if (info.isDirectory()) {
        if (untrackedIgnoredExamples(root, source)) { excluded.push({ path: key, reason: 'ignored-generated-examples' }); continue; }
        if (discardedDirectories.has(name.toLowerCase()) || /^\.playwright/i.test(name)) { excluded.push({ path: key, reason: 'generated-directory' }); continue; }
        walk(source, key); continue;
      }
      if (!info.isFile()) { excluded.push({ path: key, reason: 'special-file' }); continue; }
      if (scannerConfiguration.has(name.toLowerCase())) { excluded.push({ path: key, reason: 'scanner-configuration-overridden' }); continue; }
      if (info.size > maxFileBytes || files.length >= maxFiles || bytes + info.size > maxTotalBytes) fail('Escopo excede os limites de leitura; reduza --target.');
      const data = readStable(root, source);
      if (data.subarray(0, 8192).includes(0)) { excluded.push({ path: key, reason: 'binary-file' }); continue; }
      if (destination) {
        const output = join(destination, key);
        mkdirSafe(root, dirname(output)); writeFileSync(output, data, { flag: 'wx', mode: 0o600 });
      }
      files.push({ path: key, sha256: digest(data), source }); bytes += data.length;
    }
  };
  walk(target);
  return { files, entries, excluded, bytes };
}

function inventoryDigest(inventory) {
  return digest(JSON.stringify({ entries: inventory.entries, files: inventory.files.map(({ path, sha256 }) => ({ path, sha256 })), excluded: inventory.excluded, bytes: inventory.bytes }));
}

function findingPath(value, base) {
  if (typeof value !== 'string' || /[\x00-\x1f]/.test(value)) fail('Caminho de achado invalido.');
  const path = isAbsolute(value) ? relative(base, value) : value;
  const normalized = portable(path).replace(/^\.\//, '');
  if (!normalized || normalized.split('/').some(part => part === '..' || part === '.') || normalized.includes('\\')) fail('Achado aponta para fora do escopo.');
  return normalized;
}

function readReport(root, file) {
  safePath(root, file, { mustExist: true });
  const info = lstatSync(file);
  if (!info.isFile() || info.size > 32 * 1024 * 1024) fail('Relatorio bruto invalido ou grande demais.');
  return parseJson(readFileSync(file, 'utf8'));
}

function finding(tool, rule, path, line, severity, message, extra = {}) {
  rule = identifier(rule);
  return { tool, rule, path, line: Number.isInteger(line) && line > 0 ? line : null,
    severity: ['high', 'medium', 'low', 'info'].includes(severity) ? severity : 'medium', message,
    fingerprint: digest(`${tool}:${rule}:${path}:${line || ''}`), ...extra };
}

export function parseGitleaks(value, status, base, files = 0) {
  if (!Array.isArray(value) || ![0, 1].includes(status)) fail('Gitleaks nao concluiu uma analise valida.');
  if (status === 1 && !value.length) fail('Gitleaks falhou sem achados verificaveis.');
  const findings = value.map(item => {
    if (!item || typeof item.RuleID !== 'string' || typeof item.File !== 'string') fail('Resultado Gitleaks incompleto.');
    return finding('gitleaks', item.RuleID, findingPath(item.File, base), item.StartLine, 'high', 'Possivel segredo; confirmar contexto e necessidade de revogacao.');
  });
  return { status: findings.length ? 'findings' : files ? 'passed' : 'not-applicable', findings, scannedFiles: files };
}

export function parseOsv(value, status, base) {
  if (![0, 1, 128].includes(status) || !value || !Array.isArray(value.results)) fail('OSV nao concluiu uma analise valida.');
  const findings = []; let packages = 0;
  for (const result of value.results) {
    if (!result?.source || !Array.isArray(result.packages)) fail('Resultado OSV incompleto.');
    const path = findingPath(result.source.path, base);
    for (const item of result.packages) {
      packages++;
      if (!item.package || !Array.isArray(item.vulnerabilities || [])) fail('Pacote OSV incompleto.');
      for (const vulnerability of item.vulnerabilities || []) {
        if (typeof vulnerability.id !== 'string') fail('Vulnerabilidade OSV sem identificador.');
        findings.push(finding('osv-scanner', vulnerability.id, path, null, 'medium', 'Dependencia com vulnerabilidade conhecida.',
          { package: identifier(item.package.name), version: identifier(item.package.version), ecosystem: identifier(item.package.ecosystem) }));
      }
    }
  }
  if (status === 128 && packages || status === 1 && !findings.length) fail('Saida OSV inconsistente.');
  return { status: findings.length ? 'findings' : packages ? 'passed' : 'not-applicable', findings, scannedPackages: packages };
}

export function parseOpengrep(value, status, base) {
  if (!value || !Array.isArray(value.results) || !Array.isArray(value.errors) || ![0, 1].includes(status)) fail('Opengrep nao concluiu uma analise valida.');
  if (value.errors.length) fail('Opengrep relatou erros de analise.');
  if (!Array.isArray(value.paths?.scanned)) fail('Opengrep nao confirmou os arquivos analisados.');
  const findings = value.results.map(item => {
    if (typeof item?.check_id !== 'string' || typeof item.path !== 'string') fail('Resultado Opengrep incompleto.');
    // Opengrep prefixes local rule IDs with the dotted absolute config path.
    const rule = item.check_id.slice(item.check_id.lastIndexOf('.') + 1);
    if (!opengrepRules.has(rule)) fail('Identificador de regra Opengrep desconhecido.');
    return finding('opengrep', rule, findingPath(item.path, base), item.start?.line,
      item.extra?.severity === 'ERROR' ? 'high' : 'medium', 'Padrao de codigo exige revisao de seguranca.');
  });
  if (status === 1 && !findings.length) fail('Opengrep falhou sem achados verificaveis.');
  return { status: findings.length ? 'findings' : value.paths.scanned.length ? 'passed' : 'not-applicable', findings, scannedFiles: value.paths.scanned.length };
}

export function databaseCache(manager) {
  const entry = manager.entry('osv-scanner'), where = entry.envPaths?.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY;
  if (typeof where !== 'string' || !where) fail('Cache OSV nao configurado.');
  return safePath(manager.root, join(manager.local('osv-scanner'), where), { directory: true });
}

export function verifyDatabase(root, cache, ecosystem) {
  if (!ecosystemNames.includes(ecosystem)) fail('Ecossistema OSV nao autorizado.');
  const folder = safePath(root, join(cache, 'osv-scalibr', ecosystem), { directory: true });
  const archive = safePath(root, join(folder, 'all.zip'), { mustExist: true });
  const receiptPath = safePath(root, join(folder, 'DATABASE.json'), { mustExist: true });
  const receipt = parseJson(readFileSync(receiptPath, 'utf8'));
  const bytes = readFileSync(archive);
  if (receipt.ecosystem !== ecosystem || receipt.source !== `https://osv-vulnerabilities.storage.googleapis.com/${encodeURIComponent(ecosystem)}/all.zip`
    || receipt.sha256 !== digest(bytes) || receipt.bytes !== bytes.length) fail('Base OSV ausente, alterada ou sem recibo; execute update-data.');
  const validation = receipt.validation?.format === 'osv-zip-v1' ? receipt.validation : validateOsvDatabase(bytes);
  return { ecosystem, sha256: receipt.sha256, bytes: receipt.bytes, downloadedAt: receipt.downloadedAt, validation };
}

export function detectEcosystems(files) {
  const detected = new Set();
  for (const file of files) {
    const name = file.path.split('/').at(-1).toLowerCase();
    if (['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'].includes(name)) detected.add('npm');
    if (name === 'go.sum' || name === 'go.mod') detected.add('Go');
    if (['requirements.txt', 'poetry.lock', 'uv.lock', 'pipfile.lock', 'pdm.lock'].includes(name)) detected.add('PyPI');
    if (['pom.xml', 'gradle.lockfile'].includes(name)) detected.add('Maven');
    if (['packages.lock.json', 'packages.config'].includes(name)) detected.add('NuGet');
    if (name === 'composer.lock') detected.add('Packagist');
    if (name === 'cargo.lock') detected.add('crates.io');
    if (name === 'gemfile.lock') detected.add('RubyGems');
    if (name === 'mix.lock') detected.add('Hex');
    if (name === 'pubspec.lock') detected.add('Pub');
    if (name === 'conan.lock') detected.add('Conan');
    if (/^.*\.cabal$/.test(name)) detected.add('Hackage');
  }
  return [...detected].sort();
}

async function downloadDatabase(root, cache, ecosystem, fetcher) {
  const source = `https://osv-vulnerabilities.storage.googleapis.com/${encodeURIComponent(ecosystem)}/all.zip`;
  const response = await fetcher(source, { redirect: 'error', credentials: 'omit', headers: { Accept: 'application/zip' }, signal: AbortSignal.timeout(120000) });
  if (response.status !== 200 || !response.body) fail('Download da base OSV falhou.');
  const limit = 512 * 1024 * 1024, declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) fail('Base OSV excede o limite de download.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > limit) fail('Base OSV excede o limite de download.'); chunks.push(Buffer.from(next.value)); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  const validation = validateOsvDatabase(bytes);
  const folder = mkdirSafe(root, join(cache, 'osv-scalibr', ecosystem));
  const target = safePath(root, join(folder, 'all.zip')), receipt = safePath(root, join(folder, 'DATABASE.json'));
  for (const path of [target, receipt]) if (stat(path) && !stat(path).isFile()) fail('Estado da base OSV invalido.');
  const token = randomUUID(), staged = join(folder, `.all-${token}.zip`), stagedReceipt = join(folder, `.DATABASE-${token}.json`);
  const previous = `${target}.previous-${token}`, previousReceipt = `${receipt}.previous-${token}`;
  const data = { schemaVersion: 1, ecosystem, source, sha256: digest(bytes), bytes: bytes.length, downloadedAt: new Date().toISOString(), validation,
    integrity: 'HTTPS oficial e SHA256 local; nao e assinatura do publicador.' };
  let moved = false, movedReceipt = false, promoted = false;
  try {
    writeFileSync(staged, bytes, { flag: 'wx', mode: 0o600 }); writeFileSync(stagedReceipt, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (existsSync(target)) { renameSync(target, previous); moved = true; }
    if (existsSync(receipt)) { renameSync(receipt, previousReceipt); movedReceipt = true; }
    renameSync(staged, target); promoted = true; renameSync(stagedReceipt, receipt);
    try { rmSync(previous, { force: true }); } catch { /* Old version ignored can be cleaned later. */ }
    try { rmSync(previousReceipt, { force: true }); } catch { /* Nao desfazer a promocao por falha de limpeza. */ }
    return data;
  } catch (error) {
    if (promoted) rmSync(target, { force: true });
    if (moved) renameSync(previous, target);
    if (movedReceipt) { rmSync(receipt, { force: true }); renameSync(previousReceipt, receipt); }
    throw error;
  } finally { rmSync(staged, { force: true }); rmSync(stagedReceipt, { force: true }); }
}

export class SecurityAudit {
  constructor({ root = projectRoot, manager, execute = spawnSync, fetcher = fetch, snapshot = snapshotSources } = {}) {
    requireNode(); this.root = realpathSync(root); this.manager = manager || new ToolManager({ root: this.root });
    this.execute = execute; this.fetcher = fetcher; this.snapshot = snapshot;
  }
  check(selected = Object.keys(checks)) {
    if (!Array.isArray(selected) || !selected.length || selected.some(name => !Object.hasOwn(checks, name))) fail('Selecao de checks invalida.');
    const results = selected.map(name => {
      try { const info = this.manager.check(checks[name]); return { check: name, tool: checks[name], status: 'passed', version: info.version }; }
      catch { return { check: name, tool: checks[name], status: 'not-run', reason: 'Ferramenta ausente ou invalida; execute preparar-ferramentas setup security.' }; }
    });
    return { status: results.some(item => item.status !== 'passed') ? 'incomplete' : 'passed', scope: 'installed-tools', analysisPerformed: false, offline: true, results, exitCode: results.some(item => item.status !== 'passed') ? 2 : 0 };
  }
  invoke(name, args, cwd) {
    const script = safePath(this.root, `.pbai4devs/tools/${name}/SCRIPT.mjs`, { mustExist: true });
    const result = this.execute(process.execPath, [script, 'run', ...args], { cwd, env: sanitizedEnvironment(), encoding: 'utf8',
      timeout: 180000, maxBuffer: 32 * 1024 * 1024, shell: false, windowsHide: true });
    if (!result || result.error || result.signal || !Number.isInteger(result.status)) fail('Ferramenta interrompida ou indisponivel.');
    return result;
  }
  async updateData(selected) {
    this.manager.check('osv-scanner'); const cache = databaseCache(this.manager);
    if (!Array.isArray(selected) || !selected.length || selected.some(name => !ecosystemNames.includes(name))) fail('Selecione ecossistemas OSV validos.');
    return this.manager.withLock('osv-scanner', async () => {
      mkdirSafe(this.root, cache); const results = [];
      for (const ecosystem of selected) results.push(await downloadDatabase(this.root, cache, ecosystem, this.fetcher));
      return { status: 'passed', mode: 'update-data', analysisPerformed: false, results, exitCode: 0 };
    });
  }
  async run(options = {}) {
    const selected = options.checks || Object.keys(checks), target = safePath(this.root, options.target || '.', { directory: true, mustExist: true });
    if (!Array.isArray(selected) || !selected.length || selected.some(name => !Object.hasOwn(checks, name))) fail('Selecao de checks invalida.');
    const workBasePath = resolve(this.root, '.agent-tests/security');
    const contains = (parent, child) => { const part = relative(parent, child); return !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`); };
    if (target !== this.root && (contains(target, workBasePath) || contains(workBasePath, target))) fail('Target conflita com a pasta reservada de evidencias.');
    if (options.includeHistory) {
      const git = queryGit(target, ['rev-parse', '--show-toplevel']);
      const top = gitPath(git);
      if (top === null || realpathSync(top) !== target) fail('Historico exige --target na raiz do repositorio Git.');
    }
    const execution = `${new Date().toISOString().replace(/[^a-z0-9]/gi, '').toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const output = safePath(this.root, options.output || `.agent-tests/security/${execution}/report.json`);
    if (!output.endsWith('.json')) fail('Relatorio exige extensao .json.');
    const work = join(workBasePath, `.work-${randomUUID()}`);
    assertIgnored(this.root, output, work); if (stat(output)) fail('Relatorio ja existe; escolha outra execucao.');
    mkdirSafe(this.root, workBasePath);
    mkdirSync(work, { mode: 0o700 }); const source = mkdirSafe(this.root, join(work, 'source'));
    const createdWork = lstatSync(work), canonicalWork = realpathSync(work);
    const assertWork = () => {
      try {
        safePath(this.root, work, { directory: true, mustExist: true });
        const current = lstatSync(work);
        if (current.isDirectory() && !current.isSymbolicLink() && current.dev === createdWork.dev && current.ino === createdWork.ino && realpathSync(work) === canonicalWork) return;
      } catch { /* A removed, replaced or symbolic path is not ours to delete. */ }
      fail('Pasta temporaria da auditoria foi alterada; conteudo preservado para revisao.');
    };
    const invoke = (...args) => { assertWork(); const result = this.invoke(...args); assertWork(); return result; };
    const report = { schemaVersion: 1, mode: 'run', status: 'incomplete', target: portable(relative(this.root, target)) || '.',
      offline: true, execution, generatedAt: new Date().toISOString(), checks: [], findings: [], coverage: null,
      limits: ['Analise do snapshot de arquivos de texto; binarios, links e diretorios gerados nao sao varridos.',
        'Regras SAST proprias cobrem padroes JS/TS selecionados. Scanner nao comprova autorizacao, RLS, regras Firebase ou seguranca total.'] };
    try {
      const inventory = this.snapshot(this.root, target, source);
      assertWork();
      report.coverage = { files: inventory.files.length, bytes: inventory.bytes, excluded: inventory.excluded,
        sourceDigest: digest(inventory.files.map(file => `${file.path}:${file.sha256}`).join('\n')), inventoryDigest: inventoryDigest(inventory) };
      for (const name of selected) {
        assertWork();
        const tool = checks[name]; let version;
        try {
          version = this.manager.check(tool).version;
          let parsed;
          if (name === 'secrets') {
            const file = join(work, 'gitleaks.json');
            const config = join(work, 'gitleaks.toml'); writeFileSync(config, '[extend]\nuseDefault = true\n', { mode: 0o600 });
            const result = invoke(tool, ['dir', source, '--config', config, '--report-format=json', `--report-path=${file}`, '--redact=100', '--no-banner', '--no-color', '--log-level=error', '--ignore-gitleaks-allow', '--timeout=150'], work);
            if (!stat(file)?.isFile()) fail('Gitleaks nao confirmou o relatorio.');
            parsed = parseGitleaks(readReport(this.root, file), result.status, source, inventory.files.length);
            if (options.includeHistory) {
              const file = join(work, 'history.json');
              const result = invoke(tool, ['git', target, '--config', config, '--report-format=json', `--report-path=${file}`, '--redact=100', '--no-banner', '--no-color', '--log-level=error', '--ignore-gitleaks-allow', '--timeout=150', '--log-opts=--all --no-ext-diff --no-textconv'], work);
              if (!stat(file)?.isFile()) fail('Gitleaks nao confirmou o historico.');
              const history = parseGitleaks(readReport(this.root, file), result.status, target, 1);
              parsed.findings.push(...history.findings.map(item => ({ ...item, scope: 'git-history' })));
              parsed.status = parsed.findings.length ? 'findings' : parsed.status;
            }
          } else if (name === 'dependencies') {
            const needed = detectEcosystems(inventory.files);
            if (!needed.length) { parsed = { status: 'not-applicable', findings: [], reason: 'Nenhum lockfile ou manifesto reconhecido neste escopo.' }; }
            else {
              const cache = databaseCache(this.manager); let databases;
              try { databases = needed.map(ecosystem => verifyDatabase(this.root, cache, ecosystem)); }
              catch { fail('Base OSV ausente ou alterada; execute update-data para os ecossistemas do projeto.'); }
              const config = join(work, 'osv.toml'), file = join(work, 'osv.json'); writeFileSync(config, '', { mode: 0o600 });
              const result = invoke(tool, ['scan', 'source', '--offline', '--no-resolve', '--no-ignore', '--x-no-default-plugins', '--x-plugins=lockfile,sbom', '--all-packages', '--format=json', `--output-file=${file}`, `--config=${config}`, '-r', source], work);
              if (result.status === 128 && !stat(file)) parsed = { status: 'not-applicable', findings: [], scannedPackages: 0,
                reason: 'OSV nao encontrou pacotes analisaveis no escopo.', databases };
              else {
                if (!stat(file)?.isFile()) fail('OSV nao confirmou o relatorio.');
                parsed = { ...parseOsv(readReport(this.root, file), result.status, source), databases };
              }
              for (const database of databases) if (verifyDatabase(this.root, cache, database.ecosystem).sha256 !== database.sha256) fail('Base OSV mudou durante a analise.');
            }
          } else {
            const rule = safePath(this.root, '.pbai4devs/scripts/auditar-seguranca/rules/javascript.yml', { mustExist: true });
            const result = invoke(tool, ['--disable-version-check', '--no-git-ignore', '--disable-nosem', '--config', rule, '--json', '--error', '--quiet', '--jobs=2', source], work);
            parsed = parseOpengrep(parseJson(result.stdout), result.status, source);
          }
          if (parsed.status === 'not-applicable' && !parsed.reason) parsed.reason = 'Nenhum arquivo ou pacote aplicavel foi confirmado neste escopo.';
          report.checks.push({ check: name, tool, version, ...parsed, findings: parsed.findings.length }); report.findings.push(...parsed.findings);
        } catch (error) { report.checks.push({ check: name, tool, ...(version ? { version } : {}), status: 'not-run', reason: error.publicMessage || 'Analise incompleta. Confira ferramenta, base local e formatos suportados; nenhuma aprovacao foi emitida.' }); }
        assertWork();
      }
      const finalInventory = this.snapshot(this.root, target, null);
      assertWork();
      if (inventoryDigest(finalInventory) !== inventoryDigest(inventory)) fail('Inventario ou fontes mudaram durante a analise.');
      report.status = report.checks.some(check => check.status === 'not-run') ? 'incomplete' : report.findings.length ? 'findings'
        : report.checks.some(check => check.status === 'passed') ? 'passed' : 'not-applicable';
    } catch (error) { report.status = 'incomplete'; report.error = error.publicMessage || 'Nao foi possivel concluir o snapshot ou confirmar fontes estaveis.'; }
    // This identity check limits accidental deletion; it cannot make the
    // following recursive removal atomic against another local process.
    finally { assertWork(); rmSync(work, { recursive: true, force: true }); }
    report.exitCode = report.status === 'incomplete' ? 2 : report.status === 'findings' ? 1 : 0;
    assertIgnored(this.root, output, work);
    mkdirSafe(this.root, dirname(output)); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return { ...report, report: portable(relative(this.root, output)) };
  }
}

const help = 'Uso: run [--checks secrets,dependencies,sast] [--target .] [--include-history] [--output .agent-tests/.../report.json]; check [--checks ...]; update-data --ecosystems npm,Go';
export async function main(args = process.argv.slice(2), options = {}) {
  const parsed = parseArgs(args); if (parsed.command === 'help') { console.log(help); return 0; }
  const audit = options.audit || new SecurityAudit(options);
  const result = parsed.command === 'run' ? await audit.run(parsed) : parsed.command === 'check' ? audit.check(parsed.checks) : await audit.updateData(parsed.ecosystems);
  const summary = parsed.command === 'run' ? { status: result.status, report: result.report, offline: true, findings: result.findings.length, checks: result.checks, exitCode: result.exitCode } : result;
  console.log(JSON.stringify(summary)); return result.exitCode;
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(error => { console.error(JSON.stringify({ status: 'incomplete', message: error.publicMessage || 'Falha no comando de seguranca; confira argumentos, caminhos e pre-requisitos.', exitCode: 2 })); process.exitCode = 2; });
