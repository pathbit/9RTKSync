import '../../lib/test-git-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkCommit, checkMerge, checkReview, prepareReview, sealReview, specCriteria } from '../SCRIPT.mjs';
import { projectRoot } from '../../lib/runtime.mjs';

function fixture(t) {
  mkdirSync(join(projectRoot, '.agent-tests'), { recursive: true });
  const root = mkdtempSync(join(projectRoot, '.agent-tests/review-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  git('init', '-q');
  const put = (file, body) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), body); };
  put('.gitignore', '/.agent-tests/\n'); put('README.md', '# Projeto\n'); put('src/main.mjs', 'export const value=1;\n');
  put('spec.md', '# Spec\n\n## Critérios de aceite\n\n| ID | Resultado |\n| --- | --- |\n| AC-001 | Um |\n| AC-002 | Dois |\n\n## Dependências\n\nNenhuma.\n');
  return { root, git, put };
}

function approved(t, options = {}, setup = () => {}, seal = true) {
  const f = fixture(t);
  setup(f);
  const made = prepareReview({ root: f.root, id: 'mudanca', execution: 'exec-1', scope: ['src/main.mjs'], spec: 'spec.md', ...options });
  const report = made.report;
  for (const item of report.documentation) Object.assign(item, { decision: 'no-impact', reason: 'Comportamento externo preservado; revisado.' });
  const proof = '.agent-tests/mudanca/exec-1/test.txt'; f.put(proof, 'teste real de fixture passou\n');
  for (const item of report.validation) Object.assign(item, { method: 'node --test', prerequisite: 'Node 24', assertion: 'Resultado esperado presente', evidence: [proof], status: 'passed' });
  report.review = { status: 'approved', reviewer: 'revisor-independente', findings: [] };
  const save = () => f.put(made.file, JSON.stringify(report, null, 2)); save();
  if (seal) sealReview(made.file, { root: f.root });
  return { ...f, ...made, save, proof };
}

test('aprova relatorio completo e liga spec, documentos e evidencias ignoradas', t => {
  const f = approved(t);
  const result = checkReview(f.file, { root: f.root });
  assert.equal(result.status, 'passed');
  assert.equal(result.reviewVerification, 'not-verified');
  assert.equal(sealReview(f.file, { root: f.root }).reviewVerification, 'not-verified');
  assert.equal(f.report.validation.length, 2);
  assert.ok(f.report.snapshot.files.some(item => item.path === 'README.md'));
  assert.ok(f.report.snapshot.files.some(item => item.path === 'spec.md'));
  assert.equal(f.git('ls-files', '--', '.agent-tests').trim(), '');
});

for (const [part, label] of [
  ['report', 'relatorio de revisao'],
  ['baseline', 'baseline de revisao'],
  ['seal', 'selo de revisao'],
]) test(`JSON malformado em ${part} nao expõe conteúdo na API nem na CLI`, t => {
  const f = approved(t, {}, f => {
    f.git('add', '--', 'README.md');
    const scripts = join(f.root, '.pbai4devs/scripts');
    cpSync(join(projectRoot, '.pbai4devs/scripts/lib'), join(scripts, 'lib'), { recursive: true });
    mkdirSync(join(scripts, 'revisar-entrega'), { recursive: true });
    cpSync(join(projectRoot, '.pbai4devs/scripts/revisar-entrega/SCRIPT.mjs'), join(scripts, 'revisar-entrega/SCRIPT.mjs'));
  });
  const location = part === 'report' ? f.file : `.agent-tests/mudanca/exec-1/${part}.json`;
  const marker = 'SYNTHETIC_PRIVATE_MARKER';
  f.put(location, `${marker} malformed`);
  const before = readFileSync(join(f.root, location));
  const index = readFileSync(join(f.root, '.git/index'));
  const human = readFileSync(join(f.root, 'README.md'));
  assert.throws(() => checkReview(f.file, { root: f.root }), error => {
    assert.ok(error instanceof SyntaxError);
    assert.equal(error.message, `JSON invalido: ${label}.`);
    assert.ok(!String(error.stack).includes(marker));
    return true;
  });
  const result = spawnSync(process.execPath, [join(f.root, '.pbai4devs/scripts/revisar-entrega/SCRIPT.mjs'), 'check', f.file], {
    cwd: f.root, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), `JSON invalido: ${label}.`);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(marker));
  assert.deepEqual(readFileSync(join(f.root, location)), before);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
  assert.deepEqual(readFileSync(join(f.root, 'README.md')), human);
});

test("missing report maintains read error ENOENT", t => {
  const f = fixture(t);
  assert.throws(() => checkReview('.agent-tests/ausente.json', { root: f.root }), error => {
    assert.equal(error.code, 'ENOENT');
    assert.ok(!(error instanceof SyntaxError));
    return true;
  });
});

test('instrucoes existentes entram na revisao e mudancas posteriores invalidam o selo', async t => {
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) await t.test(file, t => {
    const f = approved(t, {}, f => f.put(file, '# Instrucoes\n'));
    assert.ok(f.report.documentation.some(item => item.path === file));
    assert.ok(f.report.snapshot.files.some(item => item.path === file));
    f.put(file, '# Instrucoes alteradas\n');
    assert.throws(() => checkReview(f.file, { root: f.root }), /mudaram/);
  });
});

test("instructions created after preparation require new snapshot even in limited scope", async t => {
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) await t.test(file, t => {
    const f = approved(t, {}, () => {}, false);
    f.put(file, '# Novas instrucoes\n');
    f.report.documentation.push({ path: file, decision: 'no-impact', reason: 'Revisado apos o preparo.' });
    f.save();
    assert.throws(() => sealReview(f.file, { root: f.root }), /Documentos obrigatorios mudaram/);
  });
});

test('relatorio inicial nao aprova entrega nem sobrescreve evidencias anteriores', t => {
  const f = fixture(t);
  const options = { root: f.root, id: 'mudanca', execution: 'exec-1', scope: ['src/main.mjs'] };
  const result = prepareReview(options);
  assert.throws(() => checkReview(result.file, { root: f.root }), /pendente|invalida/);
  assert.throws(() => prepareReview(options), /ja existe/);
});

test('mudanca de codigo, spec ou documento depois do snapshot exige nova revisao', async t => {
  for (const file of ['src/main.mjs', 'spec.md', 'README.md']) await t.test(file, t => {
    const f = approved(t); f.put(file, readFileSync(join(f.root, file), 'utf8') + '\nMudanca posterior.');
    assert.throws(() => checkReview(f.file, { root: f.root }), /mudaram/);
  });
});

test('em modo git um novo arquivo elegivel invalida a revisao', t => {
  const f = approved(t, { scope: [] });
  f.put('novo.mjs', 'export {};');
  assert.throws(() => checkReview(f.file, { root: f.root }), /mudaram/);
});

