#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { get } from 'node:https';
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { findExecutable, isSupportedNodeVersion, projectRoot, windowsNode24Minimum } from '../lib/runtime.mjs';
import { npmCandidates } from '../lib/npm.mjs';

const versionPattern = /^\d+\.\d+\.\d+$/;
const stat = path => { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const failure = message => { throw new Error(message); };
const contaminated = () => failure('Nao foi possivel validar Node/npm: resposta invalida ou contaminada. Revise os preloads do ambiente.');
const failedVerification = () => failure('Nao foi possivel validar Node/npm: verificacao falhou ou foi interrompida. Revise as configuracoes do ambiente.');
function checkProbeFailure(diagnostics) {
  if (diagnostics.invalidProbe) contaminated();
  if (diagnostics.failedProbe) failedVerification();
}
const runtimeProbe = "require('node:fs').writeSync(3, JSON.stringify({version:process.versions.node,node:process.execPath,bun:Boolean(process.versions.bun)}))";
const directRuntimeProbe = 'JSON.stringify({version:process.versions.node,node:process.execPath,bun:Boolean(process.versions.bun)})';
// The bookmark separates messages prior to npm execution without changing your stdout.
function npmProbe(marker) {
  return `const f=require('node:fs');f.writeSync(1,${JSON.stringify(marker)});const i=process.execArgv.findIndex((v,j)=>v==='-e'&&process.execArgv[j+1]===process._eval);if(i>=0)process.execArgv.splice(i,2);require('node:module').runMain()`;
}
const probeOptions = { encoding: 'utf8', timeout: 20000, maxBuffer: 65536, stdio: ['ignore', 'ignore', 'ignore', 'pipe'] };
const directProbeOptions = { encoding: 'utf8', timeout: 20000 };
const instrumentedNpmProbeOptions = { ...directProbeOptions, maxBuffer: 65536 };
function usesNodeOptions(environment, platform) {
  // In Windows, spamn orders and deduplicates keys without differentiating capitals.
  const key = platform === 'win32'
    ? Object.keys(environment).sort().find(name => name.toUpperCase() === 'NODE_OPTIONS')
    : 'NODE_OPTIONS';
  return Boolean(key && String(environment[key] ?? '').trim());
}

function safePath(root, parts) {
  let path = root;
  for (const part of parts) {
    if (!part || part === '..' || part.includes('/') || part.includes('\\')) failure('Caminho de runtime invalido.');
    path = join(path, part);
    if (stat(path)?.isSymbolicLink()) failure(`Cache nao pode ser link simbolico: ${path}`);
  }
  return path;
}

export function environmentWithNode(environment, node) {
  const result = { ...environment };
  const key = Object.keys(result).find(key => key.toLowerCase() === 'path') || 'PATH';
  result[key] = `${dirname(node)}${delimiter}${result[key] || ''}`;
  return result;
}

export async function downloadOfficial(url, destination) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'nodejs.org' || parsed.username || parsed.password) failure('Origem de runtime nao autorizada.');
  const response = await new Promise((accept, reject) => {
    const request = get(parsed, accept);
    request.on('error', reject);
    request.setTimeout(300000, () => request.destroy(new Error('Tempo limite no download do Node.')));
  });
  if (response.statusCode !== 200) { response.resume(); failure(`Download do Node falhou: HTTP ${response.statusCode}`); }
  let size = 0;
  response.on('data', chunk => { size += chunk.length; if (size > 150 * 1024 * 1024) response.destroy(new Error('Download do Node excedeu o limite.')); });
  await pipeline(response, createWriteStream(destination, { flags: 'wx' }));
}

function probe(node, minimum, run, environment, diagnostics, platform) {
  const instrumented = usesNodeOptions(environment, platform);
  const result = run(node, instrumented ? ['-e', runtimeProbe] : ['-p', directRuntimeProbe],
    { ...(instrumented ? probeOptions : directProbeOptions), env: environment });
  if (result.error || result.status !== 0) {
    if (result.error?.code !== 'ENOENT' && (result.error || result.signal || stat(node))) diagnostics.failedProbe = true;
    return null;
  }
  try {
    const info = JSON.parse(instrumented ? result.output?.[3] : result.stdout);
    if (!info || typeof info !== 'object' || typeof info.node !== 'string' ||
        typeof info.bun !== 'boolean' || !versionPattern.test(info.version) ||
        realpathSync(info.node) !== realpathSync(node)) throw new Error('invalid probe');
    return !info.bun && isSupportedNodeVersion(info.version, minimum, platform) ? info : null;
  } catch { diagnostics.invalidProbe = true; return null; }
}

