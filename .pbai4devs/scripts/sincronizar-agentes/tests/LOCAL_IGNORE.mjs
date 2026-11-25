import '../../lib/test-git-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { projectRoot } from '../../lib/runtime.mjs';
import { planLocalIgnore, applyLocalIgnore, checkLocalIgnore, planUntrack, applyUntrack, restoreUntrack, assertLocalIgnoreUnchanged } from '../../lib/gitignore.mjs';
import { nativeSkipReason } from '../../testar-infraestrutura/PLATFORM_FIXTURES.mjs';

function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agentdevkit-ignore-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, '.pbai4devs/templates/gitignore/local.ignore', readFileSync(join(projectRoot, '.pbai4devs/templates/gitignore/local.ignore')));
  return root;
}
function put(root, path, content) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
function git(root, args, input) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', input });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr); return result.stdout;
}

test("without Git preserves ignore; after git init informs visible outputs", t => {
  const root = fixture(t), outputs = ['.github/skills/generated/SKILL.md', '.vscode/.gitignore', 'AGENTS.md'];
  put(root, '.gitignore', '# Regras humanas\n*.own-cache\n');
  const plan = planLocalIgnore(root, { outputs });
  assert.equal(plan.status, 'no-git'); assert.equal(checkLocalIgnore(plan).ok, false);
  applyLocalIgnore(plan);
  assert.equal(checkLocalIgnore(planLocalIgnore(root, { outputs })).ok, false);
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '# Regras humanas\n*.own-cache\n');
  git(root, ['init', '-q']);
  put(root, '.git/info/exclude', '# Exclusoes humanas\n*.local-backup\n');
  applyLocalIgnore(planLocalIgnore(root, { outputs }));
  assert.doesNotMatch(readFileSync(join(root, '.gitignore'), 'utf8'), /AGENTDEVKIT LOCAL/);
  assert.match(readFileSync(join(root, '.git/info/exclude'), 'utf8'), /^# Exclusoes humanas/);
  assert.equal(checkLocalIgnore(planLocalIgnore(root, { outputs })).ok, true);
  for (const path of outputs) put(root, path, 'gerado\n');
  for (const path of ['.github/workflows/ci.yml', '.github/ISSUE_TEMPLATE/bug.yml', '.vscode/settings.json', '.github/skills/human/SKILL.md']) put(root, path, 'humano\n');
  git(root, ['add', '--all']);
  const tracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  for (const path of outputs) assert.equal(tracked.includes(path), true, path);
  for (const path of ['.github/workflows/ci.yml', '.github/ISSUE_TEMPLATE/bug.yml', '.vscode/settings.json', '.github/skills/human/SKILL.md']) assert.equal(tracked.includes(path), true, path);
});

test("different prefixes and projects do not change shared exclusion", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const before = readFileSync(join(root, '.git/info/exclude'));
  const template = readFileSync(join(root, '.pbai4devs/templates/gitignore/local.ignore'));
  for (const name of ['first space', 'second']) {
    const child = join(root, name); put(child, '.pbai4devs/templates/gitignore/local.ignore', template);
    applyLocalIgnore(planLocalIgnore(child, { outputs: ['.github/prompts/a[1].md'] }));
    assert.equal(checkLocalIgnore(planLocalIgnore(child, { outputs: ['.github/prompts/a[1].md'] })).ok, true);
  }
  assert.deepEqual(readFileSync(join(root, '.git/info/exclude')), before);
});

test("nested project respects ignored ancestor without changing indexes or exclusions", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, '.gitignore', '/.github/\n');
  const child = join(root, '.github/project');
  put(child, '.gitignore', '!/.claude/\n');
  put(child, '.claude/custom.md', 'instruções próprias\n');
  const exclude = readFileSync(join(root, '.git/info/exclude'));
  const index = git(root, ['ls-files', '--stage', '-z']);
  const plan = planLocalIgnore(child, { outputs: ['.claude/custom.md'] });
  applyLocalIgnore(plan);
  assert.deepEqual(readFileSync(join(root, '.git/info/exclude')), exclude);
  assert.equal(git(root, ['ls-files', '--stage', '-z']), index);
  assert.equal(readFileSync(join(child, '.claude/custom.md'), 'utf8'), 'instruções próprias\n');
  put(root, '.gitignore', '/.github/\n!/.github/\n');
  const opened = planLocalIgnore(child, { outputs: ['.claude/custom.md'] });
  applyLocalIgnore(opened);
  assert.equal(checkLocalIgnore(planLocalIgnore(child, { outputs: ['.claude/custom.md'] })).ok, true);
  assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '.github/project/.claude/custom.md']).status, 1);
});

test("nested design preserves user-configured exclusionsFile", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, 'global-ignore', '/.private/\n');
  git(root, ['config', '--local', 'core.excludesFile', join(root, 'global-ignore')]);
  const child = join(root, '.private/project');
  put(child, '.gitignore', '!/.claude/\n');
  put(child, '.claude/custom.md', 'instruções próprias\n');
  const before = readFileSync(join(root, '.git/info/exclude'));
  const plan = planLocalIgnore(child);
  applyLocalIgnore(plan);
  assert.deepEqual(readFileSync(join(root, '.git/info/exclude')), before);
  assert.equal(readFileSync(join(child, '.claude/custom.md'), 'utf8'), 'instruções próprias\n');
});

test("check identifies human denial without altering or diagnosing legitimate tracked content", t => {
  const root = fixture(t), outputs = ['generated.md']; git(root, ['init', '-q']);
  put(root, 'generated.md', 'gerado'); git(root, ['add', 'generated.md']);
  applyLocalIgnore(planLocalIgnore(root, { outputs }));
  put(root, '.gitignore', '!/generated.md\n');
  const result = checkLocalIgnore(planLocalIgnore(root, { outputs }));
  assert.equal(result.ok, true); assert.deepEqual(result.missing, []); assert.deepEqual(result.trackedOutputs, []);
  assert.equal(git(root, ['ls-files', 'generated.md']).trim(), 'generated.md');
});

