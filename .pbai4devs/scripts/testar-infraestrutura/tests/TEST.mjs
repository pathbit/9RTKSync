import '../../lib/test-git-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { projectRoot } from '../../lib/runtime.mjs';
import { classifyExecution, isExpectedPlatformSkip, testInfrastructure } from '../SCRIPT.mjs';
import { isTestEvent } from '../REPORTER.mjs';
import { nativeSkipReason, platformFixturePath, platformFixtures } from '../PLATFORM_FIXTURES.mjs';

test("events of non-entryFile versions are recognized without depending on the name", () => {
  const file = '/fixture/TEST.mjs';
  assert.equal(isTestEvent({ name: 'teste declarado', file, details: { type: 'test' } }), true);
  assert.equal(isTestEvent({ name: file, file, details: { type: 'test' } }), true);
  assert.equal(isTestEvent({ name: 'grupo', file, details: { type: 'suite' } }), false);
});

test("classification refuses absent evidence, inconsistent or interrupted execution", () => {
  const counts = { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
  const evidence = { observed: 1, fileSummaries: 1, counts, skipped: [], pending: [] };
  assert.equal(classifyExecution({ status: 0 }, evidence), 'passed');
  assert.equal(classifyExecution({ status: 1 }, evidence), 'failed');
  assert.equal(classifyExecution({ status: 0, signal: 'SIGTERM' }, evidence), 'failed');
  assert.equal(classifyExecution({ status: 0 }, null), 'partial');
  assert.equal(classifyExecution({ status: 0 }, { ...evidence, observed: 0 }), 'partial');
  assert.equal(classifyExecution({ status: 0 }, { ...evidence, fileSummaries: 0 }), 'partial');
  assert.equal(classifyExecution({ status: 0 }, { ...evidence, counts: { ...counts, passed: 0 } }), 'partial');
  assert.equal(classifyExecution({ status: 0 }, { ...evidence, counts: { ...counts, tests: 2 } }), 'partial');
  assert.equal(classifyExecution({ status: 0 }, { ...evidence, skipped: [{}] }), 'partial');
  assert.equal(classifyExecution({ status: 0 }, { ...evidence, pending: [{}] }), 'partial');
});

test('executa suites em raiz relativa, registra falhas e continua as demais', t => {
  const output = join(projectRoot, '.agent-tests'); mkdirSync(output, { recursive: true });
  const root = mkdtempSync(join(output, 'runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, pass] of [['a-fail', false], ['b-pass', true]]) {
    const folder = join(root, '.pbai4devs/scripts', name, 'tests'); mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'TEST.mjs'), `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('fixture', () => assert.equal(${pass}, true));\n`);
  }
  const report = testInfrastructure(relative(process.cwd(), root));
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.suites.map(suite => suite.status), ['failed', 'passed']);
  for (const suite of report.suites) assert.ok(readFileSync(suite.log, 'utf8').includes('fixture'));
  assert.deepEqual(JSON.parse(readFileSync(join(report.directory, 'REPORT.json'))), report);
});

function isolated(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'adk-infrastructure-'))), root = join(base, 'project');
  mkdirSync(root);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const put = (path, content) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); };
  put('.pbai4devs/scripts/demo/tests/TEST.mjs', "import { test } from 'node:test'; test('demo', () => {});\n");
  assert.equal(spawnSync('git', ['init', '-q', '--template=', root]).status, 0);
  put('human.txt', 'staged\n');
  assert.equal(spawnSync('git', ['-C', root, 'add', '--', 'human.txt']).status, 0);
  const index = readFileSync(join(root, '.git/index'));
  return { base, root, put, index };
}

