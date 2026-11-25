import '../../lib/test-git-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { projectRoot } from '../../lib/runtime.mjs';
import { extractManagedBlock, managedBlockDigest } from '../../lib/managed-content.mjs';
import { extractTomlManagedBlock } from '../../lib/managed-toml.mjs';
import { isReference, synchronize } from '../SCRIPT.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = (root, path) => fs.readFileSync(join(root, path), 'utf8');
const put = (root, path, text) => { fs.mkdirSync(dirname(join(root, path)), { recursive: true }); fs.writeFileSync(join(root, path), text); };
const run = (root, options = {}) => synchronize({ root, localIgnores: false, output() {}, ...options });
function snapshot(root) {
  const rows = [];
  function visit(directory, parent = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const path = parent ? parent + '/' + name : name;
      const file = join(directory, name), info = fs.lstatSync(file);
      if (info.isSymbolicLink()) rows.push([path, 'link', fs.readlinkSync(file)]);
      else if (info.isDirectory()) {
        rows.push([path, 'directory', info.mode & 0o777]);
        visit(file, path);
      } else rows.push([path, 'file', info.mode & 0o777, hash(fs.readFileSync(file))]);
    }
  }
  visit(root);
  return rows;
}
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'agentdevkit-mixed-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(root, '.pbai4devs/espelhos.conf', 'agente|.claude|plano\nagente|.cursor|plano\n');
  put(root, '.pbai4devs/skills/old/demo/SKILL.md', '---\nname: demo\ndescription: Demo.\n---\n\n# Demo\n');
  for (const name of ['agents.ignore', 'shared.ignore', 'local.ignore', 'clients.json']) put(root, `.pbai4devs/templates/gitignore/${name}`, fs.readFileSync(join(projectRoot, '.pbai4devs/templates/gitignore', name)));
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) put(root, `.pbai4devs/templates/entrypoints/${name}`, `---\ndescription: Entry.\n---\n\n# ${name}\n\nLeia AGENTS.md.\n`);
  return root;
}

test("sync complements human Markdown, preserves CRLF/metadados and follows only the block", t => {
  const root = fixture(t), path = '.claude/skills/demo/SKILL.md';
  const human = '\ufeff---\r\nname: meu-demo\r\ncustom: manter\r\n---\r\n\r\n# Minhas instrucoes\r\n\r\nTexto humano sem newline';
  put(root, path, human);
  if (process.platform !== 'win32') fs.chmodSync(join(root, path), 0o640);
  const mode = fs.statSync(join(root, path)).mode & 0o777;
  const result = run(root);
  const actual = read(root, path), block = extractManagedBlock(actual);
  assert.ok(actual.startsWith(human));
  assert.match(block, /old\/demo\/SKILL\.md/);
  assert.ok(block.includes('\r\n'));
  assert.equal(fs.statSync(join(root, path)).mode & 0o777, mode);
  assert.equal(result.managedBlocks[path], managedBlockDigest(actual));
  assert.ok(!result.ownedOutputs.includes(path));
  const state = JSON.parse(read(root, '.pbai4devs/state/derived.json'));
  assert.equal(state.blocks[path], managedBlockDigest(actual));
  assert.equal(state.files[path], undefined);
  assert.equal(run(root, { check: true }).exitCode, 0);
  run(root, { force: true });
  assert.equal(read(root, path), actual);
  put(root, path, actual + '\r\nOutro texto humano.\r\n');
  assert.equal(run(root, { check: true }).exitCode, 0);
  fs.mkdirSync(join(root, '.pbai4devs/skills/new'), { recursive: true });
  fs.renameSync(join(root, '.pbai4devs/skills/old/demo'), join(root, '.pbai4devs/skills/new/demo'));
  run(root);
  const updated = read(root, path);
  assert.ok(updated.startsWith(human));
  assert.ok(updated.endsWith('\r\nOutro texto humano.\r\n'));
  assert.match(extractManagedBlock(updated), /new\/demo\/SKILL\.md/);
  assert.equal(updated.split('<!-- BEGIN AGENTDEVKIT -->').length, 2);
});