test("template exceptions preserve ignore root and warn about visible private data", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  git(root, ['config', 'core.ignorecase', 'false']);
  const original = '# Regras do projeto\n.env.*\n!.env.example\n!.env.*.example\n';
  put(root, '.gitignore', original); git(root, ['add', '.gitignore']);
  const index = git(root, ['ls-files', '--stage', '-z']);
  const plan = planLocalIgnore(root);
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), original);
  assert.equal(existsSync(join(root, '.cursor')), false);
  applyLocalIgnore(plan);
  const updated = readFileSync(join(root, '.gitignore'), 'utf8');
  assert.equal(updated, original);
  assert.equal(git(root, ['ls-files', '--stage', '-z']), index);
  assert.equal(existsSync(join(root, '.cursor')), false);
  assert.equal(checkLocalIgnore(planLocalIgnore(root)).ok, true);
  put(root, '.cursor/.CACHE/private.json', 'local');
  put(root, '.cursor/.cache/private.json', 'local');
  put(root, '.cursor/human.md', 'human');
  for (const file of ['.cursor/.CACHE/private.json', '.cursor/.cache/private.json']) assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', file]).status, 1);
  const visible = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '.cursor/human.md']);
  assert.equal(visible.status, 1);
  applyLocalIgnore(planLocalIgnore(root));
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), updated);
  put(root, '.gitignore', updated + '# edição humana posterior\n');
  assert.ok(checkLocalIgnore(planLocalIgnore(root)).pending.some(item => item.code === 'private-file-visible'));
});

test('bloco legado na raiz pertence ao projeto e permanece intacto', t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const original = '# BEGIN AGENTDEVKIT PRIVATE legado\n# edição humana\n# END AGENTDEVKIT PRIVATE legado\n';
  put(root, '.gitignore', original);
  applyLocalIgnore(planLocalIgnore(root));
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), original);
});

test("Denial with mixed box informs visible caching in capital sensitive Git", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  git(root, ['config', 'core.ignorecase', 'false']);
  put(root, '.gitignore', '!*.CaChE/\n');
  put(root, '.cursor/.CaChE/private.json', 'local');
  const plan = planLocalIgnore(root); applyLocalIgnore(plan);
  assert.ok(checkLocalIgnore(plan).pending.some(item => item.code === 'private-file-visible' && item.path === '.cursor/.CaChE/private.json'));
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '!*.CaChE/\n');
});

test("literal and mixed-box denials report visible private status", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  git(root, ['config', 'core.ignorecase', 'false']);
  put(root, '.gitignore', '!*.LoCaL/\n!/.cursor/.env.production\n');
  for (const path of ['.cursor/.LoCaL/private.json', '.cursor/.env.production']) put(root, path, 'privado');
  const plan = planLocalIgnore(root); applyLocalIgnore(plan);
  const pending = checkLocalIgnore(plan).pending;
  for (const path of ['.cursor/.LoCaL/private.json', '.cursor/.env.production']) assert.ok(pending.some(item => item.code === 'private-file-visible' && item.path === path));
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '!*.LoCaL/\n!/.cursor/.env.production\n');
});

test("negation on the first line with BOM preserves bytes and informs visible secret", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const original = '\uFEFF!/.cursor/.env.production\r\n';
  put(root, '.gitignore', original); put(root, '.cursor/.env.production', 'privado');
  const plan = planLocalIgnore(root); applyLocalIgnore(plan);
  assert.ok(checkLocalIgnore(plan).pending.some(item => item.code === 'private-file-visible' && item.path === '.cursor/.env.production'));
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), original);
});

test("Later human denial is informed without rewriting the root", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, '.gitignore', '# humano\n'); applyLocalIgnore(planLocalIgnore(root));
  const path = join(root, '.gitignore');
  writeFileSync(path, readFileSync(path, 'utf8') + '!/.cursor/\n!/.cursor/.env.production\n');
  put(root, '.cursor/.env.production', 'privado');
  const plan = planLocalIgnore(root);
  assert.ok(checkLocalIgnore(plan).pending.some(item => item.code === 'private-file-visible' && item.path === '.cursor/.env.production'));
  applyLocalIgnore(plan);
  assert.equal(readFileSync(path, 'utf8'), '# humano\n!/.cursor/\n!/.cursor/.env.production\n');
});

test("planning without Git does not modify ignore or later human edition", t => {
  const root = fixture(t); put(root, '.gitignore', 'antes\r\n');
  const plan = planLocalIgnore(root, { outputs: ['generated.md'] });
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), 'antes\r\n');
  put(root, '.gitignore', 'depois\r\n');
  applyLocalIgnore(plan);
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), 'depois\r\n');
  for (const path of ['../outside', '/absolute', 'line\nname', 'a\\b']) assert.throws(() => planLocalIgnore(root, { outputs: [path] }), /invalida/);
});

test("desigradation plan is refused and preserves staged index", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, 'generated [1].md', 'gerado\n'); put(root, 'human.md', 'humano\n');
  git(root, ['add', '--all']);
  const hash = createHash('sha256').update('gerado\n').digest('hex');
  const plan = planUntrack(root, { 'generated [1].md': hash });
  assert.deepEqual(plan.paths, ['generated [1].md']);
  const index = readFileSync(join(root, '.git/index'));
  assert.throws(() => applyUntrack(plan), /desabilitado/);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  assert.equal(readFileSync(join(root, 'generated [1].md'), 'utf8'), 'gerado\n');
  assert.equal(git(root, ['ls-files', 'human.md']).trim(), 'human.md');
  git(root, ['add', 'generated [1].md']);
  const pending = planUntrack(root, { 'generated [1].md': hash });
  put(root, 'generated [1].md', 'editado\n');
  assert.throws(() => applyUntrack(pending), /desabilitado/);
  assert.equal(git(root, ['ls-files', 'generated [1].md']).trim(), 'generated [1].md');
});

test("non-existent target installation plan does not create files", t => {
  const root = fixture(t);
  const target = join(root, 'new project', 'nested');
  const fallback = planLocalIgnore(target, { outputs: ['AGENTS.md'] });
  assert.equal(fallback.status, 'no-git'); assert.equal(existsSync(target), false);
  git(root, ['init', '-q']);
  const plan = planLocalIgnore(target, { outputs: ['AGENTS.md'] });
  assert.equal(plan.status, 'git'); assert.equal(existsSync(target), false);
  assert.equal(plan.worktreeLocation.prefix, 'new project/nested');
  assert.deepEqual(plan.edits, []);
  assert.equal(existsSync(target), false);
});

test("disindication does not rule out human edition staged with workingtree restored", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, 'generated.md', 'edição humana\n'); git(root, ['add', 'generated.md']);
  put(root, 'generated.md', 'gerado\n');
  const hash = createHash('sha256').update('gerado\n').digest('hex');
  const plan = planUntrack(root, { 'generated.md': hash });
  assert.deepEqual(plan.paths, []); assert.deepEqual(plan.conflicts, ['generated.md']);
  assert.throws(() => applyUntrack(plan), /desabilitado/);
  assert.equal(git(root, ['show', ':generated.md']), 'edição humana\n');
  assert.equal(readFileSync(join(root, 'generated.md'), 'utf8'), 'gerado\n');
});

