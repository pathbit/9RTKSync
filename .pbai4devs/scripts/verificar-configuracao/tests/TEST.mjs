import '../../lib/test-git-environment.mjs';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { projectRoot } from '../../lib/runtime.mjs';
import { verifyConfiguration } from '../SCRIPT.mjs';

function fixture(t) {
  const base = join(projectRoot, '.agent-tests'); mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'config-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    const destination = join(root, file); mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  };
  for (const file of ['lib/runtime.mjs', 'lib/state-path.mjs', 'lib/script-config.mjs', 'executar-script/SCRIPT.mjs', 'verificar-configuracao/SCRIPT.mjs']) {
    const destination = join(root, '.pbai4devs/scripts', file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(projectRoot, '.pbai4devs/scripts', file), destination);
  }
  const state = (body, folder = 'state') => write(`.pbai4devs/${folder}/configuracao/ESTADO.md`, body);
  const run = (...args) => {
    const file = join(root, '.pbai4devs/scripts/verificar-configuracao/SCRIPT.mjs');
    const result = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8' });
    assert.ifError(result.error);
    return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
  };
  return { root, state, write, run };
}

const document = (preparation, configuration) => `---\npreparacao: ${preparation}\nconfiguracao_tecnica: ${configuration}\ndocumentos:\n  prd: docs/PRD.md\n---\n\n# Estado\n`;

test("blocks before code when the state is missing or pending", t => {
  const { root, state, run } = fixture(t);
  assert.deepEqual(run().report.motivo, 'estado-ausente');
  assert.equal(run().status, 1);
  for (const [preparation, configuration] of [['pendente', 'pendente'], ['concluido', 'pendente'], ['pendente', 'concluido']]) {
    state(document(preparation, configuration));
    const result = run(); assert.equal(result.status, 1);
    assert.equal(result.report.motivo, 'configuracao-pendente');
    assert.equal(existsSync(join(root, 'src')), false);
  }
});

test("accepts the actual model and maintains application evidence as separate verification", t => {
  const { root, state, run } = fixture(t);
  const template = readFileSync(join(projectRoot, '.pbai4devs/templates/configuracao/TEMPLATE.md'), 'utf8');
  state(template); assert.equal(run().report.motivo, 'configuracao-pendente');
  state(template.replace('preparacao: pendente', 'preparacao: concluido')
    .replace('configuracao_tecnica: pendente', 'configuracao_tecnica: concluido'));
  assert.equal(run().report.status, 'verificar-evidencias');
  assert.equal(existsSync(join(root, 'src')), false);
});

test("consultation only preparation without requiring early technical configuration", t => {
  const { root, state, run, write } = fixture(t);
  assert.equal(run('--preparacao').report.motivo, 'estado-ausente');
  state(document('pendente', 'concluido'));
  assert.equal(run('--preparacao').report.motivo, 'preparacao-pendente');
  state(document('concluido', 'pendente'));
  write('.gitignore', 'node_modules/\n'); write('AGENTS.md', '# Humano\n');
  assert.equal(spawnSync('git', ['init', '--quiet', root]).status, 0);
  assert.equal(spawnSync('git', ['-C', root, 'add', '.gitignore', 'AGENTS.md']).status, 0);
  const paths = ['.git/index', '.gitignore', 'AGENTS.md', '.pbai4devs/state/configuracao/ESTADO.md'];
  const before = paths.map(path => readFileSync(join(root, path)));
  const result = run('--preparacao');
  assert.equal(result.status, 0);
  assert.equal(result.report.status, 'verificar-evidencias');
  assert.match(result.report.limite, /não comprova evidências/);
  assert.equal(run().report.motivo, 'configuracao-pendente');
  assert.deepEqual(paths.map(path => readFileSync(join(root, path))), before);
  state('---\npreparacao: concluido\n---\n\n# Estado\n');
  assert.equal(run('--preparacao').report.status, 'verificar-evidencias');
  assert.equal(run().report.motivo, 'estado-invalido');
  state('---\npreparacao: concluido\npreparacao: pendente\n---\n\n# Estado\n');
  assert.equal(run('--preparacao').report.motivo, 'estado-invalido');
});

test("completed indicators require further review of evidence and do not change Git", t => {
  const { root, state, write, run } = fixture(t);
  state(document('"concluido" # aprovado', "'concluido'"));
  write('.gitignore', 'node_modules/\n'); write('AGENTS.md', '# Instruções humanas\n');
  assert.equal(spawnSync('git', ['init', '--quiet', root]).status, 0);
  assert.equal(spawnSync('git', ['-C', root, 'add', '.gitignore', 'AGENTS.md']).status, 0);
  const index = readFileSync(join(root, '.git/index'));
  const statePath = join(root, '.pbai4devs/state/configuracao/ESTADO.md');
  const original = readFileSync(statePath), ignore = readFileSync(join(root, '.gitignore'));
  const result = run(); assert.equal(result.status, 0);
  assert.equal(result.report.status, 'verificar-evidencias');
  assert.match(result.report.limite, /não comprova evidências/);
  assert.deepEqual(readFileSync(statePath), original);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  assert.deepEqual(readFileSync(join(root, '.gitignore')), ignore);
  assert.equal(existsSync(join(root, 'src')), false);
});

