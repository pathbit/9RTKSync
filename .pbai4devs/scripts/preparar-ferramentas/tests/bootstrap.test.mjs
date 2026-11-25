import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ensureRuntime, main, validateArchive, validateExtracted } from '../BOOTSTRAP.mjs';
import { findExecutable } from '../../lib/runtime.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const tar = findExecutable('tar');
const fixtureVersion = '24.13.1';
const nodeOption = (kind, path) => `--${kind}=${JSON.stringify(kind === 'import' ? pathToFileURL(path).href : path)}`;
function preflight(node, args, environment, expected = 0) {
  const result = spawnSync(node, args, { env: environment, encoding: 'utf8', timeout: 30000,
    maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  assert.equal(result.status, expected, `Preflight falhou (erro=${result.error?.code || 'nenhum'}, sinal=${result.signal || 'nenhum'}).`);
  return result;
}
function copyRuntime(executable) {
  copyFileSync(process.execPath, executable);
  if (process.platform === 'darwin') {
    // Homebrew's Node executable resolves libnode relative to its own path.
    const library = `libnode.${process.versions.modules}.dylib`;
    const original = join(dirname(realpathSync(process.execPath)), '..', 'lib', library);
    if (existsSync(original)) symlinkSync(realpathSync(original), join(dirname(executable), library));
  }
}
function fixture(t) {
  assert.ok(tar, 'Native tar is required for archive integration tests.');
  mkdirSync(join(project, '.agent-tests'), { recursive: true });
  const root = mkdtempSync(join(project, '.agent-tests/bootstrap-node-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const platform = process.platform, arch = process.arch;
  const key = platform === 'win32' ? `win-${arch}` : `${platform}-${arch}`;
  const top = `node-v${fixtureVersion}-${key}`, extension = platform === 'win32' ? 'zip' : 'tar.gz';
  const bundle = join(root, top); mkdirSync(bundle);
  const write = (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
  write(join(bundle, platform === 'win32' ? 'node.exe' : 'bin/node'), 'fixture-node');
  write(join(bundle, platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js'), 'fixture-npm');
  const archive = join(root, `${top}.${extension}`);
  const packed = spawnSync(tar, [platform === 'win32' ? '-acf' : '-czf', archive, '-C', root, top], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex');
  let manifest = `${checksum}  ${top}.${extension}\n`, calls = 0;
  const run = (file, args, options) => {
    if (args[0] === '-e' && args[3] === '--version') {
      const marker = args[1].match(/ADK_NPM_[a-f0-9]{48}/)?.[0];
      return { status: existsSync(args[2]) && readFileSync(args[2], 'utf8') === 'fixture-npm' ? 0 : 1,
        stdout: `\0${marker}\0` + '11.0.0\n' };
    }
    if (args[1] === '--version') return { status: existsSync(args[0]) && readFileSync(args[0], 'utf8') === 'fixture-npm' ? 0 : 1, stdout: '11.0.0\n' };
    if (args[0] === '-p') {
      if (!file.startsWith(root + sep) || !existsSync(file) || readFileSync(file, 'utf8') !== 'fixture-node') return { status: 1, stdout: '' };
      return { status: 0, stdout: JSON.stringify({ version: fixtureVersion, node: file, bun: false }) };
    }
    if (args[0] === '-e') {
      if (!file.startsWith(root + sep) || !existsSync(file) || readFileSync(file, 'utf8') !== 'fixture-node') return { status: 1, stdout: '' };
      return { status: 0, output: [null, null, null, JSON.stringify({ version: fixtureVersion, node: file, bun: false })] };
    }
    return spawnSync(file, args, options);
  };
  const environment = { ...process.env, PATH: dirname(tar), Path: dirname(tar), npm_execpath: '', NODE_OPTIONS: '' };
  const options = { root, node: join(root, 'missing-node'), platform, arch, libc: 'glibc', run, environment,
    download: async (url, destination) => { calls++; if (url.endsWith('SHASUMS256.txt')) writeFileSync(destination, manifest); else copyFileSync(archive, destination); } };
  return { root, options, archive, key, cache: join(root, '.pbai4devs/tools/.cache/runtime/node', key), script: name => write(join(root, '.pbai4devs/scripts', name, 'SCRIPT.mjs'), ''), setManifest: value => { manifest = value; }, calls: () => calls };
}

test("bootstrap Node extracts real file, scans npm and reuses cache without network", async t => {
  const f = fixture(t), runtime = await ensureRuntime(f.options);
  assert.equal(runtime.source, 'download'); assert.equal(runtime.version, fixtureVersion); assert.equal(f.calls(), 2);
  assert.ok(existsSync(runtime.node)); assert.ok(existsSync(runtime.npm));
  const cached = await ensureRuntime({ ...f.options, download: async () => { throw new Error('Network must not run'); } });
  assert.equal(cached.source, 'cache'); assert.equal(cached.node, runtime.node);
  assert.ok(readdirSync(f.cache).every(name => !name.startsWith('.stage.')));
});

test("checksum, ambiguous manifesto and failed download do not promote runtime", async t => {
  for (const kind of ['checksum', 'manifest', 'download']) await t.test(kind, async subtest => {
    const f = fixture(subtest), previous = join(f.cache, `v${fixtureVersion}`); mkdirSync(previous, { recursive: true }); writeFileSync(join(previous, 'preserved'), 'original');
    if (kind === 'checksum') f.setManifest(`${'0'.repeat(64)}  node-v${fixtureVersion}-${f.key}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}\n`);
    if (kind === 'manifest') f.setManifest('no matching official archive\n');
    const options = kind === 'download' ? { ...f.options, download: async () => { throw new Error('offline'); } } : f.options;
    await assert.rejects(ensureRuntime(options), /SHA-256|indisponivel|offline/);
    assert.equal(readFileSync(join(previous, 'preserved'), 'utf8'), 'original');
    assert.ok(readdirSync(f.cache).every(name => !name.startsWith('.stage.')));
  });
});

test('bootstrap Windows ignora Node afetado e usa somente um runtime corrigido no cache', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'adk-windows-runtime-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const current = join(root, 'node.exe');
  writeFileSync(current, 'fixture');
  const cache = join(root, '.pbai4devs/tools/.cache/runtime/node/win-x64');
  const create = version => {
    const directory = join(cache, `v${version}`);
    const npm = join(directory, 'node_modules/npm/bin/npm-cli.js');
    mkdirSync(dirname(npm), { recursive: true });
    writeFileSync(npm, 'fixture');
    const node = join(directory, 'node.exe');
    writeFileSync(node, 'fixture');
    return node;
  };
  const affected = create('24.13.0');
  const options = {
    root, node: current, platform: 'win32', arch: 'x64', allowDownload: false,
    environment: { NODE_OPTIONS: '', PATH: '' },
    run(file, args) {
      if (args[0] === '-p') {
        const version = [current, affected].includes(file) ? '24.13.0' : fixtureVersion;
        return { status: 0, stdout: JSON.stringify({ version, node: file, bun: false }) };
      }
      assert.equal(args[1], '--version');
      return { status: 0, stdout: '11.0.0\n' };
    },
  };
  await assert.rejects(ensureRuntime(options), /24\.13\.1/);
  const supported = create(fixtureVersion);
  const result = await ensureRuntime(options);
  assert.equal(result.source, 'cache');
  assert.equal(result.node, supported);
});

test("validation refuses names outside the distribution before extraction", () => {
  const top = 'node-v24.1.2-linux-x64';
  assert.doesNotThrow(() => validateArchive(`${top}/bin/npm\n`, top));
  for (const name of ['../../outside', `${top}/../outside`, '/absolute/file', `${top}/C:file`]) assert.throws(() => validateArchive(`${name}\n`, top), /fora/);
});

test("extracted internal links are accepted and external links are refused", t => {
  const f = fixture(t), inside = join(f.root, 'inside'), outside = join(f.root, 'outside'); mkdirSync(inside); mkdirSync(outside); writeFileSync(join(inside, 'file'), 'safe');
  try { symlinkSync('file', join(inside, 'link')); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('No symlink privilege'); return; } throw error; }
  assert.doesNotThrow(() => validateExtracted(inside));
  symlinkSync(outside, join(inside, 'escape'), 'dir');
  assert.throws(() => validateExtracted(inside), /fora/);
});

test("Symbolic cache is refused without playing external target", async t => {
  const f = fixture(t), outside = join(f.root, 'outside'); mkdirSync(outside);
  const cacheRoot = join(f.root, '.pbai4devs/tools/.cache'); mkdirSync(dirname(cacheRoot), { recursive: true });
  try { symlinkSync(outside, cacheRoot, 'dir'); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('No symlink privilege'); return; } throw error; }
  await assert.rejects(ensureRuntime(f.options), /link simbolico/); assert.deepEqual(readdirSync(outside), []);
});

test("invalid options fail before network or cache creation", async () => {
  await assert.rejects(main(['--runtime-only', 'all']), /nao aceita/);
  await assert.rejects(main(['--unknown']), /runtime-only/);
});

test("current healthy runtime does not change PATH do not save cache", async t => {
  const f = fixture(t), original = process.env.PATH;
  const result = await ensureRuntime({ root: f.root, minimum: Number(process.versions.node.split('.')[0]) });
  assert.equal(result.source, 'current'); assert.equal(process.env.PATH, original); assert.equal(existsSync(f.cache), false);
});

test("verbose synchronous preload does not prevent locating Node and npm or altering its main entry", async t => {
  const f = fixture(t), bin = join(f.root, 'runtime com espaços');
  const executable = join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  const npm = join(bin, 'node_modules/npm/bin/npm-cli.js');
  mkdirSync(dirname(npm), { recursive: true });
  copyRuntime(executable);
  if (process.platform !== 'win32') chmodSync(executable, 0o755);
  writeFileSync(npm, "if (require.main!==module || process.argv.slice(2).join(' ')!=='--version' || process.execArgv.length!==0) process.exitCode=9; else console.log('11.0.0');\n");
  const preload = join(f.root, 'preload com espaços.cjs');
  writeFileSync(preload, "process.stdout.write('SAIDA_ANTERIOR\\n'); process.stderr.write('DIAGNOSTICO_ANTERIOR\\n');\n");
  const options = [[nodeOption('require', preload), 'SAIDA_ANTERIOR']];
  if (Number(process.versions.node.split('.')[0]) >= 20) {
    const esm = join(f.root, 'preload com espaços.mjs');
    writeFileSync(esm, "process.stdout.write('SAIDA_ESM\\n');\n");
    options.push([nodeOption('import', esm), 'SAIDA_ESM']);
  }
  for (const [nodeOptions, expectedPreload] of options) {
    const environment = { ...process.env, PATH: bin, Path: bin, npm_execpath: '', NODE_OPTIONS: nodeOptions };
    const check = preflight(executable, [npm, '--version'], environment);
    assert.ok(check.stdout.includes(expectedPreload), 'O preload precisa executar no preflight.');
    assert.ok(check.stdout.includes('11.0.0'), 'O npm sintético precisa executar no preflight.');
    const result = await ensureRuntime({ root: f.root, minimum: Number(process.versions.node.split('.')[0]), node: executable,
      environment, allowDownload: false, download: async () => { throw new Error('rede indevida'); } });
    assert.equal(result.source, 'current');
    assert.equal(result.node, executable);
    assert.equal(result.npm, npm);
    assert.equal(environment.NODE_OPTIONS, nodeOptions);
    assert.equal(existsSync(f.cache), false);
  }
});

test("asynchronous preloads or channel injection refuse verification without exposing output or accessing network", async t => {
  const f = fixture(t), bin = join(f.root, 'runtime com espaços');
  const executable = join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  const npm = join(bin, 'node_modules/npm/bin/npm-cli.js');
  mkdirSync(dirname(npm), { recursive: true });
  copyRuntime(executable);
  if (process.platform !== 'win32') chmodSync(executable, 0o755);
  const npmMarker = join(f.root, 'npm-preflight-negativo.txt');
  writeFileSync(npm, `require('node:fs').writeFileSync(${JSON.stringify(npmMarker)},'npm');console.log('11.0.0');\n`);
  let downloads = 0;
  const cases = [
    ['async', 'cjs', 'require', "process.nextTick(()=>process.stdout.write('DADO_PRIVADO\\n'));\n"],
    ['fd3', 'cjs', 'require', "try{require('node:fs').writeSync(3,'DADO_PRIVADO\\n')}catch{}\n"],
  ];
  if (Number(process.versions.node.split('.')[0]) >= 20) cases.push(['esm-async', 'mjs', 'import', "process.nextTick(()=>process.stdout.write('DADO_PRIVADO\\n'));\n"]);
  for (const [name, extension, option, source] of cases) {
    const preload = join(f.root, `preload-${name}.${extension}`), marker = join(f.root, `preflight-${name}.txt`);
    const mark = extension === 'mjs'
      ? `import {writeFileSync as mark} from 'node:fs';mark(${JSON.stringify(marker)},'preload');\n`
      : `require('node:fs').writeFileSync(${JSON.stringify(marker)},'preload');\n`;
    writeFileSync(preload, mark + source);
    const environment = { ...process.env, PATH: bin, Path: bin, npm_execpath: '', NODE_OPTIONS: nodeOption(option, preload) };
    rmSync(npmMarker, { force: true });
    preflight(executable, [npm, '--version'], environment);
    assert.equal(readFileSync(marker, 'utf8'), 'preload');
    assert.equal(readFileSync(npmMarker, 'utf8'), 'npm');
    for (const allowDownload of [false, true]) {
      await assert.rejects(ensureRuntime({ root: f.root, minimum: Number(process.versions.node.split('.')[0]), node: executable,
        environment, allowDownload, download: async () => { downloads++; throw new Error('rede indevida'); } }), error => {
        assert.match(error.message, /resposta invalida ou contaminada/);
        assert.doesNotMatch(error.message, /DADO_PRIVADO/);
        return true;
      });
      assert.equal(existsSync(f.cache), false);
    }
  }
  assert.equal(downloads, 0);
});

test('npm customizado que recusa contexto eval do probe falha fechado sem download', async t => {
  const f = fixture(t), bin = join(f.root, 'node personalizado');
  const executable = join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  const npm = join(bin, 'node_modules/npm/bin/npm-cli.js');
  mkdirSync(dirname(npm), { recursive: true });
  copyRuntime(executable);
  if (process.platform !== 'win32') chmodSync(executable, 0o755);
  const npmMarker = join(f.root, 'npm-eval-preflight.txt'), marker = join(f.root, 'preload-eval-preflight.txt');
  writeFileSync(npm, `require('node:fs').writeFileSync(${JSON.stringify(npmMarker)},'npm');if(typeof process._eval==='string')process.exitCode=9;else console.log('11.0.0');\n`);
  const preload = join(f.root, 'preload.cjs');
  writeFileSync(preload, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'preload');\n`);
  const environment = { ...process.env, PATH: bin, Path: bin, npm_execpath: '', NODE_OPTIONS: nodeOption('require', preload) };
  preflight(executable, ['-e', "require('node:module').runMain()", npm, '--version'], environment, 9);
  assert.equal(readFileSync(marker, 'utf8'), 'preload');
  assert.equal(readFileSync(npmMarker, 'utf8'), 'npm');
  let downloads = 0;
  await assert.rejects(ensureRuntime({ root: f.root, minimum: Number(process.versions.node.split('.')[0]), node: executable,
    environment, download: async () => { downloads++; } }), /verificacao falhou ou foi interrompida/);
  assert.equal(downloads, 0);
  assert.equal(existsSync(f.cache), false);
});

test("npm writing direct in fd 1 is recognized with and without synchronous preload", async t => {
  const f = fixture(t), bin = join(f.root, 'node custom');
  const executable = join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  const npm = join(bin, 'node_modules/npm/bin/npm-cli.js');
  mkdirSync(dirname(npm), { recursive: true });
  copyRuntime(executable);
  if (process.platform !== 'win32') chmodSync(executable, 0o755);
  writeFileSync(npm, "if(require.main!==module || process.execArgv.length || process.argv.slice(2).join(' ')!=='--version')process.exitCode=9;else require('node:fs').writeSync(1,'11.0.0\\n');\n");
  const env = { ...process.env, PATH: bin, Path: bin, npm_execpath: '', NODE_OPTIONS: '' };
  const common = { root: f.root, minimum: Number(process.versions.node.split('.')[0]), node: executable,
    allowDownload: false, download: async () => { throw new Error('rede indevida'); } };
  assert.equal((await ensureRuntime({ ...common, environment: env })).npm, npm);
  // No NODE_OPTIONS, preserves the standard spanSync limit and the previous trim.
  writeFileSync(npm, "process.stdout.write(' '.repeat(128*1024)+'11.0.0\\n');\n");
  assert.equal((await ensureRuntime({ ...common, environment: env })).npm, npm);
  writeFileSync(npm, "if(require.main!==module || process.execArgv.length || process.argv.slice(2).join(' ')!=='--version')process.exitCode=9;else require('node:fs').writeSync(1,'11.0.0\\n');\n");
  const preload = join(f.root, 'preload.cjs'); writeFileSync(preload, "process.stdout.write('LOG\\n');\n");
  const noisy = { ...env, NODE_OPTIONS: nodeOption('require', preload) };
  assert.equal((await ensureRuntime({ ...common, environment: noisy })).npm, npm);
  assert.equal(existsSync(f.cache), false);
});

test("probe isolated preserves execArgv added by preload and removes only its eval", async t => {
  const f = fixture(t), bin = join(f.root, 'node flags');
  const executable = join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  const npm = join(bin, 'node_modules/npm/bin/npm-cli.js');
  mkdirSync(dirname(npm), { recursive: true });
  copyRuntime(executable);
  if (process.platform !== 'win32') chmodSync(executable, 0o755);
  writeFileSync(npm, "if(require.main!==module || process.execArgv.join(' ')!=='--flag-do-preload')process.exitCode=9;else console.log('11.0.0');\n");
  const preload = join(f.root, 'preload.cjs');
  writeFileSync(preload, "process.execArgv.unshift('--flag-do-preload');process.stdout.write('LOG\\n');\n");
  const environment = { ...process.env, PATH: bin, Path: bin, npm_execpath: '', NODE_OPTIONS: nodeOption('require', preload) };
  const result = await ensureRuntime({ root: f.root, minimum: Number(process.versions.node.split('.')[0]), node: executable,
    environment, allowDownload: false, download: async () => { throw new Error('rede indevida'); } });
  assert.equal(result.npm, npm);
  assert.equal(existsSync(f.cache), false);
});

test("npm customized ESM runs as input with original arguments", async t => {
  const f = fixture(t), bin = join(f.root, 'node esm');
  const executable = join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  const npm = join(bin, 'node_modules/npm/bin/npm-cli.js');
  mkdirSync(dirname(npm), { recursive: true });
  copyRuntime(executable);
  if (process.platform !== 'win32') chmodSync(executable, 0o755);
  writeFileSync(join(bin, 'node_modules/npm/package.json'), '{"type":"module"}\n');
  writeFileSync(npm, "import {writeSync} from 'node:fs';if(process.argv.slice(2).join(' ')!=='--version' || process.execArgv.length)process.exitCode=9;else writeSync(1,'11.0.0\\n');\n");
  const preload = join(f.root, 'preload.cjs'); writeFileSync(preload, "process.stdout.write('LOG\\n');\n");
  const environment = { ...process.env, PATH: bin, Path: bin, npm_execpath: '', NODE_OPTIONS: nodeOption('require', preload) };
  const result = await ensureRuntime({ root: f.root, minimum: Number(process.versions.node.split('.')[0]), node: executable,
    environment, allowDownload: false, download: async () => { throw new Error('rede indevida'); } });
  assert.equal(result.npm, npm);
  assert.equal(existsSync(f.cache), false);
});

test("missing or duplicate npm marker does not authorize result or download", async t => {
  const f = fixture(t), bin = join(f.root, 'isolated', 'bin'), node = join(bin, 'node');
  const npm = join(f.root, 'isolated', 'lib/node_modules/npm/bin/npm-cli.js');
  mkdirSync(bin, { recursive: true }); mkdirSync(dirname(npm), { recursive: true });
  writeFileSync(node, 'fixture-node'); writeFileSync(npm, 'fixture-npm');
  for (const mode of ['absent', 'duplicate', 'trailing']) {
    let downloads = 0;
    const run = (file, argv, settings) => {
      if (argv[0] === '-e' && argv[3] === '--version') {
        const found = argv[1].match(/ADK_NPM_[a-f0-9]{48}/)?.[0];
        assert.ok(found);
        const marker = `\0${found}\0`;
        const stdout = mode === 'absent' ? '11.0.0\n' : mode === 'duplicate' ? `${marker}11.0.0\n${marker}` : `${marker}11.0.0\nextra`;
        return { status: 0, stdout };
      }
      return f.options.run(file, argv, settings);
    };
    const environment = { ...f.options.environment, NODE_OPTIONS: '--require=exemplo' };
    await assert.rejects(ensureRuntime({ ...f.options, node, environment, run,
      download: async () => { downloads++; } }), /resposta invalida ou contaminada/);
    assert.equal(downloads, 0);
    assert.equal(existsSync(f.cache), false);
  }
});

test("Node_Options respects insensitive box only on Windows", async t => {
  const f = fixture(t), bin = join(f.root, 'node-mock'), executable = join(bin, 'node.exe');
  mkdirSync(join(bin, 'node_modules/npm/bin'), { recursive: true });
  writeFileSync(executable, 'fixture-node');
  writeFileSync(join(bin, 'node_modules/npm/bin/npm-cli.js'), 'fixture-npm');
  for (const [platform, expected] of [['win32', '-e'], ['linux', '-p']]) {
    const calls = [], environment = { PATH: bin, Path: bin, Node_Options: '--require=exemplo' };
    const run = (file, argv, options) => { calls.push(argv); return f.options.run(file, argv, options); };
    const result = await ensureRuntime({ ...f.options, platform, node: executable, environment, run, allowDownload: false });
    assert.equal(result.source, 'current');
    assert.equal(calls[0][0], expected);
    assert.equal(calls[1][0] === '-e', expected === '-e');
  }
  // Duplicate keys in Windows are sorted and the first is maintained by spamn.
  const calls = [], environment = { PATH: bin, Node_Options: '--require=exemplo', NODE_OPTIONS: '' };
  const run = (file, argv, options) => { calls.push(argv); return f.options.run(file, argv, options); };
  await ensureRuntime({ ...f.options, platform: 'win32', node: executable, environment, run, allowDownload: false });
  assert.equal(calls[0][0], '-p');
  assert.equal(existsSync(f.cache), false);
});

test("probe interrupted, timeout or exit limit do not trigger download or cache", async t => {
  const f = fixture(t);
  for (const result of [{ error: { code: 'ETIMEDOUT' }, status: null }, { error: { code: 'ENOBUFS' }, status: null }, { signal: 'SIGTERM', status: null }]) {
    let downloads = 0;
    await assert.rejects(ensureRuntime({ ...f.options, run: () => result, download: async () => { downloads++; } }), /verificacao falhou ou foi interrompida/);
    assert.equal(downloads, 0);
    assert.equal(existsSync(f.cache), false);
  }
});

test("runtime by symlink whose probe fails is not treated as absent", async t => {
  const f = fixture(t), target = join(f.root, 'node-real'), executable = join(f.root, 'node-link');
  writeFileSync(target, 'fixture-node');
  try { symlinkSync(target, executable, 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('No symlink privilege'); return; } throw error; }
  let downloads = 0;
  await assert.rejects(ensureRuntime({ ...f.options, node: executable, run: () => ({ status: 1 }), download: async () => { downloads++; } }), /verificacao falhou ou foi interrompida/);
  assert.equal(downloads, 0);
  assert.equal(existsSync(f.cache), false);
});

test('preload real que excede limite do canal falha sem download nem cache', async t => {
  const f = fixture(t), preload = join(f.root, 'enorme.cjs');
  const marker = join(f.root, 'preflight-fd3.txt'), programMarker = join(f.root, 'preflight-programa.txt');
  writeFileSync(preload, `const f=require('node:fs');f.writeFileSync(${JSON.stringify(marker)},'preload');const b=Buffer.alloc(1024*1024,65);for(let n=0;n<b.length;)n+=f.writeSync(3,b,n,b.length-n);\n`);
  const environment = { ...process.env, NODE_OPTIONS: nodeOption('require', preload) };
  const initial = preflight(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(programMarker)},'programa')`], environment);
  assert.equal(readFileSync(marker, 'utf8'), 'preload');
  assert.equal(readFileSync(programMarker, 'utf8'), 'programa');
  assert.equal(Buffer.byteLength(initial.output[3]), 1024 * 1024);
  assert.equal(createHash('sha256').update(initial.output[3]).digest('hex'), createHash('sha256').update(Buffer.alloc(1024 * 1024, 65)).digest('hex'));
  let downloads = 0;
  const attempts = [];
  const run = (file, args, settings) => {
    const result = spawnSync(file, args, settings);
    if (args[0] === '-e' && args.length === 2) attempts.push({ file, error: result.error?.code });
    return result;
  };
  await assert.rejects(ensureRuntime({ root: f.root, minimum: Number(process.versions.node.split('.')[0]), node: process.execPath,
    environment, run, download: async () => { downloads++; } }), /verificacao falhou ou foi interrompida/);
  assert.deepEqual(attempts, [{ file: process.execPath, error: 'ENOBUFS' }]);
  assert.equal(downloads, 0);
  assert.equal(existsSync(f.cache), false);
});

test('preload que excede limite do stdout do npm falha sem rede nem cache', async t => {
  const f = fixture(t), preload = join(f.root, 'excesso.cjs');
  const marker = join(f.root, 'preflight-stdout.txt'), npmMarker = join(f.root, 'preflight-npm.txt');
  const bin = join(f.root, 'node com espaços');
  const executable = join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  const fakeNpm = join(bin, 'node_modules/npm/bin/npm-cli.js');
  mkdirSync(dirname(fakeNpm), { recursive: true });
  copyRuntime(executable);
  if (process.platform !== 'win32') chmodSync(executable, 0o755);
  writeFileSync(preload, `const f=require('node:fs');f.writeFileSync(${JSON.stringify(marker)},'preload');if(process.argv[1] && process.argv[1].endsWith('npm-cli.js')){const b=Buffer.alloc(1024*1024,65);for(let n=0;n<b.length;)n+=f.writeSync(1,b,n,b.length-n)}\n`);
  writeFileSync(fakeNpm, `require('node:fs').writeFileSync(${JSON.stringify(npmMarker)},'npm');\n`);
  const environment = { ...process.env, PATH: bin, Path: bin, npm_execpath: '', NODE_OPTIONS: nodeOption('require', preload) };
  const initial = preflight(executable, [fakeNpm, '--version'], environment);
  assert.equal(readFileSync(marker, 'utf8'), 'preload');
  assert.equal(readFileSync(npmMarker, 'utf8'), 'npm');
  assert.equal(Buffer.byteLength(initial.stdout), 1024 * 1024);
  assert.equal(createHash('sha256').update(initial.stdout).digest('hex'), createHash('sha256').update(Buffer.alloc(1024 * 1024, 65)).digest('hex'));
  let downloads = 0;
  const attempts = [];
  const run = (file, args, settings) => {
    const result = spawnSync(file, args, settings);
    if (args[0] === '-e' && args[3] === '--version') attempts.push({ file, target: args[2], error: result.error?.code });
    return result;
  };
  await assert.rejects(ensureRuntime({ root: f.root, minimum: Number(process.versions.node.split('.')[0]), node: executable,
    environment, libc: 'glibc', run, download: async () => { downloads++; } }), /verificacao falhou ou foi interrompida/);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].file, executable);
  assert.equal(realpathSync(attempts[0].target), realpathSync(fakeNpm));
  assert.equal(attempts[0].error, 'ENOBUFS');
  assert.equal(downloads, 0);
  assert.equal(existsSync(f.cache), false);
});

test("single entry prepares runtime, diagnoses and forwards arguments and status without shell", async t => {
  const f = fixture(t), calls = [];
  f.script('script com espaços');
  const args = ['script com espaços', '--flag', 'valor com espaços', '$(não executar)', '', '--', 'final'];
  const options = { ...f.options, run: (file, argv, settings) => {
    if (argv[0] === '-e' || argv[0] === '-p' || argv[1] === '--version' || file === tar) return f.options.run(file, argv, settings);
    calls.push({ file, argv, settings });
    return { status: calls.length === 1 ? 0 : 69 };
  } };
  assert.equal(await main(['--executar', ...args], options), 69);
  assert.equal(f.calls(), 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].file, calls[1].file);
  assert.deepEqual(calls[0].argv, [join(f.root, '.pbai4devs/scripts/diagnosticar-ambiente/SCRIPT.mjs')]);
  assert.deepEqual(calls[1].argv, [join(f.root, '.pbai4devs/scripts/executar-script/SCRIPT.mjs'), ...args]);
  assert.equal(calls[0].settings.cwd, f.root);
  assert.equal(calls[1].settings.cwd, f.root);
  assert.equal(calls[1].settings.shell, undefined);
  assert.equal(calls[1].settings.stdio, 'inherit');
});

