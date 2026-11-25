import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SecurityAudit, mayAliasIndexPath, parseArgs, parseGitleaks, parseOsv, parseOpengrep, sanitizedEnvironment, safePath, snapshotSources, verifyDatabase } from '../SCRIPT.mjs';
import { zipFixture } from './zip-fixture.mjs';
import { validateOsvDatabase } from '../database-zip.mjs';

const write = (path, text) => { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, text); };
// Tests create their own repositories and must not inherit an alternate index,
// worktree, configuration, or global fsmonitor from the invoking process.
for (const key of Object.keys(process.env)) if (/^GIT_/i.test(key)) delete process.env[key];
process.env.GIT_CONFIG_GLOBAL = devNull;
process.env.GIT_CONFIG_NOSYSTEM = '1';
function fixtureGit(args, { allowFsmonitor = false } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, { GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' });
  return spawnSync('git', [...(allowFsmonitor ? [] : ['-c', 'core.fsmonitor=false']), ...args], { env });
}
const toolPath = args => args[0].replaceAll('\\', '/');
const advisory = (id = 'TEST-1', extra = {}) => JSON.stringify({ id, modified: '2026-01-01T00:00:00Z', affected: [], ...extra });
const validZip = () => zipFixture({ 'TEST-1.json': advisory() });
function fixture(t, { trailingSpace = false } = {}) {
  const temporary = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'pbai-security-')));
  const root = trailingSpace ? join(temporary, 'repo ') : temporary;
  if (trailingSpace) fs.mkdirSync(root);
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  assert.equal(fixtureGit(['init', '--quiet', '--template=', root]).status, 0);
  write(join(root, '.git/info/exclude'), '# fixture local\n');
  write(join(root, '.gitignore'), '/.agent-tests/\n');
  write(join(root, 'app/index.js'), 'export const answer = 42;\n');
  write(join(root, '.pbai4devs/scripts/auditar-seguranca/rules/javascript.yml'), 'rules: []\n');
  for (const name of ['gitleaks', 'osv-scanner', 'opengrep']) write(join(root, `.pbai4devs/tools/${name}/SCRIPT.mjs`), '// fixture\n');
  const manager = { root, check: () => ({ version: '1.0.0' }), entry: () => ({ envPaths: { OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: 'data/osv' } }), local: () => join(root, '.pbai4devs/tools/osv-scanner/.local'), withLock: (_name, action) => action() };
  const calls = [];
  const execute = (_node, args, options) => {
    calls.push({ args, options });
    const payload = toolPath(args).includes('/gitleaks/') ? [] : toolPath(args).includes('/osv-scanner/') ? { results: [] }
      : { results: [], errors: [], paths: { scanned: [join(options.cwd, 'source/index.js')] } };
    const output = args.find(arg => arg.startsWith('--report-path=') || arg.startsWith('--output-file='));
    if (output) fs.writeFileSync(output.slice(output.indexOf('=') + 1), JSON.stringify(payload));
    return { status: 0, stdout: JSON.stringify(payload), stderr: '' };
  };
  return { root, manager, calls, execute, audit: new SecurityAudit({ root, manager, execute }) };
}

test('argumentos limitam checks, destinos e operacoes', () => {
  assert.equal(parseArgs([]).command, 'help');
  assert.deepEqual(parseArgs(['run', '--checks', 'sast,secrets,secrets']).checks, ['sast', 'secrets']);
  assert.deepEqual(parseArgs(['update-data', '--ecosystems', 'NPM,go']).ecosystems, ['npm', 'Go']);
  for (const args of [['scan'], ['run', '--checks', 'cloud'], ['run', '--checks', ''], ['check', '--target', '.'], ['run', '--ecosystems', 'npm'], ['update-data'], ['update-data', '--ecosystems', '../../etc'], ['run', '--target', '.', '--target', '.'], ['run', '--checks', 'sast', '--include-history']]) assert.throws(() => parseArgs(args));
});

test('ambiente nao encaminha tokens, proxies, Node options ou configuracoes externas', () => {
  const env = sanitizedEnvironment({ PATH: '/bin', HOME: '/home/person', SystemRoot: 'C:\\Windows', AWS_ACCESS_KEY_ID: 'secret', GOOGLE_APPLICATION_CREDENTIALS: 'secret', SECRET: 'secret', NPM_TOKEN: 'secret', NODE_OPTIONS: '--require malicious', HTTPS_PROXY: 'secret', SEMGREP_RULES: 'https://remote', GITLEAKS_CONFIG: 'secret' });
  assert.equal(env.PATH, '/bin'); assert.equal(env.HOME, '/home/person'); assert.equal(env.SystemRoot, 'C:\\Windows');
  assert.ok(!JSON.stringify(env).includes('secret')); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.SEMGREP_RULES, undefined);
  assert.equal(env.OPENGREP_ENABLE_VERSION_CHECK, '0');
  assert.equal(env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(env.GIT_CONFIG_KEY_0, 'core.fsmonitor');
  assert.equal(env.GIT_CONFIG_VALUE_0, 'false');
});

