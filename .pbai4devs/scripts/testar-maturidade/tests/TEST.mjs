import '../../lib/test-git-environment.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { projectRoot, requireNode } from '../../lib/runtime.mjs';
import { adapterManifest } from '../../lib/adapters.mjs';
import { findNpmCli } from '../../lib/npm.mjs';
import { synchronize } from '../../sincronizar-agentes/SCRIPT.mjs';
import { copyAgentStructure, createExampleOutput, mayAliasPath, prepareExamples as prepare, registeredRoots, resourceTargets, runner, SCENARIOS, verifySyncRepair } from '../SCRIPT.mjs';

const isolatedGitSettings = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
const isolatedGitEnvironment = (source = process.env) => ({ ...Object.fromEntries(Object.entries(source).filter(([key]) => !/^GIT_/i.test(key))), ...isolatedGitSettings });

// This test process operates only on synthetic repositories. Never let an
// inherited Git directory, index, or injected config redirect a fixture.
const spawnSync = (command, args, options = {}) => {
  if (command !== 'git') return childProcess.spawnSync(command, args, options);
  const env = isolatedGitEnvironment(options.env || process.env);
  return childProcess.spawnSync(command, ['-c', 'core.fsmonitor=false', ...args], { ...options, env });
};

// Small fixtures isolate copy; the source-only case uses the real renderer.
const prepareExamples = options => prepare({ ...options, renderResources: () => {} });

requireNode();
function fixture(t) {
  // Match the physical spelling used by createExampleOutput, including the
  // long form of a Windows temporary directory with an 8.3 alias.
  const home = realpathSync.native(tmpdir());
  const space = mkdtempSync(join(home, 'maturity-unit-'));
  const root = join(space, 'source'), outputs = join(space, 'outputs');
  mkdirSync(root); mkdirSync(outputs);
  const oldEnv = Object.fromEntries(['TMPDIR', 'TMP', 'TEMP'].map(key => [key, process.env[key]]));
  for (const key of Object.keys(oldEnv)) process.env[key] = space;
  t.after(() => { for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } rmSync(space, { recursive: true, force: true }); });
  const put = (name, content = '') => { const file = join(root, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); return file; };
  put('.pbai4devs/espelhos.conf', 'agente|.codex|plano\nagente|.github|plano\nagente|.agents|plano\nagente|.agent|plano\nagente|.gemini|plano\ngitignore|.vscode\n');
  put('.pbai4devs/skills.json', '{"entries":[{"path":".pbai4devs/skills/projeto/demo"}]}');
  put('.pbai4devs/skills/projeto/demo/SKILL.md', '---\nname: demo\ndescription: Fixture.\n---\n\n# Demo\n');
  put('.codex/skills/demo/SKILL.md', 'ponteiro'); put('.github/skills/demo/SKILL.md', 'ponteiro');
  for (const client of ['.agents', '.agent', '.gemini']) put(`${client}/skills/demo/SKILL.md`, 'ponteiro');
  put('.gemini/commands/demo.toml', 'description = "Fixture"\nprompt = "Leia o recurso compartilhado."\n');
  put('.vscode/settings.json', '{"fixture":true}\n');
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'README.md', '.gitattributes', '.editorconfig']) put(name, 'fixture\n');
  // npm packages omit the root .gitignore; use a synthetic equivalent there.
  const sourceIgnore = join(projectRoot, '.gitignore');
  put('.gitignore', existsSync(sourceIgnore) ? readFileSync(sourceIgnore) : '/tmp/\n/temp/\n');
  put('.pbai4devs/scripts/inspecionar-projeto/SCRIPT.mjs', readFileSync(join(projectRoot, '.pbai4devs/scripts/inspecionar-projeto/SCRIPT.mjs')));
  put('.pbai4devs/scripts/lib/adapter-manifest.mjs', readFileSync(join(projectRoot, '.pbai4devs/scripts/lib/adapter-manifest.mjs')));
  put('.pbai4devs/scripts/lib/runtime.mjs', readFileSync(join(projectRoot, '.pbai4devs/scripts/lib/runtime.mjs')));
  put('.pbai4devs/scripts/lib/state-path.mjs', readFileSync(join(projectRoot, '.pbai4devs/scripts/lib/state-path.mjs')));
  put('.pbai4devs/scripts/lib/project-metadata.mjs', readFileSync(join(projectRoot, '.pbai4devs/scripts/lib/project-metadata.mjs')));
  return { root, put, space, outputs, outputRoot: join(outputs, 'suite') };
}

function controlledSource(root) {
  const source = join(root, 'controlled-source');
  // Only four explicit resources; exclude local state and additional skills.
  for (const path of ['.pbai4devs/skills/projeto/criar-skill/SKILL.md', '.pbai4devs/templates/gitignore/clients.json', '.pbai4devs/templates/gitignore/agents.ignore', '.pbai4devs/templates/gitignore/shared.ignore']) {
    let current = projectRoot;
    for (const part of path.split('/')) {
      current = join(current, part);
      assert.equal(lstatSync(current).isSymbolicLink(), false, `Fonte não pode ser link: ${path}`);
    }
    const destination = join(source, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(projectRoot, path), destination);
  }
  writeFileSync(join(source, '.gitignore'), 'node_modules/\n');
  return source;
}

function gitFixtureSnapshot(directory) {
  const snapshot = {};
  const visit = (current, prefix = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name, file = join(current, entry.name);
      if (entry.isDirectory()) visit(file, name);
      else if (entry.isFile()) snapshot[name] = createHash('sha256').update(readFileSync(file)).digest('hex');
      else throw new Error(`Fixture Git inesperada: ${name}`);
    }
  };
  visit(directory);
  return snapshot;
}

test("example startup does not inherit directory, worktree or external Git index", t => {
  const { root, space, outputRoot } = fixture(t), external = join(space, 'external');
  const env = isolatedGitEnvironment();
  let result = spawnSync('git', ['init', '--quiet', '--template=', external], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(external, 'human.txt'), 'conteúdo staged\n');
  result = spawnSync('git', ['-C', external, 'add', '--', 'human.txt'], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  const gitDir = join(external, '.git'), before = gitFixtureSnapshot(gitDir);
  const keys = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { GIT_DIR: gitDir, GIT_WORK_TREE: external, GIT_INDEX_FILE: join(gitDir, 'index'), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'true' });
  let example;
  try { [example] = prepareExamples({ sourceRoot: root, outputRoot, scenarios: [SCENARIOS[0]], initializeGit: true }); }
  finally { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
  assert.deepEqual(gitFixtureSnapshot(gitDir), before, 'Arquivos Git externos foram alterados.');
  assert.ok(lstatSync(join(example.root, '.git')).isDirectory(), 'Repositório local do exemplo ausente.');
  result = spawnSync('git', ['-C', example.root, 'rev-parse', '--show-toplevel'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(realpathSync(result.stdout.trim()), realpathSync(example.root));
});

test("index comparison considers Windows short names without til and distinguishes real entries", t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'maturity-short-name-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const staged = 'tmp/ALT/human', target = 'tmp/long-directory/run';
  mkdirSync(join(root, 'tmp'));
  assert.equal(mayAliasPath(staged, target, { root, platform: 'win32' }), true);
  assert.equal(mayAliasPath(staged, target, { root, platform: 'linux' }), false);
  mkdirSync(join(root, 'tmp', 'long-directory'));
  assert.equal(mayAliasPath(staged, target, { root, platform: 'win32' }), false);
  mkdirSync(join(root, 'tmp', 'ALT'));
  assert.equal(mayAliasPath(staged, target, { root, platform: 'win32' }), false);
  assert.equal(mayAliasPath('tmp/LONGDI~1/human', target, { root, platform: 'win32' }), existsSync(join(root, 'tmp', 'LONGDI~1')));
});

test("simulated maturity flow on Windows accepts absent output ancestor and src staged existing", t => {
  const { root } = fixture(t), target = join(root, 'tmp', 'long-directory', 'run');
  let result = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(root, '.gitignore'), '/tmp/\n'); mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'file.js'), 'humano\n');
  result = spawnSync('git', ['-C', root, 'add', '--', 'src/file.js'], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  const index = readFileSync(join(root, '.git/index')), descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    assert.equal(mayAliasPath('src/file.js', 'tmp/long-directory/run', { root }), false);
    assert.equal(mayAliasPath('ALT/file.js', 'tmp/long-directory/run', { root }), true);
    const output = createExampleOutput({ sourceRoot: root, outputRoot: target });
    output.verifyOutput();
  } finally { Object.defineProperty(process, 'platform', descriptor); }
  assert.equal(readFileSync(join(root, 'src', 'file.js'), 'utf8'), 'humano\n');
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
});

test("Native or simulated Windows refusal short name staged missing without changing index", t => {
  const { root } = fixture(t), target = join(root, 'tmp', 'long-directory');
  let result = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(root, '.gitignore'), '/tmp/\n'); mkdirSync(join(root, 'tmp'));
  result = spawnSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], { input: 'humano', encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  const hash = result.stdout.trim();
  result = spawnSync('git', ['-C', root, 'update-index', '--index-info'], { input: `100644 ${hash}\ttmp/ALT/human\n`, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  const before = readFileSync(join(root, '.git/index'));
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  try { Object.defineProperty(process, 'platform', { value: 'win32' }); assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: target }), /índice Git/); }
  finally { Object.defineProperty(process, 'platform', descriptor); }
  assert.equal(existsSync(target), false); assert.deepEqual(readFileSync(join(root, '.git/index')), before);
});

test("index with unicode decomposed alias blocks composite output before creation", t => {
  const { root } = fixture(t), target = join(root, 'tmp', 'é', 'run');
  let result = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  result = spawnSync('git', ['-C', root, 'config', 'core.precomposeunicode', 'false'], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(root, '.gitignore'), '/tmp/\n'); mkdirSync(join(root, 'tmp'));
  const staged = join(root, 'tmp', 'e\u0301'); writeFileSync(staged, 'humano');
  result = spawnSync('git', ['-C', root, 'add', '-f', '--', 'tmp/e\u0301'], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  unlinkSync(staged); const index = readFileSync(join(root, '.git/index'));
  assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: target, scenarios: [SCENARIOS[0]], initializeGit: false }), /índice Git/);
  assert.equal(existsSync(target), false); assert.deepEqual(readFileSync(join(root, '.git/index')), index);
});

test("decomposed design prefix finds alias compound in the index", t => {
  const { space } = fixture(t), repo = join(space, 'repo-unicode');
  let result = spawnSync('git', ['init', '--quiet', '--template=', repo], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  result = spawnSync('git', ['-C', repo, 'config', 'core.precomposeunicode', 'false'], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(repo, '.gitignore'), '**/tmp/\n');
  const composed = join(repo, 'zzzé'); mkdirSync(join(composed, 'tmp', 'case'), { recursive: true });
  writeFileSync(join(composed, 'tmp', 'case', 'human.txt'), 'humano');
  result = spawnSync('git', ['-C', repo, 'add', '-f', '--', 'zzzé/tmp/case/human.txt'], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  rmSync(composed, { recursive: true });
  const sourceRoot = join(repo, 'zzze\u0301'); mkdirSync(sourceRoot);
  const target = join(sourceRoot, 'tmp', 'case'), index = readFileSync(join(repo, '.git/index'));
  assert.throws(() => createExampleOutput({ sourceRoot, outputRoot: target }), /índice Git/);
  assert.equal(existsSync(target), false); assert.deepEqual(readFileSync(join(repo, '.git/index')), index);
});

test("Ignore local respects effective and injected global Git configuration", t => {
  const { root, space } = fixture(t), home = join(space, 'test-home'); mkdirSync(home);
  const configuredIgnore = join(space, 'configured-ignore'), emptyIgnore = join(space, 'empty-ignore');
  writeFileSync(configuredIgnore, 'tmp/\n'); writeFileSync(emptyIgnore, '');
  const defaultConfig = join(home, '.gitconfig'), globalConfig = join(space, 'global-config');
  writeFileSync(defaultConfig, `[core]\n excludesfile = ${JSON.stringify(configuredIgnore)}\n`);
  writeFileSync(globalConfig, '');
  const gitEnv = isolatedGitEnvironment();
  Object.assign(gitEnv, { HOME: home, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' });
  const init = spawnSync('git', ['init', '--quiet', '--template=', root], { env: gitEnv, encoding: 'utf8' }); assert.equal(init.status, 0, init.stderr);
  writeFileSync(join(root, '.gitignore'), '');
  const keys = ['HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { HOME: home, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' });
  try {
    const target = join(root, 'tmp', 'explicit-global-disabled');
    assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: target }), /precisa estar ignorada/);
    assert.equal(existsSync(target), false);
    writeFileSync(globalConfig, `[core]\n excludesfile = ${JSON.stringify(configuredIgnore)}\n`);
    Object.assign(process.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.excludesfile', GIT_CONFIG_VALUE_0: emptyIgnore });
    const injected = join(root, 'tmp', 'injected-override');
    assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: injected }), /precisa estar ignorada/);
    assert.equal(existsSync(injected), false);
    process.env.GIT_CONFIG_VALUE_0 = configuredIgnore;
    const accepted = createExampleOutput({ sourceRoot: root, outputRoot: join(root, 'tmp', 'effective-ignore') });
    assert.ok(existsSync(accepted.outputRoot));
  } finally { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
});