test("sync refusal edited note and never altered human block strength", t => {
  const root = fixture(t), path = '.claude/skills/demo/SKILL.md';
  run(root);
  const generated = read(root, path);
  const edited = generated.replace('description: Demo.', 'description: Escolha humana.') + '\nMinhas regras extras.\n';
  assert.notEqual(edited, generated);
  put(root, path, edited);
  const before = snapshot(root);
  for (const force of [false, true]) {
    const check = run(root, { check: true, force });
    assert.notEqual(check.exitCode, 0);
    assert.ok(check.conflictPaths.includes(path));
    assert.deepEqual(snapshot(root), before);
    assert.throws(() => run(root, { force }), /Conteudo proprio preservado/);
    assert.deepEqual(snapshot(root), before);
    assert.equal(read(root, path), edited);
  }

  const second = fixture(t), human = '# Minhas instruções humanas\n';
  put(second, path, human);
  run(second);
  const mixed = read(second, path), block = extractManagedBlock(mixed);
  assert.ok(block);
  assert.ok(mixed.startsWith(human));
  const changed = mixed.replace(block, block.replace('Leia e siga [origem]', 'Leia [origem humana]'));
  assert.notEqual(changed, mixed);
  put(second, path, changed);
  const beforeChanged = snapshot(second);
  for (const options of [{}, { force: true }, { check: true }]) {
    assert.throws(() => run(second, options), { code: 'E_MANAGED_BLOCK' });
    assert.deepEqual(snapshot(second), beforeChanged);
    assert.equal(read(second, path), changed);
  }
});

test("Remove feature or client only removes own block from mixed Markdown", t => {
  for (const change of ['resource', 'client']) {
    const root = fixture(t), path = '.claude/skills/demo/SKILL.md', human = '# Humano\n\nMinha skill.\n';
    put(root, path, human); run(root);
    const mixed = read(root, path), outside = mixed.replace(extractManagedBlock(mixed), '');
    if (change === 'resource') fs.rmSync(join(root, '.pbai4devs/skills/old/demo'), { recursive: true });
    else put(root, '.pbai4devs/espelhos.conf', 'agente|.cursor|plano\n');
    run(root);
    assert.equal(read(root, path), outside);
    assert.ok(read(root, path).startsWith(human));
    assert.equal(JSON.parse(read(root, '.pbai4devs/state/derived.json')).blocks?.[path], undefined);
    assert.equal(run(root, { check: true }).exitCode, 0);
  }
});

test("root inputs with existing box receive only the reference and maintain human changes", t => {
  const root = fixture(t), paths = ['agents.md', 'claude.md', 'Gemini.md'];
  put(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + 'agente|.agents|plano\ndescoberta|.agents|antigravity\n');
  for (const path of paths) put(root, path, `# Minhas instrucoes de ${path}\n\nNao apague.\n`);
  const before = Object.fromEntries(paths.map(path => [path, read(root, path)]));
  const result = run(root);
  for (const path of paths) {
    assert.ok(read(root, path).startsWith(before[path]));
    assert.ok(result.managedBlocks[path]);
    assert.ok(!result.ownedOutputs.includes(path));
  }
  assert.match(extractManagedBlock(read(root, 'claude.md')), /@agents\.md/);
  assert.match(extractManagedBlock(read(root, 'Gemini.md')), /@\.\/agents\.md/);
  for (const path of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) assert.ok(!fs.readdirSync(root).includes(path));
  put(root, 'agents.md', read(root, 'agents.md') + '\nTexto depois.\n');
  assert.equal(run(root, { check: true }).exitCode, 0);
  const beforeRepeat = hash(read(root, 'agents.md')); run(root, { force: true });
  assert.equal(hash(read(root, 'agents.md')), beforeRepeat);
});