test("human configurations can be versioned after explicit exception", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  applyLocalIgnore(planLocalIgnore(root));
  put(root, '.codex/config.toml', 'local'); put(root, '.claude/settings.json', 'local');
  put(root, '.github/settings.json', 'fonte'); put(root, '.vscode/settings.json', 'fonte');
  put(root, '.gitignore', '!/.codex/\n!/.claude/\n!/.github/\n!/.vscode/\n');
  assert.equal(checkLocalIgnore(planLocalIgnore(root)).ok, true);
  git(root, ['add', '--all']);
  const tracked = git(root, ['ls-files', '-z']).split('\0');
  assert.equal(tracked.includes('.codex/config.toml'), true);
  assert.equal(tracked.includes('.claude/settings.json'), true);
  assert.ok(tracked.includes('.github/settings.json')); assert.ok(tracked.includes('.vscode/settings.json'));
});

test("exceptions use royal precedence and visible credentials are informed", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, '.gitignore', '!/.claude/\n!/.github/\n');
  put(root, '.claude/skills/team/SKILL.md', 'skill humana\n');
  put(root, '.claude/auth.json', 'segredo');
  put(root, '.github/workflows/ci.yml', 'workflow humano\n');
  put(root, '.vscode/settings.json', 'configuração humana\n');
  const original = readFileSync(join(root, '.gitignore'));
  const plan = planLocalIgnore(root, { outputs: ['.claude/skills/team/SKILL.md', '.github/workflows/ci.yml'] });
  assert.ok(plan.optedRoots.includes('.claude'));
  assert.ok(plan.optedRoots.includes('.github'));
  applyLocalIgnore(plan);
  assert.ok(checkLocalIgnore(planLocalIgnore(root)).pending.some(item => item.code === 'private-file-visible' && item.path === '.claude/auth.json'));
  for (const path of ['.claude/skills/team/SKILL.md', '.github/workflows/ci.yml']) {
    assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', path]).status, 1, path);
  }
  for (const path of ['.claude/auth.json', '.vscode/settings.json']) assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', path]).status, 1, path);
  assert.deepEqual(readFileSync(join(root, '.gitignore')), original);
  put(root, '.gitignore', '!/.claude/\n/.claude/\n');
  const overridden = planLocalIgnore(root);
  assert.equal(overridden.optedRoots.includes('.claude'), false);
  assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '.claude/skills/team/SKILL.md']).status, 0);
  put(root, '.gitignore', '!/.claude/\n!/.claude/**\n');
  applyLocalIgnore(planLocalIgnore(root));
  assert.ok(checkLocalIgnore(planLocalIgnore(root)).pending.some(item => item.code === 'private-file-visible'));
});

test("derivatives and legitimate entries already tracked remain in the index with or without opt-in", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, '.claude/skills/team/SKILL.md', 'skill rastreada\n');
  put(root, '.github/workflows/ci.yml', 'workflow rastreado\n');
  put(root, 'AGENTS.md', 'instruções rastreadas\n');
  git(root, ['add', '--all']);
  const before = git(root, ['ls-files', '--stage', '-z']);
  const outputs = ['.claude/skills/team/SKILL.md', '.github/workflows/ci.yml', 'AGENTS.md'];
  applyLocalIgnore(planLocalIgnore(root, { outputs }));
  assert.equal(checkLocalIgnore(planLocalIgnore(root, { outputs })).ok, true);
  assert.equal(git(root, ['ls-files', '--stage', '-z']), before);
  put(root, '.gitignore', '!/.claude/\n');
  const opted = planLocalIgnore(root, { outputs });
  assert.ok(opted.optedRoots.includes('.claude'));
  applyLocalIgnore(opted);
  assert.equal(checkLocalIgnore(planLocalIgnore(root, { outputs })).ok, true);
  assert.equal(git(root, ['ls-files', '--stage', '-z']), before);
});

test("artifacts come from shared and tracked politics are informed", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, '.agent-tests/human.txt', 'evidência humana'); git(root, ['add', '-f', '.agent-tests/human.txt']);
  const plan = planLocalIgnore(root, { outputs: ['AGENTS.md'] });
  assert.ok(plan.artifacts.some(pattern => pattern.includes('[Aa][Gg][Ee][Nn][Tt]')));
  assert.ok(plan.trackedOutputs.includes('.agent-tests/human.txt'));
  applyLocalIgnore(plan);
  for (const path of ['.agent-tests/x', 'TMP/x', 'nested/TeMp/x', '.PlAyWrIgHt-McP/x', 'nested/playwright-report/x', 'TEST-RESULTS/x', 'nested/TestResults/x', 'BLOB-REPORT/x']) {
    assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', path]).status, 1, path);
  }
  assert.equal(git(root, ['ls-files', '.agent-tests/human.txt']).trim(), '.agent-tests/human.txt');
  assert.equal(readFileSync(join(root, '.agent-tests/human.txt'), 'utf8'), 'evidência humana');
  assert.ok(checkLocalIgnore(planLocalIgnore(root, { outputs: ['AGENTS.md'] })).trackedOutputs.includes('.agent-tests/human.txt'));
});

test("nested project does not change ignores in monorepo", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const child = join(root, 'apps', 'my project'); mkdirSync(child, { recursive: true });
  applyLocalIgnore(planLocalIgnore(child, { outputs: ['AGENTS.md'] }));
  for (const path of ['apps/my project/.agent-tests/x', 'apps/my project/nested/.Playwright-MCP/x', 'apps/my project/sub/test-results/x']) {
    assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', path]).status, 1, path);
  }
  for (const path of ['apps/other/.agent-tests/x', 'apps/other/tmp/x', '.agent-tests/x']) {
    const result = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', path], { encoding: 'utf8' });
    assert.equal(result.status, 1, path + result.stderr);
  }
});

test("Ignore global does not mask the absence of local artifact rules", t => {
  const root = fixture(t), outside = fixture(t); git(root, ['init', '-q']);
  put(outside, 'global.ignore', '*\n');
  git(root, ['config', 'core.excludesFile', join(outside, 'global.ignore')]);
  const plan = planLocalIgnore(root, { outputs: ['AGENTS.md'] });
  assert.equal(plan.edits.length, 0);
  const missing = checkLocalIgnore({ ...plan, edits: [] });
  assert.ok(missing.pending.some(item => item.code === 'artifact-unprotected'));
  applyLocalIgnore(plan);
  assert.equal(checkLocalIgnore(planLocalIgnore(root, { outputs: ['AGENTS.md'] })).ok, true);
});

test("Human denial of artifacts warns without changing rules or index", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const human = '!/.agent-tests/**\n'; put(root, '.gitignore', human);
  const exclude = readFileSync(join(root, '.git/info/exclude'));
  const plan = planLocalIgnore(root, { outputs: ['AGENTS.md'] });
  assert.ok(checkLocalIgnore(plan).pending.some(item => item.code === 'artifact-unprotected'));
  applyLocalIgnore(plan);
  assert.deepEqual(readFileSync(join(root, '.git/info/exclude')), exclude);
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), human);
});