test("consultation respects COUNT missing, zero and incompletely injected Git configuration", t => {
  const { root, space } = fixture(t), config = join(space, 'effective-config');
  const ignored = join(space, 'ignored-global'), empty = join(space, 'empty-global');
  writeFileSync(ignored, '/tmp/\n'); writeFileSync(empty, ''); writeFileSync(config, '');
  let result = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(root, '.gitignore'), '');
  const names = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const cases = [
    { id: 'absent-unignored', count: undefined, base: empty, injected: ignored, status: 1 },
    { id: 'zero-unignored', count: '0', base: empty, injected: ignored, status: 1 },
    { id: 'absent-ignored', count: undefined, base: ignored, injected: empty, status: 0 },
    { id: 'zero-ignored', count: '0', base: ignored, injected: empty, status: 0 },
    { id: 'incomplete-key', count: '1', base: ignored, injected: undefined, status: 128 },
    { id: 'incomplete-pair', count: '1', base: ignored, injected: null, status: 128 },
  ];
  try {
    for (const item of cases) {
      result = spawnSync('git', ['config', '--file', config, 'core.excludesfile', item.base], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
      for (const name of names) delete process.env[name];
      Object.assign(process.env, { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' });
      if (item.count !== undefined) process.env.GIT_CONFIG_COUNT = item.count;
      if (item.injected !== null) process.env.GIT_CONFIG_KEY_0 = 'core.excludesfile';
      if (typeof item.injected === 'string') process.env.GIT_CONFIG_VALUE_0 = item.injected;
      const env = { ...process.env }, target = join(root, 'tmp', item.id);
      result = childProcess.spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', root, 'check-ignore', '--no-index', '-q', '--', `tmp/${item.id}/`], { env, encoding: 'utf8' });
      assert.equal(result.status, item.status, `${item.id}: ${result.stderr}`);
      if (item.status === 0) assert.equal(createExampleOutput({ sourceRoot: root, outputRoot: target }).outputRoot, target);
      else {
        assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: target }), item.status === 1 ? /precisa estar ignorada/ : /repositório Git válido/);
        assert.equal(existsSync(target), false);
      }
    }
  } finally { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } }
});

test("local output refusal alternative Git index without changing any index", t => {
  const { root, space } = fixture(t), alternate = join(space, 'alternate-index');
  const env = isolatedGitEnvironment();
  let result = spawnSync('git', ['init', '--quiet', '--template=', root], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(root, '.gitignore'), '/tmp/\n'); mkdirSync(join(root, 'tmp', 'run'), { recursive: true });
  writeFileSync(join(root, 'tmp', 'run', 'human.txt'), 'humano');
  // Explicit exception: the alternate index is a newly created test fixture.
  result = childProcess.spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', root, 'add', '-f', '--', 'tmp/run/human.txt'], { env: { ...env, GIT_INDEX_FILE: alternate }, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  rmSync(join(root, 'tmp', 'run'), { recursive: true });
  const alternateBefore = readFileSync(alternate), defaultPath = join(root, '.git/index');
  const defaultBefore = existsSync(defaultPath) ? readFileSync(defaultPath) : null;
  const previous = process.env.GIT_INDEX_FILE; process.env.GIT_INDEX_FILE = alternate;
  try { assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: join(root, 'tmp', 'run') }), /índice Git alternativo/); }
  finally { if (previous === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = previous; }
  assert.equal(existsSync(join(root, 'tmp', 'run')), false); assert.deepEqual(readFileSync(alternate), alternateBefore);
  assert.deepEqual(existsSync(defaultPath) ? readFileSync(defaultPath) : null, defaultBefore);
});

test("local output accepts repository with space at the end of name", t => {
  if (process.platform === 'win32') { t.skip('Windows não permite diretório com espaço final pelo caminho convencional.'); return; }
  const { space } = fixture(t), root = join(space, 'repo-space ');
  const initialized = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(initialized.status, 0, initialized.stderr);
  writeFileSync(join(root, '.gitignore'), '/tmp/\n');
  const target = join(root, 'tmp', 'run');
  assert.equal(createExampleOutput({ sourceRoot: root, outputRoot: target }).outputRoot, target);
  assert.ok(existsSync(join(target, '.gitignore')));
});

const unicodeAliasTest = 'Git index blocks output with an ambiguous Unicode case alias';
test(unicodeAliasTest, t => {
  const { root } = fixture(t);
  let result = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(root, '.gitignore'), '/tmp/\n');
  const hash = spawnSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], { input: 'fixture\n', encoding: 'utf8' }); assert.equal(hash.status, 0, hash.stderr);
  const rows = ['SS', 's', 'ff'].map(name => `100644 ${hash.stdout.trim()}\ttmp/${name}/human.txt\n`).join('');
  result = spawnSync('git', ['-C', root, 'update-index', '--index-info'], { input: rows, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  const index = readFileSync(join(root, '.git/index'));
  for (const name of ['ß', 'ſ', 'ﬀ']) {
    const target = join(root, 'tmp', name);
    assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: target }), /índice Git/);
    assert.equal(existsSync(target), false);
  }
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
});