test("each implementation preserves existing reports and the Git index", t => {
  const { root, put, index } = isolated(t);
  put('.agent-tests/infraestrutura/demo.log', 'log humano\n');
  put('.agent-tests/infraestrutura/REPORT.json', 'relatório humano\n');
  const first = testInfrastructure(root), firstReport = readFileSync(join(first.directory, 'REPORT.json'));
  const second = testInfrastructure(root);
  assert.notEqual(first.directory, second.directory);
  assert.deepEqual(readFileSync(join(first.directory, 'REPORT.json')), firstReport);
  assert.equal(readFileSync(join(root, '.agent-tests/infraestrutura/demo.log'), 'utf8'), 'log humano\n');
  assert.equal(readFileSync(join(root, '.agent-tests/infraestrutura/REPORT.json'), 'utf8'), 'relatório humano\n');
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
});

test("ACL inherited in log directory interrupts before running suites", { skip: nativeSkipReason('darwin') }, t => {
  const { root, put, index } = isolated(t), folder = join(root, '.agent-tests/infraestrutura');
  mkdirSync(folder, { recursive: true });
  const acl = 'everyone allow list,search,readattr,readextattr,readsecurity,file_inherit,directory_inherit';
  assert.equal(spawnSync('/bin/chmod', ['+a', acl, folder]).status, 0);
  put('.pbai4devs/scripts/demo/tests/TEST.mjs', "import { writeFileSync } from 'node:fs'; writeFileSync('executou.txt', 'sim');\n");
  assert.throws(() => testInfrastructure(root), /ACL do diretório de resultados/);
  assert.equal(existsSync(join(root, 'executou.txt')), false);
  const runs = readdirSync(folder).filter(name => name.startsWith('run-'));
  assert.equal(runs.length, 1);
  assert.deepEqual(readdirSync(join(folder, runs[0])), []);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
});

test("ACL non-verifiable log interrupts without exposing diagnosis", { skip: nativeSkipReason('darwin') }, t => {
  const { root, put, index } = isolated(t);
  put('.pbai4devs/scripts/demo/tests/TEST.mjs', "import { writeFileSync } from 'node:fs'; writeFileSync('executou.txt', 'sim');\n");
  const original = childProcess.spawnSync;
  let observed = false, failure;
  t.mock.method(childProcess, 'spawnSync', (command, args, ...rest) => {
    if (command === '/bin/ls' && typeof args?.at(-1) === 'string' && args.at(-1).includes('/infraestrutura/run-')) {
      observed = true;
      return { status: 1, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.from('diagnóstico sintético privado') };
    }
    return original(command, args, ...rest);
  });
  syncBuiltinESMExports();
  try { testInfrastructure(root); } catch (error) { failure = error; }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.ok(observed);
  assert.match(failure?.message || '', /ACL do diretório de resultados/);
  assert.doesNotMatch(failure.message, /diagnóstico sintético privado/);
  assert.equal(existsSync(join(root, 'executou.txt')), false);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
});

test("ACL log uncheckable after suite prevents recording output", { skip: nativeSkipReason('darwin') }, t => {
  const { root, put, index } = isolated(t);
  put('.pbai4devs/scripts/demo/tests/TEST.mjs', "import { writeFileSync } from 'node:fs'; import { test } from 'node:test'; test('sintético', () => { writeFileSync('executou.txt', 'sim'); console.log('saída sintética'); });\n");
  const original = childProcess.spawnSync;
  let queries = 0, failure;
  t.mock.method(childProcess, 'spawnSync', (command, args, ...rest) => {
    if (command === '/bin/ls' && typeof args?.at(-1) === 'string' && args.at(-1).includes('/infraestrutura/run-') && ++queries === 2) {
      return { status: 1, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.from('diagnóstico sintético privado') };
    }
    return original(command, args, ...rest);
  });
  syncBuiltinESMExports();
  try { testInfrastructure(root); } catch (error) { failure = error; }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(queries, 2);
  assert.match(failure?.message || '', /ACL do diretório de resultados/);
  assert.doesNotMatch(failure.message, /diagnóstico sintético privado/);
  assert.equal(readFileSync(join(root, 'executou.txt'), 'utf8'), 'sim');
  const parent = join(root, '.agent-tests/infraestrutura');
  const runs = readdirSync(parent).filter(name => name.startsWith('run-'));
  assert.equal(runs.length, 1);
  assert.deepEqual(readdirSync(join(parent, runs[0])), []);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
});