test("Git queries do not perform fsmonitor nor modify index or configuration", async t => {
  const f = fixture(t), marker = join(f.root, 'fsmonitor-marker'), hook = join(f.root, 'fsmonitor-hook.sh');
  assert.equal(fixtureGit(['-C', f.root, 'add', 'app/index.js']).status, 0);
  // Git for Windows executes configured shell hooks through its bundled shell.
  write(hook, '#!/bin/sh\nprintf called >> "$AUDIT_FSMONITOR_MARKER"\nprintf "\\0"\n');
  fs.chmodSync(hook, 0o700);
  assert.equal(fixtureGit(['-C', f.root, 'config', 'core.fsmonitor', hook]).status, 0);
  const files = ['.git/index', '.git/config', '.git/info/exclude'];
  const previous = process.env.AUDIT_FSMONITOR_MARKER;
  process.env.AUDIT_FSMONITOR_MARKER = marker;
  try {
    // Prove the sentinel would run without the audit's fsmonitor override.
    assert.equal(fixtureGit(['-C', f.root, 'ls-files'], { allowFsmonitor: true }).status, 0);
    assert.equal(fs.existsSync(marker), true);
    fs.unlinkSync(marker);
    const before = files.map(path => fs.readFileSync(join(f.root, path)));
    const result = await f.audit.run({ checks: ['secrets'], includeHistory: true });
    assert.equal(result.status, 'passed');
    assert.equal(fs.existsSync(marker), false);
    files.forEach((path, index) => assert.deepEqual(fs.readFileSync(join(f.root, path)), before[index], path));
    assert.ok(f.calls.every(call => call.options.env.GIT_CONFIG_VALUE_0 === 'false' && call.options.env.GIT_OPTIONAL_LOCKS === '0'));
  } finally {
    if (previous === undefined) delete process.env.AUDIT_FSMONITOR_MARKER;
    else process.env.AUDIT_FSMONITOR_MARKER = previous;
  }
});

test('auditoria recusa repositorio ou indice Git redirecionado sem gravar evidencias', async t => {
  const f = fixture(t), other = fixture(t);
  assert.equal(fixtureGit(['-C', other.root, 'add', 'app/index.js']).status, 0);
  const paths = ['.git/index', '.git/config', '.git/info/exclude'];
  const before = paths.map(path => fs.readFileSync(join(other.root, path)));
  // Lowercase names exercise the same safety boundary used on Windows.
  for (const name of ['GIT_DIR', 'git_index_file', 'GIT_WORK_TREE', 'git_common_dir']) {
    const previous = process.env[name];
    process.env[name] = name.toUpperCase() === 'GIT_INDEX_FILE' ? join(other.root, '.git/index') : name.toUpperCase() === 'GIT_WORK_TREE' ? other.root : join(other.root, '.git');
    try {
      await assert.rejects(f.audit.run({ checks: ['secrets'] }), /Ambiente Git redirecionado/);
      assert.equal(fs.existsSync(join(f.root, '.agent-tests')), false);
      paths.forEach((path, index) => assert.deepEqual(fs.readFileSync(join(other.root, path)), before[index], path));
    } finally {
      if (previous === undefined) delete process.env[name]; else process.env[name] = previous;
    }
  }
});

test('consulta de ignore respeita configuracao Git efetiva do ambiente', async t => {
  const f = fixture(t), global = join(f.root, 'global.gitconfig'), excludes = join(f.root, 'global-ignore');
  write(join(f.root, '.gitignore'), '# sem regra local\n');
  write(excludes, '/.agent-tests/\n');
  write(global, `[core]\n\texcludesFile = ${excludes.replaceAll('\\', '/')}\n`);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = global;
  try {
    const result = await f.audit.run({ target: 'app', checks: ['secrets'] });
    assert.equal(result.status, 'passed');
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = previous;
  }
});

test('indice Git ilegivel nao autoriza gravar evidencias', async t => {
  const f = fixture(t), index = join(f.root, '.git/index');
  fs.writeFileSync(index, 'indice invalido');
  const before = fs.readFileSync(index);
  await assert.rejects(f.audit.run({ target: 'app', checks: ['secrets'] }), /ignorado e fora do indice Git/);
  assert.deepEqual(fs.readFileSync(index), before);
  assert.equal(fs.existsSync(join(f.root, '.agent-tests')), false);
});