test("Git queries do not perform local fsmonitor or injected", t => {
  if (process.platform === 'win32') { t.skip('Hook sentinela usa /bin/sh.'); return; }
  const { root, space } = fixture(t), hook = join(space, 'monitor-hook'), marker = join(space, 'monitor-ran');
  let result = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(root, '.gitignore'), '/tmp/\n'); writeFileSync(join(root, 'human.txt'), 'humano');
  result = spawnSync('git', ['-C', root, 'add', '--', 'human.txt'], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  writeFileSync(hook, '#!/bin/sh\nprintf invoked > "$HOOK_SENTINEL"\nprintf "v1\\0"\n'); chmodSync(hook, 0o700);
  const keys = ['HOOK_SENTINEL', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.HOOK_SENTINEL = marker;
  try {
    result = spawnSync('git', ['-C', root, 'config', 'core.fsmonitor', hook], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
    const plainEnv = isolatedGitEnvironment();
    result = childProcess.spawnSync('git', ['-C', root, 'status', '--porcelain'], { env: plainEnv, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(marker), 'Fixture não executou o hook.'); unlinkSync(marker);
    createExampleOutput({ sourceRoot: root, outputRoot: join(root, 'tmp', 'local-config') });
    assert.equal(existsSync(marker), false, 'Consulta executou hook da configuração local.');
    result = spawnSync('git', ['-C', root, 'config', '--unset', 'core.fsmonitor'], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
    Object.assign(process.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: hook });
    const injectedEnv = { ...isolatedGitEnvironment(), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: hook };
    result = childProcess.spawnSync('git', ['-C', root, 'status', '--porcelain'], { env: injectedEnv, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(marker), 'Fixture injetada não executou o hook.'); unlinkSync(marker);
    createExampleOutput({ sourceRoot: root, outputRoot: join(root, 'tmp', 'injected-config') });
    assert.equal(existsSync(marker), false, 'Consulta executou hook da configuração injetada.');
  } finally { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
});

test("fixtures isolate external Git even when the suite receives contaminated environment", { timeout: 60000 }, t => {
  const { space } = fixture(t), external = join(space, 'external-test-suite');
  let result = spawnSync('git', ['init', '--quiet', '--template=', external], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(external, 'human.txt'), 'staged\n');
  result = spawnSync('git', ['-C', external, 'add', '--', 'human.txt'], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  const gitDir = join(external, '.git'), before = gitFixtureSnapshot(gitDir);
  const env = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: external, GIT_INDEX_FILE: join(gitDir, 'index'), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'true' };
  delete env.NODE_TEST_CONTEXT;
  const runner = join(projectRoot, '.pbai4devs/scripts/testar-maturidade/tests/TEST.mjs');
  result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=^${unicodeAliasTest}$`, runner], { env, encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(result.stdout.split(/\r?\n/).includes(`ok 1 - ${unicodeAliasTest}`), result.stdout);
  assert.deepEqual(gitFixtureSnapshot(gitDir), before, 'Suíte alterou o Git externo.');
});

test("synthetic runner disables user global configuration fsmonitor", t => {
  if (process.platform === 'win32') { t.skip('Hook sentinela usa /bin/sh.'); return; }
  const { space } = fixture(t), scenario = join(space, 'runner-work'), gitConfig = join(space, 'runner-gitconfig');
  mkdirSync(scenario);
  const hook = join(space, 'runner-hook'), marker = join(space, 'runner-hook-ran');
  writeFileSync(hook, '#!/bin/sh\nprintf invoked > "$HOOK_SENTINEL"\nprintf "v1\\0"\n'); chmodSync(hook, 0o700);
  writeFileSync(gitConfig, `[core]\n fsmonitor = ${hook}\n`);
  writeFileSync(join(scenario, 'probe.mjs'), `import { spawnSync } from 'node:child_process'; import { writeFileSync } from 'node:fs';\nconst env = { ...process.env, GIT_CONFIG_GLOBAL: ${JSON.stringify(gitConfig)}, GIT_CONFIG_NOSYSTEM: '1' };\nfor (const args of [['init', '--quiet', '--template='], ['add', 'human.txt'], ['status', '--porcelain']]) { if (args[0] === 'add') writeFileSync('human.txt', 'fixture'); const r = spawnSync('git', args, { env, encoding: 'utf8' }); if (r.status !== 0) { console.error(r.stderr); process.exit(1); } }\n`);
  const oldSentinel = process.env.HOOK_SENTINEL;
  process.env.HOOK_SENTINEL = marker;
  try {
    runner(scenario, 'logs', [])('probe.mjs');
    assert.equal(existsSync(marker), false, 'Runner executou fsmonitor global.');
    const plainEnv = { ...isolatedGitEnvironment(), GIT_CONFIG_GLOBAL: gitConfig };
    const normal = childProcess.spawnSync('git', ['-C', scenario, 'status', '--porcelain'], { env: plainEnv, encoding: 'utf8' });
    assert.equal(normal.status, 0, normal.stderr); assert.equal(existsSync(marker), true, 'Fixture global não habilitou o hook.');
  } finally {
    if (oldSentinel === undefined) delete process.env.HOOK_SENTINEL; else process.env.HOOK_SENTINEL = oldSentinel;
  }
});

test("scenario subprocess isolates external Git and initializes local repository", t => {
  const { space } = fixture(t), external = join(space, 'runner-external'), scenario = join(space, 'runner-scenario');
  const env = isolatedGitEnvironment();
  let result = spawnSync('git', ['init', '--quiet', '--template=', external], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(external, 'human.txt'), 'conteúdo staged\n');
  result = spawnSync('git', ['-C', external, 'add', '--', 'human.txt'], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  const gitDir = join(external, '.git'), before = gitFixtureSnapshot(gitDir);
  mkdirSync(scenario);
  writeFileSync(join(scenario, 'probe.mjs'), "import { spawnSync } from 'node:child_process';\nconst r = spawnSync('git', ['init', '--quiet', '--template='], { encoding: 'utf8' });\nif (r.status !== 0) { console.error(r.stderr); process.exit(1); }\n");
  const keys = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { GIT_DIR: gitDir, GIT_WORK_TREE: external, GIT_INDEX_FILE: join(gitDir, 'index') });
  const commands = [];
  try { runner(scenario, 'logs', commands)('probe.mjs'); }
  finally { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
  assert.equal(commands.length, 1); assert.equal(commands[0].status, 0);
  assert.deepEqual(gitFixtureSnapshot(gitDir), before, 'Arquivos Git externos foram alterados.');
  assert.ok(lstatSync(join(scenario, '.git')).isDirectory());
  result = spawnSync('git', ['-C', scenario, 'rev-parse', '--show-toplevel'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(realpathSync(result.stdout.trim()), realpathSync(scenario));
});

test("copy features and settings, excluding payloads, caches and secrets", t => {
  const { root, put } = fixture(t);
  put('.pbai4devs/tools/demo/TOOL.json', '{}'); put('.pbai4devs/tools/demo/SCRIPT.mjs', 'export {};'); put('.pbai4devs/tools/demo/README.md', '# Tool');
  put('.pbai4devs/templates/demo/TEMPLATE.md', '# Template');
  put('.pbai4devs/scripts/demo/tests/fixture.json', '{"keep":true}');
  put('.pbai4devs/external-skills/README.md', '# External'); put('.pbai4devs/external-skills/CATALOG.json', '{}');
  put('.env.example', 'PORT=3000\n');
  const excluded = ['.pbai4devs/tools/demo/.local/package/README.md', '.pbai4devs/tools/demo/download.exe', '.pbai4devs/tools/.cache/archive', '.pbai4devs/tools/bin/demo.mjs', '.pbai4devs/external-skills/.local/upstream/SKILL.md', '.pbai4devs/scripts/demo/node_modules/pkg/index.js', '.pbai4devs/scripts/demo/.env', '.pbai4devs/scripts/demo/report.log', '.env', '.codex/auth.json', '.github/credentials.json', '.vscode/settings.local.json', '.pbai4devs/scripts/demo/private.pem', '.pbai4devs/scripts/demo/config.local.toml', '.codex/.credentials.json', '.agents/.local/token.json', '.gemini/auth.json'];
  excluded.push('.pbai4devs/scripts/demo/playwright-report/index.html', '.pbai4devs/scripts/demo/TEST-RESULTS/report.json', '.pbai4devs/scripts/demo/TmP/generated.json', '.gemini/Temp/context.json', '.gemini/Sessions/state.json', '.pbai4devs/scripts/demo/history.jsonl', '.pbai4devs/skills/demo/.PLAYWRIGHT-MCP/session.json');
  excluded.push('.pbai4devs/bin/agentdevkit.mjs', '.pbai4devs/src/cli.mjs', '.pbai4devs/release/pipeline.mjs', '.pbai4devs/tests/cli.test.mjs', '.pbai4devs/DEVELOPMENT.md');
  excluded.push('bin/agentdevkit.mjs', 'src/cli.mjs', 'scripts/release/pipeline.mjs', 'tests/cli.test.mjs', 'examples/README.md');
  const kept = ['.pbai4devs/scripts/demo/tests/fixtures/cache/input.json', '.pbai4devs/scripts/demo/tests/fixtures/playwright-response.json', '.pbai4devs/templates/demo/compose.local.yml.template'];
  for (const file of kept) put(file, 'fixture versionavel');
  for (const file of excluded) put(file, 'não copiar');
  const destination = join(root, 'copy');
  const result = copyAgentStructure(root, destination);
  assert.ok(result.copiedFiles > 10);
  for (const file of excluded) assert.equal(existsSync(join(destination, file)), false, file);
  for (const file of excluded) assert.equal(readFileSync(join(root, file), 'utf8'), 'não copiar', `Origem alterada: ${file}`);
  for (const file of ['.pbai4devs/tools/demo/TOOL.json', '.pbai4devs/tools/demo/SCRIPT.mjs', '.pbai4devs/external-skills/CATALOG.json', '.pbai4devs/templates/demo/TEMPLATE.md', '.pbai4devs/scripts/demo/tests/fixture.json', '.vscode/settings.json', '.gitattributes', '.env.example', '.agents/skills/demo/SKILL.md', '.agent/skills/demo/SKILL.md', '.gemini/skills/demo/SKILL.md', '.gemini/commands/demo.toml', 'GEMINI.md']) assert.ok(existsSync(join(destination, file)), file);
  for (const file of kept) assert.equal(readFileSync(join(destination, file), 'utf8'), 'fixture versionavel');
  assert.deepEqual(result.roots, ['.pbai4devs', '.codex', '.github', '.agents', '.agent', '.gemini', '.vscode']);
});

test("existing explicit destination is refused without altering human or generated projects", t => {
  const { root, put, outputRoot } = fixture(t);
  mkdirSync(join(outputRoot, 'anotacoes'), { recursive: true });
  writeFileSync(join(outputRoot, 'anotacoes/keep.txt'), 'preservado');
  put('examples/README.md', 'Guia humano.');
  const options = { sourceRoot: root, outputRoot, scenarios: [SCENARIOS[0]], initializeGit: false };
  assert.throws(() => prepareExamples(options), /saída já existe/);
  assert.equal(readFileSync(join(outputRoot, 'anotacoes/keep.txt'), 'utf8'), 'preservado');
  assert.equal(readFileSync(join(root, 'examples/README.md'), 'utf8'), 'Guia humano.');
  const output = join(outputRoot, 'nova-execucao');
  const [example] = prepareExamples({ ...options, outputRoot: output });
  writeFileSync(join(example.root, 'anotacao-humana.txt'), 'não apagar');
  const report = readFileSync(join(output, 'REPORT.json'));
  assert.throws(() => prepareExamples({ ...options, outputRoot: output, scenarios: [SCENARIOS[1]] }), /saída já existe/);
  assert.throws(() => prepareExamples({ ...options, outputRoot: join(example.root, 'nova'), scenarios: [SCENARIOS[1]] }), /execução anterior/);
  assert.deepEqual(readFileSync(join(output, 'REPORT.json')), report);
  assert.equal(readFileSync(join(example.root, 'anotacao-humana.txt'), 'utf8'), 'não apagar');
  assert.throws(() => prepareExamples({ ...options, outputRoot: join(outputRoot, 'invalid'), scenarios: [{ ...SCENARIOS[0], id: '../outside' }] }), /IDs únicos e seguros/);
  assert.equal(existsSync(join(outputRoot, 'invalid')), false);
});

test("switch from ancestor to symlink before creation does not write in external destination", t => {
  const { root, outputRoot } = fixture(t);
  const outside = mkdtempSync(join(dirname(root), 'maturity-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(outputRoot, { recursive: true });
  const externalSentinel = join(outside, 'sentinel.txt');
  writeFileSync(externalSentinel, 'externo preservado\n');
  const linkProbe = join(root, 'probe-link');
  try { symlinkSync(outside, linkProbe, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Sem permissão para links simbólicos.'); return; } throw error; }
  unlinkSync(linkProbe);
  const canonical = realpathSync(outputRoot);
  const original = childProcess.spawnSync;
  let injected = false;
  childProcess.spawnSync = function (file, args, options) {
    if (!injected && file === process.execPath && args?.[0] === '-e' && options?.cwd === canonical) {
      injected = true;
      renameSync(outputRoot, `${outputRoot}-original`);
      symlinkSync(outside, outputRoot, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return original.call(this, file, args, options);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: join(outputRoot, 'nova'), scenarios: [SCENARIOS[0]], initializeGit: false }), /diretório exclusivo|ancestral|link simbólico/i);
    assert.equal(injected, true);
    assert.deepEqual(readdirSync(outside), ['sentinel.txt']);
    assert.equal(readFileSync(externalSentinel, 'utf8'), 'externo preservado\n');
  } finally {
    childProcess.spawnSync = original;
    syncBuiltinESMExports();
  }
});

test("output exchange during writing is detected without claiming atomicity", t => {
  const { root, outputRoot } = fixture(t);
  mkdirSync(outputRoot);
  const target = join(outputRoot, 'race-output'), outside = mkdtempSync(join(root, 'race-outside-'));
  const sentinel = join(outside, 'sentinel'); writeFileSync(sentinel, 'Não alterar.\n');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  const probe = join(root, 'race-link-probe');
  try { symlinkSync(outside, probe, linkType); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Links simbólicos indisponíveis.'); return; } throw error; }
  unlinkSync(probe);
  const original = fs.writeFileSync; let injected = false;
  try {
    fs.writeFileSync = (file, ...args) => {
      if (!injected && String(file) === join(target, '.maturity-suite.json')) {
        renameSync(target, `${target}-moved`); symlinkSync(outside, target, linkType); injected = true;
      }
      return original.call(fs, file, ...args);
    };
    syncBuiltinESMExports();
    assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: target, scenarios: [SCENARIOS[0]], initializeGit: false }), /link|alterado/i);
  } finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
  assert.equal(injected, true);
  assert.equal(readFileSync(sentinel, 'utf8'), 'Não alterar.\n');
  // Writing already in progress may have created the marker in the external destination: a
  // verification detects the exchange, but it's not an atomic directory operation.
  assert.equal(existsSync(join(outside, '.maturity-suite.json')), true);
  assert.equal(existsSync(join(outside, 'REPORT.json')), false);
});

test("Each default destination is unique, stays out of Git and preserves previous proofs", t => {
  const { root, space } = fixture(t);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  git('init', '--template=', '--quiet');
  const options = { sourceRoot: root, scenarios: [SCENARIOS[0]], initializeGit: false };
  const [first] = prepareExamples(options);
  const firstOutput = dirname(first.root);
  assert.equal(dirname(firstOutput), space);
  const human = 'Prova humana que não pode ser apagada.\n';
  writeFileSync(join(first.root, 'human.txt'), human);
  const reportFile = join(firstOutput, 'REPORT.json');
  const oldReport = readFileSync(reportFile);
  const [second] = prepareExamples(options);
  assert.notEqual(dirname(second.root), firstOutput);
  assert.equal(readFileSync(join(first.root, 'human.txt'), 'utf8'), human);
  assert.deepEqual(readFileSync(reportFile), oldReport);
  for (const output of [firstOutput, dirname(second.root)]) {
    const probe = spawnSync('git', ['-C', output, 'rev-parse', '--git-dir'], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8', shell: false });
    assert.equal(probe.status, 128); assert.match(probe.stderr, /not a git repository/i);
    assert.match(readFileSync(join(output, '.gitignore'), 'utf8'), /^#.*\n\*\n$/);
  }
});

test("refusal output not ignored within Git before copying or changing index", t => {
  const { root, put } = fixture(t);
  const git = (...args) => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }); assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git('init', '--quiet', '--template=');
  put('.gitignore', '/outra-pasta/\n'); put('user.txt', 'conteúdo staged e humano\n'); git('add', '--', '.gitignore', 'user.txt');
  mkdirSync(join(root, 'examples/generated'), { recursive: true });
  const index = readFileSync(join(root, '.git/index')), ignore = readFileSync(join(root, '.gitignore'));
  let copied = false; const original = fs.copyFileSync;
  fs.copyFileSync = (...args) => { copied = true; return original(...args); }; syncBuiltinESMExports();
  try { assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: join(root, 'examples/generated/run'), scenarios: [SCENARIOS[0]], initializeGit: false }), /precisa estar ignorada/); }
  finally { fs.copyFileSync = original; syncBuiltinESMExports(); }
  assert.equal(copied, false); assert.deepEqual(readFileSync(join(root, '.git/index')), index); assert.deepEqual(readFileSync(join(root, '.gitignore')), ignore);
  assert.equal(readFileSync(join(root, 'user.txt'), 'utf8'), 'conteúdo staged e humano\n');
  assert.equal(existsSync(join(root, 'examples/generated/run')), false);
});

test("explicitly ignored tmp without changing index or ignoring human", t => {
  const { root, put } = fixture(t), tmp = join(root, 'tmp'), target = join(tmp, 'run');
  const git = (...args) => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }); assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git('init', '--quiet', '--template='); put('.gitignore', '/tmp/\n'); put('human.txt', 'staged\n'); git('add', '--', '.gitignore', 'human.txt'); mkdirSync(tmp);
  const index = readFileSync(join(root, '.git/index')), ignore = readFileSync(join(root, '.gitignore'));
  const [example] = prepareExamples({ sourceRoot: root, outputRoot: target, scenarios: [SCENARIOS[0]], initializeGit: false });
  assert.equal(example.root, join(target, SCENARIOS[0].id));
  assert.deepEqual(readFileSync(join(root, '.git/index')), index); assert.deepEqual(readFileSync(join(root, '.gitignore')), ignore);
  assert.equal(git('check-ignore', '--no-index', '--', 'tmp/run/somente-agentes/README.md').trim(), 'tmp/run/somente-agentes/README.md');
  git('add', '-A'); assert.equal(git('ls-files', '--', 'tmp/run').trim(), '');
});

test("accepts still missing tmp root ignored by exclusive directory rule", t => {
  const { root, put } = fixture(t), target = join(root, 'tmp');
  const init = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(init.status, 0, init.stderr);
  put('.gitignore', '/tmp/\n'); put('human.txt', 'preservado\n');
  const add = spawnSync('git', ['-C', root, 'add', '--', '.gitignore', 'human.txt'], { encoding: 'utf8' }); assert.equal(add.status, 0, add.stderr);
  const index = readFileSync(join(root, '.git/index')), ignore = readFileSync(join(root, '.gitignore'));
  assert.equal(existsSync(target), false);
  const result = createExampleOutput({ sourceRoot: root, outputRoot: target });
  assert.equal(result.outputRoot, target);
  const ignored = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '--', 'tmp/'], { encoding: 'utf8' }); assert.equal(ignored.status, 0, ignored.stderr);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index); assert.deepEqual(readFileSync(join(root, '.gitignore')), ignore);
  assert.equal(readFileSync(join(root, 'human.txt'), 'utf8'), 'preservado\n');
});

test("refuses output directory whose ancestor is missing staged file", t => {
  const { root, put } = fixture(t), target = join(root, 'tmp', 'run');
  const init = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(init.status, 0, init.stderr);
  put('.gitignore', '/tmp/\n'); put('tmp', 'arquivo humano staged\n');
  const add = spawnSync('git', ['-C', root, 'add', '-f', '--', '.gitignore', 'tmp'], { encoding: 'utf8' }); assert.equal(add.status, 0, add.stderr);
  unlinkSync(join(root, 'tmp'));
  const index = readFileSync(join(root, '.git/index')), ignore = readFileSync(join(root, '.gitignore'));
  assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: target }), /índice Git/);
  assert.equal(existsSync(join(root, 'tmp')), false);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index); assert.deepEqual(readFileSync(join(root, '.gitignore')), ignore);
});

test("creates absent ancestors of ignored tmp without touching human content or index", t => {
  const { root, put } = fixture(t), target = join(root, 'tmp', 'examples', 'run');
  const git = (...args) => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }); assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git('init', '--quiet', '--template='); put('.gitignore', '/tmp/\n'); put('human.txt', 'staged humano\n'); git('add', '--', '.gitignore', 'human.txt');
  const beforeIndex = readFileSync(join(root, '.git/index')), beforeIgnore = readFileSync(join(root, '.gitignore'));
  const [example] = prepareExamples({ sourceRoot: root, outputRoot: target, scenarios: [SCENARIOS[0]], initializeGit: false });
  assert.equal(example.root, join(target, SCENARIOS[0].id));
  assert.equal(git('check-ignore', '--no-index', '--', 'tmp/examples/run/somente-agentes/README.md').trim(), 'tmp/examples/run/somente-agentes/README.md');
  assert.equal(readFileSync(join(root, 'human.txt'), 'utf8'), 'staged humano\n');
  assert.deepEqual(readFileSync(join(root, '.git/index')), beforeIndex); assert.deepEqual(readFileSync(join(root, '.gitignore')), beforeIgnore);
});

test("does not create local ancestors if ignore not protecting fate", t => {
  const { root, put } = fixture(t), target = join(root, 'tmp', 'examples', 'run');
  const initialized = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(initialized.status, 0, initialized.stderr);
  put('.gitignore', '/outra-pasta/\n');
  assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: target, scenarios: [SCENARIOS[0]], initializeGit: false }), /precisa estar ignorada/);
  assert.equal(existsSync(join(root, 'tmp')), false); assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '/outra-pasta/\n');
});

test("link created concurrently in the absent ancestor is not followed", t => {
  const { root, put, space } = fixture(t), outside = join(space, 'outside-user'), target = join(root, 'tmp', 'examples', 'run');
  mkdirSync(outside); writeFileSync(join(outside, 'human.txt'), 'não alterar\n');
  const probe = join(space, 'link-capability');
  try { symlinkSync(outside, probe, process.platform === 'win32' ? 'junction' : 'dir'); unlinkSync(probe); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Links simbólicos indisponíveis.'); return; } throw error; }
  const git = (...args) => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }); assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git('init', '--quiet', '--template='); put('.gitignore', '/tmp/\n'); put('human.txt', 'staged\n'); git('add', '--', '.gitignore', 'human.txt');
  const index = readFileSync(join(root, '.git/index')), ignore = readFileSync(join(root, '.gitignore'));
  const original = childProcess.spawnSync; let injected = false;
  childProcess.spawnSync = (command, args, ...rest) => {
    if (!injected && command === process.execPath && args[0] === '-e' && args[2] === 'tmp') { injected = true; symlinkSync(outside, join(root, 'tmp'), process.platform === 'win32' ? 'junction' : 'dir'); }
    return original(command, args, ...rest);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: target, scenarios: [SCENARIOS[0]], initializeGit: false }), /diretório exclusivo|link/i); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  assert.equal(injected, true); assert.equal(lstatSync(join(root, 'tmp')).isSymbolicLink(), true);
  assert.equal(readFileSync(join(outside, 'human.txt'), 'utf8'), 'não alterar\n'); assert.equal(existsSync(join(outside, 'examples')), false);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index); assert.deepEqual(readFileSync(join(root, '.gitignore')), ignore);
});

test("index consultation in full and blocks aliases or ambiguities Unicode", t => {
  const { root, put } = fixture(t);
  const git = (args, input) => { const r = spawnSync('git', ['-C', root, ...args], { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git(['init', '--quiet', '--template=']); put('.gitignore', '/[Tt][Mm][Pp]/\n');
  const hash = git(['hash-object', '-w', '--stdin'], 'fixture\n').trim();
  const rows = Array.from({ length: 12000 }, (_, i) => `100644 ${hash}\tmonorepo/nested/${String(i).padStart(6, '0')}.txt\n`);
  rows.push(`100644 ${hash}\tTmP/Kelvin/human.txt\n`); git(['update-index', '--index-info'], rows.join(''));
  const beforeIndex = readFileSync(join(root, '.git/index')), beforeIgnore = readFileSync(join(root, '.gitignore'));
  const original = childProcess.spawnSync, observations = [];
  childProcess.spawnSync = (command, args, ...rest) => { const result = original(command, args, ...rest); if (command === 'git' && args.includes('ls-files')) observations.push({ args, stdout: result.stdout }); return result; };
  syncBuiltinESMExports();
  try {
    assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: join(root, 'tmp', 'kelvin'), scenarios: [SCENARIOS[0]], initializeGit: false }), /índice Git/);
    assert.equal(existsSync(join(root, 'tmp')), false);
    // On Windows a missing short directory name can alias another missing
    // index entry. Create this unrelated parent so its identity proves that
    // it is distinct from the staged Unicode path.
    mkdirSync(join(root, 'tmp', 'other'), { recursive: true });
    const [example] = prepareExamples({ sourceRoot: root, outputRoot: join(root, 'tmp', 'other', 'run'), scenarios: [SCENARIOS[0]], initializeGit: false });
    assert.equal(example.root, join(root, 'tmp', 'other', 'run', SCENARIOS[0].id));
  } finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  assert.ok(observations.length > 0); for (const call of observations) {
    assert.equal(call.args.includes('--'), false, JSON.stringify(call.args));
    assert.match(call.stdout, /monorepo\/nested/);
  }
  assert.deepEqual(readFileSync(join(root, '.git/index')), beforeIndex); assert.deepEqual(readFileSync(join(root, '.gitignore')), beforeIgnore);
});

test("nested project accepts ignored output and preserves staged sibling project", t => {
  const { space } = fixture(t), repo = space, source = join(repo, 'packages', 'app'), sibling = join(repo, 'packages', 'other');
  mkdirSync(source, { recursive: true }); mkdirSync(sibling, { recursive: true });
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git('init', '--quiet', '--template='); writeFileSync(join(repo, '.gitignore'), '/packages/app/tmp/\n');
  writeFileSync(join(source, 'README.md'), '# Humano\n'); mkdirSync(join(sibling, 'tmp', 'run'), { recursive: true });
  writeFileSync(join(sibling, 'tmp', 'run', 'human.txt'), 'irmão staged\n'); git('add', '--', '.gitignore', 'packages/app/README.md', 'packages/other/tmp/run/human.txt');
  const index = readFileSync(join(repo, '.git/index')), ignore = readFileSync(join(repo, '.gitignore'));
  const target = join(source, 'tmp', 'examples', 'run');
  const result = createExampleOutput({ sourceRoot: source, outputRoot: target });
  assert.equal(result.outputRoot, target); assert.equal(git('check-ignore', '--no-index', '--', 'packages/app/tmp/examples/run').trim(), 'packages/app/tmp/examples/run');
  assert.equal(readFileSync(join(sibling, 'tmp', 'run', 'human.txt'), 'utf8'), 'irmão staged\n');
  assert.deepEqual(readFileSync(join(repo, '.git/index')), index); assert.deepEqual(readFileSync(join(repo, '.gitignore')), ignore);
});

test('projeto aninhado detecta aliases staged Unicode no prefixo e no destino', t => {
  const { space } = fixture(t), repo = space, source = join(repo, 'packages', 'app'); mkdirSync(source, { recursive: true });
  const git = (args, input) => { const r = spawnSync('git', ['-C', repo, ...args], { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git(['init', '--quiet', '--template=']); writeFileSync(join(repo, '.gitignore'), '/packages/app/tmp/\n');
  const hash = git(['hash-object', '-w', '--stdin'], 'fixture\n').trim();
  const rows = Array.from({ length: 12000 }, (_, i) => `100644 ${hash}\tunrelated/large/${String(i).padStart(6, '0')}.txt\n`);
  rows.push(`100644 ${hash}\tpacKages/aPP/tMp/Kelvin/human.txt\n`); git(['update-index', '--index-info'], rows.join(''));
  const index = readFileSync(join(repo, '.git/index')), ignore = readFileSync(join(repo, '.gitignore'));
  const original = childProcess.spawnSync, observations = [];
  childProcess.spawnSync = (command, args, ...rest) => { const result = original(command, args, ...rest); if (command === 'git' && args.includes('ls-files')) observations.push({ args, stdout: result.stdout }); return result; };
  syncBuiltinESMExports();
  try { assert.throws(() => createExampleOutput({ sourceRoot: source, outputRoot: join(source, 'tmp', 'kelvin') }), /índice Git/); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  assert.equal(existsSync(join(source, 'tmp')), false); assert.ok(observations.length > 0);
  for (const call of observations) {
    assert.equal(call.args.includes('--'), false, JSON.stringify(call.args));
    assert.match(call.stdout, /unrelated\/large/);
  }
  assert.deepEqual(readFileSync(join(repo, '.git/index')), index); assert.deepEqual(readFileSync(join(repo, '.gitignore')), ignore);
});

test("whole index is consulted when nested prefix does not allow Unicode filter safe", t => {
  const { space } = fixture(t), repo = space, source = join(repo, 'kappa', 'app'); mkdirSync(source, { recursive: true });
  const git = (args, input) => { const r = spawnSync('git', ['-C', repo, ...args], { input, encoding: 'utf8' }); assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git(['init', '--quiet', '--template=']); writeFileSync(join(repo, '.gitignore'), '/kappa/app/tmp/\n');
  const hash = git(['hash-object', '-w', '--stdin'], 'fixture\n').trim();
  git(['update-index', '--index-info'], `100644 ${hash}\tKappa/app/tMp/run/human.txt\n`);
  const index = readFileSync(join(repo, '.git/index')), ignore = readFileSync(join(repo, '.gitignore'));
  const original = childProcess.spawnSync, observations = [];
  childProcess.spawnSync = (command, args, ...rest) => { const result = original(command, args, ...rest); if (command === 'git' && args.includes('ls-files')) observations.push(args); return result; };
  syncBuiltinESMExports();
  try { assert.throws(() => createExampleOutput({ sourceRoot: source, outputRoot: join(source, 'tmp', 'run') }), /índice Git/); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  assert.ok(observations.length > 0); for (const args of observations) assert.equal(args.includes('--'), false, JSON.stringify(args));
  assert.equal(existsSync(join(source, 'tmp')), false); assert.deepEqual(readFileSync(join(repo, '.git/index')), index); assert.deepEqual(readFileSync(join(repo, '.gitignore')), ignore);
});

test("nested project refusal alias staged Unicode in intermediate component", t => {
  const { space } = fixture(t), repo = space, source = join(repo, 'packages', 'kit'); mkdirSync(source, { recursive: true });
  const git = (args, input) => { const r = spawnSync('git', ['-C', repo, ...args], { input, encoding: 'utf8' }); assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git(['init', '--quiet', '--template=']); writeFileSync(join(repo, '.gitignore'), '/packages/kit/tmp/\n');
  const hash = git(['hash-object', '-w', '--stdin'], 'fixture\n').trim();
  git(['update-index', '--index-info'], `100644 ${hash}\tpackages/KIT/tmp/run/human.txt\n`);
  const index = readFileSync(join(repo, '.git/index')), ignore = readFileSync(join(repo, '.gitignore'));
  assert.throws(() => createExampleOutput({ sourceRoot: source, outputRoot: join(source, 'tmp', 'run') }), /índice Git/);
  assert.equal(existsSync(join(source, 'tmp')), false); assert.deepEqual(readFileSync(join(repo, '.git/index')), index); assert.deepEqual(readFileSync(join(repo, '.gitignore')), ignore);
});

test("Unicode staged alias refusal when lowercase expands on ASCII and combinant", t => {
  const { space } = fixture(t), repo = space, source = join(repo, 'i\u0307dea', 'app'); mkdirSync(source, { recursive: true });
  const git = (args, input) => { const r = spawnSync('git', ['-C', repo, ...args], { input, encoding: 'utf8' }); assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git(['init', '--quiet', '--template=']); writeFileSync(join(repo, '.gitignore'), '/i\u0307dea/app/tmp/\n');
  const hash = git(['hash-object', '-w', '--stdin'], 'fixture\n').trim();
  git(['update-index', '--index-info'], `100644 ${hash}\tİdea/app/tmp/run/human.txt\n`);
  const index = readFileSync(join(repo, '.git/index')), ignore = readFileSync(join(repo, '.gitignore'));
  assert.throws(() => createExampleOutput({ sourceRoot: source, outputRoot: join(source, 'tmp', 'run') }), /índice Git/);
  assert.equal(existsSync(join(source, 'tmp')), false); assert.deepEqual(readFileSync(join(repo, '.git/index')), index); assert.deepEqual(readFileSync(join(repo, '.gitignore')), ignore);
});

test('destinos TMP e TEMP em caixa mista exigem ignore efetivo', t => {
  const { root, put } = fixture(t);
  const initialized = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(initialized.status, 0, initialized.stderr);
  put('.gitignore', '/[Tt][Mm][Pp]/\n/[Tt][Ee][Mm][Pp]/\n');
  for (const directory of ['TmP', 'TeMp']) {
    const parent = join(root, directory); mkdirSync(parent);
    const target = join(parent, 'case');
    const [example] = prepareExamples({ sourceRoot: root, outputRoot: target, scenarios: [SCENARIOS[0]], initializeGit: false });
    assert.equal(example.root, join(target, SCENARIOS[0].id));
    const ignored = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '--', `${directory}/case/README.md`], { encoding: 'utf8' });
    assert.equal(ignored.status, 0, ignored.stderr);
  }
});

test('recusa destino ignorado com entrada staged ausente no disco', t => {
  const { root, put } = fixture(t), target = join(root, 'tmp', 'run');
  const git = (...args) => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }); assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git('init', '--quiet', '--template='); put('.gitignore', '/tmp/\n'); put('tmp/run/human.txt', 'conteúdo humano staged\n'); git('add', '-f', '--', 'tmp/run/human.txt');
  rmSync(target, { recursive: true }); const index = readFileSync(join(root, '.git/index'));
  assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: target, scenarios: [SCENARIOS[0]], initializeGit: false }), /índice Git/);
  assert.equal(existsSync(target), false); assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  assert.equal(git('show', ':tmp/run/human.txt'), 'conteúdo humano staged\n');
});

test("concurrent change that removes ignore local is detected without hiding the limit", t => {
  const { root, put } = fixture(t), target = join(root, 'tmp', 'run');
  let r = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  put('.gitignore', '/tmp/\n'); mkdirSync(join(root, 'tmp')); let injected = false;
  const original = fs.copyFileSync;
  fs.copyFileSync = (...args) => { const value = original(...args); if (!injected) { injected = true; writeFileSync(join(root, '.gitignore'), '# removido pelo usuário\n'); } return value; };
  syncBuiltinESMExports();
  try { assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: target, scenarios: [SCENARIOS[0]], initializeGit: false }), /precisa estar ignorada/); }
  finally { fs.copyFileSync = original; syncBuiltinESMExports(); }
  assert.equal(injected, true); assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '# removido pelo usuário\n');
  // Between checks a concurrent process can use git add -f: this
  // does not constitute an atomic guarantee that files will not be staged.
});

test("ignore execution removal is detected without editing project ignore", t => {
  const { root, put } = fixture(t), target = join(root, 'tmp', 'run');
  const initialized = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(initialized.status, 0, initialized.stderr);
  put('.gitignore', '/tmp/\n'); mkdirSync(join(root, 'tmp')); let injected = false;
  const original = fs.copyFileSync;
  fs.copyFileSync = (...args) => { const value = original(...args); if (!injected) { injected = true; unlinkSync(join(target, '.gitignore')); } return value; };
  syncBuiltinESMExports();
  try { assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: target, scenarios: [SCENARIOS[0]], initializeGit: false }), /Proteção da saída alterada/); }
  finally { fs.copyFileSync = original; syncBuiltinESMExports(); }
  assert.equal(injected, true); assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '/tmp/\n');
});

test('recusa TMPDIR dentro de Git, inclusive fora da origem e ignorado', t => {
  const { root, space } = fixture(t), repo = join(space, 'synthetic-repo'); mkdirSync(repo);
  const initialized = spawnSync('git', ['init', '--quiet', '--template=', repo], { encoding: 'utf8' }); assert.equal(initialized.status, 0, initialized.stderr);
  writeFileSync(join(repo, '.gitignore'), '/local-temp/\n'); const local = join(repo, 'local-temp'); mkdirSync(local);
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) process.env[key] = local;
  assert.throws(() => prepareExamples({ sourceRoot: root, scenarios: [SCENARIOS[0]], initializeGit: false }), /repositório Git/);
  assert.deepEqual(readdirSync(local), []);
});

test("refuses destinations in a bare repository and ignores GIT_DIR/GIT_CEILING_DIRECTORY inherited", t => {
  const { root, space } = fixture(t), bare = join(space, 'bare.git'), repo = join(space, 'git-work'); mkdirSync(repo);
  for (const args of [['init', '--bare', '--quiet', bare], ['init', '--quiet', '--template=', repo]]) { const r = spawnSync('git', args, { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); }
  const previous = { GIT_DIR: process.env.GIT_DIR, GIT_CEILING_DIRECTORIES: process.env.GIT_CEILING_DIRECTORIES };
  process.env.GIT_DIR = join(space, 'irrelevant'); process.env.GIT_CEILING_DIRECTORIES = repo;
  try {
    assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: join(bare, 'unsafe') }), /repositório Git/);
    assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: join(repo, 'unsafe') }), /repositório Git/);
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  assert.equal(existsSync(join(bare, 'unsafe')), false); assert.equal(existsSync(join(repo, 'unsafe')), false);
});

test("repo bare is refused before consulting Git who lies about the directory", t => {
  const { root, space } = fixture(t), bare = join(space, 'bare.git'), parent = join(bare, 'outputs');
  const r = spawnSync('git', ['init', '--bare', '--quiet', bare], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); mkdirSync(parent);
  const head = readFileSync(join(bare, 'HEAD')), config = readFileSync(join(bare, 'config')); let invoked = false;
  const original = childProcess.spawnSync; childProcess.spawnSync = (cmd, ...args) => { if (cmd === 'git') { invoked = true; return { status: 128, stderr: 'fatal: not a git repository\n' }; } return original(cmd, ...args); };
  syncBuiltinESMExports();
  try { assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: join(parent, 'case') }), /repositório Git/); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  assert.equal(invoked, false); assert.equal(existsSync(join(parent, 'case')), false);
  assert.deepEqual(readFileSync(join(bare, 'HEAD')), head); assert.deepEqual(readFileSync(join(bare, 'config')), config);
});

test("repo bare is refused even with fake Git in PATH", t => {
  if (process.platform === 'win32') { t.skip('Fixture de executável falso usa /bin/sh; a proteção bare foi testada acima.'); return; }
  const { root, space } = fixture(t), bare = join(space, 'bare.git'), parent = join(bare, 'outputs'), bin = join(space, 'fake-bin');
  const r = spawnSync('git', ['init', '--bare', '--quiet', bare], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); mkdirSync(parent); mkdirSync(bin);
  const fake = join(bin, 'git'); writeFileSync(fake, '#!/bin/sh\nprintf "fatal: not a git repository\\n" >&2\nexit 128\n'); chmodSync(fake, 0o700);
  const oldPath = process.env.PATH; process.env.PATH = bin;
  try { assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: join(parent, 'case') }), /repositório Git/); }
  finally { process.env.PATH = oldPath; }
  assert.equal(existsSync(join(parent, 'case')), false);
});

test("temporary refusal defined by human symlink and Git unavailable", t => {
  const { root, space, outputs } = fixture(t), alias = join(space, 'temp-link');
  try { symlinkSync(outputs, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Links simbólicos indisponíveis.'); return; } throw error; }
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) process.env[key] = alias;
  assert.throws(() => createExampleOutput({ sourceRoot: root }), /não pode ser link/);
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) process.env[key] = space;
  const previousPath = process.env.PATH; process.env.PATH = '';
  try { assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: join(outputs, 'no-git') }), /Não foi possível verificar Git/); }
  finally { process.env.PATH = previousPath; }
  assert.equal(existsSync(join(outputs, 'no-git')), false);
});

test("API without startup Git prepares out of repositories even without Git in PATH", t => {
  const { root, outputRoot } = fixture(t);
  const previousPath = process.env.PATH; process.env.PATH = '';
  try {
    const [example] = prepareExamples({ sourceRoot: root, outputRoot, scenarios: [SCENARIOS[0]], initializeGit: false });
    assert.ok(existsSync(join(example.root, '.pbai4devs/skills/projeto/demo/SKILL.md')));
    assert.equal(existsSync(join(example.root, '.git')), false);
    assert.match(readFileSync(join(outputRoot, '.gitignore'), 'utf8'), /\*/);
  } finally { process.env.PATH = previousPath; }
});

test("API without Git keeps blocking repositories and local output without proving ignore", t => {
  const { root, space } = fixture(t), repo = join(space, 'repo'), bare = join(space, 'bare.git');
  for (const args of [['init', '--quiet', '--template=', repo], ['init', '--bare', '--quiet', bare], ['init', '--quiet', '--template=', root]]) {
    const result = spawnSync('git', args, { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  }
  writeFileSync(join(root, '.gitignore'), '/tmp/\n');
  const previousPath = process.env.PATH; process.env.PATH = '';
  try {
    const options = { sourceRoot: root, scenarios: [SCENARIOS[0]], initializeGit: false };
    for (const target of [join(repo, 'generated'), join(bare, 'generated')]) {
      assert.throws(() => prepareExamples({ ...options, outputRoot: target }), /repositório Git/);
      assert.equal(existsSync(target), false);
    }
    const local = join(root, 'tmp', 'generated');
    assert.throws(() => prepareExamples({ ...options, outputRoot: local }), /Não foi possível verificar Git/);
    assert.equal(existsSync(local), false);
  } finally { process.env.PATH = previousPath; }
});

test('API sem Git recusa worktree definido externamente no ambiente', t => {
  const { root, outputRoot } = fixture(t);
  const previous = Object.fromEntries(['PATH', 'GIT_DIR', 'GIT_WORK_TREE'].map(key => [key, process.env[key]]));
  process.env.PATH = '';
  try {
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE']) {
      delete process.env.GIT_DIR; delete process.env.GIT_WORK_TREE;
      process.env[key] = join(root, 'external');
      assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot, scenarios: [SCENARIOS[0]], initializeGit: false }), /worktree definido externamente/);
      assert.equal(existsSync(outputRoot), false);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("empty Git executable success does not prove ignore local", t => {
  if (process.platform === 'win32') { t.skip('Fixture de executável falso usa /bin/sh.'); return; }
  const { root, space } = fixture(t), bin = join(space, 'fake-bin'), target = join(root, 'tmp', 'case');
  const initialized = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(initialized.status, 0, initialized.stderr);
  mkdirSync(bin); writeFileSync(join(root, '.gitignore'), '/tmp/\n');
  writeFileSync(join(bin, 'git'), [
    '#!/bin/sh',
    'for arg in "$@"; do',
    '  case "$arg" in',
    '    rev-parse) printf "%s\\n" "$FAKE_TEST_ROOT" ;;',
    '    check-ignore) /bin/cat >/dev/null ;;',
    '  esac',
    'done',
    'exit 0',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'git'), 0o700);
  const oldPath = process.env.PATH, oldRoot = process.env.FAKE_TEST_ROOT;
  process.env.PATH = bin; process.env.FAKE_TEST_ROOT = root;
  try {
    assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: target, scenarios: [SCENARIOS[0]], initializeGit: false }), /Resposta Git inválida ao verificar ignore/);
    assert.equal(existsSync(target), false);
  } finally {
    process.env.PATH = oldPath;
    if (oldRoot === undefined) delete process.env.FAKE_TEST_ROOT; else process.env.FAKE_TEST_ROOT = oldRoot;
  }
});

test("malformed response in index query blocks output before creating directories", t => {
  const { root, put } = fixture(t), target = join(root, 'tmp', 'case');
  let result = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  put('.gitignore', '/tmp/\n'); put('human.txt', 'existente');
  result = spawnSync('git', ['-C', root, 'add', '--', 'human.txt'], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  const index = readFileSync(join(root, '.git/index'));
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (cmd, args, ...rest) => cmd === 'git' && args.includes('ls-files') ? { status: 0, stdout: 'incompleto', stderr: '' } : original(cmd, args, ...rest);
  syncBuiltinESMExports();
  try {
    assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: target, scenarios: [SCENARIOS[0]], initializeGit: false }), /Resposta Git inválida ao verificar índice/);
  } finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  assert.equal(existsSync(target), false); assert.deepEqual(readFileSync(join(root, '.git/index')), index);
});

test("the two ILCs refuse --output inside Git before creating project", t => {
  const { space } = fixture(t), repo = join(space, 'repo'), target = join(repo, 'tmp', 'output'); mkdirSync(repo);
  let r = spawnSync('git', ['init', '--quiet', '--template=', repo], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  mkdirSync(join(repo, 'tmp')); writeFileSync(join(repo, '.gitignore'), '/tmp/\n'); writeFileSync(join(repo, 'human'), 'staged\n');
  r = spawnSync('git', ['-C', repo, 'add', '--', '.gitignore', 'human'], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  const index = readFileSync(join(repo, '.git/index')), ignore = readFileSync(join(repo, '.gitignore'));
  const commands = [
    [join(projectRoot, '.pbai4devs/scripts/testar-maturidade/SCRIPT.mjs'), 'prepare', '--case', 'somente-agentes', '--output', target],
    [join(projectRoot, 'tests/example-workflows.mjs'), '0.0.30', '--tarball', join(space, 'unused.tgz'), '--output', target],
  ];
  for (const [script, ...args] of commands) {
    if (!existsSync(script)) continue; // Product-only workflow is not shipped in npm.
    r = spawnSync(process.execPath, [script, ...args], { cwd: projectRoot, encoding: 'utf8', timeout: 30000 });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /repositório Git/); assert.equal(existsSync(target), false);
    assert.deepEqual(readFileSync(join(repo, '.git/index')), index); assert.deepEqual(readFileSync(join(repo, '.gitignore')), ignore);
  }
});

test("previous workflow destination does not receive nested execution or is replaced", t => {
  const { root, outputRoot } = fixture(t);
  const first = createExampleOutput({ sourceRoot: root, outputRoot, prefix: 'agentdevkit-workflows-' });
  const marker = join(first.outputRoot, '.agentdevkit-example-output.json');
  const original = readFileSync(marker); writeFileSync(join(first.outputRoot, 'human.txt'), 'preservar\n');
  assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: join(first.outputRoot, 'nova') }), /execução anterior/);
  assert.throws(() => createExampleOutput({ sourceRoot: root, outputRoot: first.outputRoot }), /saída já existe/);
  assert.deepEqual(readFileSync(marker), original); assert.equal(readFileSync(join(first.outputRoot, 'human.txt'), 'utf8'), 'preservar\n');
  assert.equal(existsSync(join(first.outputRoot, 'nova')), false);
});

test("preserves existing examples at source and accepts new destinations outside the tree", t => {
  const { root, put, space, outputs } = fixture(t);
  const options = { sourceRoot: root, scenarios: [SCENARIOS[0]], initializeGit: false };
  put('examples/generated/.gitignore', '!README.md\n');
  put('examples/generated/.maturity-suite.json', '{"owner":"testar-maturidade"}\n');
  put('examples/generated/somente-agentes/.maturity-case.json', '{"owner":"testar-maturidade","id":"somente-agentes"}\n');
  put('examples/generated/somente-agentes/anotacao.txt', 'Conteúdo humano anterior.\n');
  put('examples/generated/REPORT.json', '{"resultado":"anterior"}\n');
  const [generated] = prepareExamples(options);
  assert.equal(dirname(dirname(generated.root)), space);
  assert.equal(readFileSync(join(root, 'examples/generated/.gitignore'), 'utf8'), '!README.md\n');
  assert.equal(readFileSync(join(root, 'examples/generated/somente-agentes/anotacao.txt'), 'utf8'), 'Conteúdo humano anterior.\n');
  assert.equal(readFileSync(join(root, 'examples/generated/REPORT.json'), 'utf8'), '{"resultado":"anterior"}\n');
  for (const target of ['caso-novo', 'cases']) {
    const outputRoot = join(outputs, target);
    const [example] = prepareExamples({ ...options, outputRoot });
    assert.equal(example.root, join(outputRoot, SCENARIOS[0].id));
  }
});

test("interrupted preparation does not change previous result or declare success", t => {
  const { root, put, space } = fixture(t);
  const options = { sourceRoot: root, scenarios: [SCENARIOS[0]], initializeGit: false };
  const [first] = prepareExamples(options);
  const firstOutput = dirname(first.root);
  const report = join(firstOutput, 'REPORT.json');
  const previous = readFileSync(report);
  put('.pbai4devs/state/agentdevkit.json', JSON.stringify({ blocks: null }));
  assert.throws(() => prepareExamples(options), /Estado da instalação/);
  assert.deepEqual(readFileSync(report), previous);
  const failed = readdirSync(space).filter(name => name.startsWith('agentdevkit-maturity-') && join(space, name) !== firstOutput);
  assert.equal(failed.length, 1);
  const index = join(space, failed[0], 'README.md');
  assert.match(readFileSync(index, 'utf8'), /status: preparing/);
  assert.equal(existsSync(join(space, failed[0], 'REPORT.json')), false);
  assert.doesNotMatch(readFileSync(index, 'utf8'), /status: passed|\| passed \|/);
});

test("human symbolic inputs are preserved and informed without following destiny", t => {
  const { root, space, outputs } = fixture(t);
  const original = readFileSync(join(root, 'AGENTS.md'));
  const external = join(space, 'externo.txt');
  writeFileSync(external, 'Conteúdo externo a preservar.\n');
  for (const name of ['CLAUDE.md', 'GEMINI.md']) rmSync(join(root, name));
  try {
    symlinkSync('AGENTS.md', join(root, 'CLAUDE.md'));
    symlinkSync(external, join(root, 'GEMINI.md'));
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) { t.skip('Sem permissão para criar links.'); return; }
    throw error;
  }
  const outputRoot = join(outputs, 'entradas-simbolicas');
  const [example] = prepare({ sourceRoot: root, outputRoot, scenarios: [SCENARIOS[0]], initializeGit: false, renderResources() {} });
  assert.deepEqual(example.copied.omittedEntrypoints, ['CLAUDE.md', 'GEMINI.md']);
  assert.equal(existsSync(join(example.root, 'CLAUDE.md')), false);
  assert.equal(existsSync(join(example.root, 'GEMINI.md')), false);
  assert.equal(fs.readlinkSync(join(root, 'CLAUDE.md')), 'AGENTS.md');
  assert.equal(fs.readlinkSync(join(root, 'GEMINI.md')), external);
  assert.deepEqual(readFileSync(join(root, 'AGENTS.md')), original);
  assert.equal(readFileSync(external, 'utf8'), 'Conteúdo externo a preservar.\n');
  const report = JSON.parse(readFileSync(join(outputRoot, 'REPORT.json'), 'utf8'));
  assert.deepEqual(report.copies[0].omittedEntrypoints, ['CLAUDE.md', 'GEMINI.md']);
});

test("fixture ignores local artifacts without changing the origin gitignore", t => {
  const { root, put, outputs } = fixture(t);
  put('.gitignore', 'node_modules/\n');
  let git = spawnSync('git', ['init', '--quiet', '--template=', root], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  git = spawnSync('git', ['-C', root, 'add', '--', '.gitignore'], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  const original = readFileSync(join(root, '.gitignore'));
  const index = readFileSync(join(root, '.git/index'));
  const [example] = prepareExamples({ sourceRoot: root, outputRoot: join(outputs, 'ignore'), scenarios: [SCENARIOS[0]], initializeGit: true });
  assert.deepEqual(readFileSync(join(root, '.gitignore')), original);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  assert.deepEqual(readFileSync(join(example.root, '.gitignore')), original);
  assert.equal(readFileSync(join(example.root, '.agent-tests/.gitignore'), 'utf8'), '*\n');
  git = spawnSync('git', ['-C', example.root, 'check-ignore', '--no-index', '-q', '.agent-tests/prova.log'], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
});

test("package font mode ignores selection, mirrors and local preferences", t => {
  const { root, put, outputRoot } = fixture(t);
  put('package.json', JSON.stringify({
    name: '@pathbit/agentdevkit', version: '1.0.0', files: ['.pbai4devs/'],
    scripts: { prepack: 'node -e "require(\'fs\').writeFileSync(\'prepack-called\', \'\')"' },
  }));
  put('.pbai4devs/.npmignore', '/local-note.md\n');
  const state = put('.pbai4devs/state/agentdevkit.json', '{estado local inválido');
  const excludes = [
    '.pbai4devs/skills.json', '.pbai4devs/catalog.json',
    '.pbai4devs/state/derived.json', '.pbai4devs/state/configuracao/ESTADO.md',
    '.pbai4devs/local-note.md', '.pbai4devs/tools/demo/.local/control.txt',
    '.claude/rules/git/RULE.md', '.codex/skills/demo/SKILL.md', '.gemini/commands/demo.toml',
    'AGENTS.md', 'CLAUDE.md', 'GEMINI.md',
  ];
  for (const path of excludes) put(path, `original local: ${path}`);
  const manualManifest = 'agente|.claude|agrupado\nagente|.gemini|agrupado\n';
  const manifest = put('.pbai4devs/espelhos.conf', manualManifest);
  const [example] = prepareExamples({ sourceRoot: root, outputRoot, scenarios: [SCENARIOS[0]], initializeGit: false, sourceOnly: true });
  assert.deepEqual(example.copied.roots, ['.pbai4devs']);
  assert.deepEqual(example.copied.catalogSnapshots, []);
  assert.deepEqual(example.copied.entrypoints, {});
  const source = '.pbai4devs/skills/projeto/demo/SKILL.md';
  assert.deepEqual(readFileSync(join(example.root, source)), readFileSync(join(root, source)));
  for (const path of excludes) {
    assert.equal(existsSync(join(example.root, path)), false, path);
    assert.equal(readFileSync(join(root, path), 'utf8'), `original local: ${path}`);
  }
  assert.equal(existsSync(join(example.root, '.agent-tests/testar-maturidade/original-catalogs')), false);
  assert.equal(existsSync(join(example.root, '.pbai4devs/espelhos.conf')), false);
  assert.equal(readFileSync(manifest, 'utf8'), manualManifest);
  assert.equal(readFileSync(state, 'utf8'), '{estado local inválido');
  assert.equal(existsSync(join(root, 'prepack-called')), false);
  assert.equal(JSON.parse(readFileSync(join(outputRoot, 'REPORT.json'), 'utf8')).sourceMode, 'package-source');
});

test("with no proven state conserves human inputs even with template", t => {
  const { root, put } = fixture(t);
  const template = '---\ndescription: Entrada genérica.\n---\n\n# Agentes do projeto\n';
  put('AGENTS.md', '# Produto do distribuidor\n\n[PRD](docs/prd.md)\n');
  put('.pbai4devs/templates/entrypoints/AGENTS.md', template);
  const destination = join(root, 'copy');
  const copied = copyAgentStructure(root, destination);
  assert.equal(readFileSync(join(destination, 'AGENTS.md'), 'utf8'), '# Produto do distribuidor\n\n[PRD](docs/prd.md)\n');
  assert.equal(readFileSync(join(destination, 'CLAUDE.md'), 'utf8'), 'fixture\n');
  assert.equal(copied.entrypoints['AGENTS.md'], 'AGENTS.md');
  assert.equal(copied.entrypoints['CLAUDE.md'], 'CLAUDE.md');
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# Produto do distribuidor\n\n[PRD](docs/prd.md)\n');
});

test("copies respect customers and partial installations entrances", async t => {
  for (const [client, manifest, entrypoints] of [
    ['claude', 'agente|.claude|plano\n', ['AGENTS.md', 'CLAUDE.md']],
    ['codex', 'agente|.codex|agrupado\nagente|.agents|agrupado\n', ['AGENTS.md']],
  ]) await t.test(client, t => {
    const { root, put } = fixture(t);
    put('.pbai4devs/espelhos.conf', manifest);
    put('.claude/skills/demo/SKILL.md', 'ponteiro');
    for (const name of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
      put(`.pbai4devs/templates/entrypoints/${name}`, `# Modelo ${name}\n`);
      if (!entrypoints.includes(name)) rmSync(join(root, name));
    }
    const destination = join(root, 'copy');
    const copied = copyAgentStructure(root, destination);
    assert.deepEqual(Object.keys(copied.entrypoints), entrypoints);
    for (const name of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
      assert.equal(existsSync(join(destination, name)), entrypoints.includes(name), name);
      assert.ok(existsSync(join(destination, '.pbai4devs/templates/entrypoints', name)));
    }
    assert.equal(existsSync(join(destination, '.vscode')), false);
    assert.equal(existsSync(join(root, '.vscode/settings.json')), true);
    assert.equal(existsSync(join(destination, '.github')), false);
    assert.equal(existsSync(join(destination, '.gemini')), false);
    if (client === 'claude') {
      assert.deepEqual(copied.roots, ['.pbai4devs', '.claude']);
      assert.equal(existsSync(join(destination, '.codex')), false);
      assert.equal(existsSync(join(destination, '.agents')), false);
    } else {
      assert.deepEqual(copied.roots, ['.pbai4devs', '.codex', '.agents']);
      assert.equal(existsSync(join(destination, '.claude')), false);
    }
  });
});

test("editor settings require explicit log in manifest", t => {
  const { root, put } = fixture(t);
  put('.pbai4devs/espelhos.conf', 'agente|.codex|plano\nagente|.vscode|plano\ngitignore|.vscode\n');
  const destination = join(root, 'copy');
  const copied = copyAgentStructure(root, destination);
  assert.deepEqual(copied.roots, ['.pbai4devs', '.codex', '.vscode']);
  assert.equal(readFileSync(join(destination, '.vscode/settings.json'), 'utf8'), '{"fixture":true}\n');
});

test("Partial installation preserves own inputs and edited blocks", t => {
  const { root, put } = fixture(t);
  put('.pbai4devs/espelhos.conf', 'agente|.codex|agrupado\nagente|.agents|agrupado\n');
  const block = '<!-- BEGIN AGENTDEVKIT -->\nEntrada gerenciada.\n<!-- END AGENTDEVKIT -->';
  put('.pbai4devs/state/agentdevkit.json', JSON.stringify({ schemaVersion: 1, version: '1.0.0', language: 'pt', clients: ['codex'], files: {}, blocks: { 'AGENTS.md': createHash('sha256').update(block).digest('hex') } }));
  put('AGENTS.md', `# Agentes\n\n${block}\n`);
  const human = '# Claude pessoal\r\n\r\nPreservar byte a byte: ação.\r\n';
  put('CLAUDE.md', human);
  rmSync(join(root, 'GEMINI.md'));
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) put(`.pbai4devs/templates/entrypoints/${name}`, `# Modelo ${name}\n`);
  const destination = join(root, 'copy');
  const copied = copyAgentStructure(root, destination);
  assert.equal(readFileSync(join(destination, 'AGENTS.md'), 'utf8'), '# Modelo AGENTS.md\n');
  assert.deepEqual(readFileSync(join(destination, 'CLAUDE.md')), Buffer.from(human));
  assert.doesNotMatch(readFileSync(join(destination, 'CLAUDE.md'), 'utf8'), /BEGIN AGENTDEVKIT/);
  assert.equal(copied.entrypoints['AGENTS.md'], '.pbai4devs/templates/entrypoints/AGENTS.md');
  assert.equal(copied.entrypoints['CLAUDE.md'], 'CLAUDE.md');
  assert.equal(existsSync(join(destination, 'GEMINI.md')), false);
  assert.equal(existsSync(join(destination, '.claude')), false);
  assert.equal(existsSync(join(destination, '.vscode')), false);
  put('AGENTS.md', `# Agentes\n\n${block.replace('gerenciada', 'editada')}\n`);
  const changed = join(root, 'changed-copy');
  copyAgentStructure(root, changed);
  assert.deepEqual(readFileSync(join(changed, 'AGENTS.md')), readFileSync(join(root, 'AGENTS.md')));
});

test('localiza apontamentos pelo formato de cada tipo e por overrides nativos', t => {
  const { root, put } = fixture(t);
  put('.pbai4devs/espelhos.conf', [
    'agente|.claude|agrupado', 'formato|.claude|skills|plano',
    'agente|.codex|plano', 'formato|.codex|skills|agrupado',
    'nativo|.codex/skills/alias/SKILL.md|.pbai4devs/skills/projeto/demo/SKILL.md',
  ].join('\n') + '\n');
  assert.deepEqual(resourceTargets(root, '.pbai4devs/skills/projeto/demo/SKILL.md'), [
    '.claude/skills/demo/SKILL.md', '.codex/skills/projeto/demo/SKILL.md', '.codex/skills/alias/SKILL.md',
  ]);
});

test('respeita tipo sem espelho e exclui rotas Gemini do manifesto manual', t => {
  const { root, put } = fixture(t);
  put('.pbai4devs/espelhos.conf', [
    'agente|.agents|agrupado',
    'agente|.codex|agrupado', 'formato|.codex|skills|nenhum',
    'agente|.gemini|agrupado', 'formato|.gemini|commands|arquivo',
    'fallback|.gemini|.agents|skills', 'fallback|.codex|.gemini|skills',
    'nativo|.GeMiNi/commands/demo.toml|.pbai4devs/commands/projeto/demo/COMMAND.md',
  ].join('\n') + '\n');
  mkdirSync(join(root, '.agents/skills/projeto/demo/SKILL.md'), { recursive: true });
  mkdirSync(join(root, '.gemini/skills/projeto/demo/SKILL.md'), { recursive: true });
  const skill = resourceTargets(root, '.pbai4devs/skills/projeto/demo/SKILL.md');
  assert.deepEqual(skill, ['.agents/skills/projeto/demo/SKILL.md']);
  const command = resourceTargets(root, '.pbai4devs/commands/projeto/demo/COMMAND.md', 'commands');
  assert.ok(command.includes('.codex/commands/projeto/demo/COMMAND.md'));
  assert.ok(!command.some(target => /^\.gemini\//i.test(target)));
});

test("identifies the fallback Codex only for the skill whose primary route is obstructed", t => {
  const { root, put } = fixture(t);
  put('.pbai4devs/espelhos.conf', [
    'agente|.agents|agrupado', 'agente|.codex|agrupado',
    'formato|.codex|skills|nenhum', 'fallback|.codex|.agents|skills',
  ].join('\n') + '\n');
  const blocked = '.pbai4devs/skills/projeto/demo/SKILL.md';
  const available = '.pbai4devs/skills/projeto/outra/SKILL.md';
  const target = join(root, '.agents/skills/projeto/demo/SKILL.md');
  mkdirSync(target, { recursive: true });
  assert.deepEqual(resourceTargets(root, blocked), ['.codex/skills/projeto/demo/SKILL.md']);
  assert.deepEqual(resourceTargets(root, available), ['.agents/skills/projeto/outra/SKILL.md']);
  rmSync(target, { recursive: true });
  assert.deepEqual(resourceTargets(root, blocked), ['.agents/skills/projeto/demo/SKILL.md']);
});

test("checkout without manifest uses only hub until saved selection", t => {
  const { root, put } = fixture(t);
  const manifest = join(root, '.pbai4devs/espelhos.conf');
  rmSync(manifest);
  const source = '.pbai4devs/skills/projeto/demo/SKILL.md';
  assert.deepEqual(registeredRoots(root), []);
  assert.deepEqual(resourceTargets(root, source), []);
  put('.pbai4devs/state/agentdevkit.json', '{}');
  assert.ok(registeredRoots(root).includes('.claude'), 'Estado legado sem seleção preserva all.');
  put('.pbai4devs/state/agentdevkit.json', JSON.stringify({ clients: ['claude'] }));
  assert.deepEqual(registeredRoots(root), ['.claude']);
  assert.deepEqual(resourceTargets(root, source), ['.claude/skills/demo/SKILL.md']);
  assert.equal(existsSync(manifest), false);
});

for (const selection of ['none', 'claude']) test(`maturidade verifica reparo de saída gerenciada com seleção ${selection}`, t => {
  const { root } = fixture(t);
  const sourceRoot = join(root, `source-${selection}`);
  copyAgentStructure(controlledSource(root), sourceRoot);
  const statePath = join(sourceRoot, '.pbai4devs/state/agentdevkit.json');
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, version: '0.0.35', clients: [selection], files: {}, blocks: {} }));
  const roots = registeredRoots(sourceRoot);
  assert.deepEqual(roots, selection === 'none' ? [] : ['.claude']);
  for (const client of roots) assert.equal(existsSync(join(sourceRoot, client)), false, client);
  const [example] = prepare({ sourceRoot, scenarios: [SCENARIOS[0]], initializeGit: false });
  assert.deepEqual(example.copied.roots, ['.pbai4devs', ...roots]);
  const skill = '.pbai4devs/skills/projeto/criar-skill/SKILL.md';
  const hubOnly = selection === 'none';
  const mirror = '.claude/skills/criar-skill/SKILL.md';
  assert.deepEqual(resourceTargets(example.root, skill), hubOnly ? [] : [mirror]);
  const path = hubOnly ? '.pbai4devs/catalog.json' : mirror;
  const before = readFileSync(join(example.root, path));
  const steps = [];
  const repair = verifySyncRepair(example.root, example.copied.roots, (script, args, expected, label) => {
    assert.equal(script, '.pbai4devs/scripts/sincronizar-agentes/SCRIPT.mjs');
    const result = synchronize({ root: example.root, check: args.includes('--check'), localIgnores: false, output() {} });
    assert.equal(result.exitCode, expected, label);
    steps.push([label, result.exitCode]);
    return { log: `${label}.log` };
  });
  assert.deepEqual(steps, [['sync-damage-detected', 1], ['sync-repair', 0], ['sync-repaired', 0]]);
  assert.deepEqual(repair, { kind: hubOnly ? 'catalog' : 'pointer', path, log: 'sync-repaired.log' });
  assert.deepEqual(readFileSync(join(example.root, path)), before);
  if (hubOnly) for (const client of ['.agents', '.claude', '.codex', '.gemini']) assert.equal(existsSync(join(example.root, client)), false, client);
  for (const file of ['src/cli.mjs', 'bin/agentdevkit.mjs', 'scripts/release/pipeline.mjs', 'tests/cli.test.mjs']) assert.equal(existsSync(join(example.root, file)), false, file);
});