test("all criteria need result and proof; not executed is not approved", async t => {
  for (const status of ['pending', 'failed', 'not-run', 'not-applicable']) await t.test(status, t => {
    const f = approved(t); f.report.validation[0].status = status; f.save();
    assert.throws(() => checkReview(f.file, { root: f.root }), /sem prova/);
  });
  await t.test('criterio ausente', t => {
    const f = approved(t); f.report.validation.pop(); f.save();
    assert.throws(() => checkReview(f.file, { root: f.root }), /sem resultado/);
  });
});

test('provas vazias, fora do diretorio e forcadas no Git sao recusadas', async t => {
  await t.test('vazia', t => { const f = approved(t); f.put(f.proof, ''); assert.throws(() => checkReview(f.file, { root: f.root }), /vazia/); });
  await t.test('fora', t => { const f = approved(t); f.report.validation[0].evidence = ['README.md']; f.save(); assert.throws(() => checkReview(f.file, { root: f.root }), /Evidencia deve/); });
  await t.test('versionada', t => { const f = approved(t); f.git('add', '-f', f.proof); assert.throws(() => checkReview(f.file, { root: f.root }), /indice Git/); });
});

test("no impact requires reason; omit document or leave open find blocks", async t => {
  await t.test('motivo', t => { const f = approved(t); f.report.documentation[0].reason = ''; f.save(); assert.throws(() => checkReview(f.file, { root: f.root }), /documentacao/); });
  await t.test('documento', t => { const f = approved(t); f.report.documentation = []; f.save(); assert.throws(() => checkReview(f.file, { root: f.root }), /sem revisao/); });
  await t.test('achado', t => { const f = approved(t); f.report.review.findings.push({ id: 'R1', description: 'Correcao necessaria', status: 'open' }); f.save(); assert.throws(() => checkReview(f.file, { root: f.root }), /abertos/); });
});

test('caminhos perigosos e relatorios fora de local ignorado sao recusados', t => {
  const f = fixture(t);
  for (const scope of [['../fora'], ['.git/config']]) assert.throws(() => prepareReview({ root: f.root, id: 'mudanca', scope }), /fora do escopo/);
  f.put('.gitignore', '');
  assert.throws(() => prepareReview({ root: f.root, id: 'mudanca', scope: ['src/main.mjs'] }), /ignorado/);
});