test('auditoria aceita raiz Git com espaco final inclusive para historico', { skip: process.platform === 'win32' && 'O teste exige um diretório Git com espaço final, incompatível com caminhos convencionais do Windows.' }, async t => {
  const f = fixture(t, { trailingSpace: true });
  const result = await f.audit.run({ checks: ['secrets'], includeHistory: true });
  assert.equal(result.status, 'passed');
  assert.ok(fs.existsSync(join(f.root, result.report)));
});

test("audit comparison considers Windows short names without til and distinguishes real entries", t => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'audit-short-name-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const staged = '.agent-tests/security/ALT/human', output = '.agent-tests/security/long-directory/report.json';
  fs.mkdirSync(join(root, '.agent-tests', 'security'), { recursive: true });
  assert.equal(mayAliasIndexPath(staged, output, { root, platform: 'win32' }), true);
  assert.equal(mayAliasIndexPath(staged, output, { root, platform: 'linux' }), false);
  fs.mkdirSync(join(root, '.agent-tests', 'security', 'long-directory'));
  assert.equal(mayAliasIndexPath(staged, output, { root, platform: 'win32' }), false);
  fs.mkdirSync(join(root, '.agent-tests', 'security', 'ALT'));
  assert.equal(mayAliasIndexPath(staged, output, { root, platform: 'win32' }), false);
  assert.equal(mayAliasIndexPath('.agent-tests/security/LONGDI~1/human', output, { root, platform: 'win32' }), fs.existsSync(join(root, '.agent-tests', 'security', 'LONGDI~1')));
});

test("Simulated Windows audit accepts absent exit ancestor and src staged existing", async t => {
  const f = fixture(t);
  write(join(f.root, 'src/file.js'), 'humano\n');
  assert.equal(fixtureGit(['-C', f.root, 'add', '--', 'src/file.js']).status, 0);
  const index = fs.readFileSync(join(f.root, '.git/index')), descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    assert.equal(mayAliasIndexPath('src/file.js', '.agent-tests/security/run/report.json', { root: f.root }), false);
    assert.equal(mayAliasIndexPath('ALT/file.js', '.agent-tests/security/run/report.json', { root: f.root }), true);
    const result = await f.audit.run({ checks: ['secrets'] });
    assert.equal(result.status, 'passed');
    assert.equal(fs.existsSync(join(f.root, result.report)), true);
  } finally { Object.defineProperty(process, 'platform', descriptor); }
  assert.equal(fs.readFileSync(join(f.root, 'src/file.js'), 'utf8'), 'humano\n');
  assert.deepEqual(fs.readFileSync(join(f.root, '.git/index')), index);
});

test("Native or simulated Windows refusal short name staged absent before recording evidence", async t => {
  const f = fixture(t), staged = '.agent-tests/security/ALT/human', output = '.agent-tests/security/long-directory/report.json';
  const object = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', f.root, 'hash-object', '-w', '--stdin'], { input: 'humano', encoding: 'utf8' });
  assert.equal(object.status, 0, object.stderr);
  const add = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', f.root, 'update-index', '--index-info'], { input: `100644 ${object.stdout.trim()}\t${staged}\n`, encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
  const index = fs.readFileSync(join(f.root, '.git/index'));
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  try { Object.defineProperty(process, 'platform', { value: 'win32' }); await assert.rejects(f.audit.run({ checks: ['secrets'], output }), /ignorado e fora do indice Git/); }
  finally { Object.defineProperty(process, 'platform', descriptor); }
  assert.equal(fs.existsSync(join(f.root, '.agent-tests')), false);
  assert.deepEqual(fs.readFileSync(join(f.root, '.git/index')), index);
});

test('auditoria recusa nome de evidencia ou ancestral presente no indice Git', async t => {
  for (const [staged, output] of [
    ['.agent-tests/security', '.agent-tests/security/report.json'],
    ['.agent-tests/security/a.json', '.agent-tests/security/A.json'],
    ['.agent-tests/security/e\u0301.json', '.agent-tests/security/é.json'],
    ['.agent-tests/security/SS.json', '.agent-tests/security/ß.json'],
    ['.agent-tests/security/s.json', '.agent-tests/security/ſ.json'],
    ['.agent-tests/security/ff.json', '.agent-tests/security/ﬀ.json'],
  ]) {
    const f = fixture(t);
    write(join(f.root, staged), 'conteudo humano preparado');
    assert.equal(fixtureGit(['-C', f.root, 'add', '-f', '--', staged]).status, 0);
    fs.unlinkSync(join(f.root, staged));
    const index = fs.readFileSync(join(f.root, '.git/index'));
    await assert.rejects(f.audit.run({ checks: ['secrets'], output }), /ignorado e fora do indice Git/);
    assert.deepEqual(fs.readFileSync(join(f.root, '.git/index')), index, staged);
    assert.equal(fs.existsSync(join(f.root, output)), false);
    if (staged === '.agent-tests/security') assert.equal(fs.existsSync(join(f.root, '.agent-tests/security')), false);
  }
});