for (const withState of [false, true]) test(`prepare preserva catálogos humanos na cópia e na origem (estado=${withState})`, t => {
  const { root } = fixture(t), sourceRoot = join(root, `source-catalog-${withState}`);
  copyAgentStructure(controlledSource(root), sourceRoot);
  // Source checkouts do not include generated manifests; provide this fixture
  // explicitly instead of depending on ignored files in the developer's tree.
  writeFileSync(join(sourceRoot, '.pbai4devs/espelhos.conf'), adapterManifest(sourceRoot, { clients: ['codex'] }));
  const state = join(sourceRoot, '.pbai4devs/state/agentdevkit.json');
  const derived = join(sourceRoot, '.pbai4devs/state/derived.json');
  rmSync(state, { force: true }); rmSync(derived, { force: true }); // Only copies created in this fixture.
  if (withState) {
    mkdirSync(dirname(state), { recursive: true });
    writeFileSync(state, JSON.stringify({ schemaVersion: 1, version: '0.0.24', language: 'pt', clients: ['codex'], files: {}, blocks: {} }) + '\n');
  }
  const originals = {};
  for (const name of ['catalog.json', 'skills.json', 'agents.json', 'rules.json']) {
    const file = join(sourceRoot, '.pbai4devs', name), content = `{ "arquivo humano": ${JSON.stringify(name)} }\n`;
    writeFileSync(file, content); originals[name] = content;
  }
  for (const path of ['.pbai4devs/.gitignore', '.codex/.gitignore']) {
    const file = join(sourceRoot, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '# BEGIN AGENT IGNORE\n# Alteração humana dentro do bloco\n!/nao-apagar/\n# END AGENT IGNORE\n');
  }
  const skill = '.pbai4devs/skills/projeto/equipe-local/SKILL.md';
  const skillFile = join(sourceRoot, skill);
  mkdirSync(dirname(skillFile), { recursive: true });
  writeFileSync(skillFile, '---\nname: equipe-local\ndescription: Conteúdo próprio.\n---\n\n# Equipe local\n');
  const sourceIgnore = readFileSync(join(sourceRoot, '.gitignore'));
  const sourceConfig = readFileSync(join(sourceRoot, '.pbai4devs/espelhos.conf'));
  const [example] = prepare({ sourceRoot, scenarios: [SCENARIOS[0]], initializeGit: false });
  assert.equal(example.copied.catalogSnapshots.length, 4);
  for (const [name, content] of Object.entries(originals)) {
    assert.equal(readFileSync(join(sourceRoot, '.pbai4devs', name), 'utf8'), content);
    assert.equal(readFileSync(join(example.root, '.agent-tests/testar-maturidade/original-catalogs', name), 'utf8'), content);
    assert.doesNotMatch(readFileSync(join(example.root, '.pbai4devs', name), 'utf8'), /arquivo humano/);
  }
  for (const path of ['.pbai4devs/.gitignore', '.codex/.gitignore']) {
    const original = readFileSync(join(sourceRoot, path));
    const saved = example.copied.overriddenSnapshots.find(item => item.source === path);
    assert.ok(saved, path);
    assert.deepEqual(readFileSync(join(example.root, saved.snapshot)), original);
    assert.match(original.toString('utf8'), /Alteração humana/);
    if (path === '.codex/.gitignore') assert.equal(existsSync(join(example.root, path)), false);
    else assert.doesNotMatch(readFileSync(join(example.root, path), 'utf8'), /Alteração humana/);
  }
  assert.equal(readFileSync(join(example.root, skill), 'utf8'), readFileSync(skillFile, 'utf8'));
  assert.deepEqual(readFileSync(join(sourceRoot, '.gitignore')), sourceIgnore);
  assert.deepEqual(readFileSync(join(sourceRoot, '.pbai4devs/espelhos.conf')), sourceConfig);
  const report = JSON.parse(readFileSync(join(dirname(example.root), 'REPORT.json'), 'utf8'));
  assert.deepEqual(report.copies[0].catalogSnapshots, example.copied.catalogSnapshots);
  assert.match(readFileSync(join(example.root, 'README.md'), 'utf8'), /não um teste no projeto original/);
  assert.equal(existsSync(state), withState);
});