function npmFor(node, run, environment, platform, diagnostics, localOnly = false) {
  const candidates = localOnly ? [join(dirname(node), 'node_modules/npm/bin/npm-cli.js'), join(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js')] : npmCandidates({ node, environment });
  for (const candidate of candidates) {
    if (!candidate || !candidate.endsWith('npm-cli.js') || !stat(candidate)?.isFile()) continue;
    if (localOnly) {
      const base = platform === 'win32' ? dirname(node) : resolve(dirname(node), '..');
      const path = relative(base, candidate);
      if (path.startsWith('..') || path.includes(`..${sep}`)) continue;
      safePath(base, path.split(sep));
    }
    const file = realpathSync(candidate);
    const instrumented = usesNodeOptions(environment, platform);
    const marker = instrumented ? `\0ADK_NPM_${randomBytes(24).toString('hex')}\0` : null;
    const result = run(node, instrumented ? ['-e', npmProbe(marker), file, '--version'] : [file, '--version'],
      { ...(instrumented ? instrumentedNpmProbeOptions : directProbeOptions), env: environmentWithNode(environment, node) });
    if (!result.error && result.status === 0) {
      let output = result.stdout;
      if (instrumented) {
        const start = output?.indexOf(marker) ?? -1;
        if (start < 0 || start !== output.lastIndexOf(marker)) { diagnostics.invalidProbe = true; continue; }
        output = output.slice(start + marker.length);
      }
      if (/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(output?.trim() || '')) return file;
      diagnostics.invalidProbe = true;
    } else if (result.error?.code !== 'ENOENT') diagnostics.failedProbe = true;
  }
  return null;
}

function platformName(platform, arch, run, environment, libc) {
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) failure('Node local suporta Windows, macOS e Linux x64/arm64.');
  if (platform === 'win32') return `win-${arch}`;
  if (platform === 'darwin') return `darwin-${arch}`;
  if (!libc) {
    if (process.report?.getReport().header.glibcVersionRuntime) libc = 'glibc';
    else {
      const result = run('ldd', ['--version'], { encoding: 'utf8', timeout: 10000, env: environment });
      const text = `${result.stdout || ''}\n${result.stderr || ''}`;
      libc = /musl/i.test(text) ? 'musl' : /glibc|gnu/i.test(text) ? 'glibc' : null;
    }
  }
  if (!['glibc', 'musl'].includes(libc)) failure('Nao foi possivel identificar glibc/musl.');
  return `linux-${arch}${libc === 'musl' ? '-musl' : ''}`;
}

export function validateArchive(members, top) {
  if (!members.trim()) failure('Arquivo vazio.');
  for (const name of members.trimEnd().split(/\r?\n/)) {
    if (/[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith('/') || name.split('/').includes('..') || (name !== top && name !== top + '/' && !name.startsWith(top + '/'))) failure('Arquivo contem caminho fora da distribuicao.');
  }
}

export function validateExtracted(root) {
  const base = realpathSync(root);
  function inside(path) { const value = relative(base, path); return value !== '..' && !value.startsWith('..' + sep) && !isAbsolute(value); }
  function visit(directory) {
    for (const name of readdirSync(directory)) {
      const file = join(directory, name), info = lstatSync(file);
      if (info.isSymbolicLink()) {
        const target = readlinkSync(file);
        if (isAbsolute(target) || !inside(resolve(directory, target)) || !inside(realpathSync(file))) failure('Arquivo contem link fora da distribuicao.');
      } else if (info.isDirectory()) visit(file);
      else if (!info.isFile() || info.nlink > 1) failure('Arquivo contem tipo ou hardlink inseguro.');
    }
  }
  visit(base);
}

export async function ensureRuntime({ root = projectRoot, minimum = 24, node = process.execPath, platform = process.platform, arch = process.arch, libc, run = spawnSync, download = downloadOfficial, environment = process.env, allowDownload = true, searchPath = false } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 18) failure('O inicializador requer Node.js 18+; instale Node.js 24+ pelo gerenciador do SO.');
  root = realpathSync(root);
  const diagnostics = { invalidProbe: false, failedProbe: false };
  const current = probe(node, minimum, run, environment, diagnostics, platform);
  if (current) {
    const npm = npmFor(current.node, run, environment, platform, diagnostics);
    if (npm) return { node: current.node, npm, version: current.version, source: 'current' };
  }
  if (searchPath) {
    const executable = findExecutable('node', environment, platform);
    const found = executable && probe(executable, minimum, run, environment, diagnostics, platform);
    const npm = found && npmFor(found.node, run, environment, platform, diagnostics);
    if (found && npm) return { node: found.node, npm, version: found.version, source: 'path' };
  }
  let targetPlatform;
  try { targetPlatform = platformName(platform, arch, run, environment, libc); }
  catch (error) { checkProbeFailure(diagnostics); throw error; }
  const cache = safePath(root, ['.pbai4devs', 'tools', '.cache', 'runtime', 'node', targetPlatform]);
  if (stat(cache) && !stat(cache).isDirectory()) failure('Cache de runtime nao e diretorio.');
  if (existsSync(cache)) for (const version of readdirSync(cache).filter(name => /^v24\.\d+\.\d+$/.test(name)).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))) {
    const base = safePath(cache, [version]);
    const executable = safePath(base, platform === 'win32' ? ['node.exe'] : ['bin', 'node']);
    const found = probe(executable, minimum, run, environment, diagnostics, platform);
    if (found) { const npm = npmFor(executable, run, environment, platform, diagnostics, true); if (npm) return { node: executable, npm, version: found.version, source: 'cache' }; }
  }
  checkProbeFailure(diagnostics);
  const windows = platform === 'win32' ? ` No Windows, use Node.js LTS ${windowsNode24Minimum}+ ou 26+.` : '';
  if (!allowDownload) failure(`Node.js 24+ e npm nao encontrados; prepare o runtime antes de continuar.${windows}`);
  if (process.platform === 'win32' && Number(process.versions.node.split('.')[0]) >= 23 && !isSupportedNodeVersion(process.versions.node)) {
    // Installing a replacement from this process would use its affected rmSync.
    failure(`Atualize o Node.js pelo gerenciador do sistema para a versão LTS ${windowsNode24Minimum}+ ou 26+.`);
  }
  const tar = findExecutable('tar', environment, platform);
  if (!tar) failure('Instale tar pelo gerenciador do SO para extrair o Node local.');
  mkdirSync(cache, { recursive: true });
  const stage = mkdtempSync(join(cache, '.stage.')); let backup, target;
  const cleanup = () => {
    if (backup && existsSync(backup) && !existsSync(target)) renameSync(backup, target);
    rmSync(stage, { recursive: true, force: true });
  };
  const onInt = () => { cleanup(); process.exit(130); }, onTerm = () => { cleanup(); process.exit(143); };
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  try {
    const manifest = join(stage, 'SHASUMS256.txt');
    await download('https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt', manifest);
    const extension = platform === 'win32' ? 'zip' : 'tar.gz';
    const candidates = readFileSync(manifest, 'utf8').split(/\r?\n/).map(line => line.match(/^([a-f0-9]{64})\s+(node-v24\.\d+\.\d+-[^\s]+)$/i)).filter(match => match && match[2].endsWith(`-${targetPlatform}.${extension}`));
    if (candidates.length !== 1) failure(`Distribuicao oficial Node 24 indisponivel para ${targetPlatform}.`);
    const [, expected, filename] = candidates[0], archive = join(stage, filename);
    await download(`https://nodejs.org/dist/${filename.match(/^node-(v24\.\d+\.\d+)-/)[1]}/${filename}`, archive);
    const hash = createHash('sha256'); for await (const chunk of createReadStream(archive)) hash.update(chunk);
    if (hash.digest('hex') !== expected.toLowerCase()) failure('SHA-256 divergente; arquivo recusado.');
    const list = args => {
      const result = run(tar, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: environment });
      if (result.error || result.status !== 0) failure(`tar falhou: ${result.error?.message || result.stderr || result.status}`);
      return result.stdout;
    };
    const top = filename.slice(0, -extension.length - 1);
    validateArchive(list(['-tf', archive]), top);
    const unpack = join(stage, 'unpack'); mkdirSync(unpack);
    list(['-xf', archive, '-C', unpack]);
    validateExtracted(unpack);
    const installation = safePath(unpack, [top]);
    const executable = safePath(installation, platform === 'win32' ? ['node.exe'] : ['bin', 'node']);
    const found = probe(executable, minimum, run, environment, diagnostics, platform);
    const npm = found && npmFor(executable, run, environment, platform, diagnostics, true);
    if (!found || !npm) failure('Node/npm extraidos falharam na verificacao.');
    const version = filename.match(/^node-(v24\.\d+\.\d+)-/)[1]; target = safePath(cache, [version]);
    if (existsSync(target)) { backup = join(stage, 'previous'); renameSync(target, backup); }
    renameSync(installation, target);
    return { node: join(target, relative(installation, executable)), npm: join(target, relative(installation, npm)), version: found.version, source: 'download' };
  } finally { process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); cleanup(); }
}