test("name staged ancestral to subproject is not occupied by audit", async t => {
  const f = fixture(t), project = join(f.root, 'subprojeto');
  write(project, 'arquivo humano preparado');
  assert.equal(fixtureGit(['-C', f.root, 'add', '--', 'subprojeto']).status, 0);
  fs.unlinkSync(project); fs.mkdirSync(project);
  write(join(f.root, '.gitignore'), '/subprojeto/.agent-tests/\n');
  const before = fs.readFileSync(join(f.root, '.git/index'));
  const audit = new SecurityAudit({ root: project, manager: f.manager, execute: f.execute });
  await assert.rejects(audit.run({ checks: ['secrets'] }), /ignorado e fora do indice Git/);
  assert.equal(fs.existsSync(join(project, '.agent-tests')), false);
  assert.deepEqual(fs.readFileSync(join(f.root, '.git/index')), before);
});

test('nao cria snapshots se so o relatorio final estiver ignorado', async t => {
  const f = fixture(t);
  write(join(f.root, '.gitignore'), '/.agent-tests/security/done/report.json\n');
  await assert.rejects(f.audit.run({ checks: ['secrets'], output: '.agent-tests/security/done/report.json' }), /ignorado e fora do indice Git/);
  assert.equal(fs.existsSync(join(f.root, '.agent-tests')), false);
  assert.equal(f.calls.length, 0);
});

test("does not remove directory replaced by human content during audit", async t => {
  const f = fixture(t); let sentinel, original;
  f.audit.execute = (_node, _args, options) => {
    original = `${options.cwd}.moved`;
    fs.renameSync(options.cwd, original);
    fs.mkdirSync(options.cwd);
    sentinel = join(options.cwd, 'sentinel-human.txt');
    write(sentinel, 'conteudo humano');
    return { status: 1, stdout: '', stderr: '' };
  };
  await assert.rejects(f.audit.run({ target: 'app', checks: ['secrets'] }), /Pasta temporaria da auditoria foi alterada/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'conteudo humano');
  assert.ok(fs.existsSync(original));
});

test("paths refuse escapes, links and output tracked before running", async t => {
  const f = fixture(t); const outside = fs.mkdtempSync(join(tmpdir(), 'pbai-outside-')); t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, join(f.root, 'link'), process.platform === 'win32' ? 'junction' : undefined);
  assert.throws(() => safePath(f.root, '../outside')); assert.throws(() => safePath(f.root, 'link/file.json'));
  await assert.rejects(f.audit.run({ target: 'app', checks: ['secrets'], output: 'report.json' }));
  fs.mkdirSync(join(f.root, '.agent-tests/security'), { recursive: true });
  await assert.rejects(f.audit.run({ target: '.agent-tests', checks: ['secrets'] }), /conflita/);
  await assert.rejects(f.audit.run({ target: '.agent-tests/security', checks: ['secrets'] }), /conflita/);
  write(join(f.root, '.agent-tests/tracked.json'), '{}');
  assert.equal(fixtureGit(['-C', f.root, 'add', '-f', '.agent-tests/tracked.json']).status, 0);
  await assert.rejects(f.audit.run({ target: 'app', checks: ['secrets'], output: '.agent-tests/tracked.json' }));
  assert.equal(f.calls.length, 0);
});

test("snapshot preserves originals and does not cross links or generated directories", t => {
  const f = fixture(t); write(join(f.root, 'app/node_modules/excluded.js'), 'secret'); write(join(f.root, 'app/.semgrepignore'), '*');
  fs.symlinkSync(join(f.root, 'app'), join(f.root, 'app/link'), process.platform === 'win32' ? 'junction' : 'dir');
  const destination = join(f.root, '.agent-tests/snapshot'); fs.mkdirSync(destination, { recursive: true });
  const data = snapshotSources(f.root, join(f.root, 'app'), destination);
  assert.deepEqual(data.files.map(file => file.path), ['index.js']);
  assert.equal(data.excluded.length, 3); assert.equal(fs.readFileSync(join(f.root, 'app/index.js'), 'utf8'), fs.readFileSync(join(destination, 'index.js'), 'utf8'));
  assert.throws(() => snapshotSources(f.root, join(f.root, 'app'), destination, { maxFileBytes: 1 }));
});