test("archive overwritten files even when client is not selected", t => {
  const { root, put } = fixture(t);
  put('.pbai4devs/espelhos.conf', 'agente|.codex|plano\n');
  const files = ['.vscode/settings.json', '.github/workflows/legacy.yml'];
  for (const path of files) put(path, `Conteúdo de equipe: ${path}\r\n`);
  const [example] = prepareExamples({ sourceRoot: root, scenarios: [SCENARIOS.find(item => item.id === 'legado')], initializeGit: false });
  for (const path of files) {
    const saved = example.copied.overriddenSnapshots.filter(item => item.source === path);
    assert.equal(saved.length, 1, path);
    assert.deepEqual(readFileSync(join(example.root, saved[0].snapshot)), readFileSync(join(root, path)));
  }
});

test("Unselected client file with symbolic ancestor is refused", t => {
  const { root, put } = fixture(t);
  put('.pbai4devs/espelhos.conf', 'agente|.codex|plano\n');
  const outside = mkdtempSync(join(root, 'outside-'));
  writeFileSync(join(outside, 'settings.json'), 'Conteúdo externo.\n');
  rmSync(join(root, '.vscode'), { recursive: true });
  try { symlinkSync(outside, join(root, '.vscode'), 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Links simbólicos indisponíveis.'); return; } throw error; }
  assert.throws(() => prepareExamples({ sourceRoot: root, scenarios: [SCENARIOS.find(item => item.id === 'legado')], initializeGit: false }), /link/i);
  assert.equal(readFileSync(join(outside, 'settings.json'), 'utf8'), 'Conteúdo externo.\n');
});

test("source files replaced by fixtures have byte a byte copies", t => {
  const { root, put } = fixture(t);
  const files = ['README.md', 'Makefile', '.dockerignore', '.env.example', '.pbai4devs/state/README.md', '.pbai4devs/state/configuracao/ESTADO.md', '.vscode/settings.json', '.github/workflows/legacy.yml'];
  const contents = Object.fromEntries(files.map(file => [file, `Conteúdo humano sintético: ${file}\r\n`]));
  for (const [file, content] of Object.entries(contents)) put(file, content);
  const cases = [SCENARIOS.find(item => item.id === 'app-configurada'), SCENARIOS.find(item => item.id === 'legado')];
  const examples = prepareExamples({ sourceRoot: root, scenarios: cases, initializeGit: false });
  for (const example of examples) {
    for (const { source, snapshot } of example.copied.overriddenSnapshots) {
      assert.equal(readFileSync(join(example.root, snapshot), 'utf8'), contents[source], source);
      assert.equal(readFileSync(join(root, source), 'utf8'), contents[source], source);
    }
    for (const path of ['README.md', 'Makefile', '.pbai4devs/state/README.md', '.pbai4devs/state/configuracao/ESTADO.md']) assert.ok(example.copied.overriddenSnapshots.some(item => item.source === path), path);
    const expected = example.id === 'legado' ? ['.vscode/settings.json', '.github/workflows/legacy.yml'] : ['.dockerignore', '.env.example'];
    for (const path of expected) assert.ok(example.copied.overriddenSnapshots.some(item => item.source === path), path);
  }
});

test("output cannot override source resources or escape from test areas", t => {
  const { root, outputRoot } = fixture(t);
  const original = readFileSync(join(root, '.pbai4devs/espelhos.conf'), 'utf8');
  for (const location of ['.pbai4devs/generated', '.github', '.codex', '.agents', '.agent', '.gemini', 'examples', 'tmp', 'output']) {
    assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot: join(root, location), scenarios: [SCENARIOS[0]], initializeGit: false }), /Saída local|pasta pai/);
    assert.equal(readFileSync(join(root, '.pbai4devs/espelhos.conf'), 'utf8'), original);
    assert.equal(existsSync(join(root, location, '.maturity-suite.json')), false);
  }
  const examples = prepareExamples({ sourceRoot: root, outputRoot, scenarios: [SCENARIOS[0]], initializeGit: false });
  assert.equal(examples.length, 1);
  assert.equal(readFileSync(join(root, '.pbai4devs/espelhos.conf'), 'utf8'), original);
});