test("probes recognize human exceptions to actual Playwright names", async t => {
  for (const path of ['.playwright-mcp', 'playwright-report', 'playwright/.cache']) await t.test(path, subtest => {
    const root = fixture(subtest); git(root, ['init', '-q']);
    const prefixes = path.split('/').map((_part, index, parts) => '!/' + parts.slice(0, index + 1).join('/') + '/');
    const human = [...prefixes, `!/${path}/**`, ''].join('\n'); put(root, '.gitignore', human);
    const before = readFileSync(join(root, '.git/info/exclude'));
    const plan = planLocalIgnore(root, { outputs: ['AGENTS.md'] });
    assert.ok(checkLocalIgnore(plan).pending.some(item => item.code === 'artifact-unprotected'));
    applyLocalIgnore(plan);
    assert.deepEqual(readFileSync(join(root, '.git/info/exclude')), before);
  });
});

test("thousands of paths use stdin without amplifying already ignored area metadata", t => {
  const root = fixture(t); git(root, ['init', '-q']); put(root, '.gitignore', '/ignored/\n');
  const before = readFileSync(join(root, '.git/info/exclude'), 'utf8');
  const target = join(root, 'ignored'); mkdirSync(target);
  const outputs = Array.from({ length: 1500 }, (_, index) => `generated-${index}-${'x'.repeat(45)}.md`);
  const plan = planLocalIgnore(target, { outputs });
  assert.ok(plan.unprotectedOutputs.length >= 1500);
  assert.deepEqual(plan.edits, []); assert.equal(checkLocalIgnore(plan).ok, true);
  applyLocalIgnore(plan); assert.equal(readFileSync(join(root, '.git/info/exclude'), 'utf8'), before);
  assert.deepEqual(planUntrack(target, Object.fromEntries(outputs.map(path => [path, 'a'.repeat(64)]))).paths, []);
});

test("desigradation and rollback helpers refuse changes and preserve later stage", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, 'generated.md', 'gerado\n'); put(root, 'second.md', 'original\n'); put(root, 'human.md', 'humano\n');
  git(root, ['add', '--all']);
  const digest = value => createHash('sha256').update(value).digest('hex');
  const plan = planUntrack(root, { 'generated.md': digest('gerado\n'), 'second.md': digest('original\n') });
  assert.throws(() => applyUntrack(plan), /desabilitado/);
  put(root, 'second.md', 'staged depois\n'); git(root, ['add', 'second.md']);
  put(root, 'human.md', 'humano depois\n'); git(root, ['add', 'human.md']);
  const index = readFileSync(join(root, '.git/index'));
  assert.throws(() => restoreUntrack(plan), /desabilitado/);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  assert.equal(git(root, ['show', ':generated.md']), 'gerado\n');
  assert.equal(git(root, ['show', ':second.md']), 'staged depois\n');
  assert.equal(git(root, ['show', ':human.md']), 'humano depois\n');
});

test("Denied plan preserves lock and human exclusion change", t => {
  const root = fixture(t); git(root, ['init', '-q']); put(root, 'generated.md', 'gerado\n'); git(root, ['add', 'generated.md']);
  const plan = planUntrack(root, { 'generated.md': createHash('sha256').update('gerado\n').digest('hex') });
  assert.throws(() => applyUntrack(plan), /desabilitado/); put(root, '.git/index.lock', 'lock alheio');
  assert.throws(() => restoreUntrack(plan), /desabilitado/);
  assert.equal(readFileSync(join(root, '.git/index.lock'), 'utf8'), 'lock alheio');
  const metadata = planLocalIgnore(root, { outputs: ['generated.md'] });
  put(root, '.git/info/exclude', 'mudou\n');
  assert.doesNotThrow(() => assertLocalIgnoreUnchanged(metadata));
  assert.equal(readFileSync(join(root, '.git/info/exclude'), 'utf8'), 'mudou\n');
});

test("nested project does not change relative paths in the Git index", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, 'nested/generated.md', 'gerado\n'); put(root, 'human.md', 'humano\n'); git(root, ['add', '--all']);
  const child = join(root, 'nested');
  const plan = planUntrack(child, { 'generated.md': createHash('sha256').update('gerado\n').digest('hex') });
  assert.throws(() => applyUntrack(plan), /desabilitado/);
  assert.throws(() => restoreUntrack(plan), /desabilitado/);
  assert.equal(git(root, ['show', ':nested/generated.md']), 'gerado\n');
  assert.equal(git(root, ['show', ':human.md']), 'humano\n');
});

test("human denial is detected before applying new exclusions and remains intact", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, '.gitignore', '!/AGENTS.md\n');
  const before = readFileSync(join(root, '.git/info/exclude'), 'utf8');
  const plan = planLocalIgnore(root, { outputs: ['AGENTS.md'] });
  assert.deepEqual(plan.edits, []);
  assert.ok(checkLocalIgnore(plan).pending.some(item => item.code === 'output-visible' && item.path === 'AGENTS.md'));
  applyLocalIgnore(plan);
  assert.equal(readFileSync(join(root, '.git/info/exclude'), 'utf8'), before);
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '!/AGENTS.md\n');
});