test("diagnostic failure prevents execution and spread status", async t => {
  const f = fixture(t), calls = [];
  f.script('qualquer');
  const options = { ...f.options, run: (file, argv, settings) => {
    if (argv[0] === '-e' || argv[0] === '-p' || argv[1] === '--version' || file === tar) return f.options.run(file, argv, settings);
    calls.push(argv); return { status: 23 };
  } };
  assert.equal(await main(['--executar', 'qualquer'], options), 23);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], join(f.root, '.pbai4devs/scripts/diagnosticar-ambiente/SCRIPT.mjs'));
});

test("plan does not install or diagnose; uses only runtime available", async t => {
  const f = fixture(t), calls = [];
  f.script('qualquer');
  await assert.rejects(main(['--executar', '--plan', 'qualquer'], f.options), /prepare o runtime/);
  assert.equal(f.calls(), 0);
  assert.equal(existsSync(f.cache), false);
  await ensureRuntime(f.options);
  const callsBefore = f.calls();
  const options = { ...f.options, download: async () => { throw new Error('rede indevida'); }, run: (file, argv, settings) => {
    if (argv[0] === '-e' || argv[0] === '-p' || argv[1] === '--version' || file === tar) return f.options.run(file, argv, settings);
    calls.push(argv); return { status: 0 };
  } };
  assert.equal(await main(['--executar', '--plan', 'qualquer', 'argumento'], options), 0);
  assert.equal(f.calls(), callsBefore);
  assert.deepEqual(calls, [[join(f.root, '.pbai4devs/scripts/executar-script/SCRIPT.mjs'), '--plan', 'qualquer', 'argumento']]);
});