test("eight copies exercise the six levels and preserve layouts legado/monorepo", t => {
  const { root, outputRoot } = fixture(t);
  const examples = prepareExamples({ sourceRoot: root, outputRoot, initializeGit: false });
  assert.equal(examples.length, 8);
  for (const example of examples) {
    assert.doesNotMatch(readFileSync(join(example.root, 'README.md'), 'utf8'), /\n{3,}/);
    const result = spawnSync(process.execPath, ['.pbai4devs/scripts/inspecionar-projeto/SCRIPT.mjs'], { cwd: example.root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.maturity.level, example.expected, example.id);
    assert.equal(report.contract.complete, example.complete, example.id);
  }
  const legacy = examples.find(example => example.id === 'legado');
  assert.ok(existsSync(join(legacy.root, 'legacy/server.mjs')));
  assert.match(readFileSync(join(legacy.root, 'package.json'), 'utf8'), /dev:old/);
  const monorepo = examples.find(example => example.id === 'monorepo');
  assert.ok(existsSync(join(monorepo.root, 'apps/painel com espaços/package.json')));
  assert.ok(existsSync(join(monorepo.root, 'packages/cálculo/package.json')));
  assert.equal(existsSync(join(monorepo.root, 'src')), false);
});

test("configured scenarios complete missing fixtures without changing source or copied files", t => {
  const { root, put, outputRoot } = fixture(t);
  mkdirSync(outputRoot);
  const files = ['.gitignore', '.gitattributes', '.editorconfig'];
  const source = Object.fromEntries(files.map(file => [file, `# configuração própria de ${file}\n`]));
  // The two missing fonts play a distributed installation; the file
  // existing proof that the preparation does not replace copied settings.
  rmSync(join(root, '.gitattributes'));
  rmSync(join(root, '.editorconfig'));
  put('.gitignore', source['.gitignore']);
  const scenarios = SCENARIOS.filter(example => ['app-configurada', 'manutencao', 'app-inicial'].includes(example.id));
  const examples = prepareExamples({ sourceRoot: root, outputRoot: join(outputRoot, 'parcial'), scenarios, initializeGit: false });
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), source['.gitignore']);
  for (const file of ['.gitattributes', '.editorconfig']) assert.equal(existsSync(join(root, file)), false, file);
  for (const example of examples) {
    assert.equal(readFileSync(join(example.root, '.gitignore'), 'utf8'), source['.gitignore']);
    if (!example.configured) {
      for (const file of ['.gitattributes', '.editorconfig']) assert.equal(existsSync(join(example.root, file)), false, file);
      continue;
    }
    for (const file of ['.gitattributes', '.editorconfig']) assert.ok(readFileSync(join(example.root, file), 'utf8').trim(), file);
    const inspected = spawnSync(process.execPath, ['.pbai4devs/scripts/inspecionar-projeto/SCRIPT.mjs', '--check'], { cwd: example.root, encoding: 'utf8' });
    assert.ifError(inspected.error);
    assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
    assert.equal(JSON.parse(inspected.stdout).contract.complete, true, example.id);
  }
  // Retest with every file absent, as in the released npm tarball.
  rmSync(join(root, '.gitignore'));
  const configured = scenarios.find(example => example.id === 'app-configurada');
  const missing = prepareExamples({ sourceRoot: root, outputRoot: join(outputRoot, 'ausentes'), scenarios: [configured], initializeGit: false })[0];
  for (const file of files) {
    assert.equal(existsSync(join(root, file)), false, file);
    assert.ok(readFileSync(join(missing.root, file), 'utf8').trim(), file);
  }
  for (const file of files) put(file, source[file]);
  const preserved = prepareExamples({ sourceRoot: root, outputRoot: join(outputRoot, 'presentes'), scenarios: [configured], initializeGit: false })[0];
  for (const file of files) {
    assert.equal(readFileSync(join(root, file), 'utf8'), source[file]);
    assert.equal(readFileSync(join(preserved.root, file), 'utf8'), source[file]);
  }
});