test("sync removes block only TOML proven legacy and restores human bytes", t => {
  const root = fixture(t), path = '.gemini/commands/check.toml';
  const before = 'description = "Escolha humana"\r\nprompt = \'Meu comando {{args}}\'\r\n# Comentario humano\r\n';
  // Fixture congelada no formato V3 antes de aposentar o escritor Gemini CLI.
  const metadata = [
    'eyJ2IjozLCJvcmlnaW4iOiJsaXRlcmFsLW9uZSIsInN0eWxlIjoibGl0ZXJhbC1tdWx0aSIs',
    'InNlcGFyYXRvciI6IlxuXG4iLCJlb2wiOiJcbiIsInByZSI6IiIsInN0bXRFb2wiOiIiLCJi',
    'bG9ja0hhc2giOiIzOWI4MTlkN2VmODk3YTIxNDkyOGIzN2Q2MWJjMmMwMjQxNTEzZWU4NmE2',
    'ZWRhMDM1YmRiMjhlNjQ4ODExMGRkIiwibGluZUVvbCI6IlxyXG4ifQ',
  ].join('');
  const legacy = `description = "Escolha humana"\r\n# ADK-TOML-META-V3 ${metadata}\r\n`
    + "prompt = '''Meu comando {{args}}\n\n<!-- BEGIN AGENTDEVKIT -->\n"
    + "@{.pbai4devs/commands/check/COMMAND.md}\n<!-- END AGENTDEVKIT -->\n'''\r\n# Comentario humano\r\n";
  const digest = 'f674f511d9461e9038c62c2f97caac940b508f5d7c942292db5f8a16d0336f29';
  put(root, path, legacy);
  assert.match(extractTomlManagedBlock(read(root, path)), /@\{\.pbai4devs\/commands\/check\/COMMAND\.md\}/);
  put(root, '.pbai4devs/state/agentdevkit.json', JSON.stringify({ schemaVersion: 1, files: {}, blocks: { [path]: digest } }));
  assert.equal(run(root, { check: true }).exitCode, 1);
  assert.equal(read(root, path), legacy);
  const result = run(root);
  assert.equal(read(root, path), before);
  assert.equal(result.managedBlocks[path], undefined);
  assert.ok(!result.ownedOutputs.includes(path));
  assert.ok(JSON.parse(read(root, '.pbai4devs/state/derived.json')).removedBlocks.includes(path));
  assert.equal(run(root, { check: true }).exitCode, 0);
});

test('retirada standalone registra tombstone para bloco do estado instalado', t => {
  const root = fixture(t), path = '.claude/skills/demo/SKILL.md';
  put(root, path, '# Human\n'); run(root);
  const block = managedBlockDigest(read(root, path));
  put(root, '.pbai4devs/state/agentdevkit.json', JSON.stringify({ schemaVersion: 1, files: {}, blocks: { [path]: block } }));
  fs.rmSync(join(root, '.pbai4devs/skills/old/demo'), { recursive: true });
  run(root);
  const derived = JSON.parse(read(root, '.pbai4devs/state/derived.json'));
  assert.ok(derived.removedBlocks.includes(path));
  assert.equal(extractManagedBlock(read(root, path)), null);
  assert.equal(run(root, { check: true }).exitCode, 0);
});

test("stage can generate references without recording derived state", t => {
  const root = fixture(t);
  run(root, { generateEntrypoints: false, recordDerivedState: false });
  assert.ok(fs.existsSync(join(root, '.claude/skills/demo/SKILL.md')));
  assert.ok(!fs.existsSync(join(root, '.pbai4devs/state/derived.json')));
});

test("Cursor rule maintains human globs and mode when receiving reference", t => {
  const root = fixture(t), path = '.cursor/rules/code.mdc';
  put(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + 'formato|.cursor|rules|mdc\n');
  put(root, '.pbai4devs/rules/code/RULE.md', '---\ntrigger: always_on\ndescription: Canonical.\n---\n\n# Rule\n');
  const human = '---\ndescription: Minha regra\nglobs: src/custom/**\nalwaysApply: false\n---\n\n# Regra própria\n\nConserve isto.\n';
  put(root, path, human);
  const result = run(root);
  assert.ok(read(root, path).startsWith(human));
  assert.equal(result.managedBlocks[path], managedBlockDigest(read(root, path)));
  assert.ok(!result.ownedOutputs.includes(path));
  assert.equal(run(root, { check: true }).exitCode, 0);
});