test("--no-install failure without runtime and uses networkless cache; preserve target flag", async t => {
  const f = fixture(t), calls = [];
  f.script('alvo');
  await assert.rejects(main(['--executar', '--no-install', 'alvo'], f.options), /prepare o runtime/);
  assert.equal(f.calls(), 0);
  assert.equal(existsSync(f.cache), false);
  await ensureRuntime(f.options);
  const options = { ...f.options, download: async () => { throw new Error('rede indevida'); }, run: (file, argv, settings) => {
    if (argv[0] === '-e' || argv[0] === '-p' || argv[1] === '--version' || file === tar) return f.options.run(file, argv, settings);
    calls.push(argv); return { status: 0 };
  } };
  assert.equal(await main(['--executar', '--no-install', 'alvo', '--no-install'], options), 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], [join(f.root, '.pbai4devs/scripts/executar-script/SCRIPT.mjs'), 'alvo', '--no-install']);
  calls.length = 0;
  assert.equal(await main(['--executar', '--plan', '--no-install', 'alvo'], options), 0);
  assert.deepEqual(calls, [[join(f.root, '.pbai4devs/scripts/executar-script/SCRIPT.mjs'), '--plan', 'alvo']]);
});

test("New mode meets Node 24 in PATH with spaces without downloading runtime", async t => {
  const f = fixture(t), calls = [], bin = join(f.root, 'bin com espaços');
  f.script('alvo');
  mkdirSync(join(bin, 'node_modules/npm/bin'), { recursive: true });
  const executable = join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  writeFileSync(executable, 'fixture-node');
  if (process.platform !== 'win32') chmodSync(executable, 0o755);
  writeFileSync(join(bin, 'node_modules/npm/bin/npm-cli.js'), 'fixture-npm');
  const options = { ...f.options, environment: { PATH: bin }, download: async () => { throw new Error('rede indevida'); }, run: (file, argv, settings) => {
    if (argv[0] === '-e' || argv[0] === '-p' || argv[1] === '--version') return f.options.run(file, argv, settings);
    calls.push({ file, argv }); return { status: 0 };
  } };
  const runtime = await ensureRuntime({ ...options, searchPath: true, allowDownload: false });
  assert.equal(runtime.source, 'path');
  assert.equal(runtime.node, executable);
  assert.equal(await main(['--executar', '--no-install', 'alvo', 'argumento com espaços'], options), 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].file, executable);
  assert.deepEqual(calls[1].argv.slice(-2), ['alvo', 'argumento com espaços']);
  assert.equal(existsSync(f.cache), false);
  assert.equal(f.calls(), 0);
});