test("fixtures standard, legacy and monorepo perform HTTP real and close", t => {
  const { root, outputRoot } = fixture(t);
  const scenarios = SCENARIOS.filter(example => ['app-inicial', 'legado', 'monorepo'].includes(example.id));
  const examples = prepareExamples({ sourceRoot: root, outputRoot, scenarios, initializeGit: false });
  for (const example of examples) {
    const environment = { ...process.env }; delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', ...example.application.tests], { cwd: example.root, env: environment, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /AC-001/); assert.match(result.stdout, /AC-002/);
    if (example.id === 'monorepo') assert.match(result.stdout, /AC-003/);
  }
});

test("refuses source and output links, including broken", t => {
  const { root, put, outputRoot } = fixture(t);
  const target = put('payload.txt', 'fora da cópia');
  const link = join(root, '.pbai4devs/scripts/alias.mjs');
  try { symlinkSync(target, link); }
  catch (error) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) { t.skip('Sem permissão para criar symlink de arquivo.'); return; } throw error; }
  assert.throws(() => copyAgentStructure(root, join(root, 'copy')), /recusa links/);
  rmSync(link); symlinkSync(join(root, 'missing.mjs'), link);
  assert.throws(() => copyAgentStructure(root, join(root, 'copy')), /recusa links/);
  rmSync(link);
  mkdirSync(dirname(outputRoot), { recursive: true });
  symlinkSync(join(root, 'missing-output'), outputRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepareExamples({ sourceRoot: root, outputRoot, scenarios: [SCENARIOS[0]], initializeGit: false }), /não pode ser link/);
});