test("generated examples are only excluded when ignored and out of index", t => {
  const f = fixture(t), examples = join(f.root, 'examples');
  write(join(examples, '.gitignore'), '/generated/\n');
  write(join(examples, 'generated', 'fixture.js'), 'const example = true;\n');
  assert.equal(fixtureGit(['-C', f.root, 'add', 'examples/.gitignore']).status, 0);
  const omitted = snapshotSources(f.root, examples, null, { maxFiles: 1 });
  assert.deepEqual(omitted.files.map(item => item.path), ['.gitignore']);
  assert.ok(omitted.excluded.some(item => item.path === 'generated' && item.reason === 'ignored-generated-examples'));
  const explicit = snapshotSources(f.root, join(examples, 'generated'), null);
  assert.deepEqual(explicit.files.map(item => item.path), ['fixture.js']);
  assert.equal(fixtureGit(['-C', f.root, 'add', '-f', 'examples/generated/fixture.js']).status, 0);
  const tracked = snapshotSources(f.root, examples, null);
  assert.ok(tracked.files.some(item => item.path === 'generated/fixture.js'));
  assert.ok(!tracked.excluded.some(item => item.reason === 'ignored-generated-examples'));
  const other = fixture(t);
  write(join(other.root, 'examples/generated/fixture.js'), 'const example = true;\n');
  const visible = snapshotSources(other.root, join(other.root, 'examples'), null);
  assert.ok(visible.files.some(item => item.path === 'generated/fixture.js'));
  const damaged = fixture(t);
  write(join(damaged.root, 'examples/.gitignore'), '/generated/\n');
  write(join(damaged.root, 'examples/generated/fixture.js'), 'const example = true;\n');
  assert.equal(fixtureGit(['-C', damaged.root, 'add', 'examples/.gitignore']).status, 0);
  fs.writeFileSync(join(damaged.root, '.git/index'), 'índice inválido');
  const unverified = snapshotSources(damaged.root, join(damaged.root, 'examples'), null);
  assert.ok(unverified.files.some(item => item.path === 'generated/fixture.js'));
  assert.ok(!unverified.excluded.some(item => item.reason === 'ignored-generated-examples'));
});

test("global ignores, unversioned location and rule file do not hide audit examples", t => {
  const f = fixture(t), examples = join(f.root, 'examples');
  write(join(examples, 'generated', 'fixture.js'), 'const example = true;\n');
  const includes = () => snapshotSources(f.root, examples, null).files.some(item => item.path === 'generated/fixture.js');
  const global = join(f.root, 'global.gitconfig'), excludes = join(f.root, 'global-ignore');
  write(excludes, 'generated/\n');
  assert.equal(fixtureGit(['config', '--file', global, 'core.excludesFile', excludes]).status, 0);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = global;
  try { assert.equal(includes(), true, 'ignore global não deve ocultar conteúdo'); }
  finally { if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = previous; }
  write(join(f.root, '.git/info/exclude'), 'generated/\n');
  assert.equal(includes(), true, 'info/exclude não deve ocultar conteúdo');
  write(join(f.root, '.git/info/exclude'), '');
  write(join(examples, '.gitignore'), '/generated/\n');
  assert.equal(includes(), true, 'regra não versionada não deve ocultar conteúdo');
  write(join(examples, '.gitignore'), '# regra versionada anterior\n');
  assert.equal(fixtureGit(['-C', f.root, 'add', 'examples/.gitignore']).status, 0);
  write(join(examples, '.gitignore'), '/generated/\n');
  assert.equal(includes(), true, 'regra alterada fora do índice não deve ocultar conteúdo');
  assert.equal(fixtureGit(['-C', f.root, 'add', 'examples/.gitignore']).status, 0);
  assert.equal(includes(), false, 'regra no índice e working tree pode excluir exemplos ignorados');
});

