import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { diagnose } from '../SCRIPT.mjs';
import { findExecutable, projectRoot, requireNode } from '../../lib/runtime.mjs';

test('diagnostico funciona so com Node e informa dependencias opcionais ausentes', t => {
  const output = join(projectRoot, '.agent-tests'); mkdirSync(output, { recursive: true });
  const root = mkdtempSync(join(output, 'diagnose-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const report = diagnose({ root, environment: { PATH: '' }, probe: () => { throw new Error('Nenhum processo opcional esperado.'); } });
  assert.equal(report.runtime.name, 'node'); assert.equal(report.runtime.executable, process.execPath);
  assert.equal(report.npm, null); assert.equal(report.git, null);
  assert.equal(report.docker.executable, null); assert.equal(report.docker.compose, false);
  assert.equal(report.docker.composeStatus, 'not-found'); assert.equal(report.docker.daemonStatus, 'not-found');
  assert.deepEqual(report.tools, []); assert.equal(existsSync(join(root, '.pbai4devs')), false);
});

test("Docker query failure does not prove that daemon or Compose are stopped", t => {
  const output = join(projectRoot, '.agent-tests'); mkdirSync(output, { recursive: true });
  const root = mkdtempSync(join(output, 'diagnose-docker-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const docker = join(root, process.platform === 'win32' ? 'docker.exe' : 'docker');
  writeFileSync(docker, process.platform === 'win32' ? 'fixture' : '#!/bin/sh\nbase=${0%/*}\nprintf called > "$base/docker-invoked"\n'); chmodSync(docker, 0o755);
  const environment = { PATH: root };
  for (const outcome of [
    { status: 1, stderr: 'detalhe privado' },
    { status: null, error: Object.assign(new Error('detalhe privado'), { code: 'EACCES' }) },
    { status: null, error: Object.assign(new Error('detalhe privado'), { code: 'ETIMEDOUT' }) },
    { status: null, signal: 'SIGTERM' },
  ]) {
    const failed = diagnose({ root, environment, probe: (_file, _args, options) => { assert.equal(options.env, environment); return outcome; } });
    assert.equal(failed.docker.daemon, false);
    assert.equal(failed.docker.compose, false);
    assert.equal(failed.docker.daemonStatus, 'unverified');
    assert.equal(failed.docker.composeStatus, 'unverified');
    assert.ok(!JSON.stringify(failed).includes('detalhe privado'));
  }
  const calls = [];
  const success = diagnose({ root, environment, probe: (file, args, options) => { calls.push({ file, args, options }); return { status: 0 }; } });
  assert.equal(success.docker.daemon, true);
  assert.equal(success.docker.compose, true);
  assert.equal(success.docker.daemonStatus, 'available');
  assert.equal(success.docker.composeStatus, 'available');
  assert.deepEqual(calls.map(call => call.args), [['compose', 'version'], ['info', '--format', '{{.ServerVersion}}']]);
  assert.ok(calls.every(call => call.file === docker && call.options.env === environment && call.options.timeout === 5000 && call.options.windowsHide === true));
  const mixed = diagnose({ root, environment, probe: (_file, args) => ({ status: args[0] === 'compose' ? 0 : 1 }) });
  assert.equal(mixed.docker.composeStatus, 'available');
  assert.equal(mixed.docker.daemonStatus, 'unverified');
  const skipped = diagnose({ root, environment, probeDocker: false, probe: () => { throw new Error('Não deve chamar Docker.'); } });
  assert.equal(skipped.docker.daemon, false);
  assert.equal(skipped.docker.daemonStatus, 'not-requested');
  assert.equal(skipped.docker.composeStatus, 'not-requested');
  const absent = diagnose({ root, environment: { PATH: '' }, probeDocker: false, probe: () => { throw new Error('Não deve chamar Docker.'); } });
  assert.equal(absent.docker.executable, null);
  assert.equal(absent.docker.daemonStatus, 'not-found');
  assert.equal(absent.docker.composeStatus, 'not-found');
  const sentinel = join(root, 'docker-invoked');
  if (process.platform !== 'win32') {
    assert.equal(spawnSync(docker, [], { env: {} }).status, 0);
    assert.equal(existsSync(sentinel), true, 'o controle deve registrar a execução');
    rmSync(sentinel);
  }
  const cli = spawnSync(process.execPath, [join(projectRoot, '.pbai4devs/scripts/diagnosticar-ambiente/SCRIPT.mjs'), '--no-docker-probe'], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: root, Path: root },
  });
  assert.equal(cli.status, 0, cli.stderr);
  const cliDocker = JSON.parse(cli.stdout).docker;
  assert.equal(cliDocker.daemonStatus, 'not-requested');
  assert.equal(cliDocker.composeStatus, 'not-requested');
  assert.equal(existsSync(sentinel), false);
  const selector = spawnSync(process.execPath, [join(projectRoot, '.pbai4devs/scripts/executar-script/SCRIPT.mjs'), '--raw', 'diagnosticar-ambiente', '--no-docker-probe'], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: root, Path: root },
  });
  assert.equal(selector.status, 0, selector.stderr);
  assert.equal(JSON.parse(selector.stdout).docker.daemonStatus, 'not-requested');
  assert.equal(existsSync(sentinel), false);
  const typo = spawnSync(process.execPath, [join(projectRoot, '.pbai4devs/scripts/diagnosticar-ambiente/SCRIPT.mjs'), '--no-docker-probee'], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: root, Path: root },
  });
  assert.notEqual(typo.status, 0);
  assert.match(typo.stderr, /Uso:/);
  assert.equal(existsSync(sentinel), false);
  const selectorTypo = spawnSync(process.execPath, [join(projectRoot, '.pbai4devs/scripts/executar-script/SCRIPT.mjs'), '--raw', 'diagnosticar-ambiente', '--no-docker-probee'], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: root, Path: root },
  });
  assert.notEqual(selectorTypo.status, 0);
  assert.match(selectorTypo.stderr, /Uso:/);
  assert.equal(existsSync(sentinel), false);
});