test("client not selected with own symlink is not crossed by probe", t => {
  const root = fixture(t), outside = fixture(t); git(root, ['init', '-q']);
  try { symlinkSync(outside, join(root, '.opencode'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Sem permissão para criar symlink.'); return; } throw error; }
  const before = readdirSync(outside);
  applyLocalIgnore(planLocalIgnore(root, { outputs: ['AGENTS.md'] }));
  assert.equal(checkLocalIgnore(planLocalIgnore(root, { outputs: ['AGENTS.md'] })).ok, true);
  assert.deepEqual(readdirSync(outside), before);
});

test("Ignore chosen client remains intact without replacement plans", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const block = '# BEGIN AGENT IGNORE\r\n!/generated.md\r\n# END AGENT IGNORE';
  put(root, '.gitignore', '!/.github/\n');
  put(root, '.github/.gitignore', `# Humano\r\n${block}\r\n!/human.md\r\n`);
  const plan = planLocalIgnore(root, { outputs: ['.github/generated.md', '.github/human.md'] });
  const replacement = { path: join(root, '.github/.gitignore'), firstLine: 2, lastLine: 4, sha256: createHash('sha256').update(block).digest('hex') };
  assert.deepEqual(checkLocalIgnore(plan).missing, []);
  assert.deepEqual(checkLocalIgnore(plan, { replacedBlocks: [replacement] }).missing, []);
  assert.throws(() => checkLocalIgnore(plan, { replacedBlocks: [{ ...replacement, sha256: '0'.repeat(64) }] }), /Bloco de ignore mudou/);
  assert.deepEqual(plan.edits, []);
  assert.doesNotThrow(() => applyLocalIgnore(plan));
  assert.equal(readFileSync(join(root, '.github/.gitignore'), 'utf8'), `# Humano\r\n${block}\r\n!/human.md\r\n`);
});

test("ancestral aliases use native paths in exclusion, deconditation and rollback", t => {
  const base = fixture(t), project = join(base, 'project'), alias = join(base, 'alias');
  mkdirSync(project);
  try { symlinkSync(base, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Sem permissão para criar alias.'); return; } throw error; }
  git(project, ['init', '-q']);
  const native = realpathSync.native;
  const canonical = native(project), viaAlias = join(alias, 'project');
  let nativeCalls = 0;
  t.mock.method(realpathSync, 'native', (...args) => { nativeCalls++; return native(...args); });
  const plan = planLocalIgnore(viaAlias, { outputs: ['generated.md'] });
  assert.equal(plan.root, canonical); assert.equal(plan.worktreeLocation.top, canonical); assert.equal(plan.worktreeLocation.prefix, '');
  applyLocalIgnore(plan);
  assert.equal(planLocalIgnore(project, { outputs: ['generated.md'] }).edits.length, 0);
  const future = planLocalIgnore(join(viaAlias, 'future', 'nested'), { outputs: ['generated.md'] });
  assert.equal(future.root, join(canonical, 'future', 'nested'));
  assert.equal(future.worktreeLocation.prefix, 'future/nested'); assert.equal(existsSync(future.root), false);
  put(project, 'generated.md', 'gerado\n'); git(project, ['add', '-f', 'generated.md']);
  const untrack = planUntrack(viaAlias, { 'generated.md': createHash('sha256').update('gerado\n').digest('hex') });
  assert.equal(untrack.root, canonical); assert.throws(() => applyUntrack(untrack), /desabilitado/); assert.throws(() => restoreUntrack(untrack), /desabilitado/);
  assert.equal(git(project, ['show', ':generated.md']), 'gerado\n');
  assert.ok(nativeCalls > 3, 'As comparações devem usar realpathSync.native.');
});

test("canonicalization resorts to realpath when native operation is not supported", t => {
  const root = fixture(t), expected = realpathSync(root);
  t.mock.method(realpathSync, 'native', () => { throw Object.assign(new Error('Sem suporte'), { code: 'ENOSYS' }); });
  const plan = planLocalIgnore(join(root, 'future'), { outputs: ['generated.md'] });
  assert.equal(plan.root, join(expected, 'future')); assert.equal(existsSync(plan.root), false);
});

test("Windows normalizes temporary aliases 8.3 before comparing the Git root", { skip: nativeSkipReason('win32') }, t => {
  const canonical = fixture(t);
  // cmd expands "." through Windows short-name resolution. The fixture path
  // travels as the working directory, so it never becomes shell input.
  const result = spawnSync('cmd.exe', ['/d', '/u', '/v:off', '/c', 'for %I in (.) do @echo "%~fsI"'], {
    cwd: canonical, encoding: 'utf16le', windowsVerbatimArguments: true, windowsHide: true, timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const alias = result.stdout.trim().match(/^"([^"\r\n]+)"$/)?.[1];
  assert.ok(alias, 'O Windows deve retornar o caminho completo da fixture.');
  if (alias.toLowerCase() === canonical.toLowerCase()) {
    t.skip('O volume temporário não forneceu um alias 8.3 distinto.');
    return;
  }
  assert.equal(realpathSync.native(alias), canonical);
  git(canonical, ['init', '-q']);
  const plan = planLocalIgnore(alias, { outputs: ['generated.md'] });
  assert.equal(plan.root, canonical); assert.equal(plan.worktreeLocation.top, canonical); assert.equal(plan.worktreeLocation.prefix, '');
  const future = planLocalIgnore(join(alias, 'future'), { outputs: ['generated.md'] });
  assert.equal(future.root, join(canonical, 'future')); assert.equal(future.worktreeLocation.prefix, 'future');
  put(canonical, 'generated.md', 'gerado\n'); git(canonical, ['add', 'generated.md']);
  const untrack = planUntrack(alias, { 'generated.md': createHash('sha256').update('gerado\n').digest('hex') });
  assert.throws(() => applyUntrack(untrack), /desabilitado/); assert.throws(() => restoreUntrack(untrack), /desabilitado/);
  assert.equal(git(canonical, ['show', ':generated.md']), 'gerado\n');
});

test("index canonicalization keeps symlink rejection before solving the destination", t => {
  const root = fixture(t); git(root, ['init', '-q']); put(root, 'generated.md', 'gerado\n'); git(root, ['add', 'generated.md']);
  const plan = planUntrack(root, { 'generated.md': createHash('sha256').update('gerado\n').digest('hex') });
  assert.throws(() => applyUntrack(plan), /desabilitado/);
  const index = join(root, '.git/index'), saved = join(root, '.git/saved-index');
  renameSync(index, saved);
  try { symlinkSync(saved, index); }
  catch (error) { renameSync(saved, index); if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Sem permissão para criar symlink.'); return; } throw error; }
  const before = readFileSync(saved);
  assert.throws(() => restoreUntrack(plan), /desabilitado/);
  assert.throws(() => checkLocalIgnore({ root, location: null, paths: [], edits: [], trackedOutputs: [] }, {
    replacedBlocks: [{ path: index, firstLine: 1, lastLine: 1, sha256: '0'.repeat(64) }],
  }), /Link simbolico/);
  assert.deepEqual(readFileSync(saved), before);
});

test("worktree uses the native root, common exclusion and its own index", t => {
  const root = fixture(t); git(root, ['init', '-q']); put(root, 'seed.txt', 'base\n'); git(root, ['add', 'seed.txt']);
  git(root, ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=disabled-hooks', 'commit', '-q', '-m', 'test: worktree fixture']);
  const linked = join(root, 'linked-worktree');
  git(root, ['worktree', 'add', '-q', '-b', 'fixture-linked', linked]);
  const plan = planLocalIgnore(linked, { outputs: ['generated.md'] });
  assert.equal(plan.root, realpathSync.native(linked));
  assert.equal(plan.worktreeLocation.top, realpathSync.native(linked));
  assert.equal(plan.worktreeLocation.exclude, realpathSync.native(join(root, '.git/info/exclude')));
  applyLocalIgnore(plan); assert.equal(checkLocalIgnore(planLocalIgnore(linked, { outputs: ['generated.md'] })).ok, true);
  put(linked, 'generated.md', 'gerado\n'); git(linked, ['add', '-f', 'generated.md']);
  const untrack = planUntrack(linked, { 'generated.md': createHash('sha256').update('gerado\n').digest('hex') });
  assert.throws(() => applyUntrack(untrack), /desabilitado/); assert.throws(() => restoreUntrack(untrack), /desabilitado/);
  assert.equal(git(linked, ['show', ':generated.md']), 'gerado\n');
  assert.equal(git(root, ['ls-files', 'generated.md']), '');
});

test("exceptions with arbitrary names of artifacts do not undergo sampling", t => {
  for (const [name, directory] of [['.playwright-custom', true], ['.playwright-report.json', false], ['playwright-e2e', true]]) {
    const root = fixture(t); git(root, ['init', '-q']);
    const human = `!/${name}${directory ? '/' : ''}\n${directory ? `!/${name}/**\n` : ''}`;
    put(root, '.gitignore', human);
    const before = readFileSync(join(root, '.git/info/exclude'));
    const plan = planLocalIgnore(root);
    assert.ok(checkLocalIgnore(plan).pending.some(item => item.code === 'artifact-unprotected'), name);
    applyLocalIgnore(plan);
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), human);
    assert.deepEqual(readFileSync(join(root, '.git/info/exclude')), before);
  }
});

test("real file reopened by glob is also detected if it appears after plan", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, '.gitignore', '!/.playwright-report-*.json\n');
  const plan = planLocalIgnore(root), path = '.playwright-report-real.json';
  put(root, path, 'artefato local\n');
  assert.ok(checkLocalIgnore(plan).pending.some(item => item.code === 'artifact-unprotected'));
  applyLocalIgnore(plan);
  assert.equal(readFileSync(join(root, path), 'utf8'), 'artefato local\n');
});

test("global and nested denials are informed and preserved", t => {
  for (const [file, rule] of [['.gitignore', '!/.claude/s*.json'], ['.claude/.gitignore', '!s*.json'], ['.claude/.gitignore', '!/settings.local.json'], ['.pbai4devs/.gitignore', '!.playwright-*/'], ['.pbai4devs/module/.gitignore', '!.playwright-*/'], ['logs/.gitignore', '!.playwright-*/'], ['.gitignore', '!**/foo/s*.json'], ['.gitignore', '!**/foo/.playwright-*.png'], ['.gitignore', '!/docs/.playwright-*.png'], ['docs/.gitignore', '!.playwright-*/'], ['.gitignore', '!*.CaChE/'], ['.gitignore', '!/.playwright-*.png']]) {
    const root = fixture(t); git(root, ['init', '-q']);
    put(root, file, `\uFEFF${rule}\n`);
    const before = readFileSync(join(root, '.git/info/exclude'));
    const index = git(root, ['ls-files', '--stage', '-z']);
    const plan = planLocalIgnore(root);
    assert.ok(checkLocalIgnore(plan).pending.some(item => item.code === 'ignore-ambiguous' && item.path.includes(rule)), rule);
    applyLocalIgnore(plan);
    assert.deepEqual(readFileSync(join(root, '.git/info/exclude')), before);
    assert.equal(git(root, ['ls-files', '--stage', '-z']), index);
    assert.equal(readFileSync(join(root, file), 'utf8'), `\uFEFF${rule}\n`);
  }
});

test("NuGet and Visual Studio denials preserve metadata and only release proven directories", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const nuget = '!**/[Pp]ackages/build/';
  const cache = '!?*.[Cc]ache/';
  const fragment = `**/[Pp]ackages/*\n${nuget}\n*.[Cc]ache\n${cache}\n`;
  const playwright = [
    '**/.[Pp][Ll][Aa][Yy][Ww][Rr][Ii][Gg][Hh][Tt]*',
    '**/[Pp][Ll][Aa][Yy][Ww][Rr][Ii][Gg][Hh][Tt]*/',
  ];
  put(root, '.gitignore', fragment);
  put(root, 'tracked.txt', 'humano\n'); git(root, ['add', 'tracked.txt']);
  const protectedPaths = ['.git/index', '.git/config', '.git/info/exclude'];
  const before = protectedPaths.map(path => readFileSync(join(root, path)));
  const diagnosticLines = (code = 'ignore-ambiguous') => checkLocalIgnore(planLocalIgnore(root)).pending
    .filter(item => item.code === code).map(item => item.path);
  const aliases = process.platform === 'win32' ? [`.gitignore: ${nuget}`] : [];
  const cacheWarning = [`.gitignore: ${cache}`];
  assert.deepEqual(diagnosticLines(), aliases);
  assert.deepEqual(diagnosticLines('artifact-ignore-ambiguous'), cacheWarning);

  const visiblePrivate = '.claude/nested/playwright-e2e.cache/result.txt';
  put(root, visiblePrivate, 'artefato conhecido\n');
  const privateCheck = checkLocalIgnore(planLocalIgnore(root));
  assert.ok(privateCheck.pending.some(item => item.code === 'private-file-visible' && item.path === visiblePrivate));
  assert.equal(privateCheck.ok, false);

  const half = `${fragment}${playwright[0]}\n`;
  put(root, '.gitignore', half);
  assert.deepEqual(diagnosticLines(), aliases);
  assert.deepEqual(diagnosticLines('artifact-ignore-ambiguous'), cacheWarning);

  const covered = `${fragment}${playwright.join('\n')}\n`;
  put(root, '.gitignore', covered);
  for (const file of ['packages/build/project.targets', 'nested/deep/tool.cache/config.txt']) {
    put(root, file, 'humano\n');
    assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '--', file]).status, 1, file);
  }
  for (const file of ['nested/deep/.playwright-e2e.cache/result.txt', '.claude/nested/playwright-e2e.cache/result.txt']) {
    put(root, file, 'artefato\n');
    assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '--', file]).status, 0, file);
  }
  assert.deepEqual(diagnosticLines(), aliases);
  assert.deepEqual(diagnosticLines('artifact-ignore-ambiguous'), []);
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), covered);

  const reopened = `${covered}!nested/deep/.playwright-e2e.cache/\n`;
  put(root, '.gitignore', reopened);
  assert.deepEqual(diagnosticLines(), aliases);
  assert.deepEqual(diagnosticLines('artifact-ignore-ambiguous'), cacheWarning);
  assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '--', 'nested/deep/.playwright-e2e.cache/result.txt']).status, 1);
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), reopened);
  protectedPaths.forEach((path, index) => assert.deepEqual(readFileSync(join(root, path)), before[index], path));
});

