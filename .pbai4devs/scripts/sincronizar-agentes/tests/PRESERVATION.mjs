import '../../lib/test-git-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { gitIndexStatIdentityMatches, synchronize } from '../SCRIPT.mjs';
import { indexContentMatches, planUntrack } from '../../lib/gitignore.mjs';
import { nativeSkipReason } from '../../testar-infraestrutura/PLATFORM_FIXTURES.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const original = '.pbai4devs/skills/projeto/criar-skill/SKILL.md';
const pointer = '.claude/skills/criar-skill/SKILL.md';
const file = (root, relative) => join(root, relative);
const put = (root, relative, content) => { mkdirSync(dirname(file(root, relative)), { recursive: true }); writeFileSync(file(root, relative), content); };
function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}
function fixture(t, withGit = true) {
  mkdirSync(join(repository, '.agent-tests'), { recursive: true });
  const root = mkdtempSync(join(withGit ? join(repository, '.agent-tests') : tmpdir(), 'sync-preservation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (withGit) git(root, 'init', '--quiet');
  populate(root);
  return root;
}
function populate(root) {
  put(root, '.gitignore', '# Human ignore\nnode_modules/\n');
  put(root, '.pbai4devs/templates/gitignore/agents.ignore', '# Cache\n/*\n!/.gitignore\n{{ALLOWLIST}}\n/cache/\n*.log\n');
  put(root, '.pbai4devs/templates/gitignore/clients.json', '{}\n');
  put(root, '.pbai4devs/templates/gitignore/shared.ignore', '# Shared\n/tools/*/.local/\n');
  put(root, '.pbai4devs/espelhos.conf', 'agente|.claude|plano\n');
  put(root, original, '---\nname: criar-skill\ndescription: Criar recurso.\n---\n\n# Criar skill\n');
  assert.equal(run(root).exitCode, 0);
  assert.ok(existsSync(file(root, pointer)));
}
function run(root, options = {}) {
  return synchronize({ root, localIgnores: false, generateEntrypoints: false, output() {}, ...options });
}
function withoutGit(t, callback) {
  const emptyPath = mkdtempSync(join(tmpdir(), 'sync-empty-path-'));
  t.after(() => rmSync(emptyPath, { recursive: true, force: true }));
  const keys = Object.keys(process.env).filter(key => key.toLowerCase() === 'path');
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  if (!keys.length) keys.push('PATH');
  try {
    for (const key of keys) process.env[key] = emptyPath;
    return callback();
  } finally {
    for (const key of keys) {
      if (previous.has(key)) process.env[key] = previous.get(key);
      else delete process.env[key];
    }
  }
}

test("index identity uses 32 bit fields of Git format", () => {
  const info = { dev: 0x1_0000_0042n, ino: 0x3_0000_007bn };
  assert.equal(gitIndexStatIdentityMatches(0x42n, 0x7bn, info, 'darwin'), true);
  assert.equal(gitIndexStatIdentityMatches(info.dev, info.ino, info, 'darwin'), false);
  assert.equal(gitIndexStatIdentityMatches(0x42n, 0x7cn, info, 'darwin'), false);
  assert.equal(gitIndexStatIdentityMatches(0n, 0n, info, 'win32'), true);
  assert.equal(gitIndexStatIdentityMatches(0n, 0x7bn, info, 'win32'), false);
  assert.equal(gitIndexStatIdentityMatches(0x42n, 0n, info, 'win32'), false);
  assert.equal(gitIndexStatIdentityMatches(0n, 0n, info, 'darwin'), false);
  assert.equal(gitIndexStatIdentityMatches(null, 0x7bn, info, 'darwin'), false);
});

test("query preserves the project even with trace Git inherited", t => {
  const root = fixture(t), trace = file(root, 'trace-sintetico.log');
  git(root, 'add', '-f', '--', '.gitignore');
  const env = { ...process.env, GIT_TRACE: trace };
  const control = spawnSync('git', ['-C', root, 'rev-parse', '--git-dir'], { env, encoding: 'utf8' });
  assert.equal(control.status, 0, control.stderr);
  assert.ok(existsSync(trace), 'o controle deve criar o arquivo de trace');
  rmSync(trace);
  const index = readFileSync(file(root, '.git/index'));
  const ignore = readFileSync(file(root, '.gitignore'));
  const config = readFileSync(file(root, '.git/config'));
  const previous = process.env.GIT_TRACE;
  try {
    process.env.GIT_TRACE = trace;
    assert.equal(run(root, { check: true }).exitCode, 0);
    assert.equal(existsSync(trace), false);
  } finally {
    if (previous === undefined) delete process.env.GIT_TRACE;
    else process.env.GIT_TRACE = previous;
  }
  assert.deepEqual(readFileSync(file(root, '.git/index')), index);
  assert.deepEqual(readFileSync(file(root, '.gitignore')), ignore);
  assert.deepEqual(readFileSync(file(root, '.git/config')), config);
});

for (const [withGit, force] of [[true, false], [true, true], [false, false], [false, true]]) {
  test(`remoção obsoleta preserva pasta vazia humana (git=${withGit}, force=${force})`, t => {
    const root = fixture(t, withGit), human = '.claude/skills/criar-skill/Equipe-Vazia';
    mkdirSync(file(root, human));
    const state = readFileSync(file(root, '.pbai4devs/state/derived.json'));
    const index = withGit ? git(root, 'ls-files', '--stage', '-z') : null;
    const ignore = readFileSync(file(root, '.gitignore'));
    rmSync(dirname(file(root, original)), { recursive: true });
    const check = run(root, { check: true, force });
    assert.notEqual(check.exitCode, 0);
    assert.ok(existsSync(file(root, pointer)));
    assert.ok(existsSync(file(root, human)));
    assert.deepEqual(readFileSync(file(root, '.pbai4devs/state/derived.json')), state);
    run(root, { force });
    assert.equal(existsSync(file(root, pointer)), false, 'apontamento obsoleto comprovado é removido');
    assert.ok(existsSync(file(root, human)), 'pasta vazia própria permanece');
    assert.deepEqual(readFileSync(file(root, '.gitignore')), ignore);
    if (withGit) assert.equal(git(root, 'ls-files', '--stage', '-z'), index);
  });
}

for (const force of [false, true]) {
  test(`índice com conteúdo humano divergente bloqueia remoção (force=${force})`, t => {
    const root = fixture(t), generated = readFileSync(file(root, pointer));
    put(root, pointer, Buffer.concat([generated, Buffer.from('\nConteúdo humano staged.\n')]));
    git(root, 'add', '-f', '--', pointer);
    const index = git(root, 'ls-files', '--stage', '-z');
    put(root, pointer, generated);
    rmSync(dirname(file(root, original)), { recursive: true });
    const state = readFileSync(file(root, '.pbai4devs/state/derived.json'));
    const check = run(root, { check: true, force });
    assert.notEqual(check.exitCode, 0);
    assert.deepEqual(readFileSync(file(root, pointer)), generated);
    assert.deepEqual(readFileSync(file(root, '.pbai4devs/state/derived.json')), state);
    assert.throws(() => run(root, { force }), /conflitos|indice|índice/i);
    assert.deepEqual(readFileSync(file(root, pointer)), generated);
    assert.equal(git(root, 'ls-files', '--stage', '-z'), index);
  });
}

for (const force of [false, true]) {
  test(`índice divergente impede atualização de apontamento ativo (force=${force})`, t => {
    const root = fixture(t), generated = readFileSync(file(root, pointer));
    put(root, pointer, Buffer.concat([generated, Buffer.from('\nAlteração humana staged.\n')]));
    git(root, 'add', '-f', '--', pointer);
    const index = git(root, 'ls-files', '--stage', '-z');
    put(root, pointer, generated);
    put(root, original, '---\nname: criar-skill\ndescription: Mudança real.\n---\n\n# Criar skill\n');
    const state = readFileSync(file(root, '.pbai4devs/state/derived.json'));
    const output = [];
    const check = run(root, { check: true, force, output: line => output.push(line) });
    assert.notEqual(check.exitCode, 0);
    assert.ok(check.conflictPaths.includes(pointer));
    assert.ok(output.some(line => line.includes(JSON.stringify(pointer))));
    assert.ok(output.every(line => !line.includes('Alteração humana staged.')));
    assert.throws(() => run(root, { force }), /indice/i);
    assert.deepEqual(readFileSync(file(root, pointer)), generated);
    assert.deepEqual(readFileSync(file(root, '.pbai4devs/state/derived.json')), state);
    assert.equal(git(root, 'ls-files', '--stage', '-z'), index);
  });
}

for (const flag of ['--assume-unchanged', '--skip-worktree']) {
  test(`índice divergente continua protegido com ${flag}`, t => {
    const root = fixture(t), generated = readFileSync(file(root, pointer));
    put(root, pointer, Buffer.concat([generated, Buffer.from('\nAlteração humana staged.\n')]));
    git(root, 'add', '-f', '--', pointer);
    put(root, pointer, generated);
    git(root, 'update-index', flag, '--', pointer);
    const index = git(root, 'ls-files', '--stage', '-z');
    const flags = git(root, 'ls-files', '-v', '--', pointer);
    put(root, original, '---\nname: criar-skill\ndescription: Mudança real.\n---\n\n# Criar skill\n');
    assert.notEqual(run(root, { check: true, force: true }).exitCode, 0);
    assert.throws(() => run(root, { force: true }), /indice/i);
    assert.deepEqual(readFileSync(file(root, pointer)), generated);
    assert.equal(git(root, 'ls-files', '--stage', '-z'), index);
    assert.equal(git(root, 'ls-files', '-v', '--', pointer), flags);
  });
}

test("index with box alias blocks change conservatively in any system", t => {
  const root = fixture(t), generated = readFileSync(file(root, pointer));
  const alias = pointer.replace('/skills/', '/SKILLS/');
  put(root, alias, Buffer.concat([generated, Buffer.from('\nAlteração humana staged.\n')]));
  git(root, 'add', '-f', '--', alias);
  const index = git(root, 'ls-files', '--stage', '-z');
  put(root, pointer, generated);
  put(root, original, '---\nname: criar-skill\ndescription: Mudança real.\n---\n\n# Criar skill\n');
  const aliasBytes = readFileSync(file(root, alias));
  const state = readFileSync(file(root, '.pbai4devs/state/derived.json'));
  const ignore = readFileSync(file(root, '.gitignore'));
  const preserved = () => {
    assert.deepEqual(readFileSync(file(root, pointer)), generated);
    assert.deepEqual(readFileSync(file(root, alias)), aliasBytes);
    assert.deepEqual(readFileSync(file(root, '.pbai4devs/state/derived.json')), state);
    assert.deepEqual(readFileSync(file(root, '.gitignore')), ignore);
    assert.equal(git(root, 'ls-files', '--stage', '-z'), index);
  };
  let check, error;
  try { check = run(root, { check: true, force: true }); } catch (failure) { error = failure; }
  if (error) assert.match(error.message, /maiusculas\/minusculas/i);
  else assert.notEqual(check.exitCode, 0);
  preserved();
  assert.throws(() => run(root, { force: true }), /indice|maiusculas\/minusculas/i);
  preserved();
});

test("index comparison CRLF authorised and refused filters, binaries and divergence", t => {
  const root = fixture(t), path = 'arquivo.txt';
  const crlf = Buffer.from('texto\r\noutra linha\r\n'), lf = Buffer.from('texto\noutra linha\n');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'config', 'core.attributesfile', file(root, 'atributos-ausentes'));
  assert.equal(indexContentMatches(root, path, crlf, lf), false);
  git(root, 'config', 'core.autocrlf', 'true');
  assert.equal(indexContentMatches(root, path, crlf, lf), true);
  assert.equal(indexContentMatches(root, path, crlf, Buffer.from('texto humano\noutra linha\n')), false);
  assert.equal(indexContentMatches(root, path, Buffer.from([0, 13, 10]), Buffer.from([0, 10])), false);
  assert.equal(indexContentMatches(root, path, Buffer.from('um\r\ndois\r'), Buffer.from('um\ndois\r')), false);
  assert.equal(indexContentMatches(root, path, Buffer.from('\ufefftexto\r\n'), Buffer.from('texto\n')), false);
  assert.equal(indexContentMatches(root, path, Buffer.from('\ufefftexto\r\n'), Buffer.from('\ufefftexto\n')), true);
  put(root, '.gitattributes', '*.txt -text\n');
  assert.equal(indexContentMatches(root, path, crlf, lf), false);
  put(root, '.gitattributes', '*.txt text filter=nao-executar\n');
  git(root, 'config', 'filter.nao-executar.clean', 'exit 1');
  assert.equal(indexContentMatches(root, path, crlf, lf), false);
  put(root, '.gitattributes', '*.txt text working-tree-encoding=UTF-16\n');
  assert.equal(indexContentMatches(root, path, crlf, lf), false);
  put(root, '.gitattributes', '*.txt text ident\n');
  assert.equal(indexContentMatches(root, path, crlf, lf), false);
  put(root, '.gitattributes', '*.txt text eol=crlf\n');
  git(root, 'config', 'core.autocrlf', 'false');
  assert.equal(indexContentMatches(root, path, crlf, lf), true);
});

test("Standard index does not distinguish between conversions CRLF before or after staging", t => {
  const before = fixture(t), after = fixture(t);
  for (const root of [before, after]) git(root, 'config', 'core.autocrlf', 'true');
  put(before, pointer, readFileSync(file(before, pointer), 'utf8').replaceAll('\n', '\r\n'));
  git(before, 'add', '-f', '--', pointer);
  git(after, 'add', '-f', '--', pointer);
  put(after, pointer, readFileSync(file(after, pointer), 'utf8').replaceAll('\n', '\r\n'));
  assert.deepEqual(readFileSync(file(before, pointer)), readFileSync(file(after, pointer)));
  assert.equal(git(before, 'show', `:${pointer}`), git(after, 'show', `:${pointer}`));
  const records = root => JSON.parse(readFileSync(file(root, '.pbai4devs/state/derived.json'), 'utf8')).files[pointer];
  assert.equal(records(before), records(after));
});

test("sync updates equivalent staged note in autocrlf repository", t => {
  const root = fixture(t), generated = readFileSync(file(root, pointer), 'utf8').replaceAll('\n', '\r\n');
  git(root, 'config', 'core.autocrlf', 'true');
  put(root, pointer, generated);
  git(root, 'add', '-f', '--', pointer);
  const stagedStat = lstatSync(file(root, pointer), { bigint: true });
  const stagedDebug = git(root, 'ls-files', '--debug', '-z', '--', pointer).split('\0')[1];
  const stagedSeparator = String.fromCharCode(0);
  const stagedFields = stagedDebug.slice(stagedDebug.indexOf(stagedSeparator) + 1)
    .split(String.fromCharCode(9)).flatMap(part => part.split(String.fromCharCode(10)));
  const stagedField = name => {
    const line = stagedFields.find(row => row.trimStart().startsWith(`${name}:`));
    assert.ok(line, `campo ${name} ausente em git ls-files --debug`);
    return BigInt(line.slice(line.indexOf(':') + 1).trim());
  };
  const indexedDev = stagedField('dev'), indexedIno = stagedField('ino');
  const identityUnavailable = process.platform === 'win32' && indexedDev === 0n && indexedIno === 0n;
  assert.equal(gitIndexStatIdentityMatches(indexedDev, indexedIno, stagedStat), true);
  if (identityUnavailable) {
    t.diagnostic('Git index stat identity unavailable: dev=0 and ino=0; staged blob and stable metadata remain checked.');
  } else {
    assert.equal(indexedDev, BigInt.asUintN(32, stagedStat.dev));
    assert.equal(indexedIno, BigInt.asUintN(32, stagedStat.ino));
  }
  const devTruncated = !identityUnavailable && stagedStat.dev > 0xffff_ffffn;
  const inodeTruncated = !identityUnavailable && stagedStat.ino > 0xffff_ffffn;
  if (!identityUnavailable && inodeTruncated) assert.notEqual(indexedIno, stagedStat.ino);
  t.diagnostic(`Git index identity: unavailable=${identityUnavailable}, devTruncated=${devTruncated}, inodeTruncated=${inodeTruncated}`);
  const index = git(root, 'ls-files', '--stage', '-z');
  const indexBytes = readFileSync(file(root, '.git/index'));
  put(root, original, '---\nname: criar-skill\ndescription: Mudança real.\n---\n\n# Criar skill\n');
  let syncError;
  try { assert.equal(run(root, { force: true }).exitCode, 0); } catch (error) { syncError = error; }
  if (syncError) {
    const stat = lstatSync(file(root, pointer), { bigint: true });
    const debug = git(root, 'ls-files', '--debug', '-z', '--', pointer);
    const attributes = git(root, 'check-attr', '-z', 'text', 'eol', 'filter', 'working-tree-encoding', 'ident', '--', pointer);
    const autocrlf = git(root, 'config', '--bool', 'core.autocrlf');
    assert.equal(syncError, undefined, `${syncError.message}\nstat=${JSON.stringify({ dev: String(stat.dev), ino: String(stat.ino), uid: String(stat.uid), gid: String(stat.gid), size: String(stat.size), ctimeNs: String(stat.ctimeNs), mtimeNs: String(stat.mtimeNs) })}\nindex=${JSON.stringify(debug)}\nattributes=${JSON.stringify(attributes)}\nautocrlf=${JSON.stringify(autocrlf)}`);
  }
  assert.equal(git(root, 'ls-files', '--stage', '-z'), index);
  assert.deepEqual(readFileSync(file(root, '.git/index')), indexBytes);
  const updated = readFileSync(file(root, pointer), 'utf8').replaceAll('\r\n', '\n');
  assert.ok(updated.startsWith('---\nname: criar-skill\ndescription: Mudança real.\n---\n'), JSON.stringify(updated.slice(0, 180)));
});

test("sync preserves human edition only of line endings with active autocrlf", t => {
  const root = fixture(t);
  git(root, 'config', 'core.autocrlf', 'true');
  git(root, 'add', '-f', '--', pointer);
  put(root, pointer, readFileSync(file(root, pointer), 'utf8').replaceAll('\n', '\r\n'));
  const bytes = readFileSync(file(root, pointer));
  const index = readFileSync(file(root, '.git/index'));
  const state = readFileSync(file(root, '.pbai4devs/state/derived.json'));
  put(root, original, '---\nname: criar-skill\ndescription: Mudança real.\n---\n\n# Criar skill\n');
  const messages = [];
  const check = run(root, { check: true, force: true, output: message => messages.push(message) });
  assert.notEqual(check.exitCode, 0);
  assert.ok(check.preserved.some(item => item.path === pointer && item.reason === 'line-ending-diverged'));
  assert.ok(messages.some(message => message.includes('Finais de linha divergentes preservados')));
  assert.throws(() => run(root, { force: true }), /Conteudo proprio preservado/);
  assert.deepEqual(readFileSync(file(root, pointer)), bytes);
  assert.deepEqual(readFileSync(file(root, '.git/index')), index);
  assert.deepEqual(readFileSync(file(root, '.pbai4devs/state/derived.json')), state);
});

for (const recorded of [false, true]) test(`referência CRLF satisfeita permanece intacta sem bloco duplicado: registro=${recorded}`, t => {
  const root = fixture(t), derivedPath = '.pbai4devs/state/derived.json';
  const derived = JSON.parse(readFileSync(file(root, derivedPath), 'utf8'));
  const digest = derived.files[pointer];
  assert.ok(digest);
  delete derived.files[pointer];
  put(root, derivedPath, `${JSON.stringify(derived, null, 2)}\n`);
  if (recorded) put(root, '.pbai4devs/state/agentdevkit.json', JSON.stringify({ schemaVersion: 1, files: { [pointer]: digest }, blocks: {} }));
  git(root, 'add', '.gitignore');
  put(root, pointer, readFileSync(file(root, pointer), 'utf8').replaceAll('\n', '\r\n'));
  const bytes = readFileSync(file(root, pointer)), index = readFileSync(file(root, '.git/index'));
  for (let i = 0; i < 2; i++) {
    const result = run(root, { force: true });
    assert.equal(result.exitCode, 0);
    assert.ok(result.preserved.some(item => item.path === pointer && item.reason === 'existing-reference-satisfied'));
    assert.deepEqual(readFileSync(file(root, pointer)), bytes);
    assert.deepEqual(readFileSync(file(root, '.git/index')), index);
    const current = JSON.parse(readFileSync(file(root, derivedPath), 'utf8'));
    assert.equal(current.files?.[pointer], undefined);
    assert.equal(current.blocks?.[pointer], undefined);
  }
});

test("diagnosis CRLF does not classify UTF-8 invalid as divergence of end of line only", t => {
  const root = fixture(t);
  git(root, 'add', '-f', '--', pointer);
  const originalBytes = readFileSync(file(root, pointer));
  const bytes = Buffer.concat([Buffer.from(originalBytes.toString('utf8').replaceAll('\n', '\r\n')), Buffer.from([0xff])]);
  put(root, pointer, bytes);
  const index = readFileSync(file(root, '.git/index'));
  const check = run(root, { check: true, force: true });
  assert.notEqual(check.exitCode, 0);
  assert.ok(check.preserved.some(item => item.path === pointer && item.reason === 'derived-reference-diverged'));
  assert.throws(() => run(root, { force: true }), /Conteudo proprio preservado/);
  assert.deepEqual(readFileSync(file(root, pointer)), bytes);
  assert.deepEqual(readFileSync(file(root, '.git/index')), index);
});

for (const kind of ['xattr', 'acl']) test(`sync recusa apontamento CRLF com ${kind} no macOS`, { skip: nativeSkipReason('darwin') }, t => {
  const root = fixture(t), target = file(root, pointer);
  git(root, 'config', 'core.autocrlf', 'true');
  put(root, pointer, readFileSync(target, 'utf8').replaceAll('\n', '\r\n'));
  git(root, 'add', '-f', '--', pointer);
  const command = kind === 'xattr'
    ? spawnSync('/usr/bin/xattr', ['-w', 'com.pathbit.crlf-test', 'valor-sintetico', target])
    : spawnSync('/bin/chmod', ['+a', 'everyone allow read', target]);
  assert.equal(command.status, 0, 'fixture deve criar o metadado');
  const bytes = readFileSync(target), index = readFileSync(file(root, '.git/index'));
  const state = readFileSync(file(root, '.pbai4devs/state/derived.json'));
  const identity = statSync(target, { bigint: true });
  put(root, original, '---\nname: criar-skill\ndescription: Mudança real.\n---\n\n# Criar skill\n');
  assert.notEqual(run(root, { check: true, force: true }).exitCode, 0);
  assert.throws(() => run(root, { force: true }), error =>
    error.code === 'E_PROTECTED_METADATA' && error.path === pointer
    || error.code === undefined && error.message === `Conteudo proprio preservado; resolva a colisao antes de sincronizar: ${pointer}`);
  assert.deepEqual(readFileSync(target), bytes);
  assert.deepEqual(readFileSync(file(root, '.git/index')), index);
  assert.deepEqual(readFileSync(file(root, '.pbai4devs/state/derived.json')), state);
  assert.equal(statSync(target, { bigint: true }).ino, identity.ino);
  const inspect = kind === 'xattr'
    ? spawnSync('/usr/bin/xattr', ['-p', 'com.pathbit.crlf-test', target], { encoding: 'utf8' })
    : spawnSync('/bin/ls', ['-lde', '--', target], { encoding: 'utf8' });
  assert.equal(inspect.status, 0);
  assert.match(inspect.stdout, kind === 'xattr' ? /valor-sintetico/ : /everyone allow read/);
});

for (const scenario of ['edição humana', 'conversão desativada', 'filtro personalizado', 'checkout LF explícito']) {
  test(`sync preserva referência CRLF com ${scenario}`, t => {
    const root = fixture(t);
    git(root, 'config', 'core.autocrlf', 'true');
    const generated = readFileSync(file(root, pointer), 'utf8').replaceAll('\n', '\r\n');
    put(root, pointer, scenario === 'edição humana' ? `${generated}\r\nConteúdo humano.\r\n` : generated);
    git(root, 'add', '-f', '--', pointer);
    if (scenario === 'conversão desativada') git(root, 'config', 'core.autocrlf', 'false');
    if (scenario === 'checkout LF explícito') put(root, '.gitattributes', '*.md text eol=lf\n');
    if (scenario === 'filtro personalizado') {
      put(root, '.gitattributes', '*.md filter=nao-executar\n');
      git(root, 'config', 'filter.nao-executar.clean', 'touch filtro-executado');
    }
    put(root, original, '---\nname: criar-skill\ndescription: Mudança real.\n---\n\n# Criar skill\n');
    const bytes = readFileSync(file(root, pointer));
    const index = readFileSync(file(root, '.git/index'));
    const state = readFileSync(file(root, '.pbai4devs/state/derived.json'));
    assert.notEqual(run(root, { check: true, force: true }).exitCode, 0);
    assert.deepEqual(readFileSync(file(root, pointer)), bytes);
    assert.deepEqual(readFileSync(file(root, '.git/index')), index);
    assert.deepEqual(readFileSync(file(root, '.pbai4devs/state/derived.json')), state);
    assert.throws(() => run(root, { force: true }), /Conteudo proprio preservado/);
    assert.deepEqual(readFileSync(file(root, pointer)), bytes);
    assert.deepEqual(readFileSync(file(root, '.git/index')), index);
    assert.deepEqual(readFileSync(file(root, '.pbai4devs/state/derived.json')), state);
    if (scenario === 'filtro personalizado') {
      assert.equal(existsSync(file(root, 'filtro-executado')), false);
      // Force Git to renormalize even when its stat cache sees no change.
      git(root, 'add', '--renormalize', '-f', '--', pointer);
      assert.equal(existsSync(file(root, 'filtro-executado')), true);
    }
  });
}

test("obsolete reference with conversion CRLF is preserved during cleaning", t => {
  const root = fixture(t);
  git(root, 'config', 'core.autocrlf', 'true');
  put(root, pointer, readFileSync(file(root, pointer), 'utf8').replaceAll('\n', '\r\n'));
  git(root, 'add', '-f', '--', pointer);
  const bytes = readFileSync(file(root, pointer));
  const index = readFileSync(file(root, '.git/index'));
  rmSync(dirname(file(root, original)), { recursive: true });
  run(root, { force: true });
  assert.deepEqual(readFileSync(file(root, pointer)), bytes);
  assert.deepEqual(readFileSync(file(root, '.git/index')), index);
});

test("sync preserves Linux attribute when updating reference CRLF or refusal without change", { skip: nativeSkipReason('linux') }, t => {
  const probe = spawnSync('perl', ['-e', 'require "syscall.ph"; my $x = &SYS_setxattr; my $y = &SYS_getxattr;']);
  if (probe.status !== 0) { t.skip('Perl e syscall.ph não estão disponíveis para a fixture xattr.'); return; }
  const root = fixture(t), target = file(root, pointer);
  git(root, 'config', 'core.autocrlf', 'true');
  put(root, pointer, readFileSync(target, 'utf8').replaceAll('\n', '\r\n'));
  git(root, 'add', '-f', '--', pointer);
  const script = String.raw`require 'syscall.ph'; my ($op,$path)=@ARGV; my $name='user.pathbit-crlf-fixture'; if ($op eq 'set') { my $v='synthetic'; exit(syscall(&SYS_setxattr,$path,$name,$v,length($v),0)==0 ? 0 : 1); } my $v="\0" x 32; my $n=syscall(&SYS_getxattr,$path,$name,$v,32); exit(1) if $n<0; print substr($v,0,$n);`;
  const attr = op => spawnSync('perl', ['-e', script, op, target], { encoding: 'utf8' });
  if (attr('set').status !== 0) { t.skip('O filesystem da fixture não permite xattr sintético.'); return; }
  const beforeAttr = attr('get');
  assert.equal(beforeAttr.status, 0);
  assert.equal(beforeAttr.stdout, 'synthetic');
  const bytes = readFileSync(target), index = readFileSync(file(root, '.git/index'));
  put(root, original, '---\nname: criar-skill\ndescription: Mudança real.\n---\n\n# Criar skill\n');
  let error;
  try { assert.equal(run(root, { force: true }).exitCode, 0); } catch (caught) { error = caught; }
  const afterAttr = attr('get');
  assert.equal(afterAttr.status, 0);
  assert.equal(afterAttr.stdout, beforeAttr.stdout);
  if (error) {
    assert.match(error.message, /Conteudo proprio preservado|metadata|atribut/i);
    assert.deepEqual(readFileSync(target), bytes);
  } else {
    assert.match(readFileSync(target, 'utf8'), /description: Mudança real\./);
  }
  assert.deepEqual(readFileSync(file(root, '.git/index')), index);
});

test("sync preserves Linux attribute in common update or refusal without changing", { skip: nativeSkipReason('linux') }, t => {
  const probe = spawnSync('perl', ['-e', 'require "syscall.ph"; my $x = &SYS_setxattr; my $y = &SYS_getxattr;']);
  if (probe.status !== 0) { t.skip('Perl e syscall.ph não estão disponíveis para a fixture xattr.'); return; }
  const root = fixture(t), target = file(root, pointer);
  const script = String.raw`require 'syscall.ph'; my ($op,$path)=@ARGV; my $name='user.pathbit-lf-fixture'; if ($op eq 'set') { my $v='synthetic'; exit(syscall(&SYS_setxattr,$path,$name,$v,length($v),0)==0 ? 0 : 1); } my $v="\0" x 32; my $n=syscall(&SYS_getxattr,$path,$name,$v,32); exit(1) if $n<0; print substr($v,0,$n);`;
  const attr = op => spawnSync('perl', ['-e', script, op, target], { encoding: 'utf8' });
  if (attr('set').status !== 0) { t.skip('O filesystem da fixture não permite xattr sintético.'); return; }
  assert.equal(attr('get').stdout, 'synthetic');
  git(root, 'add', '-f', '--', pointer);
  assert.equal(attr('get').stdout, 'synthetic', 'o preparo do índice deve preservar o atributo');
  const bytes = readFileSync(target), index = readFileSync(file(root, '.git/index'));
  put(root, original, '---\nname: criar-skill\ndescription: Mudança real.\n---\n\n# Criar skill\n');
  if (spawnSync('/usr/bin/getfattr', ['--version']).status === 0) {
    const check = run(root, { check: true, force: true });
    assert.equal(check.xattrBlockers.includes(pointer), false);
    assert.equal(check.xattrUnverified.includes(pointer), false);
    assert.deepEqual(readFileSync(target), bytes);
    assert.equal(attr('get').stdout, 'synthetic');
    assert.deepEqual(readFileSync(file(root, '.git/index')), index);
  }
  let error;
  try { assert.equal(run(root, { force: true }).exitCode, 0); } catch (caught) { error = caught; }
  const afterAttr = attr('get');
  assert.equal(afterAttr.status, 0, 'o atributo deve continuar presente');
  assert.equal(afterAttr.stdout, 'synthetic');
  if (error) {
    assert.match(error.message, /Conteudo proprio preservado|metadata|atribut/i);
    assert.deepEqual(readFileSync(target), bytes);
  }
  else assert.match(readFileSync(target, 'utf8'), /description: Mudança real\./);
  assert.deepEqual(readFileSync(file(root, '.git/index')), index);
});

test("sync warns when Linux metadata have not been verified", { skip: nativeSkipReason('linux') }, t => {
  const exists = fs.existsSync;
  t.mock.method(fs, 'existsSync', path => path !== '/usr/bin/getfattr' && exists(path));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const root = fixture(t), target = file(root, pointer);
  git(root, 'add', '.gitignore');
  const bytes = readFileSync(target), index = readFileSync(file(root, '.git/index'));
  put(root, original, '---\nname: criar-skill\ndescription: Mudança real.\n---\n\n# Criar skill\n');
  const messages = [];
  const check = run(root, { check: true, force: true, output: message => messages.push(message) });
  assert.ok(check.xattrUnverified.includes(pointer));
  assert.ok(messages.some(message => message.includes('Atributos estendidos Linux nao foram totalmente verificados')));
  assert.deepEqual(readFileSync(target), bytes);
  assert.deepEqual(readFileSync(file(root, '.git/index')), index);
  messages.length = 0;
  assert.equal(run(root, { force: true, output: message => messages.push(message) }).exitCode, 0);
  assert.ok(messages.some(message => message.includes('Atributos estendidos Linux nao foram totalmente verificados')));
  assert.deepEqual(readFileSync(file(root, '.git/index')), index);
});

test("sync preserves human hardlink when pointing CRLF It needs to change.", t => {
  const root = fixture(t), target = file(root, pointer), human = file(root, 'humano.md');
  git(root, 'config', 'core.autocrlf', 'true');
  writeFileSync(target, readFileSync(target, 'utf8').replaceAll('\n', '\r\n'));
  git(root, 'add', '-f', '--', pointer);
  try { linkSync(target, human); }
  catch (error) {
    if (['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error.code)
      || process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip(`Hardlink indisponível na fixture (${error.code}).`);
      return;
    }
    throw error;
  }
  const originalBytes = readFileSync(target), index = readFileSync(file(root, '.git/index'));
  const before = statSync(target, { bigint: true });
  put(root, original, '---\nname: criar-skill\ndescription: Mudança real.\n---\n\n# Criar skill\n');
  assert.throws(() => run(root, { force: true }), error =>
    error.code === 'E_PROTECTED_METADATA' && error.path === pointer
    || error.code === undefined && error.message === `Conteudo proprio preservado; resolva a colisao antes de sincronizar: ${pointer}`);
  assert.deepEqual(readFileSync(target), originalBytes);
  assert.deepEqual(readFileSync(human), originalBytes);
  assert.deepEqual(readFileSync(file(root, '.git/index')), index);
  for (const path of [target, human]) {
    const after = statSync(path, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(after.nlink, before.nlink);
  }
});

for (const target of ['.pbai4devs/state/derived.json']) {
  test(`índice divergente impede atualização de ${target}`, t => {
    const root = fixture(t), generated = readFileSync(file(root, target));
    put(root, target, Buffer.concat([generated, Buffer.from('\nAlteração humana staged.\n')]));
    git(root, 'add', '-f', '--', target);
    const index = git(root, 'ls-files', '--stage', '-z');
    put(root, target, generated);
    if (target.endsWith('derived.json')) {
      put(root, original, '---\nname: criar-skill\ndescription: Mudança real.\n---\n\n# Criar skill\n');
    } else {
      put(root, '.pbai4devs/templates/gitignore/agents.ignore', '# Cache atualizado\n/*\n!/.gitignore\n{{ALLOWLIST}}\n/cache/\n*.log\n');
    }
    assert.notEqual(run(root, { check: true, force: true }).exitCode, 0);
    assert.throws(() => run(root, { force: true }), /indice/i);
    assert.deepEqual(readFileSync(file(root, target)), generated);
    assert.equal(git(root, 'ls-files', '--stage', '-z'), index);
  });
}

test("Ignore customer with divergent index is preserved even with force", t => {
  const root = fixture(t), target = '.claude/.gitignore';
  put(root, target, '# conteúdo staged\n'); git(root, 'add', '-f', '--', target);
  const index = git(root, 'ls-files', '--stage', '-z');
  put(root, target, '# conteúdo de trabalho\n');
  assert.equal(run(root, { check: true, force: true }).exitCode, 0);
  run(root, { force: true });
  assert.equal(readFileSync(file(root, target), 'utf8'), '# conteúdo de trabalho\n');
  assert.equal(git(root, 'ls-files', '--stage', '-z'), index);
});

for (const options of [{ check: true }, { force: true }]) {
  test(`Git indisponível bloqueia limpeza em repositório (check=${Boolean(options.check)}, force=${Boolean(options.force)})`, t => {
    const root = fixture(t), generated = readFileSync(file(root, pointer));
    put(root, pointer, Buffer.concat([generated, Buffer.from('\nConteúdo humano staged.\n')]));
    git(root, 'add', '-f', '--', pointer);
    const index = git(root, 'ls-files', '--stage', '-z');
    put(root, pointer, generated);
    rmSync(dirname(file(root, original)), { recursive: true });
    const state = readFileSync(file(root, '.pbai4devs/state/derived.json'));
    withoutGit(t, () => assert.throws(() => run(root, options), /consultar o Git.*preservar/i));
    assert.deepEqual(readFileSync(file(root, pointer)), generated);
    assert.deepEqual(readFileSync(file(root, '.pbai4devs/state/derived.json')), state);
    assert.equal(git(root, 'ls-files', '--stage', '-z'), index);
  });
}

test("design really without Git can clear own pointer without Git executable", t => {
  const root = fixture(t, false), human = '.claude/skills/criar-skill/equipe-vazia';
  mkdirSync(file(root, human));
  rmSync(dirname(file(root, original)), { recursive: true });
  withoutGit(t, () => assert.equal(run(root, { force: true }).exitCode, 0));
  assert.equal(existsSync(file(root, pointer)), false);
  assert.ok(existsSync(file(root, human)));
});

test("preserves preexisting directory without proof of ownership after removing single point", t => {
  const root = fixture(t), directory = dirname(file(root, pointer));
  rmSync(dirname(file(root, original)), { recursive: true });
  assert.equal(run(root, { force: true }).exitCode, 0);
  assert.equal(existsSync(file(root, pointer)), false);
  assert.ok(existsSync(directory));
});

test("concurrent change in the index blocks cleaning before any exclusion", t => {
  const root = fixture(t), generated = readFileSync(file(root, pointer));
  rmSync(dirname(file(root, original)), { recursive: true });
  let staged;
  assert.throws(() => synchronize({ root, localIgnores: false, generateEntrypoints: false, force: true,
    output() {
      if (staged !== undefined) return;
      put(root, pointer, Buffer.concat([generated, Buffer.from('\nStaged pela equipe.\n')]));
      git(root, 'add', '-f', '--', pointer);
      staged = git(root, 'ls-files', '--stage', '-z');
      put(root, pointer, generated);
    },
  }), /indice git mudou/i);
  assert.notEqual(staged, undefined);
  assert.deepEqual(readFileSync(file(root, pointer)), generated);
  assert.equal(git(root, 'ls-files', '--stage', '-z'), staged);
});

test("Diverging index is protected when project is in subfolder of Git repository", t => {
  const outer = mkdtempSync(join(tmpdir(), 'sync-parent-git-'));
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  git(outer, 'init', '--quiet');
  const root = join(outer, 'projeto'); mkdirSync(root);
  populate(root);
  const generated = readFileSync(file(root, pointer));
  put(root, pointer, Buffer.concat([generated, Buffer.from('\nStaged pela equipe.\n')]));
  git(root, 'add', '-f', '--', pointer);
  const index = git(outer, 'ls-files', '--stage', '-z');
  put(root, pointer, generated);
  rmSync(dirname(file(root, original)), { recursive: true });
  assert.throws(() => run(root, { force: true }), /indice/i);
  assert.deepEqual(readFileSync(file(root, pointer)), generated);
  assert.equal(git(outer, 'ls-files', '--stage', '-z'), index);
});

test("file added to the index during nested design cleaning is preserved", t => {
  const outer = mkdtempSync(join(tmpdir(), 'sync-parent-race-'));
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  git(outer, 'init', '--quiet');
  const root = join(outer, 'projeto'); mkdirSync(root);
  populate(root);
  const generated = readFileSync(file(root, pointer));
  const state = readFileSync(file(root, '.pbai4devs/state/derived.json'));
  rmSync(dirname(file(root, original)), { recursive: true });
  let staged;
  assert.throws(() => run(root, { force: true, output() {
    if (staged !== undefined) return;
    git(outer, 'add', '-f', '--', `projeto/${pointer}`);
    staged = git(outer, 'ls-files', '--stage', '-z');
  } }), /indice git mudou/i);
  assert.notEqual(staged, undefined);
  assert.deepEqual(readFileSync(file(root, pointer)), generated);
  assert.deepEqual(readFileSync(file(root, '.pbai4devs/state/derived.json')), state);
  assert.equal(git(outer, 'ls-files', '--stage', '-z'), staged);
});

test("nested project plan records only the selected index entry", t => {
  const outer = mkdtempSync(join(tmpdir(), 'sync-parent-index-'));
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  git(outer, 'init', '--quiet');
  const root = join(outer, 'projeto'); mkdirSync(root);
  populate(root);
  put(outer, 'outro.txt', 'Outro arquivo\n');
  git(outer, 'add', '-f', '--', `projeto/${pointer}`, 'outro.txt');
  const generated = readFileSync(file(root, pointer));
  const hash = createHash('sha256').update(generated).digest('hex');
  const plan = planUntrack(root, { [pointer]: hash });
  assert.deepEqual(plan.paths, [pointer]);
  assert.deepEqual(plan.conflicts, []);
  assert.match(plan.index, new RegExp(`\\tprojeto/${pointer}$`));
  assert.equal(plan.index.includes('outro.txt'), false);
  assert.equal(plan.index, git(outer, 'ls-files', '--stage', '--', `projeto/${pointer}`).trimEnd());
});

test("human content in the folder and edited managed note survive forced cleaning", t => {
  const root = fixture(t), human = '.claude/skills/criar-skill/notas-da-equipe.md';
  const notes = '# Referência própria\n', edited = Buffer.concat([readFileSync(file(root, pointer)), Buffer.from('\nNota própria.\n')]);
  put(root, human, notes);
  put(root, pointer, edited);
  rmSync(dirname(file(root, original)), { recursive: true });
  run(root, { force: true });
  assert.equal(readFileSync(file(root, human), 'utf8'), notes);
  assert.deepEqual(readFileSync(file(root, pointer)), edited);
});

test("collision with ancestral human file is not removed by --force", t => {
  const root = fixture(t), ancestor = '.claude/skills/equipe-custom';
  const human = 'Arquivo da equipe; não substituir.\n';
  put(root, ancestor, human);
  put(root, '.pbai4devs/skills/projeto/equipe-custom/SKILL.md', '---\nname: equipe-custom\ndescription: Exemplo.\n---\n\n# Equipe\n');
  const index = git(root, 'ls-files', '--stage', '-z');
  try { run(root, { force: true }); } catch (error) { assert.match(error.message, /conflito|gerenciado|arquivo|diretor/i); }
  assert.equal(readFileSync(file(root, ancestor), 'utf8'), human);
  assert.equal(git(root, 'ls-files', '--stage', '-z'), index);
});
