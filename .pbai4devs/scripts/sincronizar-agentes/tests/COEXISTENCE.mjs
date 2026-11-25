import '../../lib/test-git-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { projectRoot } from '../../lib/runtime.mjs';
import { nativePathBoundary } from '../../lib/native-paths.mjs';
import { synchronize } from '../SCRIPT.mjs';

const hash = content => createHash('sha256').update(content).digest('hex');
const put = (root, path, text) => { fs.mkdirSync(dirname(join(root, path)), { recursive: true }); fs.writeFileSync(join(root, path), text); };
const run = (root, options = {}) => synchronize({ root, localIgnores: false, output() {}, ...options });
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'agentdevkit-coexist-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(root, '.pbai4devs/espelhos.conf', 'agente|.claude|plano\nagente|.codex|plano\nagente|.agents|plano\ndescoberta|.agents|antigravity\n');
  put(root, '.pbai4devs/skills/demo/SKILL.md', '---\nname: demo\ndescription: Demo.\n---\n\n# Demo\n');
  put(root, '.pbai4devs/agents/revisor/AGENT.md', '---\nname: revisor\ndescription: Revisor.\n---\n\n# Revisor\n');
  for (const name of ['agents.ignore', 'shared.ignore', 'local.ignore', 'clients.json']) put(root, `.pbai4devs/templates/gitignore/${name}`, fs.readFileSync(join(projectRoot, '.pbai4devs/templates/gitignore', name)));
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) put(root, `.pbai4devs/templates/entrypoints/${name}`, `---\ndescription: Entry.\n---\n\n# ${name}\n\nLeia AGENTS.md.\n`);
  return root;
}
function link(t, root, target, path, type = 'file') {
  fs.mkdirSync(dirname(join(root, path)), { recursive: true });
  try { fs.symlinkSync(target, join(root, path), type); return true; }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Sistema não permite criar este link simbólico.'); return false; } throw error; }
}
function snapshot(root) {
  const result = {};
  function visit(prefix = '') {
    for (const name of fs.readdirSync(join(root, prefix)).sort()) {
      const path = prefix ? `${prefix}/${name}` : name, info = fs.lstatSync(join(root, path));
      result[path] = info.isSymbolicLink() ? ['link', fs.readlinkSync(join(root, path))] : info.isDirectory() ? ['directory', info.mode & 0o777] : ['file', info.mode & 0o777, hash(fs.readFileSync(join(root, path)))];
      if (info.isDirectory()) visit(path);
    }
  }
  visit(); return result;
}

test("coexists with native aliases and complements collisions without losing human content", t => {
  const root = fixture(t);
  put(root, '.claude/skills/existing/SKILL.md', '# Human skill\n');
  put(root, '.claude/agents/revisor.md', '# Human reviewer\n');
  put(root, '.claude/.gitignore', '# Human ignore\n*.private\n');
  put(root, 'AGENTS.md', '# Human instructions\n');
  put(root, 'external/config.json', '{"human":true}\n');
  if (!link(t, root, '../.claude/skills', '.codex/skills', 'dir') || !link(t, root, 'AGENTS.md', 'CLAUDE.md') || !link(t, root, '../external/config.json', '.claude/settings.local.json')) return;
  const original = snapshot(root), result = run(root, { force: true });
  for (const [path, before] of Object.entries(original)) {
    if (['AGENTS.md', '.claude/agents/revisor.md'].includes(path)) {
      assert.ok(fs.readFileSync(join(root, path), 'utf8').startsWith(path === 'AGENTS.md' ? '# Human instructions\n' : '# Human reviewer\n'));
      assert.match(fs.readFileSync(join(root, path), 'utf8'), /<!-- BEGIN AGENTDEVKIT -->/);
    } else assert.deepEqual(snapshot(root)[path], before, path);
  }
  for (const path of ['.codex/skills', 'CLAUDE.md', '.claude/agents/revisor.md', '.claude/.gitignore', '.claude/settings.local.json']) assert.ok(result.preserved.some(item => item.path === path), path);
  assert.ok(result.ownedOutputs.includes('.agents/skills/demo/SKILL.md'));
  assert.ok(result.ownedOutputs.every(path => !path.startsWith('.codex/skills/') && path !== '.claude/agents/revisor.md' && path !== 'CLAUDE.md'));
  const stable = snapshot(root);
  assert.equal(run(root, { check: true }).exitCode, 0);
  run(root, { force: true });
  assert.deepEqual(snapshot(root), stable);
});

