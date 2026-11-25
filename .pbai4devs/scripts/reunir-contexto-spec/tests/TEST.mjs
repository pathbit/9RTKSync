import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gatherContext, readDocument } from '../SCRIPT.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'adk-spec-context-')));
  t.after(() => { t.mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }); });
  const put = (name, content) => { const file = join(root, name); fs.mkdirSync(dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  put('.pbai4devs/state/configuracao/ESTADO.md', '---\npreparacao: concluido\ndocumentos:\n  prd: docs/product/prd.md\n  ux_ui: docs/product/ux.md\n  design: docs/product/design.md\n  roadmap: docs/product/roadmap.md\n  specs: docs/specs\n---\n\n# Estado\n');
  put('docs/product/prd.md', '---\nstatus: aprovado\n---\n\n# Produto\n\nAprovação é uma declaração.\n');
  put('docs/product/ux.md', '---\nstatus: nao-aplicavel\n---\n\n# UX\n\nJustificativa sintética.\n');
  put('docs/product/design.md', '---\nstatus: aprovado\n---\n\n# Design\n');
  put('docs/product/roadmap.md', '---\nstatus: aprovado\n---\n\n# Roadmap\n\n- [ ] [Spec](../specs/primeira/SPEC.md)\n');
  put('docs/specs/primeira/SPEC.md', '---\r\nstatus: aprovado\r\n---\r\n\r\n# Spec\r\n');
  put('.git/index', 'índice sintético\n'); put('.git/config', 'configuração sintética\n');
  put('.git/info/exclude', 'regra sintética\n'); put('.gitignore', '# regra humana\n');
  return { root, put };
}

test('coleta a spec escolhida e documentos configurados sem tocar Git', t => {
  const { root } = fixture(t), protectedNames = ['.git/index', '.git/config', '.git/info/exclude', '.gitignore'];
  const before = protectedNames.map(name => fs.readFileSync(join(root, name)));
  const result = gatherContext(root, 'docs/specs/primeira/SPEC.md');
  assert.equal(result.documentsComplete, true); assert.equal(result.selection.status, 'selected');
  assert.equal(result.git.status, 'not-checked');
  assert.deepEqual(Object.keys(result.documents), ['estado', 'prd', 'ux_ui', 'design', 'roadmap', 'spec']);
  for (const item of Object.values(result.documents)) {
    assert.equal(item.status, 'read');
    const bytes = fs.readFileSync(join(root, item.path));
    assert.equal(item.text, bytes.toString('utf8'));
    assert.equal(item.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  assert.match(result.documents.spec.text, /\r\n/);
  protectedNames.forEach((name, index) => assert.deepEqual(fs.readFileSync(join(root, name)), before[index]));
});

test("does not read documents when spec is outside the configured folder", t => {
  const { root, put } = fixture(t); put('fora/SPEC.md', '# Não selecionada\n');
  const open = fs.openSync, opened = [];
  t.mock.method(fs, 'openSync', (name, ...args) => { opened.push(name); return open(name, ...args); });
  const result = gatherContext(root, 'fora/SPEC.md');
  assert.equal(result.documentsComplete, false); assert.equal(result.selection.status, 'outside-configured-specs');
  assert.equal(result.documents.spec.status, 'not-read');
  assert.ok(Object.values(result.documents).every(item => item.text === undefined));
  assert.ok(!opened.includes(join(root, 'docs/product/prd.md')));
  assert.throws(() => gatherContext(root, '../segredo.md'), /spec relativa/i);
});

for (const target of ['.env', '.pbai4devs/private.md']) test(`configuração não lê ou emite arquivo privado ${target}`, t => {
  const { root, put } = fixture(t), state = join(root, '.pbai4devs/state/configuracao/ESTADO.md');
  put(target, 'TOKEN=synthetic-only\n');
  fs.writeFileSync(state, fs.readFileSync(state, 'utf8').replace('prd: docs/product/prd.md', `prd: ${target}`));
  const open = fs.openSync, opened = [];
  t.mock.method(fs, 'openSync', (name, ...args) => { opened.push(name); return open(name, ...args); });
  const result = gatherContext(root, 'docs/specs/primeira/SPEC.md');
  assert.equal(result.documentsComplete, false); assert.equal(result.documents.prd.status, 'unsafe');
  assert.ok(!opened.includes(join(root, target))); assert.doesNotMatch(JSON.stringify(result), /TOKEN=synthetic-only/);
  assert.ok(Object.values(result.documents).every(item => item.text === undefined && item.sha256 === undefined));
});

test("ambiguous configuration does not release the collection or opens documents", t => {
  const { root } = fixture(t), state = join(root, '.pbai4devs/state/configuracao/ESTADO.md');
  fs.writeFileSync(state, fs.readFileSync(state, 'utf8').replace('  prd: docs/product/prd.md', '  prd: docs/product/prd.md\n    item: inesperado'));
  const open = fs.openSync, opened = [];
  t.mock.method(fs, 'openSync', (name, ...args) => { opened.push(name); return open(name, ...args); });
  const result = gatherContext(root, 'docs/specs/primeira/SPEC.md');
  assert.equal(result.documentsComplete, false); assert.equal(result.selection.status, 'not-configured');
  assert.ok(!opened.includes(join(root, 'docs/product/prd.md')));
  assert.ok(Object.values(result.documents).every(item => item.text === undefined && item.sha256 === undefined));
});

test("discards collects when the state changes during rereading another document", t => {
  const { root } = fixture(t);
  const state = join(root, '.pbai4devs/state/configuracao/ESTADO.md');
  const design = join(root, 'docs/product/design.md');
  const open = fs.openSync; let count = 0;
  t.mock.method(fs, 'openSync', (name, ...args) => {
    if (name === design && ++count === 2) {
      fs.writeFileSync(state, fs.readFileSync(state, 'utf8').replace('prd.md', 'outra.md'));
    }
    return open(name, ...args);
  });
  const result = gatherContext(root, 'docs/specs/primeira/SPEC.md');
  assert.equal(count, 2); assert.equal(result.documentsComplete, false);
  assert.equal(result.documents.estado.status, 'changed');
  assert.ok(Object.values(result.documents).every(item => item.text === undefined && item.sha256 === undefined));
});

for (const value of ['null', '~']) test(`documentos ${value} não aceita caminhos aninhados`, t => {
  const { root } = fixture(t), state = join(root, '.pbai4devs/state/configuracao/ESTADO.md');
  fs.writeFileSync(state, fs.readFileSync(state, 'utf8').replace('documentos:\n', `documentos: ${value}\n`));
  const open = fs.openSync, opened = [];
  t.mock.method(fs, 'openSync', (name, ...args) => { opened.push(name); return open(name, ...args); });
  const result = gatherContext(root, 'docs/specs/primeira/SPEC.md');
  assert.equal(result.documentsComplete, false); assert.equal(result.selection.status, 'not-configured');
  assert.ok(!opened.includes(join(root, 'docs/product/prd.md')));
  assert.ok(Object.values(result.documents).every(item => item.text === undefined && item.sha256 === undefined));
});

test("explicit spec remains selected when there is more than one", t => {
  const { root, put } = fixture(t); put('docs/specs/segunda/SPEC.md', '---\nstatus: rascunho\n---\n\n# Segunda\n');
  const result = gatherContext(root, 'docs/specs/primeira/SPEC.md');
  assert.equal(result.selection.status, 'selected'); assert.equal(result.documents.spec.path, 'docs/specs/primeira/SPEC.md');
});

test('spec ausente interrompe a coleta antes de abrir os documentos de produto', t => {
  const { root } = fixture(t); fs.rmSync(join(root, 'docs/specs/primeira/SPEC.md'));
  const open = fs.openSync, opened = [];
  t.mock.method(fs, 'openSync', (name, ...args) => { opened.push(name); return open(name, ...args); });
  const result = gatherContext(root, 'docs/specs/primeira/SPEC.md');
  assert.equal(result.documentsComplete, false); assert.equal(result.selection.status, 'not-verified');
  assert.equal(result.documents.spec.status, 'missing');
  assert.ok(!opened.includes(join(root, 'docs/product/prd.md')));
  assert.ok(Object.values(result.documents).every(item => item.text === undefined && item.sha256 === undefined));
});

test("missing document does not turn empty content or complete collection", t => {
  const { root } = fixture(t); fs.rmSync(join(root, 'docs/product/design.md'));
  const result = gatherContext(root, 'docs/specs/primeira/SPEC.md');
  assert.equal(result.documentsComplete, false); assert.equal(result.documents.design.status, 'missing');
  assert.equal(result.documents.design.text, undefined);
});

test('rejeita link em ancestral sem ler o destino externo', t => {
  const { root } = fixture(t), outside = fs.mkdtempSync(join(tmpdir(), 'adk-spec-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(join(outside, 'design.md'), 'segredo externo\n');
  fs.rmSync(join(root, 'docs/product/design.md'));
  try { fs.symlinkSync(join(outside, 'design.md'), join(root, 'docs/product/design.md')); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('Links simbólicos indisponíveis.'); throw error; }
  const result = gatherContext(root, 'docs/specs/primeira/SPEC.md');
  assert.equal(result.documentsComplete, false); assert.equal(result.documents.design.status, 'unsafe');
  assert.equal(result.documents.design.text, undefined); assert.equal(fs.readFileSync(join(outside, 'design.md'), 'utf8'), 'segredo externo\n');
});

test("refuses large file or UTF-8 invalid without issuing partial content", t => {
  const { root, put } = fixture(t);
  put('docs/product/design.md', Buffer.alloc(256 * 1024 + 1, 65));
  let result = gatherContext(root, 'docs/specs/primeira/SPEC.md');
  assert.equal(result.documentsComplete, false); assert.equal(result.documents.design.status, 'too-large');
  assert.equal(result.documents.design.text, undefined);
  put('docs/product/design.md', Buffer.from([0xff, 0xfe]));
  result = gatherContext(root, 'docs/specs/primeira/SPEC.md');
  assert.equal(result.documentsComplete, false); assert.equal(result.documents.design.status, 'invalid-utf8');
  assert.equal(result.documents.design.text, undefined);
});

test("discards altered reading during collection", t => {
  const { root, put } = fixture(t), file = join(root, 'docs/product/design.md');
  const open = fs.openSync, read = fs.readSync; let target, changed = false;
  t.mock.method(fs, 'openSync', (name, ...args) => { const fd = open(name, ...args); if (name === file) target = fd; return fd; });
  t.mock.method(fs, 'readSync', (fd, ...args) => {
    const count = read(fd, ...args);
    if (fd === target && !changed) { changed = true; put('docs/product/design.md', '# Alteração concorrente mais longa\n'); }
    return count;
  });
  const result = readDocument(root, 'docs/product/design.md');
  assert.equal(changed, true); assert.equal(result.status, 'changed'); assert.equal(result.text, undefined);
});

test("Raw selector keeps JSON clean and differentiate complete collection, incomplete and invalid entry", t => {
  const { root } = fixture(t), scripts = new URL('../../', import.meta.url);
  for (const name of ['reunir-contexto-spec/SCRIPT.mjs', 'executar-script/SCRIPT.mjs', 'lib/runtime.mjs', 'lib/state-path.mjs', 'lib/project-metadata.mjs', 'lib/script-config.mjs']) {
    const target = join(root, '.pbai4devs/scripts', name); fs.mkdirSync(dirname(target), { recursive: true });
    fs.copyFileSync(new URL(name, scripts), target);
  }
  const selector = join(root, '.pbai4devs/scripts/executar-script/SCRIPT.mjs');
  const run = spec => spawnSync(process.execPath, [selector, '--raw', 'reunir-contexto-spec', '--spec', spec], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const complete = run('docs/specs/primeira/SPEC.md');
  assert.equal(complete.status, 0, complete.stderr); assert.equal(JSON.parse(complete.stdout).documentsComplete, true);
  assert.match(complete.stderr, /runtime=node/);
  const incomplete = run('fora/SPEC.md');
  assert.equal(incomplete.status, 1, incomplete.stderr); assert.equal(JSON.parse(incomplete.stdout).documentsComplete, false);
  assert.ok(Object.values(JSON.parse(incomplete.stdout).documents).every(item => item.text === undefined));
  const invalid = run('../fora/SPEC.md');
  assert.equal(invalid.status, 2); assert.equal(invalid.stdout, ''); assert.match(invalid.stderr, /Nao foi possivel/);
});