test('links simbolicos nao viram prova ou documento autorizado', t => {
  const f = approved(t); const target = '.agent-tests/mudanca/exec-1/link.txt';
  try { symlinkSync(join(f.root, f.proof), join(f.root, target)); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Sem permissao de symlink.'); throw error; }
  f.report.validation[0].evidence = [target]; f.save();
  assert.throws(() => checkReview(f.file, { root: f.root }), /simbolico/);
});

test("spec without clear IDs does not go through preparation", () => {
  assert.throws(() => specCriteria('## Critérios de aceite\n\nFunciona.\n'), /AC-001/);
  assert.deepEqual(specCriteria('## Critérios de aceite\nAC-001\nAC-001\n\n## Referências\nAC-999'), ['AC-001']);
});

test('placeholders no plano nao contam como validacao definida', t => {
  const f = approved(t); f.report.validation[0].assertion = 'A definir.'; f.save();
  assert.throws(() => checkReview(f.file, { root: f.root }), /incompleto/);
});

test("extra document no Markdown remains mandatory and protected by snapshot", t => {
  const f = fixture(t); f.put('api/openapi.yaml', 'openapi: 3.1.0\n');
  const made = prepareReview({ root: f.root, id: 'mudanca', execution: 'extra', scope: ['src/main.mjs'], documents: ['api/openapi.yaml'] });
  assert.ok(made.report.snapshot.documents.includes('api/openapi.yaml'));
  assert.ok(made.report.snapshot.files.some(file => file.path === 'api/openapi.yaml'));
  made.report.documentation = made.report.documentation.filter(item => item.path !== 'api/openapi.yaml');
  for (const item of made.report.documentation) Object.assign(item, { decision: 'no-impact', reason: 'Revisado sem alteracao.' });
  f.put(made.file, JSON.stringify(made.report));
  assert.throws(() => checkReview(made.file, { root: f.root }), /Documento sem revisao/);
});

test("spec and reference document cannot be ignored artifacts", t => {
  const f = fixture(t); f.put('.agent-tests/spec.md', readFileSync(join(f.root, 'spec.md')));
  assert.throws(() => prepareReview({ root: f.root, id: 'mudanca', spec: '.agent-tests/spec.md' }), /versionavel/);
  assert.throws(() => prepareReview({ root: f.root, id: 'mudanca', documents: ['.agent-tests/relatorio.txt'] }), /versionavel/);
});

test('remover referencia da spec do relatorio nao remove sua obrigatoriedade', t => {
  const f = approved(t); f.report.spec = null; f.save();
  assert.throws(() => checkReview(f.file, { root: f.root }), /Baseline|referencias alteradas/);
});

test("Git index needs to match the code tested before commit", t => {
  const f = approved(t, {}, f => {
    f.git('add', 'src/main.mjs');
    f.put('src/main.mjs', 'export const value=2;\n');
  }, false);
  assert.throws(() => checkReview(f.file, { root: f.root }), /Indice Git difere/);
  f.git('add', 'src/main.mjs');
  sealReview(f.file, { root: f.root });
  assert.equal(checkReview(f.file, { root: f.root }).status, 'passed');
});

test("prepare, seal, check and check-commit preserve index with outdated stat", t => {
  const f = fixture(t);
  f.git('add', '.');
  f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=disabled-hooks', 'commit', '-q', '-m', 'test: base');
  f.put('src/main.mjs', 'export const value=2;\n'); f.git('add', 'src/main.mjs');
  const path = join(f.root, 'src/main.mjs'), index = join(f.root, '.git/index');
  const stale = () => { const info = statSync(path); utimesSync(path, info.atime, new Date(info.mtimeMs - 120000)); };
  const preserved = call => { stale(); const before = readFileSync(index); const result = call(); assert.deepEqual(readFileSync(index), before); return result; };
  const made = preserved(() => prepareReview({ root: f.root, id: 'stat-cache', execution: 'case' }));
  for (const item of made.report.documentation) Object.assign(item, { decision: 'no-impact', reason: 'Documento examinado na fixture.' });
  const proof = '.agent-tests/stat-cache/case/proof.txt'; f.put(proof, 'Prova sintetica.\n');
  for (const item of made.report.validation) Object.assign(item, { method: 'fixture', prerequisite: 'Git local', assertion: 'Blob revisado', evidence: [proof], status: 'passed' });
  made.report.review = { status: 'approved', reviewer: 'simulacao de teste', findings: [] };
  f.put(made.file, JSON.stringify(made.report));
  assert.equal(preserved(() => sealReview(made.file, { root: f.root })).status, 'passed');
  assert.equal(preserved(() => checkReview(made.file, { root: f.root })).status, 'passed');
  const commitCheck = preserved(() => checkCommit([made.file], { root: f.root }));
  assert.equal(commitCheck.status, 'passed');
  assert.equal(commitCheck.reviewVerification, 'not-verified');
});

test('coleta automatica inclui staged cancelado e ambas pontas de renomeacao', async t => {
  for (const name of ['cancelado', 'renomeado']) await t.test(name, t => {
    const f = fixture(t);
    f.git('add', '.');
    f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=disabled-hooks', 'commit', '-q', '-m', 'test: base');
    if (name === 'cancelado') {
      f.put('src/main.mjs', 'export const value=2;\n'); f.git('add', 'src/main.mjs');
      f.put('src/main.mjs', 'export const value=1;\n');
    } else f.git('mv', 'src/main.mjs', 'src/new name.mjs');
    const index = readFileSync(join(f.root, '.git/index'));
    const made = prepareReview({ root: f.root, id: 'coleta', execution: 'case' });
    const paths = made.report.snapshot.files.map(file => file.path);
    assert.ok(paths.includes('src/main.mjs'));
    if (name === 'renomeado') assert.ok(paths.includes('src/new name.mjs'));
    assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
  });
});

test("automatic collection refuses name with line break without touching index", t => {
  if (process.platform === 'win32') return t.skip('Quebras de linha nao sao nomes de arquivo validos no Windows.');
  const f = fixture(t); f.put('line\nbreak.txt', 'conteudo\n'); f.git('add', 'line\nbreak.txt');
  const index = readFileSync(join(f.root, '.git/index'));
  assert.throws(() => prepareReview({ root: f.root, id: 'newline', execution: 'case' }), /Caminho invalido/);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
  assert.equal(existsSync(join(f.root, '.agent-tests/newline')), false);
});

test('coleta permite filtro global configurado sem atributo aplicado', t => {
  const f = fixture(t); f.git('add', 'src/main.mjs');
  f.put('.agent-tests/global-git-config', '');
  const globalConfig = join(f.root, '.agent-tests/global-git-config');
  f.git('config', '--file', globalConfig, 'filter.fixture.clean', 'false');
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  t.after(() => { if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = previous; });
  const index = readFileSync(join(f.root, '.git/index'));
  const made = prepareReview({ root: f.root, id: 'global-filter', execution: 'case' });
  assert.ok(made.report.snapshot.files.some(file => file.path === 'src/main.mjs'));
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test('coleta automatica recusa filtro aplicado sem executa-lo e scope continua disponivel', t => {
  const f = fixture(t); f.git('add', '.');
  f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=disabled-hooks', 'commit', '-q', '-m', 'test: base');
  const executable = process.execPath.replaceAll('\\', '/');
  const clean = `"${executable}" -e "require('fs').writeFileSync('filter-marker','hit');process.stdin.pipe(process.stdout)"`;
  f.git('config', 'filter.fixture.clean', clean);
  f.put('.git/info/attributes', 'src/main.mjs filter=fixture\n');
  f.put('src/main.mjs', 'export const value=2;\n');
  const marker = join(f.root, 'filter-marker'), index = readFileSync(join(f.root, '.git/index'));
  assert.throws(() => prepareReview({ root: f.root, id: 'filtro', execution: 'auto' }), /filtro Git aplicado.*--scope/);
  assert.equal(existsSync(marker), false);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
  const made = prepareReview({ root: f.root, id: 'filtro', execution: 'scope', scope: ['src/main.mjs'] });
  assert.ok(made.report.snapshot.files.some(file => file.path === 'src/main.mjs'));
  assert.equal(existsSync(marker), false);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test("gate refuses split-index without changing index or shareindex", t => {
  const f = fixture(t); f.git('add', 'src/main.mjs'); f.git('update-index', '--split-index');
  const sharedPath = f.git('rev-parse', '--shared-index-path').trim();
  assert.ok(sharedPath);
  const shared = resolve(f.root, sharedPath), before = statSync(shared, { bigint: true });
  const index = readFileSync(join(f.root, '.git/index'));
  assert.throws(() => prepareReview({ root: f.root, id: 'split', execution: 'case', scope: ['src/main.mjs'] }), /Split-index Git nao suportado/);
  const after = statSync(shared, { bigint: true });
  assert.equal(after.mtimeNs, before.mtimeNs); assert.equal(after.ctimeNs, before.ctimeNs);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test('coleta automatica recusa flags ocultas sem modifica-las', async t => {
  for (const flag of ['--assume-unchanged', '--skip-worktree']) await t.test(flag, t => {
    const f = fixture(t); f.git('add', 'src/main.mjs'); f.git('update-index', flag, 'src/main.mjs');
    f.put('src/main.mjs', 'export const value=2;\n');
    const index = readFileSync(join(f.root, '.git/index'));
    assert.throws(() => prepareReview({ root: f.root, id: 'hidden', execution: 'case' }), /flags que ocultam alteracoes.*--scope/);
    assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
  });
});

test("gate refuses flags that hide differences between index and file", async t => {
  for (const [name, options] of [
    ['assume-unchanged', ['--assume-unchanged']],
    ['skip-worktree', ['--skip-worktree']],
    ['ambas', ['--assume-unchanged', '--skip-worktree']],
  ]) await t.test(name, t => {
    const f = approved(t, {}, f => {
      f.git('add', 'src/main.mjs');
      for (const option of options) f.git('update-index', option, 'src/main.mjs');
      f.put('src/main.mjs', 'export const value=2;\n');
    }, false);
    // Git itself reports equality here even though staged and working differ.
    f.git('--literal-pathspecs', 'diff', '--quiet', '--no-ext-diff', '--', 'src/main.mjs');
    const index = readFileSync(join(f.root, '.git/index'));
    const flags = f.git('-c', 'core.fsmonitor=false', 'ls-files', '-v', '--', 'src/main.mjs');
    const staged = f.git('show', ':src/main.mjs');
    assert.notEqual(staged, readFileSync(join(f.root, 'src/main.mjs'), 'utf8'));
    assert.throws(() => sealReview(f.file, { root: f.root }), /assume-unchanged ou skip-worktree/);
    assert.throws(() => checkReview(f.file, { root: f.root }), /assume-unchanged ou skip-worktree/);
    assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
    assert.equal(f.git('-c', 'core.fsmonitor=false', 'ls-files', '-v', '--', 'src/main.mjs'), flags);
    assert.equal(f.git('show', ':src/main.mjs'), staged);
  });
});

test('gate aceita delecao preparada sem entrada no indice', t => {
  const f = approved(t, {}, f => {
    f.git('add', '.');
    f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'test: base');
    f.git('rm', '-q', 'src/main.mjs');
  }, false);
  const index = readFileSync(join(f.root, '.git/index'));
  assert.equal(sealReview(f.file, { root: f.root }).status, 'passed');
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test('gate recusa multiplas entradas de indice em conflito', t => {
  const f = approved(t, {}, f => {
    const commit = message => f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', message);
    f.git('add', '.'); commit('test: base');
    const base = f.git('symbolic-ref', '--short', 'HEAD').trim();
    f.git('checkout', '-q', '-b', 'fixture-conflict');
    f.put('src/main.mjs', 'export const value=2;\n'); f.git('add', 'src/main.mjs'); commit('test: feature');
    f.git('checkout', '-q', base);
    f.put('src/main.mjs', 'export const value=3;\n'); f.git('add', 'src/main.mjs'); commit('test: target');
    const merge = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'merge', '--no-commit', 'fixture-conflict'], { cwd: f.root, encoding: 'utf8' });
    assert.equal(merge.status, 1, merge.stderr);
  }, false);
  const index = readFileSync(join(f.root, '.git/index'));
  assert.throws(() => sealReview(f.file, { root: f.root }), /Flags do indice Git ambiguas/);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test('gate recusa nomes Git UTF-8 invalidos antes de aprovar ou gerar relatorio', t => {
  if (process.platform === 'win32') return t.skip('Nomes Git arbitrarios em bytes nao sao representaveis no filesystem Windows.');
  const f = approved(t, {}, () => {}, false);
  f.put('collision\ufffd.txt', 'arquivo humano valido\n'); f.git('add', 'collision\ufffd.txt');
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: f.root, input: 'arquivo de teste\n', encoding: 'utf8' });
  assert.equal(blob.status, 0, blob.stderr);
  const invalidName = Buffer.concat([Buffer.from('collision'), Buffer.from([0xff]), Buffer.from('.txt')]);
  const entry = Buffer.concat([Buffer.from(`100644 ${blob.stdout.trim()}\t`), invalidName, Buffer.from([0])]);
  const update = spawnSync('git', ['update-index', '-z', '--index-info'], { cwd: f.root, input: entry });
  assert.equal(update.status, 0, update.stderr?.toString());
  const index = readFileSync(join(f.root, '.git/index'));
  assert.throws(() => prepareReview({ root: f.root, id: 'invalido', execution: 'case' }), /UTF-8 valido/);
  assert.equal(existsSync(join(f.root, '.agent-tests/invalido')), false);
  assert.throws(() => sealReview(f.file, { root: f.root }), /UTF-8 valido/);
  assert.throws(() => checkReview(f.file, { root: f.root }), /UTF-8 valido/);
  assert.throws(() => checkCommit([f.file], { root: f.root }), /UTF-8 valido/);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test("path with isolated surrogate not converted into another file", t => {
  const f = fixture(t); f.put('collision\ufffd.txt', 'arquivo humano\n');
  assert.throws(() => prepareReview({ root: f.root, id: 'invalido', scope: ['collision\ud800.txt'] }), /Caminho invalido/);
  assert.equal(readFileSync(join(f.root, 'collision\ufffd.txt'), 'utf8'), 'arquivo humano\n');
});

test('nome iniciado por BOM e preservado em staged e na consulta de ignores', async t => {
  await t.test('staged', t => {
    const name = '\ufeffbom.txt';
    const f = approved(t, { scope: [name] }, f => {
      f.put(name, 'conteudo revisado\n');
      f.put('bom.txt', 'outro arquivo humano\n');
      f.git('add', '--', name);
    }, false);
    const index = readFileSync(join(f.root, '.git/index'));
    assert.ok(f.report.snapshot.files.some(file => file.path === name));
    assert.equal(sealReview(f.file, { root: f.root }).status, 'passed');
    assert.equal(checkCommit([f.file], { root: f.root }).status, 'passed');
    assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
    assert.equal(readFileSync(join(f.root, 'bom.txt'), 'utf8'), 'outro arquivo humano\n');
  });
  await t.test('ignorado', t => {
    const f = fixture(t), name = '\ufeffignored.md';
    f.put('.gitignore', `/.agent-tests/\n/${name}\n`);
    f.put(name, '# Ignorado\n');
    f.put('ignored.md', '# Documento versionavel\n');
    const made = prepareReview({ root: f.root, id: 'bom', execution: 'case', scope: [name, 'ignored.md'] });
    assert.ok(!made.report.documentation.some(file => file.path === name));
    assert.ok(made.report.documentation.some(file => file.path === 'ignored.md'));
  });
});

test("check-commit blocks human staged out of review without altering it", t => {
  const f = approved(t, {}, f => {
    f.git('add', 'src/main.mjs');
    f.put('humano extra.txt', 'arquivo preparado por outra pessoa\n');
    f.git('add', 'humano extra.txt');
  }, false);
  sealReview(f.file, { root: f.root });
  assert.equal(checkReview(f.file, { root: f.root }).status, 'passed');
  const index = readFileSync(join(f.root, '.git/index'));
  const content = readFileSync(join(f.root, 'humano extra.txt'));
  assert.throws(() => checkCommit([f.file], { root: f.root }), /Arquivos preparados sem revisao selada: humano extra\.txt/);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
  assert.deepEqual(readFileSync(join(f.root, 'humano extra.txt')), content);
});

test('check-commit aceita cobertura unida de relatorios selados', t => {
  const f = approved(t, {}, f => {
    f.git('add', 'src/main.mjs'); f.put('extra.txt', 'conteudo\n'); f.git('add', 'extra.txt');
  }, false);
  sealReview(f.file, { root: f.root });
  const extra = prepareReview({ root: f.root, id: 'extra', execution: 'exec', scope: ['extra.txt'] });
  for (const item of extra.report.documentation) Object.assign(item, { decision: 'no-impact', reason: 'Documento examinado na fixture.' });
  const proof = '.agent-tests/extra/exec/proof.txt'; f.put(proof, 'Prova sintetica complementar.\n');
  for (const item of extra.report.validation) Object.assign(item, { method: 'fixture', prerequisite: 'Git local', assertion: 'Conteudo revisado', evidence: [proof], status: 'passed' });
  extra.report.review = { status: 'approved', reviewer: 'simulacao de teste', findings: [] };
  f.put(extra.file, JSON.stringify(extra.report)); sealReview(extra.file, { root: f.root });
  const index = readFileSync(join(f.root, '.git/index'));
  const result = checkCommit([f.file, extra.file], { root: f.root });
  assert.equal(result.status, 'passed'); assert.equal(result.reports, 2); assert.equal(result.staged, 2);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
  assert.throws(() => checkCommit([f.file, `./${f.file}`], { root: f.root }), /sem repeticao/);
});

test('check-commit na CLI aplica a mesma protecao de staged extra', t => {
  const f = approved(t, {}, f => f.git('add', 'src/main.mjs'), false);
  sealReview(f.file, { root: f.root });
  const script = '.pbai4devs/scripts/revisar-entrega/SCRIPT.mjs', runtime = '.pbai4devs/scripts/lib/runtime.mjs';
  for (const file of [script, runtime]) { mkdirSync(dirname(join(f.root, file)), { recursive: true }); cpSync(join(projectRoot, file), join(f.root, file)); }
  const args = [join(f.root, script), 'check-commit', f.file];
  let run = spawnSync(process.execPath, args, { cwd: f.root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'passed'); assert.equal(result.reviewVerification, 'not-verified');
  f.put('extra.txt', 'preparado\n'); f.git('add', 'extra.txt');
  const index = readFileSync(join(f.root, '.git/index'));
  run = spawnSync(process.execPath, args, { cwd: f.root, encoding: 'utf8' });
  assert.equal(run.status, 1); assert.match(run.stderr, /sem revisao selada: extra\.txt/);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test('check-commit recusa nome preparado com quebra de linha', t => {
  if (process.platform === 'win32') return t.skip('Quebras de linha nao sao nomes de arquivo validos no Windows.');
  const f = approved(t, {}, f => f.git('add', 'src/main.mjs'), false);
  sealReview(f.file, { root: f.root });
  f.put('line\nbreak.txt', 'conteudo humano\n'); f.git('add', 'line\nbreak.txt');
  const index = readFileSync(join(f.root, '.git/index'));
  assert.throws(() => checkCommit([f.file], { root: f.root }), /Caminho invalido/);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test('check-commit exige as duas pontas de renomeacao preparada', async t => {
  for (const [name, scope, expected] of [
    ['cobertura completa', ['src/main.mjs', 'src/new name.mjs'], true],
    ['origem ausente', ['src/new name.mjs'], false],
  ]) await t.test(name, t => {
    const f = approved(t, { scope }, f => {
      f.git('add', '.');
      f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'test: base');
      f.git('mv', 'src/main.mjs', 'src/new name.mjs');
    }, false);
    sealReview(f.file, { root: f.root });
    const index = readFileSync(join(f.root, '.git/index'));
    if (expected) assert.equal(checkCommit([f.file], { root: f.root }).staged, 2);
    else assert.throws(() => checkCommit([f.file], { root: f.root }), /sem revisao selada: src\/main\.mjs/);
    assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
  });
});

test('check-commit rejeita modo executavel staged apos o selo', t => {
  const f = approved(t, {}, f => {
    f.git('add', '.');
    f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'test: base');
  }, false);
  sealReview(f.file, { root: f.root });
  f.git('config', 'core.filemode', 'false');
  f.git('update-index', '--chmod=+x', 'src/main.mjs');
  assert.equal(checkReview(f.file, { root: f.root }).status, 'passed');
  const index = readFileSync(join(f.root, '.git/index'));
  assert.throws(() => checkCommit([f.file], { root: f.root }), /modo preparado nao comprovado: src\/main\.mjs/);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test('fixtures isolam Git externo herdado antes de criar commits', t => {
  const external = fixture(t);
  external.git('add', '.');
  external.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'test: base');
  external.put('src/main.mjs', 'conteudo humano staged\n');
  external.git('add', 'src/main.mjs');
  const marker = join(external.root, 'fsmonitor-ran');
  const injected = {};
  if (process.platform !== 'win32') {
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const hook = join(external.root, 'fsmonitor.sh');
    writeFileSync(hook, `#!/bin/sh\nprintf triggered > ${quote(marker)}\n`);
    Object.assign(injected, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: `sh ${quote(hook)}` });
    const probe = spawnSync('git', ['ls-files'], { cwd: external.root, env: { ...process.env, ...injected }, encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.ok(existsSync(marker), 'O fsmonitor sintético precisa executar no controle.');
    rmSync(marker);
  }
  const index = join(external.root, '.git/index');
  const before = {
    head: external.git('rev-parse', 'HEAD'),
    index: readFileSync(index),
    config: readFileSync(join(external.root, '.git/config')),
    staged: external.git('diff', '--cached', '--binary'),
  };
  const env = { ...process.env, ...injected, GIT_DIR: join(external.root, '.git'), GIT_WORK_TREE: external.root, GIT_INDEX_FILE: index };
  for (const key of Object.keys(env)) if (/^NODE_TEST_CONTEXT$/i.test(key)) delete env[key];
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^check-commit rejeita modo executavel staged apos o selo$', fileURLToPath(import.meta.url)], {
    env, encoding: 'utf8', timeout: 90000, windowsHide: true,
  });
  assert.equal(run.status, 0, `${run.stdout || ''}${run.stderr || ''}${run.error || ''}`);
  assert.match(run.stdout, /^ok 1 - check-commit rejeita modo executavel staged apos o selo\r?$/m);
  assert.match(run.stdout, /^# tests 1\r?$/m);
  assert.match(run.stdout, /^# pass 1\r?$/m);
  assert.equal(external.git('rev-parse', 'HEAD'), before.head);
  assert.deepEqual(readFileSync(index), before.index);
  assert.deepEqual(readFileSync(join(external.root, '.git/config')), before.config);
  assert.equal(external.git('diff', '--cached', '--binary'), before.staged);
  assert.equal(existsSync(marker), false, 'O fsmonitor externo não deve executar durante a fixture.');
});

test("gate rejects blob transformed by clean filter without running filter in check", t => {
  const f = approved(t, {}, f => {
    f.git('add', '.');
    f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'test: base');
    f.put('src/main.mjs', 'export const value=2;\n');
  }, false);
  sealReview(f.file, { root: f.root });
  const executable = process.execPath.replaceAll('\\', '/');
  const clean = `"${executable}" -e "require('fs').writeFileSync('filter-marker','hit');process.stdin.on('data',x=>process.stdout.write(x.toString().toUpperCase()))"`;
  f.git('config', 'filter.fixture.clean', clean);
  f.put('.git/info/attributes', 'src/main.mjs filter=fixture\n');
  f.git('add', 'src/main.mjs');
  const marker = join(f.root, 'filter-marker'); assert.equal(existsSync(marker), true); rmSync(marker);
  const index = readFileSync(join(f.root, '.git/index'));
  assert.throws(() => checkReview(f.file, { root: f.root }), /Indice Git difere dos bytes testados.*filtros e CRLF/);
  assert.throws(() => checkCommit([f.file], { root: f.root }), /Indice Git difere dos bytes testados.*filtros e CRLF/);
  assert.equal(existsSync(marker), false);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test("gate accepts identity blob with clean filter configured without running filter", t => {
  const f = approved(t, {}, f => {
    const executable = process.execPath.replaceAll('\\', '/');
    const clean = `"${executable}" -e "require('fs').writeFileSync('filter-marker','hit');process.stdin.pipe(process.stdout)"`;
    f.git('config', 'filter.fixture.clean', clean);
    f.put('.git/info/attributes', 'src/main.mjs filter=fixture\n');
    f.git('add', 'src/main.mjs');
  }, false);
  const marker = join(f.root, 'filter-marker'); assert.equal(existsSync(marker), true); rmSync(marker);
  const index = readFileSync(join(f.root, '.git/index'));
  assert.equal(sealReview(f.file, { root: f.root }).status, 'passed');
  assert.equal(checkCommit([f.file], { root: f.root }).status, 'passed');
  assert.equal(existsSync(marker), false);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test("gate blocks staged CRLF normalized when different from revised bytes", t => {
  const f = approved(t, {}, f => {
    f.git('add', '.');
    f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'test: base');
    f.put('src/main.mjs', 'export const value=2;\r\n');
  }, false);
  sealReview(f.file, { root: f.root });
  f.put('.git/info/attributes', 'src/main.mjs text eol=crlf\n'); f.git('add', 'src/main.mjs');
  const index = readFileSync(join(f.root, '.git/index'));
  assert.throws(() => checkCommit([f.file], { root: f.root }), /Indice Git difere dos bytes testados.*CRLF/);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test('gate recusa promisor antes de ler blob preparado', t => {
  const f = approved(t, {}, f => f.git('add', 'src/main.mjs'), false);
  f.git('config', 'remote.fixture.promisor', 'true');
  const index = readFileSync(join(f.root, '.git/index'));
  assert.throws(() => sealReview(f.file, { root: f.root }), /Clone parcial ou remote promisor/);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test('consultas do gate nao executam hook fsmonitor configurado', t => {
  const f = fixture(t);
  f.git('add', 'src/main.mjs');
  f.put('.git/fsmonitor-hook', "#!/bin/sh\nprintf hit > .git/fsmonitor-marker\nprintf 'builtin:fake\\0'\n");
  f.git('config', 'core.fsmonitor', 'sh .git/fsmonitor-hook');
  f.git('ls-files', '-z');
  const marker = join(f.root, '.git/fsmonitor-marker');
  assert.equal(existsSync(marker), true, 'controle deve executar o hook'); rmSync(marker);
  const index = readFileSync(join(f.root, '.git/index'));
  const made = prepareReview({ root: f.root, id: 'monitor', execution: 'case', scope: ['src/main.mjs'] });
  for (const item of made.report.documentation) Object.assign(item, { decision: 'no-impact', reason: 'Documento examinado na fixture.' });
  const proof = '.agent-tests/monitor/case/proof.txt'; f.put(proof, 'Prova sintetica.\n');
  for (const item of made.report.validation) Object.assign(item, { method: 'fixture', prerequisite: 'Git local', assertion: 'Blob revisado', evidence: [proof], status: 'passed' });
  made.report.review = { status: 'approved', reviewer: 'simulacao de teste', findings: [] };
  f.put(made.file, JSON.stringify(made.report));
  assert.equal(sealReview(made.file, { root: f.root }).status, 'passed');
  assert.equal(checkReview(made.file, { root: f.root }).status, 'passed');
  assert.equal(checkCommit([made.file], { root: f.root }).status, 'passed');
  assert.equal(existsSync(marker), false);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
  assert.equal(f.git('config', '--get', 'core.fsmonitor').trim(), 'sh .git/fsmonitor-hook');
});

test('diff do gate nao executa hook fsmonitor de submodulo', t => {
  const f = fixture(t);
  const commit = message => f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=disabled-hooks', 'commit', '-q', '-m', message);
  f.git('add', '.'); commit('test: base');
  const source = join(f.root, '.agent-tests/submodule-source'); mkdirSync(source, { recursive: true });
  const env = { ...process.env, GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0' };
  const git = (cwd, args) => {
    const run = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(run.status, 0, run.stderr); return run.stdout;
  };
  git(source, ['init', '-q']); writeFileSync(join(source, 'data.txt'), 'original\n'); git(source, ['add', '.']);
  git(source, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=disabled-hooks', 'commit', '-q', '-m', 'test: submodule']);
  git(f.root, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', pathToFileURL(source).href, 'nested']);
  f.git('add', '.gitmodules', 'nested'); commit('test: add submodule');
  f.put('nested/monitor.sh', "#!/bin/sh\nprintf hit > monitor-marker\nprintf 'builtin:fake\\0'\n");
  f.git('-C', 'nested', 'config', 'core.fsmonitor', 'sh monitor.sh');
  f.git('config', 'diff.ignoreSubmodules', 'none');
  f.git('-C', 'nested', 'ls-files', '-z');
  const marker = join(f.root, 'nested/monitor-marker');
  assert.equal(existsSync(marker), true, 'controle deve executar o hook do submodulo'); rmSync(marker);
  f.put('nested/data.txt', 'alterado\n');
  const index = readFileSync(join(f.root, '.git/index'));
  assert.throws(() => prepareReview({ root: f.root, id: 'nested', execution: 'case' }), /Coleta automatica nao suporta submodulo.*use --scope/);
  assert.equal(existsSync(marker), false);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test('todos os gates recusam partial clone antes de buscar objetos', t => {
  mkdirSync(join(projectRoot, '.agent-tests'), { recursive: true });
  const base = mkdtempSync(join(projectRoot, '.agent-tests/partial-gate-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const source = join(base, 'source'), remote = join(base, 'remote.git'), target = join(base, 'clone');
  mkdirSync(source);
  const emptyConfig = join(base, 'empty-git-config'); writeFileSync(emptyConfig, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  const git = (cwd, args) => {
    const run = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(run.status, 0, run.stderr); return run.stdout;
  };
  git(source, ['init', '-q']);
  writeFileSync(join(source, 'README.md'), '# Fixture\n'); writeFileSync(join(source, 'data.txt'), 'original\n');
  git(source, ['add', '.']);
  git(source, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=disabled-hooks', 'commit', '-q', '-m', 'test: base']);
  git(base, ['clone', '--bare', '--quiet', source, remote]);
  git(base, ['--git-dir', remote, 'config', 'uploadpack.allowFilter', 'true']);
  git(base, ['clone', '--quiet', '--no-checkout', '--filter=tree:0', '--no-local', pathToFileURL(remote).href, target]);
  writeFileSync(join(target, '.gitignore'), '/.agent-tests/\n'); writeFileSync(join(target, 'data.txt'), 'working\n');
  const packDir = join(target, '.git/objects/pack');
  const packs = () => Object.fromEntries(readdirSync(packDir).sort().map(name => [name, readFileSync(join(packDir, name))]));
  const before = packs(), index = join(target, '.git/index'), hadIndex = existsSync(index);
  const moduleUrl = new URL('../SCRIPT.mjs', import.meta.url).href;
  const code = `import {prepareReview,sealReview,checkReview,checkCommit,checkMerge} from ${JSON.stringify(moduleUrl)};
    const root=${JSON.stringify(target)}, file='.agent-tests/no/revisao.json';
    const calls=[()=>prepareReview({root,id:'parcial',execution:'prova',scope:['data.txt']}),()=>sealReview(file,{root}),()=>checkReview(file,{root}),()=>checkCommit([file],{root}),()=>checkMerge([file],'refs/heads/main',{root})];
    process.stdout.write(JSON.stringify(calls.map(call=>{try{call();return 'passed'}catch(error){return error.message}})));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: target, env, encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(run.status, 0, run.stderr);
  const messages = JSON.parse(run.stdout);
  assert.equal(messages.length, 5);
  for (const message of messages) assert.match(message, /Clone parcial ou remote promisor/);
  assert.deepEqual(packs(), before);
  assert.equal(existsSync(index), hadIndex);
  assert.equal(existsSync(join(target, '.agent-tests/parcial')), false);
});

test("check-commit does not hide submodule by Git configuration", t => {
  const f = approved(t, {}, f => {
    f.git('add', '.');
    f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'test: base');
    f.put('src/main.mjs', 'export const value=2;\n'); f.git('add', 'src/main.mjs');
  }, false);
  sealReview(f.file, { root: f.root });
  const object = f.git('rev-parse', 'HEAD').trim();
  f.git('update-index', '--add', '--cacheinfo', `160000,${object},vendor`);
  f.git('config', 'diff.ignoreSubmodules', 'all');
  const index = readFileSync(join(f.root, '.git/index'));
  assert.throws(() => checkCommit([f.file], { root: f.root }), /modo preparado nao comprovado: vendor/);
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
});

test("change evidence after approval invalidates the seal", t => {
  const f = approved(t); f.put(f.proof, 'TESTE FALHOU\n');
  assert.throws(() => checkReview(f.file, { root: f.root }), /apos selar/);
  assert.throws(() => sealReview(f.file, { root: f.root }), /apos selar/);
});

test('remover spec e criterios do JSON nao altera a baseline do preparo', t => {
  const f = approved(t);
  f.report.spec = null; f.report.snapshot.spec = null;
  f.report.snapshot.files = f.report.snapshot.files.filter(item => item.path !== 'spec.md');
  f.report.snapshot.documents = f.report.snapshot.documents.filter(path => path !== 'spec.md');
  f.report.validation.pop(); f.save();
  assert.throws(() => checkReview(f.file, { root: f.root }), /Baseline/);
});

test("check requires seal without allowing bypass by API", t => {
  const f = approved(t, {}, () => {}, false);
  assert.throws(() => checkReview(f.file, { root: f.root, requireSeal: false }), /nao selada/);
  sealReview(f.file, { root: f.root });
  assert.equal(checkReview(f.file, { root: f.root }).status, 'passed');
});

function stageUntrack(f, file = 'generated.md', ignore = true) {
  f.put(file, '# Saida local\n');
  f.git('add', '-f', '--', file);
  f.git('-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=disabled-hooks', 'commit', '-q', '-m', 'test: fixture base');
  f.git('rm', '--cached', '--', file);
  if (ignore) f.put('.git/info/exclude', `/${file}\n`);
}

test("real desigradation records action and physical hash without requiring local document", async t => {
  for (const scope of [[], ['generated.md']]) await t.test(scope.length ? 'scope' : 'git', t => {
    const f = approved(t, { scope }, f => stageUntrack(f));
    const file = f.report.snapshot.files.find(file => file.path === 'generated.md');
    assert.equal(file.indexAction, 'untrack'); assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(f.report.documentation.some(item => item.path === 'generated.md'), false);
    assert.ok(existsSync(join(f.root, 'generated.md')));
    assert.equal(f.git('ls-files', 'generated.md'), '');
    assert.equal(checkReview(f.file, { root: f.root }).status, 'passed');
    const index = readFileSync(join(f.root, '.git/index')), content = readFileSync(join(f.root, 'generated.md'));
    assert.equal(checkCommit([f.file], { root: f.root }).status, 'passed');
    assert.deepEqual(readFileSync(join(f.root, '.git/index')), index);
    assert.deepEqual(readFileSync(join(f.root, 'generated.md')), content);
  });
});

test("unignored desidication remains blocked in git and scope", async t => {
  for (const scope of [[], ['generated.md']]) await t.test(scope.length ? 'scope' : 'git', t => {
    assert.throws(() => approved(t, { scope }, f => stageUntrack(f, 'generated.md', false)), /Indice Git difere/);
  });
});

test("changes in file, index or ignore invalidate the revision of deindication", async t => {
  const cases = [
    ['conteudo', f => f.put('generated.md', '# Editado depois\n')],
    ['indice', f => f.git('add', '-f', 'generated.md')],
    ['ignore', f => f.put('.git/info/exclude', '')],
    ['arquivo removido', f => rmSync(join(f.root, 'generated.md'))],
  ];
  for (const [name, change] of cases) await t.test(name, t => {
    const f = approved(t, { scope: [] }, f => stageUntrack(f));
    change(f);
    assert.throws(() => checkReview(f.file, { root: f.root }), /mudaram|desindexacao/);
  });
});

test("Inputs ignored outside the index do not enter the required documents", t => {
  const f = approved(t, {}, f => {
    f.put('AGENTS.md', '# Gerado\n'); f.put('CLAUDE.md', '# Gerado\n'); f.put('GEMINI.md', '# Gerado\n');
    f.put('.git/info/exclude', '/AGENTS.md\n/CLAUDE.md\n/GEMINI.md\n');
  });
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) assert.equal(f.report.documentation.some(item => item.path === name), false);
  assert.equal(checkReview(f.file, { root: f.root }).status, 'passed');
});

test("Tracked documents remain mandatory even with a rule of ignoring", t => {
  const f = approved(t, {}, f => {
    f.put('AGENTS.md', '# Instrução versionada\n');
    f.git('add', 'AGENTS.md', 'spec.md');
    f.put('.git/info/exclude', '/AGENTS.md\n/spec.md\n');
  });
  assert.ok(f.report.documentation.some(item => item.path === 'AGENTS.md'));
  assert.ok(f.report.documentation.some(item => item.path === 'spec.md'));
  assert.equal(checkReview(f.file, { root: f.root }).status, 'passed');
});

function mergeFixture(t, { scope = ['src/main.mjs', 'src/old.txt', 'src/new.txt'], dirty = false, seal = true, ignoredSubmodule = false } = {}) {
  const f = fixture(t);
  const commit = message => f.git('-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=disabled-hooks', 'commit', '-q', '-m', message);
  f.put('src/old.txt', 'original\n'); f.git('add', '.'); commit('test: base');
  f.git('branch', '-M', 'main'); f.git('checkout', '-q', '-b', 'feature');
  f.put('src/main.mjs', 'export const value=2;\n');
  f.git('mv', 'src/old.txt', 'src/new.txt'); f.git('add', 'src/main.mjs'); commit('test: source');
  if (ignoredSubmodule) {
    const object = f.git('rev-parse', 'HEAD').trim();
    f.git('update-index', '--add', '--cacheinfo', `160000,${object},vendor`);
    commit('test: submodule');
    f.git('config', 'diff.ignoreSubmodules', 'all');
  }
  if (dirty) f.put('src/main.mjs', 'export const value=3; // not committed\n');
  const made = prepareReview({ root: f.root, id: 'merge', execution: 'review', scope });
  for (const item of made.report.documentation) Object.assign(item, { decision: 'no-impact', reason: 'Documento examinado na fixture.' });
  const proof = '.agent-tests/merge/review/proof.txt'; f.put(proof, 'Prova sintetica para testar validacao.\n');
  for (const item of made.report.validation) Object.assign(item, { method: 'fixture', prerequisite: 'fixture local', assertion: 'snapshot comparado', evidence: [proof], status: 'passed' });
  made.report.review = { status: 'approved', reviewer: 'simulacao de teste', findings: [] };
  f.put(made.file, JSON.stringify(made.report));
  if (seal) sealReview(made.file, { root: f.root });
  return { ...f, ...made, commit };
}

test("check-merge proof fast-forward complete without changing index or human files", t => {
  const f = mergeFixture(t);
  f.put('human.txt', 'staged humano\n'); f.git('add', 'human.txt'); f.put('human.txt', 'alteracao humana\n');
  const index = readFileSync(join(f.root, '.git/index')), human = readFileSync(join(f.root, 'human.txt'));
  const result = checkMerge([f.file], 'refs/heads/main', { root: f.root });
  assert.equal(result.status, 'passed'); assert.equal(result.reviewVerification, 'not-verified'); assert.equal(result.mode, 'fast-forward'); assert.equal(result.changes, 3);
  assert.equal(result.source, f.git('rev-parse', 'HEAD').trim()); assert.equal(result.target, f.git('rev-parse', 'main').trim());
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), index); assert.deepEqual(readFileSync(join(f.root, 'human.txt')), human);
});

test('check-merge funciona na CLI e rejeita relatorio duplicado por alias', t => {
  const f = mergeFixture(t);
  const script = '.pbai4devs/scripts/revisar-entrega/SCRIPT.mjs', runtime = '.pbai4devs/scripts/lib/runtime.mjs';
  for (const file of [script, runtime]) { mkdirSync(dirname(join(f.root, file)), { recursive: true }); cpSync(join(projectRoot, file), join(f.root, file)); }
  const args = [join(f.root, script), 'check-merge', '--destino', 'refs/heads/main', f.file];
  const run = spawnSync(process.execPath, args, { cwd: f.root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'passed'); assert.equal(result.reviewVerification, 'not-verified');
  assert.throws(() => checkMerge([f.file, `./${f.file}`], 'refs/heads/main', { root: f.root }), /sem repeticao/);
});

test("check-merge blocks content not committed and partial scope", async t => {
  await t.test('working tree diferente do commit', t => {
    const f = mergeFixture(t, { dirty: true });
    assert.equal(checkReview(f.file, { root: f.root }).status, 'passed');
    assert.throws(() => checkMerge([f.file], 'refs/heads/main', { root: f.root }), /difere do commit/);
  });
  await t.test('omissao de arquivo removido', t => {
    const f = mergeFixture(t, { scope: ['src/main.mjs', 'src/new.txt'] });
    assert.throws(() => checkMerge([f.file], 'refs/heads/main', { root: f.root }), /sem revisao selada: src\/old.txt/);
  });
  await t.test('relatorio sem selo', t => {
    const f = mergeFixture(t, { seal: false });
    assert.throws(() => checkMerge([f.file], 'refs/heads/main', { root: f.root }), /nao selada/);
  });
});

test('check-merge aceita cobertura distribuida por relatorios selados', t => {
  const f = mergeFixture(t, { scope: ['src/main.mjs', 'src/new.txt'] });
  const made = prepareReview({ root: f.root, id: 'merge-extra', execution: 'review', scope: ['src/old.txt'] });
  for (const item of made.report.documentation) Object.assign(item, { decision: 'no-impact', reason: 'Documento examinado na fixture.' });
  const proof = '.agent-tests/merge-extra/review/proof.txt'; f.put(proof, 'Prova sintetica complementar.\n');
  for (const item of made.report.validation) Object.assign(item, { method: 'fixture', prerequisite: 'fixture local', assertion: 'delecao revisada', evidence: [proof], status: 'passed' });
  made.report.review = { status: 'approved', reviewer: 'simulacao de teste', findings: [] };
  f.put(made.file, JSON.stringify(made.report)); sealReview(made.file, { root: f.root });
  const result = checkMerge([f.file, made.file], 'refs/heads/main', { root: f.root });
  assert.equal(result.status, 'passed'); assert.equal(result.reports, 2); assert.equal(result.changes, 3);
});

test('check-merge recusa origem e destino invalidos, divergencia e tipos nao comprovados', async t => {
  await t.test('branch invalida ou identica', t => {
    const f = mergeFixture(t);
    for (const name of ['main', 'refs/heads/missing', 'refs/heads/feature', '--help']) assert.throws(() => checkMerge([f.file], name, { root: f.root }));
  });
  await t.test('historico divergente', t => {
    const f = mergeFixture(t); f.git('checkout', '-q', 'main'); f.put('different.txt', 'destino\n'); f.git('add', 'different.txt'); f.commit('test: target'); f.git('checkout', '-q', 'feature');
    assert.throws(() => checkMerge([f.file], 'refs/heads/main', { root: f.root }), /fast-forward/);
  });
  await t.test('HEAD destacado', t => {
    const f = mergeFixture(t); f.git('checkout', '-q', '--detach');
    assert.throws(() => checkMerge([f.file], 'refs/heads/main', { root: f.root }), /HEAD destacado/);
  });
  await t.test('origem fora das branches locais', t => {
    const f = mergeFixture(t); f.git('symbolic-ref', 'HEAD', 'refs/remotes/origin/feature');
    assert.throws(() => checkMerge([f.file], 'refs/heads/main', { root: f.root }), /origem deve ser uma branch local/);
  });
  await t.test("submodule ignored by Git configuration", t => {
    const f = mergeFixture(t, { ignoredSubmodule: true });
    assert.throws(() => checkMerge([f.file], 'refs/heads/main', { root: f.root }), /modo nao comprovado: vendor/);
    const script = '.pbai4devs/scripts/revisar-entrega/SCRIPT.mjs', runtime = '.pbai4devs/scripts/lib/runtime.mjs';
    for (const file of [script, runtime]) { mkdirSync(dirname(join(f.root, file)), { recursive: true }); cpSync(join(projectRoot, file), join(f.root, file)); }
    const run = spawnSync(process.execPath, [join(f.root, script), 'check-merge', '--destino', 'refs/heads/main', f.file], { cwd: f.root, encoding: 'utf8' });
    assert.equal(run.status, 1); assert.match(run.stderr, /modo nao comprovado: vendor/);
  });
  await t.test('link simbolico', t => {
    const f = mergeFixture(t);
    try { symlinkSync('main.mjs', join(f.root, 'src/link')); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('Sem permissao de symlink.'); throw error; }
    f.git('add', 'src/link'); f.commit('test: link');
    assert.throws(() => checkMerge([f.file], 'refs/heads/main', { root: f.root }), /simbolico|modo nao comprovado/);
  });
  await t.test('arquivo executavel', t => {
    const f = mergeFixture(t); f.git('update-index', '--chmod=+x', 'src/main.mjs'); f.commit('test: mode');
    assert.throws(() => checkMerge([f.file], 'refs/heads/main', { root: f.root }), /modo nao comprovado/);
  });
});
