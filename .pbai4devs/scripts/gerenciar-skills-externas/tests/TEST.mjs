import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { ExternalSkills, loadCatalog, main, runSkills, safePath, skillsArguments, sourceUrl, validateCatalog } from '../SCRIPT.mjs';
import { projectRoot } from '../../lib/runtime.mjs';

function write(file, text) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
const sample = () => ({ id: 'vendor-demo', repository: 'vendor/skills', commit: 'a'.repeat(40), path: 'skills/demo/SKILL.md', name: 'demo', license: 'MIT', use: 'Teste offline.', status: 'reviewed' });
const contents = entry => `---\nname: ${entry.name}\ndescription: Fixture.\n---\n\n# Demo\n\nConteudo ${entry.commit}.\n`;
function fixture(t) {
  mkdirSync(join(projectRoot, '.agent-tests'), { recursive: true });
  const root = mkdtempSync(join(projectRoot, '.agent-tests/external-skills-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entry = sample(); const catalog = { schemaVersion: 1, allowlist: ['vendor/skills'], skills: [entry] };
  write(join(root, '.pbai4devs/external-skills/CATALOG.json'), JSON.stringify(catalog));
  const state = { calls: [], fail: false, corrupt: false, extra: false };
  const manager = new ExternalSkills({ root, catalog, run: async (_root, cwd, args) => {
    state.calls.push({ cwd, args });
    if (state.fail) throw new Error('download interrompido');
    if (args.includes('--list')) return 'demo: Fixture.';
    const base = join(cwd, '.agents/skills', entry.name);
    write(join(base, 'SKILL.md'), contents(entry));
    write(join(base, 'references/REFERENCE.md'), '# Referencia preservada\n');
    write(join(base, 'LICENSE.txt'), 'MIT fixture\n');
    const lock = { version: 2, skills: { [entry.name]: { source: state.corrupt ? 'other/repo' : entry.repository, ref: entry.commit, skillPath: entry.path, sourceType: 'github', computedHash: 'a'.repeat(64) } } };
    write(join(cwd, 'skills-lock.json'), JSON.stringify(lock));
    if (state.extra) write(join(cwd, '.codex/skills/demo/SKILL.md'), contents(entry));
  } });
  return { root, catalog, entry, state, manager, local: join(root, '.pbai4devs/external-skills/.local') };
}

test('catalogo aceita somente origens permitidas, pins completos e metadados de revisao', t => {
  const { root, catalog } = fixture(t);
  assert.equal(loadCatalog(root).skills[0].id, 'vendor-demo');
  for (const change of [{ commit: 'main' }, { commit: 'a'.repeat(39) }, { repository: 'evil/skills' }, { path: '../SKILL.md' }, { path: 'skills\\demo\\SKILL.md' }, { name: '../demo' }, { id: '../demo' }, { status: 'approved' }, { license: '' }, { use: '' }]) {
    assert.throws(() => validateCatalog({ ...catalog, skills: [{ ...sample(), ...change }] }));
  }
  assert.throws(() => validateCatalog({ ...catalog, skills: [sample(), sample()] }), /duplicado/);
  assert.throws(() => validateCatalog({ ...catalog, allowlist: ['vendor/skills', 'VENDOR/skills'] }), /duplicada/);
  assert.throws(() => validateCatalog({ ...catalog, skills: [{ ...sample(), notes: {} }] }), /Notas invalidas/);
  assert.throws(() => validateCatalog({ ...catalog, skills: [{ ...sample(), licenseSource: 'https://github.com/vendor/skills/blob/main/LICENSE' }] }), /mesma origem e pin/);
});

test("help and listing are local and do not create status", async t => {
  const { manager, state, local } = fixture(t);
  await main([], manager); await main(['list'], manager);
  assert.equal(state.calls.length, 0); assert.equal(existsSync(local), false);
  await assert.rejects(main(['install', 'unknown'], manager), /desconhecida/);
  await assert.rejects(main(['install', 'vendor-demo', 'extra'], manager), /unico id/);
});

test("candidates are not installed; discovery uses only fixed source without import", async t => {
  const { manager, entry, state, local } = fixture(t); entry.status = 'candidate';
  await assert.rejects(manager.install(entry.id), /Revise origem/); assert.equal(existsSync(local), false);
  const result = await manager.discover(entry.id); assert.equal(result, 'demo: Fixture.');
  assert.deepEqual(state.calls[0].args, ['add', sourceUrl(entry), '--skill', 'demo', '--list']);
  assert.deepEqual(readdirSync(local), []);
  assert.throws(() => manager.read(entry.id), /Revise origem/);
});

test("install by CLI with universal copy and preserves referencias/licenca in isolated origin", async t => {
  const { manager, entry, state, root } = fixture(t);
  const installed = await manager.install(entry.id); assert.equal(installed.changed, true);
  assert.deepEqual(state.calls[0].args, skillsArguments(entry));
  assert.ok(state.calls[0].args.includes('--copy')); assert.ok(state.calls[0].args.includes('universal')); assert.ok(!state.calls[0].args.includes('--global'));
  assert.equal(readFileSync(installed.file, 'utf8'), contents(entry));
  assert.match(readFileSync(join(dirname(installed.file), 'references/REFERENCE.md'), 'utf8'), /preservada/);
  assert.match(readFileSync(join(dirname(installed.file), 'LICENSE.txt'), 'utf8'), /MIT/);
  for (const path of ['.pbai4devs/skills', '.agents/skills', '.codex', '.claude', '.github']) assert.equal(existsSync(join(root, path)), false);
  assert.equal((await manager.install(entry.id)).changed, false); assert.equal(state.calls.length, 1);
});

test('check e read sao offline; alteracao local exige restauracao do pin revisado', async t => {
  const { manager, entry, state } = fixture(t); await manager.install(entry.id);
  const info = manager.check(entry.id); assert.equal(manager.read(entry.id).content, contents(entry)); assert.equal(state.calls.length, 1);
  write(info.file, contents(entry) + '\nAlterado.\n'); assert.throws(() => manager.check(entry.id), /Conteudo local alterado/);
  assert.throws(() => manager.read(entry.id), /Conteudo local alterado/);
  const result = await manager.update(entry.id); assert.equal(result.changed, true); assert.equal(state.calls.length, 2);
  assert.equal(manager.read(entry.id).content, contents(entry));
});

test('update aplica somente mudanca explicita para outro pin reviewed do catalogo', async t => {
  const { manager, entry, state, root } = fixture(t); await manager.install(entry.id);
  const catalogFile = join(root, '.pbai4devs/external-skills/CATALOG.json'); const catalogBefore = readFileSync(catalogFile, 'utf8');
  assert.equal((await manager.update(entry.id)).changed, false); assert.equal(state.calls.length, 1);
  entry.commit = 'b'.repeat(40); assert.throws(() => manager.check(entry.id), /Pin ou origem mudou/);
  await assert.rejects(manager.install(entry.id), /Pin ou origem mudou/);
  entry.status = 'candidate'; await assert.rejects(manager.update(entry.id), /Revise origem/);
  entry.status = 'reviewed'; await manager.update(entry.id);
  assert.equal(manager.check(entry.id).commit, entry.commit); assert.ok(state.calls[1].args[1].includes(entry.commit));
  assert.equal(readFileSync(catalogFile, 'utf8'), catalogBefore);
});

test('falhas de download, proveniencia ou destinos extras preservam a copia anterior', async t => {
  const { manager, entry, state, local } = fixture(t); const first = await manager.install(entry.id);
  const original = readFileSync(first.file, 'utf8'); const receipt = readFileSync(join(manager.local(entry.id), 'CURRENT.json'), 'utf8'); entry.commit = 'b'.repeat(40);
  for (const mode of ['fail', 'corrupt', 'extra']) {
    state[mode] = true; await assert.rejects(manager.update(entry.id), /interrompido|Proveniencia|inesperada/); state[mode] = false;
    assert.equal(readFileSync(first.file, 'utf8'), original); assert.equal(readFileSync(join(manager.local(entry.id), 'CURRENT.json'), 'utf8'), receipt);
    assert.deepEqual(readdirSync(local), [entry.id]);
  }
});

test('locks impedem duas instalacoes simultaneas sem remover lock alheio', async t => {
  const { manager, entry, state, local } = fixture(t); const originalRun = manager.run; let entered; let proceed;
  const started = new Promise(resolve => { entered = resolve; }); const ready = new Promise(resolve => { proceed = resolve; });
  manager.run = async (...args) => { entered(); await ready; return originalRun(...args); };
  const first = manager.install(entry.id); await started;
  await assert.rejects(manager.install(entry.id), /Operacao em andamento/);
  assert.ok(existsSync(join(local, `.${entry.id}.lock`))); proceed(); await first;
  assert.equal(state.calls.length, 1); assert.deepEqual(readdirSync(local), [entry.id]);
});

test("symbolic state does not redirect writing to another folder", async t => {
  const { manager, state, local, root } = fixture(t); const outside = join(root, 'outside'); mkdirSync(outside);
  try { symlinkSync(outside, local, 'dir'); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Sistema sem permissao para symlinks.'); return; } throw error; }
  assert.throws(() => safePath(manager.home, '.local'), /simbolico/);
  await assert.rejects(manager.install('vendor-demo'), /simbolico/); assert.equal(state.calls.length, 0); assert.deepEqual(readdirSync(outside), []);
});

test("CLI real skills copy fixture site without writing in canonic or global origins", async t => {
  if (!existsSync(join(projectRoot, '.pbai4devs/tools/skills/.local/CURRENT.json'))) { t.skip('CLI skills ainda nao preparado.'); return; }
  const { root } = fixture(t); const name = `external-proof-${process.pid}`; const source = join(root, 'source'); const target = join(root, 'target'); mkdirSync(target);
  const entry = { ...sample(), name }; write(join(source, 'SKILL.md'), contents(entry)); write(join(source, 'LICENSE.txt'), 'MIT fixture\n');
  const canonical = join(projectRoot, '.pbai4devs/skills', name); const global = join(homedir(), '.agents/skills', name);
  assert.equal(existsSync(canonical), false); assert.equal(existsSync(global), false);
  runSkills(projectRoot, target, ['add', source, '--skill', name, '--agent', 'universal', '--copy', '--yes']);
  const file = join(target, '.agents/skills', name, 'SKILL.md'); assert.equal(readFileSync(file, 'utf8'), contents(entry));
  assert.equal(readFileSync(join(dirname(file), 'LICENSE.txt'), 'utf8'), 'MIT fixture\n');
  assert.deepEqual(readdirSync(join(target, '.agents/skills')), [name]); assert.equal(existsSync(join(target, '.codex')), false);
  assert.equal(existsSync(canonical), false); assert.equal(existsSync(global), false);
});