test("Generic denials preserve configuration and inform unproven Windows aliases", t => {
  for (const platform of new Set([process.platform, 'win32'])) for (const [file, rule] of [['.gitignore', '!*.md'], ['.gitignore', '!docs/*.md'], ['.gitignore', '!**/*.mdx'], ['docs/.gitignore', '!*.txt'], ['.gitignore', '!*.json'], ['.gitignore', '!*.yaml'], ['.gitignore', '!docs/*.json']]) {
    const root = fixture(t); git(root, ['init', '-q']); put(root, file, `${rule}\n`);
    put(root, 'humano.txt', 'conteúdo staged\n'); git(root, ['add', 'humano.txt']);
    const protectedPaths = ['.git/index', '.git/config', '.git/info/exclude'];
    const before = protectedPaths.map(path => readFileSync(join(root, path)));
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    try {
      Object.defineProperty(process, 'platform', { value: platform });
      const plan = planLocalIgnore(root, { outputs: ['AGENTS.md'] });
      const checked = checkLocalIgnore(plan);
      const ambiguous = platform === 'win32' && (file === 'docs/.gitignore' || rule.startsWith('!docs/'));
      assert.deepEqual(checked.pending.filter(item => item.code === 'ignore-ambiguous').map(item => item.path), ambiguous ? [`${file}: ${rule}`] : [], `${platform}: ${file}: ${rule}`);
      assert.equal(checked.ok, !ambiguous, `${platform}: ${file}: ${rule}`);
      assert.ok(checked.pending.some(item => item.code === 'output-visible'), rule);
      applyLocalIgnore(plan);
    } finally { Object.defineProperty(process, 'platform', descriptor); }
    assert.equal(readFileSync(join(root, file), 'utf8'), `${rule}\n`);
    protectedPaths.forEach((path, index) => assert.deepEqual(readFileSync(join(root, path)), before[index], path));
  }
});