for (const path of ['.agent-tests', '.agent-tests/infraestrutura']) {
  test(`recusa ancestral simbólico ${path} antes de executar testes`, t => {
    const { base, root, put, index } = isolated(t), outside = join(base, 'outside');
    put('.pbai4devs/scripts/demo/tests/TEST.mjs', "import { writeFileSync } from 'node:fs'; writeFileSync('executou.txt', 'sim');\n");
    mkdirSync(outside);
    writeFileSync(join(outside, 'demo.log'), 'sentinela\n');
    const link = join(root, path); mkdirSync(dirname(link), { recursive: true }); symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => testInfrastructure(root), /inválido ou simbólico/);
    assert.equal(readFileSync(join(outside, 'demo.log'), 'utf8'), 'sentinela\n');
    assert.equal(existsSync(join(outside, 'REPORT.json')), false);
    assert.equal(existsSync(join(root, 'executou.txt')), false);
    assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  });
}

test("does not overwrite a symbolic log created during the suite", {
  skip: process.platform === 'win32' && 'A fixture cria um symlink de arquivo em um processo filho; junctions do NTFS só representam diretórios.',
}, t => {
  const { base, root, put, index } = isolated(t), outside = join(base, 'outside.txt');
  writeFileSync(outside, 'sentinela\n');
  put('.pbai4devs/scripts/demo/tests/TEST.mjs', `import fs from 'node:fs'; import { join } from 'node:path'; import { test } from 'node:test';\ntest('cria colisão', () => { const p = join(process.cwd(), '.agent-tests/infraestrutura'); const dir = fs.readdirSync(p).find(n => n.startsWith('run-')); fs.symlinkSync(${JSON.stringify(outside)}, join(p, dir, 'demo.log')); });\n`);
  assert.throws(() => testInfrastructure(root), error => error.code === 'EEXIST');
  assert.equal(readFileSync(outside, 'utf8'), 'sentinela\n');
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
});