test("single entry without target failure before preparing runtime", async t => {
  const f = fixture(t);
  for (const args of [['--executar'], ['--executar', '--plan'], ['--executar', '--no-install'], ['--executar', '--plan', '--no-install']]) await assert.rejects(main(args, f.options), /nome-ou-caminho/);
  assert.equal(f.calls(), 0);
  assert.equal(existsSync(f.cache), false);
});

test("help does not seek runtime, network access or start diagnosis", async t => {
  const f = fixture(t), unexpected = [];
  const options = { ...f.options, run: (...args) => { unexpected.push(args); return f.options.run(...args); } };
  for (const args of [['--executar', '--help'], ['--executar', '-h'], ['--executar', '--no-install', '--plan', '--help']]) assert.equal(await main(args, options), 0);
  assert.equal(unexpected.length, 0);
  assert.equal(f.calls(), 0);
  assert.equal(existsSync(f.cache), false);
});

test("invalid target or configuration fails before runtime, network and diagnosis", async t => {
  const f = fixture(t), scripts = join(f.root, '.pbai4devs/scripts');
  const invalid = join(scripts, 'invalido'); mkdirSync(invalid, { recursive: true });
  writeFileSync(join(invalid, 'SCRIPT.mjs'), '');
  writeFileSync(join(invalid, 'SCRIPT.conf'), 'executor=desconhecido\n');
  writeFileSync(join(f.root, 'shell.sh'), '');
  const unexpected = [];
  const options = { ...f.options, run: (...args) => { unexpected.push(args); return f.options.run(...args); } };
  for (const target of ['ausente', 'invalido', 'shell.sh', '../fora.mjs']) {
    await assert.rejects(main(['--executar', target], options), /ausente|SCRIPT.conf|JavaScript|fora/);
  }
  assert.equal(unexpected.length, 0);
  assert.equal(f.calls(), 0);
  assert.equal(existsSync(f.cache), false);
});

test("CLI preserves selector code when target does not exist", t => {
  const f = fixture(t), target = join(f.root, 'ausente.mjs');
  const selector = join(project, '.pbai4devs/scripts/executar-script/SCRIPT.mjs');
  const bootstrap = join(project, '.pbai4devs/scripts/preparar-ferramentas/BOOTSTRAP.mjs');
  const direct = spawnSync(process.execPath, [selector, target], { encoding: 'utf8', timeout: 30000 });
  const viaBootstrap = spawnSync(process.execPath, [bootstrap, '--executar', target], { encoding: 'utf8', timeout: 30000 });
  assert.equal(direct.status, 2, direct.stderr);
  assert.equal(viaBootstrap.status, direct.status, viaBootstrap.stderr);
  assert.match(viaBootstrap.stderr, /ausente/);
  assert.doesNotMatch(viaBootstrap.stdout, /node=/);
  assert.equal(existsSync(f.cache), false);
});