test("preserves external symbolic root, pending link and loop without opening them", t => {
  for (const targetKind of ['external', 'dangling', 'loop']) {
    const root = fixture(t), outside = fixture(t);
    put(outside, 'sentinel.txt', 'outside\n');
    const beforeOutside = snapshot(outside);
    const target = targetKind === 'external' ? outside : targetKind === 'loop' ? '.codex' : join(outside, 'missing');
    if (!link(t, root, target, '.codex', targetKind === 'external' && process.platform === 'win32' ? 'junction' : 'dir')) return;
    const result = run(root, { force: true });
    assert.equal(fs.readlinkSync(join(root, '.codex')), target);
    assert.deepEqual(snapshot(outside), beforeOutside);
    assert.ok(result.preserved.some(item => item.path === '.codex' && item.reason === 'symbolic-link'));
    assert.equal(run(root, { check: true }).exitCode, 0);
  }
});

test("Ignore symbolic native remains opaque in local Git politics", t => {
  const root = fixture(t), outside = fixture(t);
  const git = spawnSync('git', ['-C', root, 'init', '-q'], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  put(outside, 'ignore', '# External human ignore\n!*.private\n');
  if (!link(t, root, join(outside, 'ignore'), '.claude/.gitignore')) return;
  const before = snapshot(outside);
  const result = run(root, { localIgnores: true });
  assert.ok(result.preserved.some(item => item.path === '.claude/.gitignore'));
  assert.deepEqual(snapshot(outside), before);
  assert.equal(run(root, { localIgnores: true, check: true }).exitCode, 0);
});

test("link on recorded path remains error before any writing", t => {
  for (const source of ['files', 'blocks', 'derived', 'outputs']) {
    const root = fixture(t), path = source === 'derived' ? 'CLAUDE.md' : source === 'outputs' ? '.agents/skills.json' : '.claude/skills/demo/SKILL.md';
    if (!link(t, root, 'missing', path)) return;
    if (source === 'derived' || source === 'outputs') put(root, '.pbai4devs/state/derived.json', JSON.stringify({ schemaVersion: 1, entries: source === 'derived' ? { [path]: 'a'.repeat(64) } : {}, ...(source === 'outputs' ? { outputs: { [path]: 'a'.repeat(64) } } : {}) }));
    else put(root, '.pbai4devs/state/agentdevkit.json', JSON.stringify({ schemaVersion: 1, files: source === 'files' ? { [path]: 'a'.repeat(64) } : {}, blocks: source === 'blocks' ? { [path]: 'a'.repeat(64) } : {} }));
    const before = snapshot(root);
    assert.throws(() => run(root, { force: true }), /Link simbolico em caminho gerenciado/);
    assert.deepEqual(snapshot(root), before);
  }
});

test("manifesto standalone edited by the user will be preserved", t => {
  const root = fixture(t); run(root);
  const path = '.agents/skills.json', original = fs.readFileSync(join(root, path), 'utf8');
  const derived = JSON.parse(fs.readFileSync(join(root, '.pbai4devs/state/derived.json')));
  assert.equal(derived.outputs[path], hash(original));
  put(root, path, '{"entries":[{"path":".agents/skills/custom"}]}\n');
  const result = run(root, { force: true });
  assert.equal(fs.readFileSync(join(root, path), 'utf8'), '{"entries":[{"path":".agents/skills/custom"}]}\n');
  assert.ok(result.preserved.some(item => item.path === path));
  assert.ok(!result.ownedOutputs.includes(path));
  assert.equal(run(root, { check: true }).exitCode, 0);
});

test('manifesto nativo inclui recursos humanos complementados com apontamento', t => {
  const root = fixture(t), collision = '.agents/skills/demo/SKILL.md';
  put(root, collision, '# Human demo\n');
  const result = run(root);
  assert.deepEqual(JSON.parse(fs.readFileSync(join(root, '.agents/skills.json'))).entries, [{ path: '.agents/skills/demo' }]);
  assert.ok(result.preserved.some(item => item.path === collision));
  assert.ok(!result.ownedOutputs.includes(collision));
  assert.equal(run(root, { check: true }).exitCode, 0);
});

test("preserves human directories in place of indexes, ignores and entries, and file in place of root", t => {
  const root = fixture(t);
  for (const path of ['.agents/skills.json', '.claude/.gitignore', 'CLAUDE.md']) put(root, `${path}/keep.txt`, 'Human data\n');
  put(root, '.codex', 'Human native configuration\n');
  const before = snapshot(root), result = run(root, { force: true });
  for (const [path, value] of Object.entries(before)) assert.deepEqual(snapshot(root)[path], value, path);
  for (const path of ['.agents/skills.json', '.claude/.gitignore', 'CLAUDE.md', '.codex']) {
    assert.ok(result.preserved.some(item => item.path === path), path);
    assert.ok(result.ownedOutputs.every(output => output !== path && !output.startsWith(`${path}/`)), path);
  }
  const stable = snapshot(root);
  assert.equal(run(root, { check: true }).exitCode, 0);
  run(root, { force: true });
  assert.deepEqual(snapshot(root), stable);
});

test("changed type on registered native path continues refused before recording", t => {
  for (const [path, owned] of [
    ['.agents/skills.json', '.agents/skills.json'],
    ['.claude/.gitignore', '.claude/.gitignore'],
    ['CLAUDE.md', 'CLAUDE.md'],
    ['.codex', '.codex/skills/demo/SKILL.md'],
  ]) {
    const root = fixture(t);
    if (path === '.codex') put(root, path, 'Human root\n'); else put(root, `${path}/keep.txt`, 'Human directory\n');
    put(root, '.pbai4devs/state/agentdevkit.json', JSON.stringify({ schemaVersion: 1, files: { [owned]: 'a'.repeat(64) }, blocks: {} }));
    const before = snapshot(root);
    if (path === '.claude/.gitignore') {
      const result = run(root, { force: true });
      assert.ok(result.preserved.some(item => item.path === path));
      assert.deepEqual(snapshot(root)[`${path}/keep.txt`], before[`${path}/keep.txt`]);
    } else {
      assert.throws(() => run(root, { force: true }), /caminho gerenciado/);
      assert.deepEqual(snapshot(root), before);
    }
  }
});

test("Preservable classification does not cover aliases per box or paths outside the scope", t => {
  const root = fixture(t);
  put(root, '.Claude/notes.txt', 'human\n');
  assert.throws(() => nativePathBoundary(root, '.claude/skills'), /maiusculas\/minusculas/);
  assert.throws(() => nativePathBoundary(root, '.claude/skills', [], { preserveRootAliases: true }), /maiusculas\/minusculas/);
  for (const path of ['../outside', '/outside', '.claude//skills', '.claude/./skills', '.claude/skills\n']) assert.throws(() => nativePathBoundary(root, path), /Caminho invalido/);
});

test("human variants of root inputs are preserved without creating duplicates", t => {
  const root = fixture(t);
  for (const path of ['Readme.md', 'agents.md', 'claude.md', 'gemini.md']) put(root, path, `# Human ${path}\n`);
  const before = snapshot(root), result = run(root, { force: true });
  for (const [path, content] of Object.entries(before)) {
    if (['agents.md', 'claude.md', 'gemini.md'].includes(path)) {
      assert.ok(fs.readFileSync(join(root, path), 'utf8').startsWith(`# Human ${path}\n`));
      assert.match(fs.readFileSync(join(root, path), 'utf8'), /<!-- BEGIN AGENTDEVKIT -->/);
    } else assert.deepEqual(snapshot(root)[path], content, path);
  }
  for (const [canonical, alias] of [['README.md', 'Readme.md'], ['AGENTS.md', 'agents.md'], ['CLAUDE.md', 'claude.md'], ['GEMINI.md', 'gemini.md']]) {
    assert.deepEqual(nativePathBoundary(root, canonical, [], { preserveRootAliases: true }), { path: alias, reason: 'case-variant' });
    if (canonical !== 'README.md') assert.ok(result.preserved.some(item => item.path === alias));
    assert.ok(!result.ownedOutputs.includes(canonical));
    assert.ok(!fs.readdirSync(root).includes(canonical), canonical);
  }
  const stable = snapshot(root);
  assert.equal(run(root, { check: true }).exitCode, 0);
  assert.deepEqual(snapshot(root), stable);
});

test("unique variant of registered entry saves content as mixed file", t => {
  for (const owned of ['AGENTS.md', 'agents.md']) {
    const root = fixture(t); put(root, 'agents.md', '# Renamed human entry\n');
    assert.throws(() => nativePathBoundary(root, 'AGENTS.md', [owned], { preserveRootAliases: true }), /maiusculas\/minusculas/);
    put(root, '.pbai4devs/state/agentdevkit.json', JSON.stringify({ schemaVersion: 1, files: { [owned]: 'a'.repeat(64) }, blocks: {} }));
    run(root, { force: true });
    assert.ok(fs.readFileSync(join(root, 'agents.md'), 'utf8').startsWith('# Renamed human entry\n'));
    assert.ok(!fs.readdirSync(root).includes('AGENTS.md'));
    assert.equal(run(root, { check: true }).exitCode, 0);
  }
});