test("diagnostic without scanning does not use process and network monitored APIs", t => {
  // The controls prove spamSync and https.request; the other substitutions
  // are additional observations, not a complete barrier against network.
  const output = join(projectRoot, '.agent-tests'); mkdirSync(output, { recursive: true });
  const root = mkdtempSync(join(output, 'diagnose-offline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const docker = join(root, process.platform === 'win32' ? 'docker.exe' : 'docker');
  writeFileSync(docker, 'fixture'); chmodSync(docker, 0o755);
  const marker = join(root, 'unexpected-operation'), preload = join(root, 'guard.mjs');
  writeFileSync(preload, `
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const blocked = () => { writeFileSync(process.env.ADK_TEST_MARKER, 'called'); throw new Error('unexpected operation'); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = blocked;
for (const [object, names] of [[http, ['request', 'get']], [https, ['request', 'get']], [net, ['connect', 'createConnection']], [tls, ['connect']], [dns, ['lookup', 'resolve']]]) {
  for (const name of names) object[name] = blocked;
}
globalThis.fetch = blocked;
syncBuiltinESMExports();
`);
  const guardEnv = { ...process.env, NODE_OPTIONS: '', PATH: root, Path: root, ADK_TEST_MARKER: marker, DOCKER_HOST: 'tcp://127.0.0.1:1' };
  for (const source of [
    "import { spawnSync } from 'node:child_process'; try { spawnSync('forbidden'); } catch {}",
    "import { request } from 'node:https'; try { request('invalid:'); } catch {}",
  ]) {
    const control = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 10000, env: guardEnv });
    assert.equal(control.status, 0, control.stderr);
    assert.equal(existsSync(marker), true, 'o controle deve detectar a operação');
    rmSync(marker);
  }
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(projectRoot, '.pbai4devs/scripts/diagnosticar-ambiente/SCRIPT.mjs'), '--no-docker-probe'], {
    encoding: 'utf8', timeout: 10000, env: guardEnv,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).docker.daemonStatus, 'not-requested');
  assert.equal(existsSync(marker), false, 'nenhuma API monitorada deve ser chamada');
});

