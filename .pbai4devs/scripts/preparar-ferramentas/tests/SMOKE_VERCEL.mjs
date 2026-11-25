#!/usr/bin/env node
// Exercise installed CLIs; results stay in .agent-tests, without installing packages.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireNode } from '../../lib/runtime.mjs';

requireNode();
const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../../../..');
const manager = resolve(here, '../SCRIPT.mjs');
const artifacts = join(project, '.agent-tests/vercel-labs');
mkdirSync(artifacts, { recursive: true });
const runRoot = mkdtempSync(join(artifacts, 'smoke-'));
const reportFile = join(runRoot, 'REPORT.json');
const report = {
  startedAt: new Date().toISOString(),
  scope: 'CLIs locais com fixtures; sem browser, produto, proxy, TLS ou chamadas de modelo.',
  limitations: [
    'Probes de versão/ajuda comprovam inicialização, não o fluxo de um produto.',
    'webreel valida e resolve roteiro; gravação de vídeo e Chrome não são exercitados.',
    'opensrc lista cache local; resolução de registries e download de fontes não são exercitados.',
  ],
  steps: [],
};
let sequence = 0;

function snapshot(folder) {
  if (!existsSync(folder)) return null;
  const entries = [];
  function visit(base, path = '') {
    for (const name of readdirSync(base).sort()) {
      const file = join(base, name);
      const item = path ? `${path}/${name}` : name;
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) entries.push({ path: item, type: 'symlink' });
      else if (stat.isDirectory()) { entries.push({ path: item, type: 'directory' }); visit(file, item); }
      else entries.push({ path: item, type: 'file', sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
    }
  }
  visit(folder);
  return entries;
}

function fixture(name) {
  const folder = join(runRoot, name);
  cpSync(join(here, 'fixtures-vercel', name), folder, { recursive: true });
  return folder;
}

function stateDirectory(tool, variable) {
  const config = JSON.parse(readFileSync(join(project, '.pbai4devs/tools', tool, 'TOOL.json'), 'utf8'));
  assert.equal(typeof config.envPaths?.[variable], 'string', `TOOL.json deve isolar ${variable} via envPaths.`);
  const local = join(project, '.pbai4devs/tools', tool, '.local');
  const state = resolve(local, config.envPaths[variable]);
  const traversal = relative(local, state);
  assert.ok(traversal && !isAbsolute(traversal) && traversal !== '..' && !traversal.startsWith('../') && !traversal.startsWith('..\\'), `${variable} fora da instalação local.`);
  return state;
}

function run(tool, args, cwd) {
  const command = [manager, 'run', tool, ...args];
  const result = spawnSync(process.execPath, command, {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, CI: '1', NO_COLOR: '1', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', NO_UPDATE_NOTIFIER: '1' },
  });
  const log = join(runRoot, `${String(++sequence).padStart(2, '0')}-${tool}.json`);
  writeFileSync(log, JSON.stringify({ executable: process.execPath, args: command, cwd, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2) + '\n');
  report.steps.at(-1).logs.push(log);
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${tool}: processo interrompido; veja ${log}`);
  assert.equal(result.status, 0, `${tool}: saída ${result.status}; veja ${log}`);
  return result.stdout;
}

function check(name, kind, action) {
  const step = { name, kind, status: 'running', logs: [] };
  report.steps.push(step);
  try {
    const detail = action();
    if (detail) step.detail = detail;
    step.status = 'passed';
  } catch (error) {
    step.status = 'failed';
    step.error = error.message;
    process.exitCode = 1;
  }
}

const tools = ['skills', 'just-bash', 'opensrc', 'webreel', 'portless'];
check('Instalações locais disponíveis', 'precondition', () => {
  for (const name of tools) {
    const folder = join(project, '.pbai4devs/tools', name);
    assert.ok(existsSync(join(folder, 'TOOL.json')), `Definição ausente: ${name}. Configure antes de executar este smoke.`);
    assert.ok(existsSync(join(folder, '.local/CURRENT.json')), `Ferramenta ausente: ${name}. Execute install ${name} antes deste smoke; ele não instala pacotes.`);
  }
});

if (report.steps[0].status === 'passed') {
  check('skills descobre skill local sem instalar nem criar apontamentos', 'functional', () => {
    const cwd = fixture('skills');
    const before = snapshot(cwd);
    const state = stateDirectory('skills', 'XDG_STATE_HOME');
    const stateBefore = snapshot(state);
    const stdout = run('skills', ['add', join(cwd, 'agentdevkit-smoke'), '--list'], cwd);
    assert.match(stdout, /agentdevkit-smoke/);
    assert.deepEqual(snapshot(cwd), before, 'A listagem criou ou alterou arquivos, links, locks ou pastas de clientes.');
    assert.deepEqual(snapshot(state), stateBefore, 'A listagem criou ou alterou estado/locks de skills fora do cwd.');
    assert.ok(before.every(item => item.type !== 'symlink'));
  });

  check('just-bash executa cat e grep com saída JSON', 'functional', () => {
    const cwd = fixture('just-bash');
    const before = snapshot(cwd);
    const result = JSON.parse(run('just-bash', ['--root', cwd, '-c', 'cat input.txt | grep agentdevkit', '--json'], cwd));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'agentdevkit example\n');
    assert.equal(result.stderr, '');
    assert.deepEqual(snapshot(cwd), before);
  });

  check('just-bash escreve no overlay sem persistir no disco', 'functional', () => {
    const cwd = fixture('just-bash-overlay');
    const before = snapshot(cwd);
    const result = JSON.parse(run('just-bash', ['--root', cwd, '--allow-write', '-c', 'printf overlay > output.txt; cat output.txt', '--json'], cwd));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'overlay');
    assert.equal(result.stderr, '');
    assert.equal(existsSync(join(cwd, 'output.txt')), false);
    assert.deepEqual(snapshot(cwd), before);
  });

  check('opensrc lista somente o cache local configurado', 'functional', () => {
    const cache = stateDirectory('opensrc', 'OPENSRC_HOME');
    const before = snapshot(cache);
    const cwd = join(runRoot, 'opensrc');
    mkdirSync(cwd);
    const stdout = run('opensrc', ['list', '--json'], cwd).trim();
    let detail;
    if (stdout.startsWith('{')) {
      const index = JSON.parse(stdout);
      assert.ok(index && typeof index === 'object' && !Array.isArray(index));
      for (const key of ['packages', 'repos']) if (index[key] !== undefined) assert.ok(Array.isArray(index[key]));
      detail = 'Índice JSON local lido sem downloads.';
    } else {
      assert.match(stdout, /^No sources cached yet\./);
      const indexFile = join(cache, 'sources.json');
      const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {};
      assert.equal((index.packages?.length || 0) + (index.repos?.length || 0), 0);
      detail = 'Cache vazio. A CLI upstream retorna texto mesmo com --json nesse estado.';
    }
    assert.deepEqual(snapshot(cache), before, 'A listagem alterou o cache.');
    assert.deepEqual(readdirSync(cwd), []);
    return detail;
  });

  check('webreel valida roteiro local e resolve dry-run sem gravar', 'functional', () => {
    const cwd = fixture('webreel');
    const config = join(cwd, 'webreel.config.json');
    const before = snapshot(cwd);
    assert.match(run('webreel', ['validate', '--config', config], cwd), /webreel\.config\.json: valid/);
    const stdout = run('webreel', ['record', '--dry-run', '--config', config], cwd);
    assert.match(stdout, /Resolved configuration/);
    assert.match(stdout, /agentdevkit-smoke/);
    assert.match(stdout, /pause 10ms/);
    assert.match(stdout, /index\.html/);
    assert.deepEqual(snapshot(cwd), before, 'O dry-run criou artefatos ou alterou a fixture.');
  });

  check('portless inicia versão e ajuda sem iniciar proxy', 'probe', () => {
    const cwd = join(runRoot, 'portless');
    mkdirSync(cwd);
    const state = stateDirectory('portless', 'PORTLESS_STATE_DIR');
    const stateBefore = snapshot(state);
    assert.match(run('portless', ['--version'], cwd), /\d+\.\d+\.\d+/);
    assert.match(run('portless', ['--help'], cwd), /portless/i);
    assert.deepEqual(readdirSync(cwd), []);
    assert.deepEqual(snapshot(state), stateBefore, 'Versão/ajuda criaram ou alteraram estado do proxy.');
  });
}

report.completedAt = new Date().toISOString();
report.status = report.steps.every(step => step.status === 'passed') ? 'passed' : 'failed';
writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, passed: report.steps.filter(step => step.status === 'passed').length, failed: report.steps.filter(step => step.status === 'failed').length, report: reportFile }));