test("two project generator uses local package offline and keeps out of Git", { timeout: 240000 }, t => {
  const runner = join(projectRoot, 'tests/example-workflows.mjs'), packageFile = join(projectRoot, 'package.json');
  if (!existsSync(runner) || !existsSync(packageFile)) { t.skip('Runner de desenvolvimento não é distribuído no pacote.'); return; }
  const npm = findNpmCli(); assert.ok(npm, 'npm CLI é necessário.');
  const { outputs, space } = fixture(t), tarDir = join(space, 'package'), target = join(outputs, 'workflows'); mkdirSync(tarDir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_|^git_|^node_options$|^node_test_context$/i.test(key)));
  Object.assign(env, isolatedGitSettings);
  const userConfig = join(space, 'npmrc-user'), globalConfig = join(space, 'npmrc-global'); writeFileSync(userConfig, ''); writeFileSync(globalConfig, '');
  Object.assign(env, { npm_config_cache: join(space, 'npm-cache'), npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' });
  const packed = spawnSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', tarDir], { cwd: projectRoot, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(packed.error); assert.equal(packed.status, 0, packed.stderr); const tar = join(tarDir, JSON.parse(packed.stdout)[0].filename);
  const version = JSON.parse(readFileSync(packageFile, 'utf8')).version;
  const external = join(space, 'workflow-external');
  let externalGit = spawnSync('git', ['init', '--quiet', '--template=', external], { env, encoding: 'utf8' }); assert.equal(externalGit.status, 0, externalGit.stderr);
  writeFileSync(join(external, 'human.txt'), 'staged\n');
  externalGit = spawnSync('git', ['-C', external, 'add', '--', 'human.txt'], { env, encoding: 'utf8' }); assert.equal(externalGit.status, 0, externalGit.stderr);
  const externalDir = join(external, '.git'), externalBefore = gitFixtureSnapshot(externalDir);
  const contaminatedEnv = { ...env, GIT_DIR: externalDir, GIT_WORK_TREE: external, GIT_INDEX_FILE: join(externalDir, 'index') };
  const r = spawnSync(process.execPath, [runner, version, '--tarball', tar, '--output', target], { cwd: projectRoot, env: contaminatedEnv, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(r.error); assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  assert.deepEqual(gitFixtureSnapshot(externalDir), externalBefore, 'Runner alterou Git externo.');
  const report = JSON.parse(readFileSync(join(target, 'REPORT.json'), 'utf8'));
  assert.equal(report.status, 'passed'); assert.equal(report.examples.length, 2);
  for (const example of report.examples) {
    assert.equal(example.stages.length, 3); assert.ok(example.stages.every(stage => stage.status === 'passed'));
    assert.ok(lstatSync(join(example.directory, '.git')).isDirectory(), 'Repositório local do exemplo ausente.');
    const probeLocal = spawnSync('git', ['-C', example.directory, 'rev-parse', '--show-toplevel'], { env, encoding: 'utf8' });
    assert.equal(probeLocal.status, 0, probeLocal.stderr); assert.equal(realpathSync(probeLocal.stdout.trim()), realpathSync(example.directory));
  }
  const probe = spawnSync('git', ['-C', target, 'rev-parse', '--git-dir'], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' });
  assert.equal(probe.status, 128); assert.match(probe.stderr, /not a git repository/i);
  const previousReport = readFileSync(join(target, 'REPORT.json')), mismatch = join(outputs, 'mismatch');
  const wrongVersion = version === '0.0.0' ? '0.0.1' : '0.0.0';
  const bad = spawnSync(process.execPath, [runner, wrongVersion, '--tarball', tar, '--output', mismatch], { cwd: projectRoot, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(bad.error); assert.notEqual(bad.status, 0); assert.match(bad.stderr, /versão do pacote/i);
  assert.deepEqual(readFileSync(join(target, 'REPORT.json')), previousReport);
  assert.equal(JSON.parse(readFileSync(join(mismatch, 'REPORT.json'), 'utf8')).status, 'failed');
});
