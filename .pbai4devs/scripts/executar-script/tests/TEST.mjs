import { test } from 'node:test';
import './RAW.mjs';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveScript } from '../SCRIPT.mjs';
import { projectRoot, requireNode } from '../../lib/runtime.mjs';

const script = fileURLToPath(new URL('../SCRIPT.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
function createSymlink(t, target, path, type) {
  try { symlinkSync(target, path, type); return true; }
  catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.skip('Sistema sem permissao para criar symlinks de teste.');
    return false;
  }
}
function fixture(t) {
  mkdirSync(join(projectRoot, '.agent-tests'), { recursive: true });
  const root = mkdtempSync(join(projectRoot, '.agent-tests/executor-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, content) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); return file; };
  return { root, write };
}

test('Node 24 e necessario e nao ha tentativa de runtime alternativo', () => {
  assert.doesNotThrow(() => requireNode(24, '24.0.0', 'linux'));
  assert.throws(() => requireNode(24, '22.22.0'), /Node.js >=24/);
});

test("plan resolves folder or file without running; arguments and cwd are preserved", t => {
  const { root, write } = fixture(t); const marker = join(root, 'output.json');
  const file = write('com espacos/SCRIPT.mjs', `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify({args:process.argv.slice(3),cwd:process.cwd()}));`);
  const planned = run('--plan', dirname(file), marker); assert.equal(planned.status, 0, planned.stderr); assert.match(planned.stdout, /runtime=node/); assert.equal(existsSync(marker), false);
  const value = 'espacos;$(nao execute)'; const result = run(file, marker, value, '--option');
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), { args: [value, '--option'], cwd: projectRoot });
});

test('nomes encontram SCRIPT.mjs; falha nao executa outra variante', t => {
  assert.match(run('--plan', 'preparar-ferramentas').stdout, /preparar-ferramentas\/SCRIPT.mjs/);
  const { root, write } = fixture(t); const file = write('failed/SCRIPT.mjs', 'process.exit(23);');
  write('failed/SCRIPT.js', `throw new Error('Nao deve executar variante alternativa');`);
  const result = run(dirname(file)); assert.equal(result.status, 23); assert.doesNotMatch(result.stderr, /alternativa/);
  assert.equal(resolveScript(file).file, file); assert.equal(existsSync(join(root, 'unused')), false);
});

test('shell e Python sao recusados mesmo quando executaveis; js e cjs usam Node', t => {
  const { write } = fixture(t);
  for (const name of ['SCRIPT.sh', 'SCRIPT.ps1', 'SCRIPT.cmd', 'SCRIPT.bat', 'SCRIPT.py']) assert.equal(run(write(name, 'exit 0')).status, 2);
  for (const name of ['file.js', 'file.cjs']) {
    const result = run(write(name, "console.log('node=passed');")); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /node=passed/);
  }
});

test("off root paths, file symlinks, folder or conf do not escape the containment", async t => {
  const { root, write } = fixture(t); const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const external = write('outside.mjs', 'process.exit(0);');
  assert.throws(() => resolveScript(external, { root: workspace }), /fora do repositorio/);
  const internal = write('workspace/inside/SCRIPT.mjs', 'process.exit(0);');
  await t.test('arquivo simbolico', subtest => {
    if (!createSymlink(subtest, internal, join(workspace, 'alias.mjs'))) return;
    assert.throws(() => resolveScript(join(workspace, 'alias.mjs'), { root: workspace }), /simbolico/);
  });
  await t.test('diretorio simbolico', subtest => {
    if (!createSymlink(subtest, dirname(internal), join(workspace, 'alias-dir'), 'dir')) return;
    assert.throws(() => resolveScript(join(workspace, 'alias-dir/SCRIPT.mjs'), { root: workspace }), /simbolico/);
  });
  await t.test('configuracao simbolica', subtest => {
    const config = write('real.conf', 'executor=playwright-mcp');
    if (!createSymlink(subtest, config, join(dirname(internal), 'SCRIPT.conf'))) return;
    assert.throws(() => resolveScript(internal, { root: workspace }), /simbolico/);
  });
  await t.test("targetless symbol configuration", subtest => {
    const script = write('workspace/dangling/SCRIPT.mjs', 'process.exit(0);');
    if (!createSymlink(subtest, join(workspace, 'missing.conf'), join(dirname(script), 'SCRIPT.conf'))) return;
    assert.throws(() => resolveScript(script, { root: workspace }), /simbolico/);
  });
});

test("Playwright keeps plan and code 69 without running connector file", t => {
  const { root, write } = fixture(t); const marker = join(root, 'should-not-exist');
  const file = write('browser/SCRIPT.js', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad');`);
  write('browser/SCRIPT.conf', 'executor=playwright-mcp\n');
  const plan = run('--plan', dirname(file)); assert.equal(plan.status, 0); assert.match(plan.stdout, /executor=playwright-mcp/);
  const result = run(dirname(file)); assert.equal(result.status, 69); assert.match(result.stderr, /conector Playwright/); assert.equal(existsSync(marker), false);
});

test('configuracao invalida nunca recai em Node nem executa outro script', t => {
  const { root, write } = fixture(t);
  const marker = join(root, 'must-not-run');
  const file = write('configured/SCRIPT.mjs', `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'bad');`);
  for (const config of ['', '# comentario\n', 'executor=python\n', 'other=node\n', 'executor=node\nexecutor=node\n', 'executor=node\nexecutor=playwright-mcp\n']) {
    write('configured/SCRIPT.conf', config);
    const result = run(file);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /SCRIPT.conf exige/);
    assert.equal(existsSync(marker), false);
  }
  write('configured/SCRIPT.conf', '# Node explicito\n executor = node \n');
  assert.equal(resolveScript(file).executor, 'node');
});

test("connector configuration and target need to be regular files", t => {
  const { root, write } = fixture(t);
  const script = write('bad-config/SCRIPT.mjs', 'process.exit(0);');
  mkdirSync(join(dirname(script), 'SCRIPT.conf'));
  assert.throws(() => resolveScript(script), /SCRIPT.conf deve ser um arquivo/);
  write('bad-connector/SCRIPT.conf', 'executor=playwright-mcp\n');
  mkdirSync(join(root, 'bad-connector/SCRIPT.js'));
  assert.throws(() => resolveScript(join(root, 'bad-connector')), /SCRIPT.js do conector deve ser um arquivo/);
  const alternate = write('connector/other.mjs', 'process.exit(0);');
  write('connector/SCRIPT.conf', 'executor=playwright-mcp\n');
  write('connector/SCRIPT.js', 'page.title();');
  assert.throws(() => resolveScript(alternate), /exige o arquivo SCRIPT.js configurado/);
});

test("missing or invalid path fails without looking for system interpreters", () => {
  assert.equal(run().status, 2); assert.equal(run('missing-agent-script').status, 2);
  assert.equal(run('--help').status, 0);
});