test("Interior globstars in directory exceptions preserve ordinary build paths", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const ordinary = '!src/**/build/';
  const restricted = ['!src/**/.cache/', '!src/**/playwright-report/', '!.claude/**/build/'];
  const ignore = `src/**/build*\n${[ordinary, ...restricted].join('\n')}\n`;
  put(root, '.gitignore', ignore);
  put(root, 'src/component/build/project.targets', 'project content\n');
  const visible = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '--', 'src/component/build/project.targets']);
  assert.equal(visible.status, 1);

  const expected = (process.platform === 'win32' ? [ordinary, ...restricted] : restricted).map(rule => `.gitignore: ${rule}`);
  const plan = planLocalIgnore(root);
  const pending = checkLocalIgnore(plan).pending.filter(item => item.code === 'ignore-ambiguous').map(item => item.path);
  assert.deepEqual(pending, expected);
  applyLocalIgnore(plan);
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), ignore);
});

test("Generic denials do not suppress relevant denials or visible credentials", t => {
  for (const [file, rule] of [['.gitignore', '!/.claude/*.json'], ['.gitignore', '!/.claude/*.md'], ['.claude/.gitignore', '!*.md'], ['.gitignore', '!/.playwright-report/*.md']]) {
    const root = fixture(t); git(root, ['init', '-q']); put(root, file, `${rule}\n`);
    assert.ok(checkLocalIgnore(planLocalIgnore(root)).pending.some(item => item.code === 'ignore-ambiguous'), rule);
  }
  for (const [rule, path] of [['!*.md', '.claude/.env.secret.md'], ['!*.json', '.claude/auth.json'], ['!*.yaml', '.claude/.env.secret.yaml']]) {
    const root = fixture(t); git(root, ['init', '-q']);
    put(root, '.gitignore', `${rule}\n`); put(root, path, 'fixture\n');
    let checked = checkLocalIgnore(planLocalIgnore(root));
    assert.ok(checked.pending.some(item => item.code === 'private-file-visible' && item.path === path), path);
    assert.equal(checked.ok, false);
    git(root, ['add', '-f', path]);
    checked = checkLocalIgnore(planLocalIgnore(root));
    assert.ok(checked.trackedOutputs.includes(path), path);
    assert.equal(checked.ok, false);
  }
});

test("ancestral glob of the subproject is detected before altering the exclusion", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const child = join(root, 'packages/app'); mkdirSync(child, { recursive: true });
  put(root, '.gitignore', '!/packages/app/.claude/s*.json\n');
  const before = readFileSync(join(root, '.git/info/exclude'));
  const plan = planLocalIgnore(child);
  assert.ok(checkLocalIgnore(plan).pending.some(item => item.code === 'ignore-ambiguous' && item.path.includes('s*.json')));
  applyLocalIgnore(plan);
  assert.deepEqual(readFileSync(join(root, '.git/info/exclude')), before);
});

test("already ignored dependencies do not cause conflict, but visible ignores are verified", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, '.gitignore', 'node_modules/\n');
  put(root, 'node_modules/pacote/.gitignore', '!.playwright-*/\n');
  assert.equal(checkLocalIgnore(planLocalIgnore(root)).pending.some(item => item.code === 'ignore-ambiguous' && item.path.includes('!.playwright-*/')), false);
  put(root, '.gitignore', '# dependências visíveis\n');
  assert.ok(checkLocalIgnore(planLocalIgnore(root)).pending.some(item => item.code === 'ignore-ambiguous' && item.path.includes('!.playwright-*/')));
});

test("block of another worktree does not block local customer policy", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const old = '# BEGIN AGENTDEVKIT LOCAL 0123456789abcdef\n/.claude/\n# END AGENTDEVKIT LOCAL 0123456789abcdef\n';
  put(root, '.git/info/exclude', old);
  const plan = planLocalIgnore(root);
  assert.equal(checkLocalIgnore(plan).missing.length, 0);
  assert.doesNotThrow(() => applyLocalIgnore(plan));
  assert.ok(readFileSync(join(root, '.git/info/exclude'), 'utf8').startsWith(old));
});

test("already versioned artifacts are reported without changing the index", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const artifacts = ['.playwright-mcp/trace.zip', 'playwright-report/index.html', 'test-results/result.txt', '.agent-tests/log.txt', '.claude/settings.local.json', '.codex/.env'];
  for (const path of artifacts) put(root, path, 'trace');
  git(root, ['add', '-f', ...artifacts]);
  const before = git(root, ['ls-files', '--stage', '-z']);
  const plan = planLocalIgnore(root);
  assert.deepEqual([...plan.trackedOutputs].sort(), artifacts.sort());
  assert.equal(checkLocalIgnore(plan).ok, false);
  assert.equal(git(root, ['ls-files', '--stage', '-z']), before);
});