test("Human edition during planning is not overwritten by the merge calculated before", t => {
  const root = fixture(t), path = '.claude/skills/demo/SKILL.md', before = '# Humano antes\n', concurrent = '# Humano durante planejamento\n';
  put(root, path, before);
  const originalRead = fs.readFileSync;
  let injected = false;
  t.mock.method(fs, 'readFileSync', (file, ...options) => {
    const result = originalRead(file, ...options);
    if (!injected && String(file) === join(root, '.pbai4devs/templates/entrypoints/AGENTS.md')) {
      injected = true;
      fs.writeFileSync(join(root, path), concurrent);
    }
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.throws(() => run(root), /Arquivo mudou apos planejar/);
  assert.equal(injected, true);
  assert.equal(read(root, path), concurrent);
  assert.ok(!fs.existsSync(join(root, '.pbai4devs/catalog.json')));
});

test("generated pointer receiving concurrent editing before snapshot is preserved", t => {
  const root = fixture(t), path = '.claude/skills/demo/SKILL.md', concurrent = '# Novo texto humano\n';
  run(root);
  const previousCatalog = read(root, '.pbai4devs/catalog.json');
  put(root, '.pbai4devs/skills/old/demo/SKILL.md', '---\nname: demo\ndescription: Updated.\n---\n\n# Demo\n');
  const originalRead = fs.readFileSync;
  let injected = false;
  t.mock.method(fs, 'readFileSync', (file, ...options) => {
    const result = originalRead(file, ...options);
    if (!injected && String(file) === join(root, '.pbai4devs/templates/entrypoints/AGENTS.md')) {
      injected = true;
      fs.writeFileSync(join(root, path), concurrent);
    }
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.throws(() => run(root), /Arquivo mudou apos planejar/);
  assert.equal(injected, true);
  assert.equal(read(root, path), concurrent);
  assert.equal(read(root, '.pbai4devs/catalog.json'), previousCatalog);
});

test("custom native destination maintains compatibility and complements the human file", t => {
  const root = fixture(t), path = '.claude/custom.md', human = '# Meu documento\n';
  put(root, path, human);
  put(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + `nativo|${path}|.pbai4devs/skills/old/demo/SKILL.md\n`);
  const result = run(root, { force: true });
  assert.ok(read(root, path).startsWith(human));
  assert.match(read(root, path), /<!-- BEGIN AGENTDEVKIT -->/);
  assert.ok(result.managedBlocks[path]);
  assert.ok(!result.ownedOutputs.includes(path));
  assert.equal(run(root, { check: true }).exitCode, 0);
});

test("human YAML is preserved with and without origin, including force", t => {
  for (const stale of [false, true]) for (const force of [false, true]) {
    const root = fixture(t), path = '.claude/skills/demo/SKILL.md';
    run(root);
    const generated = read(root, path);
    const human = generated.replace('description: Demo.', 'description: Metadado humano.');
    assert.notEqual(human, generated);
    put(root, path, human);
    if (stale) fs.rmSync(join(root, '.pbai4devs/skills/old/demo'), { recursive: true });
    const before = snapshot(root);
    const check = run(root, { check: true, force });
    assert.notEqual(check.exitCode, 0);
    assert.deepEqual(snapshot(root), before);
    if (!stale) {
      assert.ok(check.conflictPaths.includes(path));
      assert.throws(() => run(root, { force }), /Conteudo proprio preservado/);
      assert.deepEqual(snapshot(root), before);
    } else {
      assert.ok(check.preserved.some(item => item.path === path && item.reason === 'edited-generated-file'));
      const result = run(root, { force });
      assert.ok(!result.ownedOutputs.includes(path));
    }
    assert.equal(read(root, path), human);
  }
});

test("Markdown destination with uppercase extension also preserves human content", t => {
  const root = fixture(t), path = '.claude/custom.MD', human = '# Humano\n';
  put(root, path, human);
  put(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + `nativo|${path}|.pbai4devs/skills/old/demo/SKILL.md\n`);
  const result = run(root);
  assert.ok(result.managedBlocks[path]);
  assert.ok(read(root, path).startsWith(human));
  assert.equal(run(root, { check: true }).exitCode, 0);
});

test("legacy marker without hash does not authorize to replace or remove human text", t => {
  for (const stale of [false, true]) {
    const root = fixture(t), path = '.claude/skills/demo/SKILL.md';
    const human = '---\ndescription: Metadado humano\n---\n\n# Escolha humana\n\n<!-- gerado: sincronizar-agentes -->\nLeia e siga [origem](../../origem.md).\n';
    assert.equal(isReference(human), true);
    put(root, path, human);
    if (stale) fs.rmSync(join(root, '.pbai4devs/skills/old/demo'), { recursive: true });
    const result = run(root, { force: true });
    assert.ok(read(root, path).startsWith(human));
    assert.ok(!result.ownedOutputs.includes(path));
    if (stale) assert.equal(read(root, path), human);
    else assert.ok(result.managedBlocks[path]);
    assert.equal(run(root, { check: true }).exitCode, 0);
    run(root, { force: true });
    assert.ok(read(root, path).startsWith(human));
  }
});

test("Human file created during planning is not replaced by predicted output", t => {
  for (const path of ['.claude/skills/demo/SKILL.md', '.agents/skills.json', '.claude/.gitignore']) {
    const root = fixture(t), human = path.endsWith('.json') ? '{"entries":[],"human":true}\n' : '# Criado durante planejamento\n';
    if (path.startsWith('.agents/')) put(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + 'agente|.agents|plano\ndescoberta|.agents|antigravity\n');
    const originalRead = fs.readFileSync;
    let injected = false;
    t.mock.method(fs, 'readFileSync', (file, ...options) => {
      const result = originalRead(file, ...options);
      if (!injected && String(file) === join(root, '.pbai4devs/templates/entrypoints/AGENTS.md')) {
        injected = true;
        put(root, path, human);
      }
      return result;
    });
    syncBuiltinESMExports();
    try {
      if (path === '.claude/.gitignore') run(root, { force: true });
      else assert.throws(() => run(root, { force: true }), /Arquivo mudou apos planejar/);
      assert.equal(injected, true, path);
      assert.equal(read(root, path), human, path);
      if (path !== '.claude/.gitignore') assert.ok(!fs.existsSync(join(root, '.pbai4devs/catalog.json')), path);
    } finally {
      t.mock.restoreAll(); syncBuiltinESMExports();
    }
  }
});

test("Removed mixed file is recreated without preserving missing block property", t => {
  for (const path of ['.claude/skills/demo/SKILL.md', 'AGENTS.md']) {
    const root = fixture(t);
    put(root, path, '# Humano\n'); run(root);
    const hash = managedBlockDigest(read(root, path));
    put(root, '.pbai4devs/state/agentdevkit.json', JSON.stringify({ schemaVersion: 1, clients: ['claude'], files: {}, blocks: { [path]: hash } }));
    fs.rmSync(join(root, path));
    run(root);
    const derived = JSON.parse(read(root, '.pbai4devs/state/derived.json'));
    assert.ok(derived.removedBlocks.includes(path));
    assert.ok(derived.files?.[path] || derived.entries?.[path]);
    assert.equal(extractManagedBlock(read(root, path)), null);
    assert.equal(run(root, { check: true }).exitCode, 0);
  }
});

test("rename mixed inbox transfers only block property", t => {
  const root = fixture(t), before = '# Humano\n';
  put(root, 'AGENTS.md', before); run(root);
  const hash = managedBlockDigest(read(root, 'AGENTS.md'));
  put(root, '.pbai4devs/state/agentdevkit.json', JSON.stringify({ schemaVersion: 1, files: {}, blocks: { 'AGENTS.md': hash } }));
  fs.renameSync(join(root, 'AGENTS.md'), join(root, 'agents.md'));
  const result = run(root);
  const derived = JSON.parse(read(root, '.pbai4devs/state/derived.json'));
  assert.ok(read(root, 'agents.md').startsWith(before));
  assert.ok(derived.removedBlocks.includes('AGENTS.md'));
  assert.equal(derived.blocks['agents.md'], result.managedBlocks['agents.md']);
  assert.equal(run(root, { check: true }).exitCode, 0);
});