test('parsers redigem segredos e recusam saidas invalidas ou falsas aprovacoes', () => {
  const secret = 'a-secret-value-that-must-not-escape';
  const gitleaks = parseGitleaks([{ RuleID: 'key', File: 'a.js', StartLine: 3, Secret: secret, Match: secret, Line: secret, Description: secret }], 1, '/tmp');
  assert.equal(gitleaks.status, 'findings'); assert.ok(!JSON.stringify(gitleaks).includes(secret));
  assert.throws(() => parseGitleaks([], 1, '/tmp')); assert.throws(() => parseGitleaks([], 2, '/tmp')); assert.throws(() => parseGitleaks([{ RuleID: 'x', File: '../escape' }], 1, '/tmp'));
  assert.throws(() => parseGitleaks([{ RuleID: 'x', File: 'src/../../escape' }], 1, '/tmp'));
  assert.equal(parseOsv({ results: [] }, 128, '/tmp').status, 'not-applicable'); assert.throws(() => parseOsv({ results: [] }, 127, '/tmp')); assert.throws(() => parseOsv({ results: [] }, 1, '/tmp'));
  const osv = parseOsv({ results: [{ source: { path: 'package-lock.json' }, packages: [{ package: { name: 'demo', version: '1.0.0', ecosystem: 'npm' }, vulnerabilities: [{ id: 'TEST-1', details: secret }] }] }] }, 1, '/tmp');
  assert.equal(osv.findings.length, 1); assert.ok(!JSON.stringify(osv).includes(secret));
  const sast = parseOpengrep({ results: [{ check_id: 'pbai-eval-input', path: 'a.js', start: { line: 2 }, extra: { lines: secret, message: secret } }], errors: [], paths: { scanned: ['a.js'] } }, 1, '/tmp');
  assert.equal(sast.findings.length, 1); assert.ok(!JSON.stringify(sast).includes(secret));
  assert.throws(() => parseOpengrep({ results: [], errors: [{}], paths: { scanned: [] } }, 0, '/tmp'));
  assert.throws(() => parseOpengrep({ results: [], errors: [] }, 0, '/tmp'));
});

test("Opengrep uses stable IDs and fingerprints without Linux, Windows or macOS paths", () => {
  const rules = ['pbai-eval-input', 'pbai-shell-input', 'pbai-sql-input', 'pbai-tls-verification-disabled'];
  const prefixes = ['', 'home.runner.work.AgentDevKit.AgentDevKit..agent-tests.security-smoke.run-eu1Fdm..pbai4devs.scripts.auditar-seguranca.rules.',
    'D.a.AgentDevKit.AgentDevKit..agent-tests.security-smoke.run-TpubGc..pbai4devs.scripts.auditar-seguranca.rules.',
    'Users.person.Library.Project..agent-tests.security-smoke.run-macABC..pbai4devs.scripts.auditar-seguranca.rules.'];
  const reports = prefixes.map(prefix => parseOpengrep({
    results: rules.map((rule, index) => ({ check_id: `${prefix}${rule}`, path: 'src/handler.js', start: { line: index + 1 }, extra: { severity: 'ERROR' } })),
    errors: [], paths: { scanned: ['src/handler.js'] },
  }, 1, '/unused'));
  for (const report of reports) {
    assert.deepEqual(report, reports[0]);
    assert.deepEqual(report.findings.map(item => item.rule), rules);
    assert.equal(new Set(report.findings.map(item => item.fingerprint)).size, rules.length);
    assert.doesNotMatch(JSON.stringify(report), /runner|person|run-eu1Fdm|run-TpubGc|run-macABC|AgentDevKit|pbai4devs|D\.a\./);
  }
});

test("Opengrep rejects unknown and similar rules without disclosing the gross ID", () => {
  const unknown = ['unknown', 'pbai-eval-input-extra', 'prefix.pbai-eval-input.extra', 'prefix.pbai-unknown', '/private/person/pbai-eval-input', ''];
  for (const check_id of unknown) {
    assert.throws(() => parseOpengrep({ results: [{ check_id, path: 'src/handler.js', start: { line: 1 } }], errors: [], paths: { scanned: ['src/handler.js'] } }, 1, '/unused'),
      error => error.message === 'Identificador de regra Opengrep desconhecido.' && error.publicMessage === error.message);
  }
});

test("Unknown Opengrep rule makes audit incomplete without leaking local path", async t => {
  const f = fixture(t), check_id = 'Users.private-person.project.run-private.rules.unrecognized';
  f.audit.execute = () => ({ status: 1, stdout: JSON.stringify({ results: [{ check_id, path: 'index.js', start: { line: 1 } }], errors: [], paths: { scanned: ['index.js'] } }), stderr: '' });
  const report = await f.audit.run({ target: 'app', checks: ['sast'] });
  assert.equal(report.status, 'incomplete'); assert.equal(report.exitCode, 2);
  assert.deepEqual(report.findings, []); assert.equal(report.checks[0].status, 'not-run');
  assert.doesNotMatch(JSON.stringify(report), /private-person|run-private|unrecognized/);
});