test("Custom nested rules remain valid and include hidden parents", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const policy = readFileSync(join(projectRoot, '.pbai4devs/templates/gitignore/agents.ignore'), 'utf8');
  put(root, '.pbai4devs/templates/gitignore/agents.ignore', `${policy}\n**/reports/cache*/\n`);
  const path = '.hidden/reports/cache-custom/out.json';
  put(root, path, 'local\n');
  put(root, '.gitignore', '!/.hidden/reports/cache-custom/\n!/.hidden/reports/cache-custom/**\n');
  const plan = planLocalIgnore(root);
  applyLocalIgnore(plan);
  assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', path]).status, 1);
  assert.equal(readFileSync(join(root, path), 'utf8'), 'local\n');
});

test("literal keys in Git patterns did not see glob expansion", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const policy = readFileSync(join(projectRoot, '.pbai4devs/templates/gitignore/agents.ignore'), 'utf8');
  put(root, '.pbai4devs/templates/gitignore/agents.ignore', `${policy}\n**/cache{keep,archive}/\n`);
  put(root, 'cachekeep/source.txt', 'código humano\n');
  put(root, '.gitignore', '!cachekeep/source.txt\n');
  assert.doesNotThrow(() => applyLocalIgnore(planLocalIgnore(root)));
  assert.equal(readFileSync(join(root, 'cachekeep/source.txt'), 'utf8'), 'código humano\n');
});

test("nominal exception of an ancestral ignore is checked in the subproject", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  put(root, '.gitignore', '!/modules/app/.playwright-personal/\n!/modules/app/.playwright-personal/**\n');
  const child = join(root, 'modules/app'); mkdirSync(child, { recursive: true });
  const plan = planLocalIgnore(child);
  assert.ok(checkLocalIgnore(plan).pending.some(item => item.code === 'artifact-unprotected'));
  applyLocalIgnore(plan);
});

test("human permissions of exclusions are not changed", { skip: process.platform === 'win32' && 'A fixture verifica modos POSIX de leitura e escrita.' }, t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const exclude = join(root, '.git/info/exclude'); chmodSync(exclude, 0o600);
  applyLocalIgnore(planLocalIgnore(root));
  assert.equal(statSync(exclude).mode & 0o777, 0o600);
  const changed = planLocalIgnore(root, { outputs: ['new-generated.md'] });
  chmodSync(exclude, 0o640);
  assert.doesNotThrow(() => applyLocalIgnore(changed));
  assert.equal(statSync(exclude).mode & 0o777, 0o640);
});

test("human exclusion altered after planning remains intact", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const file = join(root, '.git/info/exclude'), plan = planLocalIgnore(root);
  const index = git(root, ['ls-files', '--stage', '-z']);
  put(root, '.git/info/exclude', '# regra humana concorrente\n');
  const write = fs.writeFileSync; let writes = 0;
  try {
    fs.writeFileSync = (path, ...args) => { if (String(path).startsWith(file)) writes++; return write(path, ...args); };
    syncBuiltinESMExports(); applyLocalIgnore(plan);
  } finally { fs.writeFileSync = write; syncBuiltinESMExports(); }
  assert.equal(writes, 0); assert.equal(readFileSync(file, 'utf8'), '# regra humana concorrente\n');
  assert.equal(git(root, ['ls-files', '--stage', '-z']), index);
});

test("no renaming or rollback is done in human exclusions", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const file = join(root, '.git/info/exclude'), plan = planLocalIgnore(root), before = readFileSync(file);
  const rename = fs.renameSync; let renamed = false;
  try {
    fs.renameSync = (from, to) => { if (String(from).startsWith(file) || String(to).startsWith(file)) renamed = true; return rename(from, to); };
    syncBuiltinESMExports(); applyLocalIgnore(plan);
  } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.equal(renamed, false); assert.deepEqual(readFileSync(file), before);
});

test("Ignore root keeps mode and bytes before and after git init", { skip: process.platform === 'win32' && 'A fixture verifica modos POSIX de leitura e escrita.' }, t => {
  const root = fixture(t), ignore = join(root, '.gitignore');
  put(root, '.gitignore', '# humano\n'); chmodSync(ignore, 0o600);
  applyLocalIgnore(planLocalIgnore(root));
  assert.equal(statSync(ignore).mode & 0o777, 0o600);
  const original = readFileSync(ignore); git(root, ['init', '-q']);
  const exclude = join(root, '.git/info/exclude'); chmodSync(exclude, 0o600);
  applyLocalIgnore(planLocalIgnore(root));
  assert.equal(statSync(exclude).mode & 0o777, 0o600);
  assert.deepEqual(readFileSync(ignore), original); assert.equal(statSync(ignore).mode & 0o777, 0o600);
});

test("Ignore root read only does not prevent local deletion in Git", { skip: process.platform === 'win32' && 'A fixture verifica modos POSIX de leitura e escrita.' }, t => {
  const root = fixture(t), ignore = join(root, '.gitignore');
  put(root, '.gitignore', '# humano\n'); chmodSync(ignore, 0o444);
  applyLocalIgnore(planLocalIgnore(root));
  const original = readFileSync(ignore); git(root, ['init', '-q']);
  const exclude = join(root, '.git/info/exclude');
  chmodSync(exclude, 0o444);
  const plan = planLocalIgnore(root);
  applyLocalIgnore(plan);
  assert.equal(statSync(exclude).mode & 0o777, 0o444);
  assert.deepEqual(readFileSync(ignore), original); assert.equal(statSync(ignore).mode & 0o777, 0o444);
});

test("nested project does not read inaccessible gitignore of the brother project", { skip: process.platform === 'win32' && 'A fixture verifica modos POSIX de leitura e escrita.' }, t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const other = join(root, 'other/.gitignore'); put(root, 'other/.gitignore', 'tmp/\n');
  git(root, ['add', 'other/.gitignore']); chmodSync(other, 0o000);
  t.after(() => { try { chmodSync(other, 0o600); } catch {} });
  const child = join(root, 'app'); mkdirSync(child);
  const plan = planLocalIgnore(child);
  applyLocalIgnore(plan);
  assert.equal(checkLocalIgnore(planLocalIgnore(child)).ok, true);
});

test("old plan that would alter exclusion is refused without writing", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const file = join(root, '.git/info/exclude'), before = readFileSync(file), plan = planLocalIgnore(root);
  plan.edits.push({ path: file, before: before.toString(), after: 'mudança indevida\n' });
  assert.throws(() => applyLocalIgnore(plan), /desabilitado/);
  assert.deepEqual(readFileSync(file), before);
});

test("validation failure keeps original error and deletion intact", t => {
  const root = fixture(t); git(root, ['init', '-q']);
  const file = join(root, '.git/info/exclude'), before = readFileSync(file), original = new Error('falha de validação');
  assert.throws(() => applyLocalIgnore(planLocalIgnore(root), { validate() { throw original; } }), error => error === original);
  assert.deepEqual(readFileSync(file), before);
});