export async function main(args = process.argv.slice(2), options = {}) {
  const runtimeOnly = args[0] === '--runtime-only';
  const execute = args[0] === '--executar';
  const selected = execute ? args.slice(1) : [];
  let plan = false, noInstall = false, raw = false;
  while (execute && ['--plan', '--no-install', '--raw'].includes(selected[0])) {
    if (selected[0] === '--plan') { if (plan) failure('--plan duplicado.'); plan = true; }
    else if (selected[0] === '--no-install') { if (noInstall) failure('--no-install duplicado.'); noInstall = true; }
    else { if (raw) failure('--raw duplicado.'); raw = true; }
    selected.shift();
  }
  if (runtimeOnly && args.length !== 1) failure('--runtime-only nao aceita selecao ou outros argumentos.');
  if (execute && !selected[0]) failure('Use --executar [--no-install] [--plan] [--raw] <nome-ou-caminho> [argumentos].');
  if (!runtimeOnly && !execute && args.some(arg => arg.startsWith('-'))) failure('Use --runtime-only ou uma selecao de ferramentas.');
  if (execute && ['--help', '-h'].includes(selected[0])) {
    (raw ? process.stderr : process.stdout).write('Uso: --executar [--no-install] [--plan] [--raw] <nome-ou-caminho> [argumentos]\n');
    return 0;
  }
  if (execute) {
    const { resolveScript } = await import('../executar-script/SCRIPT.mjs');
    resolveScript(selected[0], { root: options.root || projectRoot });
  }
  const runtime = await ensureRuntime({ ...options, allowDownload: !plan && !noInstall, searchPath: execute });
  (raw ? process.stderr : process.stdout).write(`node=${runtime.node}\n`);
  if (runtimeOnly) return 0;
  if (execute) {
    const run = options.run || spawnSync;
    const root = options.root || projectRoot;
    const env = environmentWithNode(options.environment || process.env, runtime.node);
    const processOptions = { stdio: 'inherit', env, cwd: root, windowsHide: true };
    if (!plan) {
      const diagnostic = run(runtime.node, [join(root, '.pbai4devs/scripts/diagnosticar-ambiente/SCRIPT.mjs')], raw ? { ...processOptions, stdio: ['inherit', 2, 'inherit'] } : processOptions);
      if (diagnostic.error) throw diagnostic.error;
      if (diagnostic.status !== 0) return diagnostic.status ?? 1;
    }
    const result = run(runtime.node, [join(root, '.pbai4devs/scripts/executar-script/SCRIPT.mjs'), ...(raw ? ['--raw'] : []), ...(plan ? ['--plan'] : []), ...selected], processOptions);
    if (result.error) throw result.error;
    return result.status ?? 1;
  }
  const result = (options.run || spawnSync)(runtime.node, [join(options.root || projectRoot, '.pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs'), 'setup', ...args], { stdio: 'inherit', env: environmentWithNode(options.environment || process.env, runtime.node) });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function isEntrypoint() {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url); }
  catch { return false; }
}
if (isEntrypoint()) {
  try { process.exitCode = await main(); } catch (error) {
    console.error(`bootstrap: ${error.message}`);
    process.exitCode = Number.isInteger(error.exitCode) && error.exitCode >= 1 && error.exitCode <= 255 ? error.exitCode : 1;
  }
}