test('run usa argumentos locais e fecha incompleto quando ferramenta ou DB falta', async t => {
  const f = fixture(t);
  const result = await f.audit.run({ target: 'app', checks: ['secrets', 'sast'] });
  assert.equal(result.status, 'passed'); assert.equal(result.exitCode, 0);
  assert.ok(f.calls.every(call => call.options.shell === false && call.options.timeout > 0));
  assert.ok(f.calls.some(call => call.args.includes('--disable-version-check') && call.args.includes('--no-git-ignore')));
  assert.ok(f.calls.some(call => call.args.includes('--redact=100')));
  assert.ok(!f.calls.some(call => call.args.some(arg => /metrics|https:\/\/|--autofix/.test(arg))));
  assert.ok(fs.existsSync(join(f.root, result.report))); assert.ok(!fs.readdirSync(join(f.root, '.agent-tests/security')).some(name => name.startsWith('.work-')));
  write(join(f.root, 'app/package-lock.json'), '{}');
  const missingDb = await f.audit.run({ target: 'app', checks: ['dependencies'] });
  assert.equal(missingDb.status, 'incomplete'); assert.equal(missingDb.exitCode, 2);
  f.manager.check = () => { throw Error('Missing TOKEN=secret'); };
  const missingTool = await f.audit.run({ target: 'app', checks: ['secrets'] });
  assert.equal(missingTool.status, 'incomplete'); assert.ok(!JSON.stringify(missingTool).includes('TOKEN'));
});

test('alteracao da fonte durante a ferramenta invalida o resultado', async t => {
  const f = fixture(t), execute = f.execute;
  f.audit.execute = (...args) => { const result = execute(...args); write(join(f.root, 'app/index.js'), 'changed'); return result; };
  const result = await f.audit.run({ target: 'app', checks: ['secrets'] });
  assert.equal(result.status, 'incomplete'); assert.equal(result.exitCode, 2);
});

test("broken tool exit does not become clean report", async t => {
  const f = fixture(t); f.audit.execute = () => ({ status: 2, stdout: 'secret', stderr: 'secret' });
  const result = await f.audit.run({ target: 'app', checks: ['sast'] });
  assert.equal(result.exitCode, 2); assert.ok(!JSON.stringify(result).includes('secret'));
});

