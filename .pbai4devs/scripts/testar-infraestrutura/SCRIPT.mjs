#!/usr/bin/env node
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isMain, projectRoot, requireNode } from '../lib/runtime.mjs';
import { inspectMacDirectoryAcl } from '../lib/xattr-probe.mjs';
import { expectedPlatformFixture } from './PLATFORM_FIXTURES.mjs';

export function isExpectedPlatformSkip(suite, skipped, platform = process.platform) {
  return Boolean(expectedPlatformFixture(suite, skipped, platform));
}

export function classifyExecution(result, evidence) {
  if (result?.error || result?.signal || result?.status !== 0) return 'failed';
  const counts = evidence?.counts;
  const valid = Number.isSafeInteger(evidence?.observed) && evidence.observed >= 0
    && Number.isSafeInteger(evidence?.fileSummaries) && evidence.fileSummaries >= 0
    && Array.isArray(evidence?.skipped) && Array.isArray(evidence?.pending)
    && counts && ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'].every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0);
  if (!valid || evidence.fileSummaries === 0 || counts.tests === 0 || counts.passed === 0
    || counts.tests !== counts.passed || evidence.observed < counts.passed
    || counts.failed || counts.cancelled || counts.skipped || counts.todo || evidence.skipped.length || evidence.pending.length) return 'partial';
  return 'passed';
}

function outputDirectory(root) {
  const directory = path => {
    let info = lstatSync(path, { throwIfNoEntry: false, bigint: true });
    if (!info) {
      try { mkdirSync(path, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      info = lstatSync(path, { bigint: true });
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Diretório de resultados inválido ou simbólico.');
    return info;
  };
  const base = join(root, '.agent-tests'), infrastructure = join(base, 'infraestrutura');
  const roots = [[root, directory(root)], [base, directory(base)], [infrastructure, directory(infrastructure)]];
  const run = mkdtempSync(join(infrastructure, 'run-'));
  console.log(`directory=${run}`);
  roots.push([run, directory(run)]);
  const verify = () => {
    for (const [path, original] of roots) {
      const current = lstatSync(path, { throwIfNoEntry: false, bigint: true });
      if (!current?.isDirectory() || current.isSymbolicLink() || current.dev !== original.dev || current.ino !== original.ino || current.mode !== original.mode) {
        throw new Error('Diretório de resultados mudou; interrompido para revisão.');
      }
    }
    if (process.platform === 'darwin' && inspectMacDirectoryAcl(run) !== 'empty') {
      throw new Error('ACL do diretório de resultados presente ou não verificada; execução interrompida.');
    }
  };
  verify();
  return { run, verify };
}

export function testInfrastructure(root = projectRoot) {
  requireNode();
  root = realpathSync(resolve(root));
  const hub = join(root, '.pbai4devs'), scripts = join(hub, 'scripts');
  for (const path of [hub, scripts]) {
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error('Diretório de testes inválido ou simbólico.');
  }
  const suites = readdirSync(scripts, { withFileTypes: true })
    .filter(entry => {
      if (entry.isSymbolicLink()) throw new Error('Entrada de script simbólica não é permitida.');
      if (!entry.isDirectory()) return false;
      const folder = join(scripts, entry.name, 'tests');
      const directory = lstatSync(folder, { throwIfNoEntry: false });
      if (!directory) return false;
      if (directory.isSymbolicLink()) throw new Error('Diretório de testes inválido ou simbólico.');
      if (!directory.isDirectory()) return false;
      const file = lstatSync(join(folder, 'TEST.mjs'), { throwIfNoEntry: false });
      if (file?.isSymbolicLink()) throw new Error('Arquivo de teste simbólico não é permitido.');
      return Boolean(file?.isFile());
    })
    .map(entry => entry.name).sort();
  if (!suites.length) throw new Error('Nenhuma suite Node encontrada.');
  const output = outputDirectory(root);
  const report = { status: 'passed', directory: output.run, suites: [] };
  const environment = { ...process.env };
  // Cada --test precisa de seu proprio contexto, inclusive ao testar este runner.
  // Inherited options could filter the tests without changing the output code.
  for (const key of Object.keys(environment)) if (['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'ADK_INFRA_ENTRY'].includes(key.toUpperCase())) delete environment[key];
  const reporter = new URL('./REPORTER.mjs', import.meta.url).href;
  for (const name of suites) {
    const file = join(scripts, name, 'tests/TEST.mjs');
    const result = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, file], { cwd: root, env: { ...environment, ADK_INFRA_ENTRY: file }, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const log = join(output.run, `${name}.log`);
    const logContent = `${result.stdout || ''}${result.stderr || ''}${result.error ? '\n' + result.error.message : ''}`;
    output.verify();
    writeFileSync(log, logContent, { flag: 'wx', mode: 0o600 });
    const match = result.stdout?.match(/\nADK_INFRA_EVIDENCE (\{[^\n]*\})\n$/);
    let evidence;
    try { evidence = match ? JSON.parse(match[1]) : undefined; } catch { /* inconclusive */ }
    if (Array.isArray(evidence?.skipped)) {
      evidence.skipped = evidence.skipped.map(item => {
        const fixture = expectedPlatformFixture(name, item, process.platform);
        return {
          ...item,
          expectedForPlatform: Boolean(fixture),
          ...(fixture ? { nativePlatform: fixture.native } : {}),
          classification: fixture ? 'platform' : item.reason ? 'unexpected' : 'missing-reason',
        };
      });
    }
    const status = classifyExecution(result, evidence);
    report.suites.push({ name, status, log, ...(evidence ? { evidence } : {}) });
    console.log(`${name}=${status}`);
    if (status === 'failed') { report.status = 'failed'; console.error(logContent.slice(-4000)); }
    else if (status === 'partial' && report.status === 'passed') report.status = 'partial';
  }
  output.verify();
  writeFileSync(join(output.run, 'REPORT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`report=${join(output.run, 'REPORT.json')}`);
  console.log(`suites=${suites.length}`);
  return report;
}

if (isMain(import.meta.url)) {
  try { if (testInfrastructure().status !== 'passed') process.exitCode = 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
