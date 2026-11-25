import '../../lib/test-git-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import childProcess, { spawnSync } from 'node:child_process';
import { projectRoot } from '../../lib/runtime.mjs';
import { collectErrorDiagnostics } from '../../lib/error-reporting.mjs';
import { isReference, synchronize } from '../SCRIPT.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const source = '.pbai4devs/skills/demo/SKILL.md';
const generated = '.claude/skills/demo/SKILL.md';
const human = '# Título\n\nLeia [manual](https://example.com/manual).\n';
function write(root, path, data) { fs.mkdirSync(dirname(join(root, path)), { recursive: true }); fs.writeFileSync(join(root, path), data); }
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'agentdevkit-ownership-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, '.pbai4devs/espelhos.conf', 'agente|.claude|plano\n');
  write(root, source, '---\nname: demo\ndescription: Exemplo.\n---\n\n# Demo\n');
  for (const name of ['agents.ignore', 'shared.ignore', 'local.ignore', 'clients.json']) write(root, `.pbai4devs/templates/gitignore/${name}`, fs.readFileSync(join(projectRoot, '.pbai4devs/templates/gitignore', name)));
  const initialized = spawnSync('git', ['-C', root, 'init', '-q'], { encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  return root;
}
const run = (root, options = {}) => synchronize({ root, generateEntrypoints: false, localIgnores: false, output() {}, ...options });
function snapshot(root) {
  const files = {};
  function visit(path, prefix = '') {
    for (const entry of fs.readdirSync(path, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const next = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { files[next] = 'directory'; visit(join(path, entry.name), next); }
      else files[next] = hash(fs.readFileSync(join(path, entry.name)));
    }
  }
  visit(root); return files;
}

test("human text with reference format never proves property", t => {
  for (const path of [generated, '.claude/skills/human.md']) {
    const root = fixture(t); write(root, path, human);
    const before = snapshot(root);
    assert.equal(isReference(human), true, 'O parser de formato continua independente da propriedade.');
    assert.equal(run(root, { check: true }).exitCode, 1);
    const result = run(root);
    assert.ok(result.preserved.some(item => item.path === path));
    assert.ok(!result.ownedOutputs.includes(path));
    if (path === generated) {
      assert.ok(fs.readFileSync(join(root, path), 'utf8').startsWith(human));
      assert.match(fs.readFileSync(join(root, path), 'utf8'), /<!-- BEGIN AGENTDEVKIT -->/);
    } else {
      assert.equal(fs.readFileSync(join(root, path), 'utf8'), human);
      assert.equal(snapshot(root)[path], before[path]);
    }
    assert.equal(run(root, { check: true }).exitCode, 0);
    const stable = snapshot(root);
    run(root, { force: true });
    assert.deepEqual(snapshot(root), stable);
  }
});

test("registered hash proves legacy reference without marker and human empty directory remains", t => {
  const root = fixture(t), stale = '.claude/skills/legacy.md';
  write(root, stale, human);
  write(root, '.pbai4devs/state/agentdevkit.json', JSON.stringify({ schemaVersion: 1, clients: ['claude'], files: { [stale]: hash(human) }, blocks: {} }));
  fs.mkdirSync(join(root, '.claude/skills/user-empty'), { recursive: true });
  run(root);
  assert.equal(fs.existsSync(join(root, stale)), false);
  assert.equal(fs.existsSync(join(root, '.claude/skills/user-empty')), true);
  assert.equal(run(root, { check: true }).exitCode, 0);
});

test("negation of human ignorance is preserved and visibility is warned", t => {
  const root = fixture(t); write(root, '.gitignore', '!/.agent-tests/\n!/.agent-tests/**\n');
  const before = fs.readFileSync(join(root, '.gitignore')), exclude = fs.readFileSync(join(root, '.git/info/exclude')), messages = [];
  assert.equal(run(root, { localIgnores: true, force: true, output: message => messages.push(message) }).exitCode, 0);
  assert.deepEqual(fs.readFileSync(join(root, '.gitignore')), before);
  assert.deepEqual(fs.readFileSync(join(root, '.git/info/exclude')), exclude);
  assert.ok(messages.some(message => /dados privados podem ficar visíveis/.test(message)));
  assert.ok(fs.existsSync(join(root, generated)));
});

test("own reference update saves permissions", t => {
  const root = fixture(t); run(root);
  fs.chmodSync(join(root, generated), 0o600);
  const mode = fs.statSync(join(root, generated)).mode & 0o777;
  write(root, source, '---\nname: demo\ndescription: Atualizado.\n---\n\n# Demo\n');
  run(root);
  assert.equal(fs.statSync(join(root, generated)).mode & 0o777, mode);
});

test("concurrent change of ignore after recording preserves the human rule", t => {
  const root = fixture(t); run(root);
  write(root, source, '---\nname: demo\ndescription: Atualizado.\n---\n\n# Demo\n');
  const target = join(root, generated);
  let injected = false;
  const editIgnore = () => {
    if (injected) return;
    injected = true;
    write(root, '.git/info/exclude', '# concurrent human change\n');
  };
  if (process.platform === 'win32') {
    const spawn = childProcess.spawnSync;
    t.mock.method(childProcess, 'spawnSync', (program, args, options) => {
      const result = spawn(program, args, options);
      if (options?.env?.AGENTDEVKIT_DESTINATION === target && result.status === 0) editIgnore();
      return result;
    });
  } else {
    const rename = fs.renameSync;
    t.mock.method(fs, 'renameSync', (from, to) => {
      rename(from, to);
      if (to === target) editIgnore();
    });
  }
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.equal(run(root, { localIgnores: true }).exitCode, 0);
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(join(root, '.git/info/exclude'), 'utf8'), '# concurrent human change\n');
});

function afterNewFileCloses(t, target, action) {
  const open = fs.openSync, close = fs.closeSync;
  let targetFd;
  t.mock.method(fs, 'openSync', (path, flags, ...args) => {
    const fd = open(path, flags, ...args);
    if (path === target && flags === 'wx') targetFd = fd;
    return fd;
  });
  t.mock.method(fs, 'closeSync', fd => {
    close(fd);
    if (fd === targetFd) { targetFd = undefined; action(); }
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

test("competing human content is preserved in sync failure", t => {
  const root = fixture(t);
  afterNewFileCloses(t, join(root, generated), () => write(root, generated, human));
  assert.throws(() => run(root), /Mudanca concorrente preservada/);
  assert.equal(fs.readFileSync(join(root, generated), 'utf8'), human);
  assert.equal(run(root, { check: true }).recovery.status, 'pending');
});

test("failure to register derivative removal preserves fallback in backup and index in project", t => {
  const root = fixture(t), fallback = '.codex/skills/demo/SKILL.md';
  write(root, '.pbai4devs/espelhos.conf', [
    'agente|.agents|agrupado', 'agente|.codex|plano',
    'formato|.codex|skills|nenhum', 'fallback|.codex|.agents|skills',
  ].join('\n') + '\n');
  write(root, '.agents/skills', 'obstrução humana');
  write(root, '.gitignore', '# ignore humano\n');
  assert.equal(spawnSync('git', ['-C', root, 'add', '.gitignore']).status, 0);
  run(root);
  const initial = fs.readFileSync(join(root, fallback));
  write(root, '.pbai4devs/state/agentdevkit.json', JSON.stringify({ schemaVersion: 1, files: { [fallback]: hash(initial) }, blocks: {} }));
  fs.rmSync(join(root, '.agents/skills')); // The obstruction belongs to the fixture.
  const index = fs.readFileSync(join(root, '.git/index'));
  const writeFile = fs.writeFileSync, originalRemove = fs.rmSync;
  let injected = false, temporary, temporaryBytes, cleanupAttempted = false;
  t.mock.method(fs, 'writeFileSync', (path, data, ...args) => {
    const result = writeFile(path, data, ...args);
    if (!injected && typeof path === 'string' && path.includes(`${sep}stage${sep}`) &&
        typeof data === 'string' && data.includes('"removedFiles"') && data.includes(fallback)) {
      injected = true; temporary = path; temporaryBytes = fs.readFileSync(path);
      throw new Error('falha injetada no registro derivado');
    }
    return result;
  });
  t.mock.method(fs, 'rmSync', (path, ...args) => {
    if (path === temporary) cleanupAttempted = true;
    return originalRemove(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  let failure; try { run(root); } catch (error) { failure = error; }
  assert.match(failure?.message || '', /falha injetada no registro derivado/);
  assert.equal(injected, true); assert.ok(temporary && temporaryBytes);
  assert.equal(cleanupAttempted, false);
  assert.deepEqual(fs.readFileSync(temporary), temporaryBytes);
  assert.ok(collectErrorDiagnostics(failure).preservedPaths.includes(temporary));
  assert.deepEqual(fs.readFileSync(join(root, '.git/index')), index);
  assert.equal(fs.existsSync(join(root, fallback)), false);
  const backup = failure.recovery.backup;
  const manifest = JSON.parse(fs.readFileSync(join(backup, 'manifest.json')));
  const entry = manifest.entries.find(item => item.path === fallback);
  assert.deepEqual(fs.readFileSync(join(backup, 'blobs', entry.blob)), initial);
  assert.throws(() => run(root), { code: 'E_RECOVERY_PENDING' });
});

test("human content is preserved when closing informs failure after writing", t => {
  const root = fixture(t);
  const failure = new Error('falha depois de fechar');
  afterNewFileCloses(t, join(root, generated), () => { write(root, generated, human); throw failure; });
  assert.throws(() => run(root), error => error === failure && error.recovery.status === 'pending');
  assert.equal(fs.readFileSync(join(root, generated), 'utf8'), human);
});

test("catalog failure preserves ancestral and maintains already completed removals", { skip: process.platform === 'win32' && 'A comparação desta fixture verifica os bits POSIX dos diretórios antes e depois da falha.' }, t => {
  const root = fixture(t); run(root);
  const parent = join(root, '.claude/skills'); fs.chmodSync(parent, 0o700);
  fs.rmSync(join(root, '.pbai4devs/skills/demo'), { recursive: true });
  const original = fs.readFileSync(join(root, generated)), rename = fs.renameSync;
  let injected = false;
  t.mock.method(fs, 'renameSync', (from, to) => {
    rename(from, to);
    if (!injected && to === join(root, '.pbai4devs/catalog.json')) { injected = true; throw new Error('falha injetada no catálogo'); }
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.throws(() => run(root, { localIgnores: true }), /falha injetada no catálogo/);
  assert.equal(injected, true);
  assert.equal(fs.existsSync(join(root, generated)), false);
  const backup = run(root, { check: true }).recovery.backup;
  const manifest = JSON.parse(fs.readFileSync(join(backup, 'manifest.json')));
  const entry = manifest.entries.find(item => item.path === generated);
  assert.deepEqual(fs.readFileSync(join(backup, 'blobs', entry.blob)), original);
  assert.equal(fs.statSync(parent).mode & 0o777, 0o700);
});