test("refuses missing, unknown, duplicated indicators and does not expose values", t => {
  const { state, run } = fixture(t);
  const secret = 'SENSITIVE_VALUE_47849';
  for (const value of [
    'preparacao: concluido',
    'preparacao: concluido\nconfiguracao_tecnica: ausente',
    'preparacao: concluido\npreparacao: pendente\nconfiguracao_tecnica: concluido',
    'preparacao: concluido\nconfiguracao_tecnica: concluido\n"configuracao_tecnica": pendente',
    "'preparacao': concluido\npreparacao: pendente\nconfiguracao_tecnica: concluido",
    'preparacao: concluido\n"prepara\\u0063ao": pendente\nconfiguracao_tecnica: concluido',
    'preparacao: concluido\nconfiguracao_tecnica: concluido\n!!str configuracao_tecnica: pendente',
    'preparacao: concluido\nconfiguracao_tecnica: concluido\npadrao: &base { configuracao_tecnica: pendente }',
    'preparacao: concluido\nconfiguracao_tecnica: concluido\npadrao: *base',
    'preparacao: concluido\nconfiguracao_tecnica: concluido\npadrao: !!str valor',
    'preparacao: concluido\nconfiguracao_tecnica: concluido\n<<: *base',
    'preparacao: concluido\nconfiguracao_tecnica: concluido\n? configuracao_tecnica\n: pendente',
    `preparacao: concluido\nconfiguracao_tecnica: ${secret}`,
    'preparacao: concluido\nconfiguracao_tecnica: true',
  ]) {
    state(`---\n${value}\n---\n# Estado\n`);
    const result = run(); assert.equal(result.status, 1);
    assert.equal(result.report.motivo, 'estado-invalido');
    assert.ok(!result.stdout.includes(secret)); assert.ok(!result.stderr.includes(secret));
  }
  state('preparacao: concluido\nconfiguracao_tecnica: concluido\n');
  assert.equal(run().report.motivo, 'estado-invalido');
  state('---\n"preparacao": concluido\n\'configuracao_tecnica\': concluido\n---\n# Estado\n');
  assert.equal(run().report.status, 'verificar-evidencias');
});

test("accepts legacy status and refuses coexistence of state trees", t => {
  const { state, run } = fixture(t);
  state(document('concluido', 'concluido'), 'estado');
  assert.equal(run().report.status, 'verificar-evidencias');
  state(document('concluido', 'concluido'));
  const result = run(); assert.equal(result.status, 1);
  assert.equal(result.report.motivo, 'estado-inacessivel-ou-inseguro');
});

test("does not follow human link in file or status folder", t => {
  const { root, state, run } = fixture(t);
  const outside = join(root, 'fora'); mkdirSync(outside);
  const target = join(outside, 'ESTADO.md'); writeFileSync(target, document('concluido', 'concluido'));
  const directory = join(root, '.pbai4devs/state/configuracao'); mkdirSync(directory, { recursive: true });
  try { symlinkSync(target, join(directory, 'ESTADO.md')); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Sem permissão para links.'); return; } throw error; }
  assert.equal(run().report.motivo, 'estado-inseguro');
  assert.equal(readFileSync(target, 'utf8'), document('concluido', 'concluido'));
  unlinkSync(join(directory, 'ESTADO.md')); rmdirSync(directory);
  symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(run().report.motivo, 'estado-inseguro');
  assert.equal(readFileSync(target, 'utf8'), document('concluido', 'concluido'));
});

test("requires Node and rejects extra arguments without reading another project", t => {
  const { root, run } = fixture(t);
  const result = run('--root', root); assert.equal(result.status, 2);
  assert.match(result.stderr, /\[--preparacao\]/);
  assert.equal(verifyConfiguration(root).status, 'bloqueado');
});

test("script selector propagates lock and requires evidence review", t => {
  const { root, state } = fixture(t);
  const selector = join(root, '.pbai4devs/scripts/executar-script/SCRIPT.mjs');
  const execute = () => spawnSync(process.execPath, [selector, 'verificar-configuracao'], { cwd: root, encoding: 'utf8' });
  state(document('concluido', 'pendente'));
  const pending = execute(); assert.ifError(pending.error); assert.equal(pending.status, 1);
  assert.match(pending.stdout, /"motivo":"configuracao-pendente"/);
  const preparation = spawnSync(process.execPath, [selector, 'verificar-configuracao', '--preparacao'], { cwd: root, encoding: 'utf8' });
  assert.ifError(preparation.error); assert.equal(preparation.status, 0);
  assert.match(preparation.stdout, /"status":"verificar-evidencias"/);
  const raw = spawnSync(process.execPath, [selector, '--raw', 'verificar-configuracao', '--preparacao'], { cwd: root, encoding: 'utf8' });
  assert.ifError(raw.error); assert.equal(raw.status, 0);
  assert.equal(JSON.parse(raw.stdout).status, 'verificar-evidencias');
  assert.match(raw.stderr, /runtime=node/);
  state(document('concluido', 'concluido'));
  const recorded = execute(); assert.ifError(recorded.error); assert.equal(recorded.status, 0);
  assert.match(recorded.stdout, /"status":"verificar-evidencias"/);
});