test('requisito comum recusa Node antigo e procura executaveis sem shell', t => {
  assert.throws(() => requireNode(24, '22.22.0'), /Node.js >=24/);
  assert.doesNotThrow(() => requireNode(24, '24.13.0', 'linux'));
  assert.throws(() => requireNode(24, '24.13.0', 'win32'), /24\.13\.1/);
  const output = join(projectRoot, '.agent-tests'); mkdirSync(output, { recursive: true });
  const root = mkdtempSync(join(output, 'runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
  writeFileSync(file, 'fixture'); chmodSync(file, 0o755);
  assert.equal(findExecutable(file), file);
  assert.equal(findExecutable('fixture', { PATH: dirname(file) }), file);
  assert.equal(findExecutable('missing', { PATH: dirname(file) }), null);
});

test("isMain recognizes main path by alias without executing imports as input", t => {
  const output = join(projectRoot, '.agent-tests'); mkdirSync(output, { recursive: true });
  const root = mkdtempSync(join(output, 'runtime alias espaço-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const real = join(root, 'real'), alias = join(root, 'alias'); mkdirSync(real);
  try { symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.skip('Sistema sem permissão para criar alias de diretório.'); return;
  }
  const script = join(real, 'entry.mjs');
  const runtime = pathToFileURL(join(projectRoot, '.pbai4devs/scripts/lib/runtime.mjs')).href;
  writeFileSync(script, `import { isMain } from ${JSON.stringify(runtime)};\nconst main = isMain(import.meta.url);\nconsole.log(main ? 'entrada' : 'importado');\nif (main && process.env.ADK_RUNTIME_IMPORT) { const target = process.env.ADK_RUNTIME_IMPORT; delete process.env.ADK_RUNTIME_IMPORT; await import(target); }\n`);
  const run = (args, extra = {}) => {
    const env = { ...process.env, ...extra }; if (!Object.hasOwn(extra, 'NODE_OPTIONS')) delete env.NODE_OPTIONS;
    if (!Object.hasOwn(extra, 'NODE_PRESERVE_SYMLINKS_MAIN')) delete env.NODE_PRESERVE_SYMLINKS_MAIN;
    if (!Object.hasOwn(extra, 'NODE_PRESERVE_SYMLINKS')) delete env.NODE_PRESERVE_SYMLINKS;
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', env, timeout: 30000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim().split(/\r?\n/);
  };
  assert.deepEqual(run([script]), ['entrada']);
  assert.deepEqual(run([join(alias, 'entry.mjs')]), ['entrada']);
  const fileAlias = join(root, 'entry-link.mjs');
  try {
    symlinkSync(script, fileAlias, 'file');
    assert.deepEqual(run([fileAlias]), ['entrada']);
  } catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error; }
  const importer = join(root, 'importer.mjs');
  writeFileSync(importer, `await import(${JSON.stringify(pathToFileURL(join(alias, 'entry.mjs')).href)});\n`);
  assert.deepEqual(run([importer]), ['importado']);
  writeFileSync(importer, `await import(${JSON.stringify(pathToFileURL(script).href + '?importado')});\n`);
  assert.deepEqual(run([importer]), ['importado']);
  assert.deepEqual(run(['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(script).href)});`, script]), ['importado']);
  assert.deepEqual(run(['--input-type=module', `--eval=await import(${JSON.stringify(pathToFileURL(script).href)});`, script]), ['importado']);
  const physical = pathToFileURL(script).href, logical = pathToFileURL(join(alias, 'entry.mjs')).href;
  assert.deepEqual(run(['--preserve-symlinks-main', join(alias, 'entry.mjs')], { ADK_RUNTIME_IMPORT: physical }), ['entrada', 'importado']);
  assert.deepEqual(run(['--preserve-symlinks-main=false', join(alias, 'entry.mjs')], { ADK_RUNTIME_IMPORT: physical }), ['entrada', 'importado']);
  assert.deepEqual(run(['--preserve-symlinks-main=ignored', join(alias, 'entry.mjs')], { ADK_RUNTIME_IMPORT: physical }), ['entrada', 'importado']);
  assert.deepEqual(run(['--preserve-symlinks', script], { ADK_RUNTIME_IMPORT: logical }), ['entrada', 'importado']);
  assert.deepEqual(run(['--preserve-symlinks', join(alias, 'entry.mjs')], { ADK_RUNTIME_IMPORT: logical }), ['entrada', 'importado']);
  assert.deepEqual(run([join(alias, 'entry.mjs')], { NODE_OPTIONS: '--preserve-symlinks', ADK_RUNTIME_IMPORT: logical }), ['entrada', 'importado']);
  assert.deepEqual(run([join(alias, 'entry.mjs')], { NODE_OPTIONS: '--preserve-symlinks-main', ADK_RUNTIME_IMPORT: physical }), ['entrada', 'importado']);
  assert.deepEqual(run(['--no-preserve-symlinks-main', join(alias, 'entry.mjs')], { NODE_OPTIONS: '--preserve-symlinks-main' }), ['entrada']);
  assert.deepEqual(run([join(alias, 'entry.mjs')], { NODE_PRESERVE_SYMLINKS_MAIN: '1', ADK_RUNTIME_IMPORT: physical }), ['entrada', 'importado']);
  assert.deepEqual(run(['--no-preserve-symlinks-main', join(alias, 'entry.mjs')], { NODE_PRESERVE_SYMLINKS_MAIN: '1' }), ['entrada']);
  const positiveText = join(root, 'preload --preserve-symlinks-main');
  const negativeText = join(root, 'preload --no-preserve-symlinks-main');
  for (const file of [positiveText, negativeText]) writeFileSync(file, '// preload sem efeitos\n');
  assert.deepEqual(run(['--require', positiveText, join(alias, 'entry.mjs')]), ['entrada']);
  assert.deepEqual(run([join(alias, 'entry.mjs')], { NODE_OPTIONS: `--require ${JSON.stringify(positiveText)}` }), ['entrada']);
  assert.deepEqual(run(['--preserve-symlinks-main', '--require', negativeText, join(alias, 'entry.mjs')], { ADK_RUNTIME_IMPORT: physical }), ['entrada', 'importado']);
  assert.deepEqual(run([join(alias, 'entry.mjs')], { NODE_OPTIONS: `--preserve-symlinks-main --require ${JSON.stringify(negativeText)}`, ADK_RUNTIME_IMPORT: physical }), ['entrada', 'importado']);
  const toolAlias = join(root, 'tool');
  symlinkSync(join(projectRoot, '.pbai4devs/scripts/gerenciar-skills-externas'), toolAlias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(run([join(toolAlias, 'SCRIPT.mjs'), '--help']).join('\n'), /Uso:/);
});