for (const kind of ['diretório', 'arquivo']) {
  test(`recusa ${kind} de teste simbólico sem executar destino`, t => {
    const { base, root, index } = isolated(t), outside = join(base, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'TEST.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('executou.txt', 'sim');\n");
    const folder = join(root, '.pbai4devs/scripts/demo/tests'), file = join(folder, 'TEST.mjs');
    if (kind === 'diretório') {
      rmSync(folder, { recursive: true });
      symlinkSync(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
    } else {
      rmSync(file);
      try { symlinkSync(join(outside, 'TEST.mjs'), file, 'file'); }
      catch (error) {
        if (process.platform === 'win32' && ['EACCES', 'EPERM'].includes(error.code)) {
          t.skip('Windows não concedeu permissão para criar symlink de arquivo.');
          return;
        }
        throw error;
      }
    }
    assert.throws(() => testInfrastructure(root), /simbólico/);
    assert.equal(existsSync(join(root, 'executou.txt')), false);
    assert.equal(existsSync(join(root, '.agent-tests')), false);
    assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  });
}

test("does not silently omit a symbolic directory suite", t => {
  const { base, root, put, index } = isolated(t), outside = join(base, 'outside');
  mkdirSync(join(outside, 'tests'), { recursive: true });
  writeFileSync(join(outside, 'tests/TEST.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('externo.txt', 'sim');\n");
  put('.pbai4devs/scripts/demo/tests/TEST.mjs', "import { writeFileSync } from 'node:fs'; writeFileSync('executou.txt', 'sim');\n");
  symlinkSync(outside, join(root, '.pbai4devs/scripts/link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => testInfrastructure(root), /simbólica/);
  assert.equal(existsSync(join(root, 'executou.txt')), false);
  assert.equal(existsSync(join(root, 'externo.txt')), false);
  assert.equal(existsSync(join(root, '.agent-tests')), false);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
});

test("does not approve an execution without suites", t => {
  const output = join(projectRoot, '.agent-tests'); mkdirSync(output, { recursive: true });
  const root = mkdtempSync(join(output, 'runner-empty-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.pbai4devs/scripts'), { recursive: true });
  assert.throws(() => testInfrastructure(root), /Nenhuma suite Node/);
});

for (const [scenario, source] of [
  ['teste ignorado', "import { test } from 'node:test'; test('ignorado', { skip: true }, () => {});\n"],
  ['teste pendente', "import { test } from 'node:test'; test('pendente', { todo: true }, () => {});\n"],
  ['suíte com teste aprovado e outro ignorado', "import { test } from 'node:test'; test('ok', () => {}); test('ignorado', { skip: true }, () => {});\n"],
  ['grupo ignorado com outro teste aprovado', "import { test, describe } from 'node:test'; test('ok', () => {}); describe('grupo', { skip: true }, () => { test('não executado', () => {}); });\n"],
  ['grupo pendente com outro teste aprovado', "import { test, describe } from 'node:test'; test('ok', () => {}); describe('grupo', { todo: true }, () => { test('pendente', () => {}); });\n"],
  ['arquivo sem testes declarados', 'export const fixture = true;\n'],
  ['saída que imita evidência', `console.log('ADK_INFRA_EVIDENCE {"observed":1,"fileSummaries":1,"counts":{"tests":1,"passed":1,"failed":0,"cancelled":0,"skipped":0,"todo":0}}');\n`],
  ['execução encerrada antes de terminar', "import { test } from 'node:test'; test('concluído', () => {}); test('pendente', async () => { await new Promise(() => {}); }); setTimeout(() => process.exit(0), 200);\n"],
]) {
  test(`relatório não certifica ${scenario}`, t => {
    const { root, put, index } = isolated(t);
    put('.pbai4devs/scripts/demo/tests/TEST.mjs', source);
    const report = testInfrastructure(root);
    assert.deepEqual(readFileSync(join(root, '.git/index')), index);
    assert.equal(report.status, 'partial');
    assert.equal(report.suites[0].status, 'partial');
  });
}

test("inherited options from Node do not filter the suite", t => {
  const { root, index } = isolated(t), previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--test-name-pattern=nome-que-nao-existe';
  try {
    const report = testInfrastructure(root);
    assert.equal(report.status, 'passed');
    assert.equal(report.suites[0].evidence.observed, 1);
    assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
});

test("report identifies skips without exposing absolute paths", t => {
  const { root, put } = isolated(t);
  put('.pbai4devs/scripts/demo/tests/TEST.mjs', `
    import { test } from 'node:test';
    test('alvo', { skip: 'indisponível neste sistema' }, () => {});
    test('sem motivo', { skip: true }, () => {});
    test('motivo vazio', { skip: '   ' }, () => {});
  `);
  const report = testInfrastructure(root);
  assert.equal(report.status, 'partial');
  assert.equal(report.suites[0].evidence.counts.skipped, 3);
  assert.deepEqual(report.suites[0].evidence.skipped, [{
    name: 'alvo', file: '.pbai4devs/scripts/demo/tests/TEST.mjs', reason: 'indisponível neste sistema',
    kind: 'test', event: 'test:pass', booleanSkip: false, todo: false, expectedForPlatform: false, classification: 'unexpected',
  }, {
    name: 'sem motivo', file: '.pbai4devs/scripts/demo/tests/TEST.mjs', reason: null,
    kind: 'test', event: 'test:pass', booleanSkip: true, todo: false, expectedForPlatform: false, classification: 'missing-reason',
  }, {
    name: 'motivo vazio', file: '.pbai4devs/scripts/demo/tests/TEST.mjs', reason: null,
    kind: 'test', event: 'test:pass', booleanSkip: false, todo: false, expectedForPlatform: false, classification: 'missing-reason',
  }]);
});

test('skip de alias Windows exige identidade restrita e motivo exato', () => {
  const skipped = {
    name: 'Windows normalizes temporary aliases 8.3 before comparing the Git root',
    file: '.pbai4devs/scripts/sincronizar-agentes/tests/LOCAL_IGNORE.mjs',
    reason: 'Requer Windows para verificar a resolução de alias 8.3.',
    kind: 'test', event: 'test:pass', booleanSkip: false, todo: false,
  };
  assert.equal(isExpectedPlatformSkip('sincronizar-agentes', skipped, 'linux'), true);
  assert.equal(isExpectedPlatformSkip('sincronizar-agentes', skipped, 'darwin'), true);
  assert.equal(isExpectedPlatformSkip('sincronizar-agentes', skipped, 'win32'), false);
  assert.equal(isExpectedPlatformSkip('outro', skipped, 'linux'), false);
  for (const change of [{ name: 'outro' }, { file: 'outro' }, { reason: 'outro' }, { reason: '' }, { reason: null }, { kind: 'suite' }, { event: 'test:fail' }, { booleanSkip: true }, { todo: true }]) {
    assert.equal(isExpectedPlatformSkip('sincronizar-agentes', { ...skipped, ...change }, 'linux'), false);
  }
});

test("expected skips preserve reasons, counts and partial result in the report", {
  skip: ['darwin', 'linux'].includes(process.platform) ? false : 'Requer Linux ou macOS para exercitar a delegação da suíte.',
}, t => {
  const { root, put } = isolated(t);
  const folder = '.pbai4devs/scripts/sincronizar-agentes/tests';
  const fixtures = platformFixtures.filter(item => item.suite === 'sincronizar-agentes' && item.platforms.includes(process.platform));
  const names = fixtures.flatMap(fixture => fixture.names);
  assert.equal(names.length, process.platform === 'darwin' ? 4 : 3);
  put(`${folder}/TEST.mjs`, fixtures.map(fixture => `import './${fixture.file}';\n`).join(''));
  for (const fixture of fixtures) {
    const reason = JSON.stringify(nativeSkipReason(fixture.native));
    put(platformFixturePath(fixture), [
      "import { test } from 'node:test';",
      "test('controle', () => {});",
      ...fixture.names.map(name => `test(${JSON.stringify(name)}, { skip: ${reason} }, () => {});`),
    ].join('\n'));
  }
  const report = testInfrastructure(root), suite = report.suites.find(item => item.name === 'sincronizar-agentes');
  const { counts, skipped } = suite.evidence;
  assert.equal(report.status, 'partial');
  assert.equal(suite.status, 'partial');
  assert.equal(counts.passed, fixtures.length);
  assert.equal(counts.skipped, names.length);
  assert.equal(counts.tests, fixtures.length + names.length);
  assert.deepEqual(skipped.map(item => item.name).sort(), names.sort());
  for (const item of skipped) {
    assert.equal(item.expectedForPlatform, true);
    assert.equal(item.classification, 'platform');
    assert.equal(item.reason, nativeSkipReason(item.nativePlatform));
  }
  assert.deepEqual(JSON.parse(readFileSync(join(report.directory, 'REPORT.json'))), report);
});

test("imported test does not certify file that ends before pending test", t => {
  const { root, put } = isolated(t);
  put('.pbai4devs/scripts/demo/tests/helper.mjs', "import { test } from 'node:test'; test('importado', () => {});\n");
  put('.pbai4devs/scripts/demo/tests/TEST.mjs', "import './helper.mjs'; import { test } from 'node:test'; test('pendente', async () => { await new Promise(() => {}); }); setTimeout(() => process.exit(0), 200);\n");
  const report = testInfrastructure(root);
  assert.notEqual(report.status, 'passed');
});

test("suite importing completed test keeps approved result", t => {
  const { root, put } = isolated(t);
  put('.pbai4devs/scripts/demo/tests/helper.mjs', "import { test } from 'node:test'; test('importado', () => {});\n");
  put('.pbai4devs/scripts/demo/tests/TEST.mjs', "import './helper.mjs';\n");
  const report = testInfrastructure(root);
  assert.equal(report.status, 'passed');
  assert.equal(report.suites[0].evidence.fileSummaries, 1);
});