test('bases OSV atualizam explicitamente, validam hash e preservam anterior em falha', async t => {
  const f = fixture(t); const zip = validZip(); let calls = 0;
  f.audit.fetcher = async (url, options) => { calls++; assert.equal(url, 'https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.deepEqual(Object.keys(options.headers), ['Accept']); return new Response(zip); };
  assert.equal((await f.audit.updateData(['npm'])).status, 'passed');
  const cache = join(f.manager.local(), 'data/osv'); const before = verifyDatabase(f.root, cache, 'npm'); assert.equal(calls, 1);
  f.audit.fetcher = async () => new Response('broken'); await assert.rejects(f.audit.updateData(['npm']));
  assert.deepEqual(verifyDatabase(f.root, cache, 'npm'), before);
  const fake = Buffer.alloc(22); fake.writeUInt32LE(0x04034b50); fake.writeUInt32LE(0x06054b50, 4);
  f.audit.fetcher = async () => new Response(fake); await assert.rejects(f.audit.updateData(['npm']));
  assert.deepEqual(verifyDatabase(f.root, cache, 'npm'), before);
  f.audit.fetcher = async () => new Response(zipFixture({ 'TEST-1.json': '{}' })); await assert.rejects(f.audit.updateData(['npm']));
  assert.deepEqual(verifyDatabase(f.root, cache, 'npm'), before);
  fs.appendFileSync(join(cache, 'osv-scalibr/npm/all.zip'), 'tampered'); assert.throws(() => verifyDatabase(f.root, cache, 'npm'));
});

test('query check nao escreve relatorios nem instala ferramentas', t => {
  const f = fixture(t); const before = fs.readdirSync(f.root);
  const result = f.audit.check(['secrets', 'sast']); assert.equal(result.exitCode, 0); assert.deepEqual(fs.readdirSync(f.root), before); assert.equal(f.calls.length, 0);
});

test('historico nunca amplia silenciosamente um target de subpasta', async t => {
  const f = fixture(t);
  await assert.rejects(f.audit.run({ target: 'app', checks: ['secrets'], includeHistory: true }), /raiz do repositorio/);
  assert.equal(f.calls.length, 0);
});

test('bundles de texto continuam incluidos no snapshot de segredos', t => {
  const f = fixture(t); write(join(f.root, 'app/dist/app.js'), 'bundle'); write(join(f.root, 'app/build/server.js'), 'server');
  const destination = join(f.root, '.agent-tests/snapshot'); fs.mkdirSync(destination, { recursive: true });
  const data = snapshotSources(f.root, join(f.root, 'app'), destination);
  assert.ok(data.files.some(file => file.path === 'dist/app.js')); assert.ok(data.files.some(file => file.path === 'build/server.js'));
});

test('OSV recebe modo offline estrito e erro de outro scanner prevalece sobre achados', async t => {
  const f = fixture(t); const zip = validZip(); f.audit.fetcher = async () => new Response(zip); await f.audit.updateData(['npm']);
  write(join(f.root, 'app/package-lock.json'), '{}');
  const execute = f.execute;
  f.audit.execute = (node, args, options) => {
    if (toolPath(args).includes('/osv-scanner/')) {
      assert.ok(args.includes('--offline')); assert.ok(args.includes('--no-resolve')); assert.ok(args.includes('--all-packages'));
      assert.ok(!args.some(arg => arg.includes('call-analysis') || arg.includes('licenses')));
    }
    return execute(node, args, options);
  };
  const result = await f.audit.run({ target: 'app', checks: ['dependencies'] }); assert.equal(result.status, 'not-applicable');
  f.audit.execute = (_node, args) => {
    if (toolPath(args).includes('/gitleaks/')) { const output = args.find(arg => arg.startsWith('--report-path=')); fs.writeFileSync(output.slice(output.indexOf('=') + 1), JSON.stringify([{ RuleID: 'key', File: 'index.js', StartLine: 1 }])); return { status: 1, stdout: '', stderr: '' }; }
    return { status: 2, stdout: '{}', stderr: 'failure' };
  };
  const mixed = await f.audit.run({ target: 'app', checks: ['secrets', 'sast'] }); assert.equal(mixed.exitCode, 2); assert.equal(mixed.findings.length, 1);
});

test("OSV without packages uses 128 explicit; error without JSON remains incomplete", async t => {
  const f = fixture(t); const zip = validZip(); f.audit.fetcher = async () => new Response(zip); await f.audit.updateData(['npm']);
  write(join(f.root, 'app/package-lock.json'), '{}');
  f.audit.execute = () => ({ status: 128, stdout: '', stderr: '' });
  assert.equal((await f.audit.run({ target: 'app', checks: ['dependencies'] })).status, 'not-applicable');
  f.audit.execute = () => ({ status: 127, stdout: '', stderr: '' });
  assert.equal((await f.audit.run({ target: 'app', checks: ['dependencies'] })).status, 'incomplete');
});

test('ZIP e ZIP64 exigem estrutura, CRC, JSON OSV e limites validos', () => {
  for (const options of [{}, { stored: true }, { descriptor: true }, { zip64: true }, { zip64: true, descriptor: true }]) {
    const zip = zipFixture({ 'TEST-1.json': advisory(), 'TEST-2.json': advisory('TEST-2', { withdrawn: '2026-02-01T00:00:00Z', affected: undefined }) }, options);
    assert.equal(validateOsvDatabase(zip).records, 2);
  }
  const zero = Buffer.alloc(22); zero.writeUInt32LE(0x04034b50); zero.writeUInt32LE(0x06054b50, 4);
  assert.throws(() => validateOsvDatabase(zero));
  assert.throws(() => validateOsvDatabase(zipFixture({ 'TEST-1.json': 'invalid' })));
  assert.throws(() => validateOsvDatabase(zipFixture({ 'TEST-1.json': '{}' })));
  assert.throws(() => validateOsvDatabase(zipFixture({ '../TEST-1.json': advisory() })));
  assert.throws(() => validateOsvDatabase(zipFixture([['TEST-1.json', advisory()], ['TEST-1.json', advisory()]])));
  const brokenCrc = validZip(); const central = brokenCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  brokenCrc.writeUInt32LE(1, central + 16); assert.throws(() => validateOsvDatabase(brokenCrc));
  const brokenPayload = validZip(); const payload = 30 + brokenPayload.readUInt16LE(26) + brokenPayload.readUInt16LE(28); brokenPayload[payload] ^= 0xff;
  assert.throws(() => validateOsvDatabase(brokenPayload));
  assert.throws(() => validateOsvDatabase(validZip(), { maxEntryBytes: 2 }));
  assert.throws(() => validateOsvDatabase(validZip(), { maxTotalBytes: 2 }));
});

test('inventario final recusa adicao, remocao, renomeacao e mudanca de tipo', async t => {
  const changes = {
    addition: root => write(join(root, 'app/added-during-scan.js'), 'new'),
    removal: root => fs.unlinkSync(join(root, 'app/index.js')),
    rename: root => fs.renameSync(join(root, 'app/index.js'), join(root, 'app/renamed.js')),
    type: root => { fs.unlinkSync(join(root, 'app/index.js')); fs.mkdirSync(join(root, 'app/index.js')); },
    directory: root => fs.mkdirSync(join(root, 'app/new-folder')),
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async subtest => {
    const f = fixture(subtest), execute = f.execute;
    f.audit.execute = (...args) => { const result = execute(...args); change(f.root); return result; };
    const result = await f.audit.run({ target: 'app', checks: ['secrets'] });
    assert.equal(result.status, 'incomplete'); assert.equal(result.exitCode, 2);
  });
});
