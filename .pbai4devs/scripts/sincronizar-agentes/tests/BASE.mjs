import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPrivateSyncStage, header, isReference, resourcePath, synchronize, synchronizePrivateStage } from '../SCRIPT.mjs';
import * as syncEngine from '../synchronize.mjs';
import { applySynchronization } from '../apply.mjs';
import { buildCatalog } from '../../lib/catalog.mjs';
import { resourceTargets } from '../../testar-maturidade/SCRIPT.mjs';
import { toolWrapper } from '../../preparar-ferramentas/SCRIPT.mjs';
import { mergeGitignore, ignoreBegin, ignoreEnd, validateIgnoreClients } from '../../lib/gitignore.mjs';
import { validateCatalog as validateExternalCatalog } from '../../gerenciar-skills-externas/SCRIPT.mjs';
import { stateDirectory } from '../../lib/state-path.mjs';
import { project, cli, marker, skill, source, read, write, pointer, recordOwned, toolConfig, externalConfig, run, snapshot, fixture, rejected, assertCheckReadonly } from './fixtures.mjs';

test("authenticated private internship only can dispense the diary", t => {
  const root = fixture(t, true);
  const handle = createPrivateSyncStage();
  t.after(() => rmSync(handle.path, { recursive: true, force: true }));
  const before = snapshot(root);
  assert.equal(Object.hasOwn(syncEngine, 'runSynchronization'), false);
  for (const invalid of [true, { path: root }, handle]) {
    assert.throws(() => synchronizePrivateStage({ root }, invalid), /Estágio privado inválido/);
    assert.throws(() => applySynchronization({ root, stageHandle: invalid }), /Estágio privado inválido/);
  }
  assert.deepEqual(snapshot(root), before);
});

test("direct synchronization preserves legacy state and refuses two status folders", t => {
  const root = fixture(t, true);
  write(root, source, skill);
  write(root, '.pbai4devs/estado/agentdevkit.json', JSON.stringify({
    schemaVersion: 1, clients: ['codex'], files: {}, blocks: {},
  }));
  assert.equal(run(root).exitCode, 0);
  assert.equal(existsSync(join(root, '.pbai4devs/estado/derived.json')), true);
  assert.equal(existsSync(join(root, '.pbai4devs/state')), false);
  write(root, '.pbai4devs/state/configuracao/ESTADO.md', '# Decisões próprias\n');
  const before = snapshot(root);
  assert.throws(() => run(root), /coexistem/);
  assert.deepEqual(snapshot(root), before);
});

test("state detection refusal symbolic link without opening destination", t => {
  const root = fixture(t, true);
  const external = join(root, 'externo');
  mkdirSync(external);
  symlinkSync(external, join(root, '.pbai4devs/estado'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => stateDirectory(root), /Link simbolico/);
  assert.equal(existsSync(join(root, '.pbai4devs/state')), false);
});
test("synchronises only majors, preserves metadata and uses references UTF-8 relative", t => {
  const root = fixture(t);
  assertCheckReadonly(root);
  assert.equal(run(root).exitCode, 0);
  assertCheckReadonly(root, {}, 0);
  assert.match(read(root, '.codex/skills/demo/SKILL.md'), /name: demo/);
  assert.doesNotMatch(read(root, '.codex/skills/demo/SKILL.md'), /NAO_DUPLICAR_INSTRUCOES/);
  assert.match(read(root, '.codex/skills/outro/SKILL.md'), /grupo%20com%20espa%C3%A7o/);
  assert.match(read(root, '.opencode/agents/revisor/AGENT.md'), /edit: deny/);
  assert.match(read(root, '.kimi-code/agents/revisor.md'), /tools: \[Read, Grep, Glob\]/);
  assert.ok(existsSync(join(root, '.claude/skills/projeto/demo/SKILL.md')));
  for (const client of ['.claude', '.opencode', '.github', '.codex', '.cursor', '.kimi-code', '.vscode', '.agents', '.agent']) {
    for (const kind of ['templates', 'scripts', 'tools', 'external-skills', 'state', 'estado', 'tests', 'docs', 'adapters', 'extra', 'README.md', 'INSTRUCTIONS.md']) {
      if (client === '.claude' && ['templates', 'scripts', 'tools', 'external-skills', 'state', 'tests', 'docs', 'adapters'].includes(kind)) {
        assert.equal(existsSync(join(root, client, kind, 'demo/REFERENCE.md')), false);
        assert.ok(existsSync(join(root, client, kind)), 'diretório sem prova de propriedade permanece');
      } else assert.equal(existsSync(join(root, client, kind)), false, `${client}/${kind}`);
    }
  }
  assert.deepEqual(JSON.parse(read(root, '.pbai4devs/agents.json')).entries, [{ path: '.pbai4devs/agents/revisor/AGENT.md' }]);
  assert.ok(JSON.parse(read(root, '.pbai4devs/skills.json')).entries.some(entry => entry.path === '.pbai4devs/skills/grupo com espaço/outro'));
  assert.deepEqual(JSON.parse(read(root, '.pbai4devs/rules.json')).entries, [{ path: '.pbai4devs/rules/example/RULE.md' }]);
  assert.match(read(root, '.github/workflows/ci.yml'), /workflow-preservado/);
  assert.match(read(root, '.vscode/settings.json'), /config-preservada/);
  assert.ok(existsSync(join(root, '.vscode/extensions.json')));
  assert.match(read(root, '.codex/config.toml'), /config-native-preservada/);
  assert.ok(existsSync(join(root, '.github/prompts/custom.prompt.md')));
  assert.ok(existsSync(join(root, '.claude/notas.md')));
  const before = snapshot(root);
  run(root);
  assert.deepEqual(snapshot(root), before, 'A segunda sincronização deve ser idempotente.');
});

test("Single hub derives rules by inclusion and native metadata from Antigravity", t => {
  const root = fixture(t);
  write(root, '.pbai4devs/agents/revisor/antigravity.yaml', '---\nname: revisor\nmainAgent: false\nsubagent: true\n---\n');
  write(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + [
    'nativo|.agents/agents/revisor.md|.pbai4devs/agents/revisor/AGENT.md|.pbai4devs/agents/revisor/antigravity.yaml',
    'nativo|.agent/agents/revisor.md|.pbai4devs/agents/revisor/AGENT.md|.pbai4devs/agents/revisor/antigravity.yaml',
  ].join('\n') + '\n');
  run(root);
  for (const client of ['.agents', '.agent']) {
    assert.ok(existsSync(join(root, client, 'skills/demo/SKILL.md')));
    assert.equal(existsSync(join(root, client, '.gitignore')), false);
    for (const extra of ['tools', 'scripts', 'templates', 'docs', 'external-skills']) assert.equal(existsSync(join(root, client, extra)), false);
  }
  for (const client of ['.agents', '.agent']) {
    assert.match(read(root, `${client}/agents/revisor.md`), /mainAgent: false/);
    assert.match(read(root, `${client}/rules/example.md`), /@\[origem\]\(\.\.\/\.\.\/\.pbai4devs\/rules\/example\/RULE\.md\)/);
    assert.ok(isReference(read(root, `${client}/rules/example.md`)));
    const target = read(root, `${client}/rules/example.md`).match(/@\[origem\]\(([^)]+)\)/)[1];
    assert.ok(existsSync(resolve(root, client, 'rules', decodeURIComponent(target))));
  }
  const catalog = JSON.parse(read(root, '.pbai4devs/catalog.json'));
  assert.equal(catalog.agents.length, 1);
  assert.deepEqual(JSON.parse(read(root, '.pbai4devs/agents.json')), { entries: [{ path: '.pbai4devs/agents/revisor/AGENT.md' }] });
  assert.ok(catalog.skills.every(entry => entry.path.startsWith('.pbai4devs/')));
  assertCheckReadonly(root, {}, 0);
  assert.doesNotThrow(() => validateIgnoreClients({ '.agents': {}, '.agent': {}, '.gemini': {} }));
  assert.throws(() => validateIgnoreClients({ '.pbai4devs': {} }));
});

test("manifest without state refuses the retired root with any capitalisation", t => {
  const config = '.pbai4devs/espelhos.conf';
  for (const row of [
    'agente|.gemini|plano', 'agente|.Gemini|plano', 'gitignore|.GEMINI',
    'formato|.gemini|commands|arquivo', 'fallback|.codex|.Gemini|skills',
    'nativo|.Gemini/commands/check.toml|.pbai4devs/commands/check/COMMAND.md',
    'nativo|.codex/commands/check.md|.gemini/commands/check/COMMAND.md',
  ]) {
    const root = fixture(t, true);
    write(root, config, read(root, config) + row + '\n');
    write(root, '.gemini/commands/human.toml', 'description = "Humano"\nprompt = "Meu comando"\n');
    for (const options of [{ check: true }, { force: true }]) rejected(root, options, /agentdevkit update --dry-run/);
    assert.equal(existsSync(join(root, '.pbai4devs/state/agentdevkit.json')), false);
  }
});

test("TOML new is not native destination and false legacy references are not recognized", t => {
  const root = fixture(t);
  const row = 'nativo|.claude/commands/check.toml|.pbai4devs/commands/check/COMMAND.md';
  write(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + row + '\n');
  rejected(root, { force: true }, /Destino nativo nao permitido/);
  assert.equal(isReference('# gerado: sincronizar-agentes\ndescription = "teste"\nprompt = "!{comando-local}"\n'), false);
  assert.equal(isReference('# gerado: sincronizar-agentes\ndescription = "teste"\nprompt = "@{.pbai4devs/commands/../private/COMMAND.md}\\n\\n{{args}}"\n'), false);
  assert.equal(isReference('---\ndescription: regra\n---\n\n# Regra\n\n@[../../.pbai4devs/rules/demo/RULE.md]\nTexto proprio\n'), false);
});

test("generates ignore the kit without creating customers ignores or hide features", t => {
  const root = fixture(t, true);
  write(root, source, skill);
  write(root, '.pbai4devs/espelhos.conf', 'agente|.codex|plano\ngitignore|.vscode\n');
  write(root, '.pbai4devs/templates/gitignore/clients.json', JSON.stringify({ '.vscode': { resources: false, allow: ['settings.json'] } }));
  write(root, '.vscode/settings.json', '{"preserved":true}\n');
  write(root, '.gitignore', '# Somente regras gerais\n*.tmp\n');
  const result = run(root);
  assert.equal(result.gitignores, 1);
  assert.equal(read(root, '.pbai4devs/.gitignore'), `${ignoreBegin}\n${read(root, '.pbai4devs/templates/gitignore/shared.ignore')}${ignoreEnd}\n`);
  for (const target of ['.codex', '.vscode']) assert.equal(existsSync(join(root, target, '.gitignore')), false);
  assert.equal(existsSync(join(root, '.vscode/skills')), false);
  assert.equal(read(root, '.vscode/settings.json'), '{"preserved":true}\n');
  assert.equal(read(root, '.gitignore'), '# Somente regras gerais\n*.tmp\n');
  assertCheckReadonly(root, {}, 0);
});

test("preserves customer block gitignore even when the template changes", t => {
  const root = fixture(t, true); run(root);
  const prefix = '# Regras do usuario\r\n/private-cache/\r\n';
  const suffix = '# Excecao local\r\n!keep.log\r\n';
  const old = `${prefix}${ignoreBegin}\r\n/custom-inside/\r\n${ignoreEnd}\r\n${suffix}`;
  write(root, '.codex/.gitignore', old);
  run(root, { force: true });
  assert.equal(read(root, '.codex/.gitignore'), old);
  write(root, '.pbai4devs/templates/gitignore/agents.ignore', '# Novo padrao\n{{ALLOWLIST}}\n/cache/\n/session/\n');
  run(root, { force: true });
  assert.equal(read(root, '.codex/.gitignore'), old);
  assertCheckReadonly(root, {}, 0);
});

test("preserves gigignore itself, detects exclusion from shared ignorance and maintains idempotencia", t => {
  const root = fixture(t, true);
  const custom = '# Local\n/custom/\n!custom/keep'; write(root, '.codex/.gitignore', custom);
  run(root); assert.equal(read(root, '.codex/.gitignore'), custom);
  const before = snapshot(root); run(root); assert.deepEqual(snapshot(root), before);
  rmSync(join(root, '.pbai4devs/.gitignore')); assertCheckReadonly(root);
  assert.equal(run(root).gitignores, 1); assertCheckReadonly(root, {}, 0);
});

test('ignores existentes e indice staged sobrevivem a template compartilhado alterado', t => {
  const root = fixture(t, true);
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  write(root, '.gitignore', '# regra humana\n'); write(root, 'humano.txt', 'conteudo staged\n');
  assert.equal(spawnSync('git', ['-C', root, 'add', '--', '.gitignore', 'humano.txt']).status, 0);
  for (const name of ['local.ignore', 'agents.ignore']) {
    write(root, `.pbai4devs/templates/gitignore/${name}`, readFileSync(join(project, '.pbai4devs/templates/gitignore', name), 'utf8'));
  }
  const index = readFileSync(join(root, '.git/index'));
  const exclude = readFileSync(join(root, '.git/info/exclude'));
  const projectIgnore = readFileSync(join(root, '.gitignore'));
  const assertGitPreserved = () => {
    assert.deepEqual(readFileSync(join(root, '.git/index')), index);
    assert.deepEqual(readFileSync(join(root, '.git/info/exclude')), exclude);
    assert.deepEqual(readFileSync(join(root, '.gitignore')), projectIgnore);
  };
  run(root, { localIgnores: true }); assertGitPreserved();
  const shared = readFileSync(join(root, '.pbai4devs/.gitignore'));
  write(root, '.pbai4devs/templates/gitignore/shared.ignore', '# Modelo alterado\n/novo-cache/\n');
  const check = run(root, { check: true, localIgnores: true });
  assert.equal(check.gitignores, 0, 'check nao compara ignore existente ao novo modelo');
  assertGitPreserved(); assert.deepEqual(readFileSync(join(root, '.pbai4devs/.gitignore')), shared);
  run(root, { force: true, localIgnores: true });
  assert.deepEqual(readFileSync(join(root, '.pbai4devs/.gitignore')), shared);
  assert.equal(existsSync(join(root, '.codex/.gitignore')), false);
  assertGitPreserved();
});

test("gitignore refuses invalid markers and missing sources before any mutation", t => {
  for (const text of [ignoreBegin, ignoreEnd, `${ignoreEnd}\n${ignoreBegin}\n`, `${ignoreBegin}\na\n${ignoreEnd}\n${ignoreBegin}\nb\n${ignoreEnd}\n`]) {
    const root = fixture(t, true); write(root, '.codex/.gitignore', text);
    run(root, { force: true }); assert.equal(read(root, '.codex/.gitignore'), text);
  }
  for (const text of ['', `${ignoreBegin}\n/cache/\n${ignoreEnd}\n`]) {
    const root = fixture(t, true); write(root, '.pbai4devs/templates/gitignore/shared.ignore', text);
    rejected(root, { force: true }, /Template/);
  }
  const missing = fixture(t, true); rmSync(join(missing, '.pbai4devs/templates/gitignore/agents.ignore'));
  assert.doesNotThrow(() => run(missing, { force: true }));
  for (const row of ['gitignore|.vscode|extra', 'gitignore|.pbai4devs', 'gitignore|../outside', 'gitignore|.git', 'gitignore|.CODEX']) {
    const root = fixture(t, true); write(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + row + '\n');
    rejected(root, { force: true });
  }
});

test('gitignore gerado funciona no Git sem esconder definicoes versionadas', t => {
  const root = fixture(t);
  const git = spawnSync('git', ['init', '-q', root], { encoding: 'utf8' });
  if (git.error?.code === 'ENOENT') { t.skip('Git ausente: prova de regras delegada a integracao.'); return; }
  assert.equal(git.status, 0, git.stderr); run(root);
  write(root, '.pbai4devs/tools/demo/.local/state.json', '{}\n');
  assert.equal(spawnSync('git', ['check-ignore', '--no-index', '.pbai4devs/tools/demo/.local/state.json'], { cwd: root }).status, 0);
  for (const file of ['.codex/cache/session.json', '.claude/debug.log']) {
    write(root, file, '{}\n');
    assert.equal(spawnSync('git', ['check-ignore', '--no-index', file], { cwd: root }).status, 1, file);
  }
  for (const file of ['.pbai4devs/tools/demo/TOOL.json', '.pbai4devs/tools/demo/SCRIPT.mjs', '.codex/skills/demo/SKILL.md', '.codex/.gitignore', '.pbai4devs/.gitignore']) {
    assert.equal(spawnSync('git', ['check-ignore', '--no-index', file], { cwd: root }).status, 1, file);
  }
});

test("mergeGitignore preserves external bytes and does not interpret the file as Markdown", () => {
  const current = `---\r\ncustom: true\r\n---\r\n${ignoreBegin}\r\nold\r\n${ignoreEnd}\r\n**/other\r\n`;
  const merged = mergeGitignore(current, '*.log\n');
  assert.equal(merged.hasBlock, true);
  assert.equal(merged.text, `---\r\ncustom: true\r\n---\r\n${ignoreBegin}\n*.log\n${ignoreEnd}\n**/other\r\n`);
});

test("allowlist opens only settings and directories declared in Git", t => {
  const root = fixture(t, true);
  write(root, '.pbai4devs/espelhos.conf', 'agente|.codex|plano\ngitignore|.vscode\n');
  write(root, '.pbai4devs/templates/gitignore/clients.json', JSON.stringify({ '.codex': { allow: ['config.toml', 'native/file.json'] }, '.vscode': { resources: false, allow: ['settings.json', 'snippets/'] } }));
  write(root, '.gitignore', '.DS_Store\n*.swp\nThumbs.db\n');
  const git = spawnSync('git', ['init', '-q', root], { encoding: 'utf8' });
  if (git.error?.code === 'ENOENT') { t.skip('Git ausente: prova de allowlist delegada a integracao.'); return; }
  assert.equal(git.status, 0, git.stderr); run(root);
  for (const file of ['.codex/config.toml', '.codex/native/file.json', '.codex/skills/demo/SKILL.md', '.vscode/settings.json', '.vscode/snippets/example.code-snippets']) {
    write(root, file, 'fixture\n'); assert.equal(spawnSync('git', ['check-ignore', '--no-index', file], { cwd: root }).status, 1, file);
  }
  for (const file of ['.codex/native/extra.json', '.codex/auth.json', '.vscode/skills/demo/SKILL.md', '.vscode/tasks.json', '.codex/skills/demo/.DS_Store', '.codex/skills/demo/file.swp', '.vscode/snippets/Thumbs.db']) {
    write(root, file, 'fixture\n'); assert.equal(spawnSync('git', ['check-ignore', '--no-index', file], { cwd: root }).status, /(?:\.DS_Store|\.swp|Thumbs\.db)$/.test(file) ? 0 : 1, file);
  }
  assert.equal(existsSync(join(root, '.codex/clients.json')), false);
});

test('allowlist invalida ou token ausente falha antes de mutacoes', t => {
  for (const config of [[], null, { '.pbai4devs': {} }, { '../outside': {} }, { '.codex': [], '.vscode': {} }, { '.codex': { resources: 'false' } }, { '.codex': { allow: null } }, { '.codex': { extra: true } }, { '.codex': {}, '.CODEX': {} }]) assert.throws(() => validateIgnoreClients(config));
  for (const path of ['/absolute', '../outside', 'nested/../outside', './file', 'C:/file', 'back\\slash', 'double//slash', '*', '*.json', '!file', '#file', 'ends ', '']) assert.throws(() => validateIgnoreClients({ '.codex': { allow: [path] } }), /relativo/);
  for (const body of ['{{ALLOWLIST}}\n{{ALLOWLIST}}\n']) {
    const root = fixture(t, true); write(root, '.pbai4devs/templates/gitignore/agents.ignore', body); run(root, { force: true });
    assert.equal(existsSync(join(root, '.codex/.gitignore')), false);
  }
  const root = fixture(t, true); write(root, '.pbai4devs/templates/gitignore/clients.json', '{broken'); rejected(root, { force: true });
});

test("records are derived, deterministic and --check never corrects them", t => {
  const root = fixture(t);
  run(root);
  write(root, '.pbai4devs/skills.json', '{"incorreto":true}\n');
  assertCheckReadonly(root);
  assert.throws(() => run(root, { force: true }), /Conteudo proprio preservado/);
  assert.equal(read(root, '.pbai4devs/skills.json'), '{"incorreto":true}\n');
  rmSync(join(root, '.pbai4devs/skills.json'));
  run(root);
  assert.ok(Array.isArray(JSON.parse(read(root, '.pbai4devs/skills.json')).entries));
  rmSync(join(root, '.pbai4devs/adapters/antigravity/agents/revisor.md'));
  run(root);
  assert.deepEqual(JSON.parse(read(root, '.pbai4devs/agents.json')).entries, [{ path: '.pbai4devs/agents/revisor/AGENT.md' }]);
  const empty = fixture(t, true);
  run(empty);
  assert.deepEqual(JSON.parse(read(empty, '.pbai4devs/skills.json')), { entries: [] });
  assertCheckReadonly(empty, {}, 0);
});

test("Downloaded external skills do not enter the indexes; human copies remain intact", t => {
  const root = fixture(t);
  write(root, '.pbai4devs/external-skills/README.md', '# Catálogo externo\n');
  write(root, '.pbai4devs/external-skills/CATALOG.json', JSON.stringify(externalConfig()));
  for (let index = 0; index < 80; index++) write(root, `.pbai4devs/external-skills/.local/upstream-${index}/SKILL.md`, '# Skill upstream sem frontmatter\n');
  run(root);
  const index = JSON.parse(read(root, '.pbai4devs/skills.json')).entries;
  assert.equal(index.length, 2);
  assert.ok(index.every(entry => entry.path.startsWith('.pbai4devs/skills/')));
  assert.equal(existsSync(join(root, '.codex/skills/upstream-0')), false);
  const sourceBefore = read(root, '.pbai4devs/external-skills/.local/upstream-0/SKILL.md');
  write(root, '.codex/external-skills/.local/upstream-0/SKILL.md', '# Cópia indevida\n');
  write(root, '.claude/external-skills/README.md', pointer('../../.pbai4devs/external-skills/README.md'));
  assertCheckReadonly(root, {}, 0);
  const result = run(root, { force: true });
  assert.equal(read(root, '.claude/external-skills/README.md'), pointer('../../.pbai4devs/external-skills/README.md'));
  assert.ok(result.preserved.some(item => item.path === '.codex/external-skills'));
  assert.equal(read(root, '.pbai4devs/external-skills/.local/upstream-0/SKILL.md'), sourceBefore);
  assert.equal(read(root, '.codex/external-skills/.local/upstream-0/SKILL.md'), '# Cópia indevida\n');
  assertCheckReadonly(root, {}, 0);
});

test('sync e --force recusam apontamentos editados preservando recursos humanos', t => {
  const root = fixture(t);
  run(root);
  const paths = ['.claude/skills/projeto/demo/SKILL.md', '.kimi-code/agents/revisor.md'];
  recordOwned(root, paths);
  write(root, '.claude/scripts/local.sh', 'script humano\n');
  write(root, '.claude/tools/program.exe', Buffer.from([1, 2, 3]));
  write(root, '.claude/docs/plain.md', '# Documento auxiliar\n');
  write(root, '.claude/skills/local.bin', 'custom\n');
  for (const path of paths) write(root, path, 'corrompido\n');
  write(root, '.github/prompts/edited.prompt.md', pointer() + '\nRevisar [manual](bar).\n');
  for (const force of [false, true]) {
    const before = snapshot(root), check = run(root, { check: true, force });
    assert.notEqual(check.exitCode, 0);
    for (const path of paths) assert.ok(check.conflictPaths.includes(path));
    assert.deepEqual(snapshot(root), before);
    rejected(root, { force }, /Conteudo proprio preservado/);
    for (const path of paths) assert.equal(read(root, path), 'corrompido\n');
  }
  assert.deepEqual(readFileSync(join(root, '.claude/tools/program.exe')), Buffer.from([1, 2, 3]));
  assert.equal(read(root, '.claude/scripts/local.sh'), 'script humano\n');
  assert.equal(read(root, '.claude/skills/local.bin'), 'custom\n');
  assert.match(read(root, '.github/prompts/edited.prompt.md'), /Revisar \[manual\]/);
  assert.ok(existsSync(join(root, '.codex/skills/outro/SKILL.md')));
  assert.match(read(root, '.codex/skills/outro/SKILL.md'), /name: outro/);
  assert.match(read(root, '.github/workflows/ci.yml'), /workflow-preservado/);
  assert.match(read(root, '.codex/config.toml'), /config-native-preservada/);
});

test("preserves human legacy lines without proof of ownership", t => {
  const root = fixture(t);
  run(root);
  write(root, 'docs/produto/prd/demo/PRD.md', '# Produto real\n');
  write(root, 'manual/guia com espaço/DOC.md', '# Documento real\n');
  write(root, '.claude/manual/DOC.md', pointer('../../manual/guia%20com%20espa%C3%A7o/DOC.md'));
  write(root, '.github/prompts/missing.prompt.md', pointer());
  write(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + 'documento|manual\n' + 'nativo|.github/prompts/missing.prompt.md|.pbai4devs/commands/missing/COMMAND.md\n');
  const config = read(root, '.pbai4devs/espelhos.conf');
  assertCheckReadonly(root);
  assert.throws(() => run(root, { force: true }), /Conteudo proprio preservado/);
  assert.equal(read(root, '.pbai4devs/espelhos.conf'), config);
  assert.equal(existsSync(join(root, '.claude/manual/DOC.md')), true);
  assert.equal(existsSync(join(root, '.github/prompts/missing.prompt.md')), true);
  assert.ok(existsSync(join(root, 'docs/produto/prd/demo/PRD.md')));
  assert.ok(existsSync(join(root, 'manual/guia com espaço/DOC.md')));
  assertCheckReadonly(root);
});

test("clean legate configuration provenly managed and registers new hash", t => {
  const root = fixture(t);
  const path = '.pbai4devs/espelhos.conf';
  write(root, path, read(root, path) + 'documento|manual\n');
  recordOwned(root, [path]);
  run(root);
  assert.doesNotMatch(read(root, path), /documento\|/);
  const derived = JSON.parse(read(root, '.pbai4devs/state/derived.json'));
  assert.equal(derived.config, createHash('sha256').update(readFileSync(join(root, path))).digest('hex'));
  assertCheckReadonly(root, {}, 0);
});

test("rejects manifests outside the scope, extra fields, conflicting paths and boxes without mutation", t => {
  const rows = [
    'agente|.git', 'agente|.AGENTS|plano', 'agente|.GIT|plano', 'agente|.AgEnT-TeStS|plano', 'agente|.CLAUDE|plano', 'agente|.claude|plano', 'agente|.other|invalid', 'agente|.other|plano|extra',
    'agente|../outside|plano', 'agente|C:/outside|plano', 'agente|.test//dir|plano', 'agente|.test\\dir|plano', 'agente|.test|plano|extra|another',
    `nativo|.github/workflows/unsafe.md|${source}`, `nativo|.github/WorkFlows/unsafe.md|${source}`, `nativo|.claude/templates/unsafe.md|${source}`, `nativo|.claude/external-skills/unsafe.md|${source}`, `nativo|.claude/README.md|${source}`, `nativo|.outside/prompts/unsafe.md|${source}`,
    'nativo|.claude/prompts/aux.md|.pbai4devs/templates/demo/REFERENCE.md', 'nativo|.github/prompts/aux.md|.pbai4devs/skills/projeto/demo/REFERENCE.md', 'nativo|.claude/prompts/wrong.md|.pbai4devs/commands/check/COMMAND.md|.pbai4devs/agents/revisor/kimi-code.yaml',
  ];
  for (const row of rows) {
    const root = fixture(t);
    write(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + row + '\n');
    rejected(root, { force: true });
  }
});

test("destination collisions, ancestry, metadata and slugs are not resolved by --force", t => {
  for (const variant of ['slug', 'source', 'ancestor', 'metadata', 'target-case']) {
    const root = fixture(t);
    let extra;
    if (variant === 'slug') write(root, '.pbai4devs/skills/duplicado/demo/SKILL.md', skill);
    if (variant === 'source') extra = 'nativo|.codex/skills/demo/SKILL.md|.pbai4devs/commands/check/COMMAND.md';
    if (variant === 'ancestor') extra = [`nativo|.github/prompts/custom.md|${source}`, `nativo|.github/prompts/custom.md/child.md|${source}`].join('\n');
    if (variant === 'target-case') extra = [`nativo|.github/prompts/custom.md|${source}`, `nativo|.github/prompts/CUSTOM.md|${source}`].join('\n');
    if (variant === 'metadata') {
      write(root, '.pbai4devs/agents/revisor/other.yaml', '---\nname: other\n---\n');
      extra = 'nativo|.kimi-code/agents/revisor.md|.pbai4devs/agents/revisor/AGENT.md|.pbai4devs/agents/revisor/other.yaml';
    }
    if (extra) write(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + extra + '\n');
    rejected(root, { force: true }, /conflito|ancestral|maiusculas/i);
  }
});

test("incomplete, absent and body metadata are rejected before changes", t => {
  for (const text of ['name: revisor\n', '---\nname: revisor\n', '---\nname: revisor\n---\ntexto indevido\n', null]) {
    const root = fixture(t);
    const metadata = '.pbai4devs/agents/revisor/kimi-code.yaml';
    if (text === null) rmSync(join(root, metadata)); else write(root, metadata, text);
    rejected(root, { force: true }, /YAML|Metadados|Frontmatter/);
  }
  const root = fixture(t);
  write(root, source, '---\nname: demo\n---\nSem titulo\n');
  rejected(root, { force: true }, /Titulo/);
});

test("canonical symlinks are rejected without effect when the system allows to create them", t => {
  for (const location of ['.pbai4devs/skills/projeto/demo/external.md', '.pbai4devs/skills.json', '.pbai4devs/espelhos.conf']) {
    const root = fixture(t);
    rmSync(join(root, location), { recursive: true, force: true });
    try { symlinkSync(join(root, 'missing-target'), join(root, location)); }
    catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Sistema não permite criar symlinks de teste.'); return; } throw error; }
    rejected(root, { force: true }, /Link simbolico/);
  }
});

test("control names are rejected without effects on all systems", t => {
  const root = fixture(t);
  const manifest = read(root, '.pbai4devs/espelhos.conf');
  write(root, '.pbai4devs/espelhos.conf', manifest + `nativo|.claude/skills/invalid\u0001.md|${source}\n`);
  rejected(root, { force: true }, /Caminho invalido/);
  assert.match(read(root, 'README.md'), /README raiz preservado/);

  if (process.platform !== 'win32') {
    const filesystem = fixture(t);
    write(filesystem, '.claude/skills/invalid\nREADME.md', 'nunca deve fragmentar caminho\n');
    rejected(filesystem, { force: true }, /Caminho invalido/);
    assert.match(read(filesystem, 'README.md'), /README raiz preservado/);
  }
});

test("non-regular records are rejected without effect", t => {
  const other = fixture(t);
  mkdirSync(join(other, '.pbai4devs/skills.json'));
  rejected(other, { force: true }, /Registro nao e arquivo/);
});

test("symbolic root refusal recovery with project files intact", t => {
  const root = fixture(t);
  run(root);
  write(root, source, skill.replace('Exemplo.', 'Exemplo modificado.'));
  write(root, '.claude/scripts/own.sh', 'preservar\n');
  const outside = join(root, 'outside');
  mkdirSync(outside);
  const recoveryRoot = join(root, '.agent-tests');
  renameSync(recoveryRoot, join(root, 'diario-original-da-fixture'));
  try { symlinkSync(outside, recoveryRoot, 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Sistema não permite criar symlinks de teste.'); return; } throw error; }
  rejected(root, { force: true }, { code: 'E_RECOVERY_STORE', recovery: { status: 'invalid', reason: 'invalid-store' } });
  assert.match(read(root, '.claude/scripts/own.sh'), /preservar/);
  assert.deepEqual(readdirSync(outside), []);
});

test("frontmatter and note recognition do not confuse own instructions", () => {
  assert.equal(header('---\r\nname: test\r\n---\r\nbody\r\n'), '---\nname: test\n---\n');
  assert.ok(isReference(pointer()));
  assert.ok(isReference('# Git\n\nLeia [origem](x) ao realizar operações Git.\n'));
  assert.equal(isReference(pointer() + '\nInstrução própria.\n'), false);
  assert.equal(isReference(pointer() + '\nLeia [outra](x).\n'), false);
  assert.equal(isReference('---\nsem fechamento\n# Titulo\nLeia [origem](x).\n'), false);
  assert.throws(() => header('sem YAML'), /YAML/);
});

test("CLI Node propagates check codes and rejects options without invoking shell", t => {
  const root = fixture(t);
  write(root, '.pbai4devs/templates/gitignore/local.ignore', readFileSync(join(project, '.pbai4devs/templates/gitignore/local.ignore'), 'utf8'));
  write(root, '.pbai4devs/templates/gitignore/agents.ignore', readFileSync(join(project, '.pbai4devs/templates/gitignore/agents.ignore'), 'utf8'));
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  run(root, { localIgnores: true });
  const before = snapshot(root);
  const good = spawnSync(process.execPath, [cli, '--root', root, '--check'], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /0 desatualizadas/);
  for (const option of ['--documento', '--invalid', '--root']) {
    const result = spawnSync(process.execPath, [cli, '--root', root, option], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
  }
  assert.deepEqual(snapshot(root), before);
  write(root, source, skill.replace('Exemplo.', 'Novo.'));
  const changed = spawnSync(process.execPath, [cli, '--root', root, '--force', '--check'], { encoding: 'utf8' });
  assert.equal(changed.status, 1, changed.stderr);
});

test("Inputs from CLI maintain full ownership and resources have derived provenance", t => {
  const root = fixture(t, true);
  const template = '---\ndescription: Entrada.\n---\n\n# Agentes\n';
  const entry = template + '\nResponda em português.\n';
  write(root, source, skill);
  write(root, '.pbai4devs/templates/entrypoints/AGENTS.md', template);
  write(root, 'AGENTS.md', entry);
  write(root, '.pbai4devs/state/agentdevkit.json', JSON.stringify({ clients: ['codex'], files: { 'AGENTS.md': createHash('sha256').update(entry).digest('hex') } }));
  const result = run(root, { generateEntrypoints: true });
  assert.ok(result.ownedOutputs.includes('AGENTS.md'));
  assert.equal(read(root, 'AGENTS.md'), entry);
  assert.equal(JSON.parse(read(root, '.pbai4devs/state/derived.json')).entries['AGENTS.md'], undefined);
  assert.ok(JSON.parse(read(root, '.pbai4devs/state/derived.json')).files['.codex/skills/demo/SKILL.md']);
  assertCheckReadonly(root, { generateEntrypoints: true }, 0);
});

function completeCatalogFixture(t) {
  const root = fixture(t, true);
  for (const [kind, file] of Object.entries({ skills: 'SKILL.md', agents: 'AGENT.md', commands: 'COMMAND.md', rules: 'RULE.md', templates: 'TEMPLATE.md' })) {
    write(root, `.pbai4devs/${kind}/demo/${file}`, `---\nname: demo\n${kind === 'rules' ? 'trigger: always_on\n' : ''}description: ${kind} original.\n---\n\n# Demo ${kind}\n`);
  }
  write(root, '.pbai4devs/templates/demo/config.yaml.template', 'example: true\n');
  write(root, '.pbai4devs/tools/demo/TOOL.json', JSON.stringify(toolConfig()));
  write(root, '.pbai4devs/tools/demo/SCRIPT.mjs', toolWrapper('demo'));
  write(root, '.pbai4devs/scripts/demo/SCRIPT.mjs', '#!/usr/bin/env node\nconsole.log("fixture");\n');
  write(root, '.pbai4devs/scripts/demo/README.md', '---\ndescription: scripts original.\n---\n\n# Demo\n');
  write(root, '.pbai4devs/scripts/demo/tests/TEST.mjs', '// Teste versionado.\n');
  write(root, '.pbai4devs/scripts/demo/tests/SMOKE_DEMO.mjs', '// Smoke versionado.\n');
  write(root, '.pbai4devs/scripts/lib/shared.mjs', 'export const shared = true;\n');
  write(root, '.pbai4devs/external-skills/CATALOG.json', JSON.stringify(externalConfig()));
  return root;
}

test('nativos recusam principais dentro de estado ignorado e fora do catalogo', t => {
  for (const directory of ['.local', '.cache', 'tmp', 'test-results', 'playwright-report']) {
    const root = fixture(t, true);
    const hidden = `.pbai4devs/skills/${directory}/oculto/SKILL.md`;
    write(root, hidden, skill);
    write(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + `nativo|.codex/skills/oculto/SKILL.md|${hidden}\n`);
    rejected(root, { force: true }, /fora do catalogo canonico/);
  }
});

test("rules validate trigger and context before generating records or mirrors", t => {
  const root = fixture(t, true); const path = '.pbai4devs/rules/demo/RULE.md';
  const rule = fields => `---\ndescription: Regra de teste.\n${fields}---\n\n# Regra\n`;
  for (const [fields, expected] of [
    ['trigger: always_on\n', { trigger: 'always_on' }],
    ['trigger: model_decision\n', { trigger: 'model_decision' }],
    ['trigger: manual\n', { trigger: 'manual' }],
    ['trigger: glob\nglobs: "**/*.ts"\n', { trigger: 'glob', globs: '**/*.ts' }],
    ['trigger: glob\nglob: "src/**"\n', { trigger: 'glob', globs: 'src/**' }],
  ]) {
    write(root, path, rule(fields));
    const entry = buildCatalog(root).catalog.rules[0];
    assert.equal(entry.trigger, expected.trigger); assert.equal(entry.globs, expected.globs);
  }
  for (const fields of ['', 'trigger: invalid\n', 'trigger: glob\n', 'trigger: glob\nglobs: []\n', 'trigger: glob\nglob: "a/**"\nglobs: "b/**"\n']) {
    write(root, path, rule(fields)); rejected(root, { force: true }, /Trigger|globs|Metadado|conflitantes/);
  }
  write(root, path, rule('trigger: model_decision\n').replace('description: Regra de teste.\n', ''));
  rejected(root, { force: true }, /Descricao ausente/);
});

test('outputs ignorados nao entram nos assets; fixtures versionaveis continuam', t => {
  const root = completeCatalogFixture(t);
  const hidden = ['scripts/demo/playwright-report/index.html', 'scripts/demo/.Playwright-MCP/session.json', 'scripts/demo/TEST-RESULTS/report.json', 'scripts/demo/TmP/README.md', 'scripts/demo/run.log', 'scripts/demo/Sessions/state.json', 'scripts/demo/auth.json', 'scripts/demo/CREDENTIALS.JSON', 'scripts/demo/history.jsonl', 'scripts/demo/settings.LOCAL.yaml', 'scripts/demo/.env', 'skills/demo/.agent-tests/trace.json', 'templates/demo/temp/data.json'];
  for (const path of hidden) write(root, `.pbai4devs/${path}`, 'output temporario\n');
  const kept = ['scripts/demo/tests/fixtures/cache/input.json', 'scripts/demo/tests/fixtures/playwright-response.json', 'scripts/demo/tests/fixtures/auth.sample.json', 'scripts/demo/.env.example', 'templates/demo/compose.local.yml.template'];
  for (const path of kept) write(root, `.pbai4devs/${path}`, 'fixture versionavel\n');
  const catalog = buildCatalog(root).catalog;
  const assets = new Set(Object.values(catalog).flatMap(entries => Array.isArray(entries) ? entries.flatMap(entry => entry.assets) : []));
  for (const path of hidden) assert.ok(!assets.has(`.pbai4devs/${path}`), path);
  for (const path of kept) assert.ok(assets.has(`.pbai4devs/${path}`), path);
});

test("complete catalog derives eight types, real actions and asset without local state", t => {
  const root = completeCatalogFixture(t);
  write(root, '.pbai4devs/scripts/browser/SCRIPT.conf', 'executor=playwright-mcp\n');
  write(root, '.pbai4devs/scripts/browser/SCRIPT.js', '(page) => page.title();\n');
  write(root, '.pbai4devs/commands/demo/COMMAND.md', '---\ndescription: Comando com referências.\n---\n\n# Demo\n\nLeia [tool](../../tools/demo/TOOL.json), [script][script], [pasta](../../scripts/demo/) e [template](../../templates/demo/TEMPLATE.md).\n\n[script]: ../../scripts/demo/SCRIPT.mjs\n');
  for (const path of ['.pbai4devs/tools/demo/.local/node_modules/payload/SKILL.md', '.pbai4devs/tools/demo/versions/1.0.0/package.json', '.pbai4devs/external-skills/.local/upstream/SKILL.md', '.pbai4devs/scripts/demo/.cache/large.json']) write(root, path, 'conteúdo local inválido deliberado');
  const before = snapshot(root);
  const first = buildCatalog(root);
  assert.deepEqual(snapshot(root), before, 'Construir o catálogo não pode escrever arquivos.');
  assert.deepEqual(buildCatalog(root), first);
  for (const type of ['skills', 'agents', 'commands', 'rules', 'templates', 'tools', 'scripts', 'externalSkills']) assert.ok(first.catalog[type].length, type);
  assert.deepEqual([...first.outputs.keys()].sort(), ['.pbai4devs/agents.json', '.pbai4devs/catalog.json', '.pbai4devs/rules.json', '.pbai4devs/skills.json']);
  assert.ok(first.catalog.templates[0].assets.includes('.pbai4devs/templates/demo/config.yaml.template'));
  assert.deepEqual(first.catalog.commands[0].references, ['.pbai4devs/scripts/demo', '.pbai4devs/scripts/demo/SCRIPT.mjs', '.pbai4devs/templates/demo/TEMPLATE.md', '.pbai4devs/tools/demo/TOOL.json']);
  const tool = first.catalog.tools[0];
  for (const action of ['install', 'update', 'check', 'info', 'run']) assert.deepEqual(tool.actions[action].argv, ['node', '.pbai4devs/tools/demo/SCRIPT.mjs', action]);
  assert.equal(tool.actions.run.requiresArguments, true);
  const script = first.catalog.scripts.find(entry => entry.id === 'demo');
  assert.deepEqual(script.argv, ['node', '.pbai4devs/scripts/demo/SCRIPT.mjs']);
  assert.deepEqual(script.support.modules, ['.pbai4devs/scripts/lib/shared.mjs']);
  assert.deepEqual(script.support.tests, ['.pbai4devs/scripts/demo/tests/TEST.mjs']);
  assert.deepEqual(script.support.smokes, ['.pbai4devs/scripts/demo/tests/SMOKE_DEMO.mjs']);
  const browser = first.catalog.scripts.find(entry => entry.id === 'browser');
  assert.equal(browser.executor, 'playwright-mcp');
  assert.equal(browser.path, '.pbai4devs/scripts/browser/SCRIPT.js');
  assert.deepEqual(browser.argv, []);
  assert.equal(first.catalog.externalSkills[0].path, '.pbai4devs/external-skills/CATALOG.json');
  assert.equal(first.catalog.externalSkills[0].upstreamPath, 'skills/demo/SKILL.md');
  assert.doesNotMatch(first.outputs.get('.pbai4devs/catalog.json'), /node_modules|\.local|versions|\.cache|installed|conteúdo local|updatedAt/);
  run(root);
  for (const [path, text] of first.outputs) assert.equal(read(root, path), text);
  assertCheckReadonly(root, {}, 0);
});

test("create edit and remove features updates all types and native indexes", t => {
  const root = completeCatalogFixture(t);
  run(root);
  for (const [kind, file] of Object.entries({ skills: 'SKILL.md', agents: 'AGENT.md', commands: 'COMMAND.md', rules: 'RULE.md', templates: 'TEMPLATE.md' })) write(root, `.pbai4devs/${kind}/demo/${file}`, `---\nname: demo\n${kind === 'rules' ? 'trigger: always_on\n' : ''}description: ${kind} atualizado.\n---\n\n# Demo\n`);
  write(root, '.pbai4devs/tools/demo/TOOL.json', JSON.stringify({ ...toolConfig(), description: 'tools atualizado.' }));
  write(root, '.pbai4devs/scripts/demo/README.md', '---\ndescription: scripts atualizado.\n---\n\n# Demo\n');
  const external = externalConfig(); external.skills[0].use = 'externalSkills atualizado.';
  write(root, '.pbai4devs/external-skills/CATALOG.json', JSON.stringify(external));
  assertCheckReadonly(root);
  run(root);
  const updated = JSON.parse(read(root, '.pbai4devs/catalog.json'));
  for (const kind of ['skills', 'agents', 'commands', 'rules', 'templates', 'tools', 'scripts', 'externalSkills']) assert.match(updated[kind][0].description, /atualizado/);
  for (const kind of ['skills', 'agents', 'commands', 'rules', 'templates/demo', 'tools', 'scripts', 'external-skills']) rmSync(join(root, '.pbai4devs', kind), { recursive: true });
  assertCheckReadonly(root);
  run(root);
  const removed = JSON.parse(read(root, '.pbai4devs/catalog.json'));
  for (const value of Object.values(removed)) if (Array.isArray(value)) assert.deepEqual(value, []);
  for (const kind of ['skills', 'agents', 'rules']) assert.deepEqual(JSON.parse(read(root, `.pbai4devs/${kind}.json`)), { entries: [] });
  assertCheckReadonly(root, {}, 0);
});

test("JSON modified derivative is preserved until deliberately removed by the user", t => {
  const root = completeCatalogFixture(t);
  run(root);
  for (const path of ['.pbai4devs/catalog.json', '.pbai4devs/skills.json', '.pbai4devs/agents.json', '.pbai4devs/rules.json']) write(root, path, '{corrompido');
  assertCheckReadonly(root, { force: true });
  assert.throws(() => run(root, { force: true }), /Conteudo proprio preservado/);
  for (const path of ['.pbai4devs/catalog.json', '.pbai4devs/skills.json', '.pbai4devs/agents.json', '.pbai4devs/rules.json']) assert.equal(read(root, path), '{corrompido');
  for (const path of ['.pbai4devs/catalog.json', '.pbai4devs/skills.json', '.pbai4devs/agents.json', '.pbai4devs/rules.json']) rmSync(join(root, path));
  run(root);
  assert.equal(JSON.parse(read(root, '.pbai4devs/catalog.json')).schemaVersion, 1);
  assertCheckReadonly(root, {}, 0);
});

test('catalogo e seletor aceitam o mesmo SCRIPT.conf e os tres formatos Node', t => {
  const root = completeCatalogFixture(t);
  write(root, '.pbai4devs/scripts/demo/SCRIPT.conf', '# Node explicito\n executor = node \n');
  write(root, '.pbai4devs/scripts/browser/SCRIPT.conf', '# Conector\n executor = playwright-mcp \n');
  write(root, '.pbai4devs/scripts/browser/SCRIPT.js', '(page) => page.title();\n');
  write(root, '.pbai4devs/scripts/common/SCRIPT.cjs', 'module.exports = {};\n');
  write(root, '.pbai4devs/scripts/plain/SCRIPT.js', 'console.log("Node");\n');
  const scripts = buildCatalog(root).catalog.scripts;
  assert.equal(scripts.find(entry => entry.id === 'demo').executor, 'node');
  assert.equal(scripts.find(entry => entry.id === 'demo').configuration, '.pbai4devs/scripts/demo/SCRIPT.conf');
  assert.equal(scripts.find(entry => entry.id === 'browser').executor, 'playwright-mcp');
  assert.equal(scripts.find(entry => entry.id === 'common').path, '.pbai4devs/scripts/common/SCRIPT.cjs');
  assert.equal(scripts.find(entry => entry.id === 'plain').path, '.pbai4devs/scripts/plain/SCRIPT.js');
  for (const invalid of ['', '# vazio\n', 'executor=bash\n', 'executor=node\nexecutor=playwright-mcp\n']) {
    write(root, '.pbai4devs/scripts/demo/SCRIPT.conf', invalid);
    rejected(root, { force: true }, /SCRIPT.conf exige/);
  }
  rmSync(join(root, '.pbai4devs/scripts/demo/SCRIPT.conf'));
  mkdirSync(join(root, '.pbai4devs/scripts/demo/SCRIPT.conf'));
  rejected(root, { force: true }, /SCRIPT.conf deve ser um arquivo/);
});

test("fonts JSON, references and invalid script entries fail before mutations", t => {
  const cases = [
    ['.pbai4devs/tools/demo/TOOL.json', '{invalid', /TOOL|JSON/],
    ['.pbai4devs/external-skills/CATALOG.json', '{invalid', /JSON/],
    ['.pbai4devs/external-skills/CATALOG.json', '{"schemaVersion":1,"skills":[]}', /externo/],
    ['.pbai4devs/commands/demo/COMMAND.md', '---\ndescription: Ref faltando.\n---\n\n# Demo\n\nLeia [ausente](../../scripts/missing/SCRIPT.mjs).\n', /ausente/],
    ['.pbai4devs/scripts/browser/SCRIPT.conf', 'executor=python\n', /SCRIPT.conf exige/],
    ['.pbai4devs/scripts/browser/SCRIPT.conf', 'executor=playwright-mcp\n', /ausente/],
    ['.pbai4devs/templates/demo/TEMPLATE.md', '# Sem metadados\n', /Frontmatter/],
  ];
  for (const [path, body, pattern] of cases) {
    const root = completeCatalogFixture(t);
    write(root, path, body);
    rejected(root, { force: true }, pattern);
  }
  const root = completeCatalogFixture(t);
  rmSync(join(root, '.pbai4devs/tools/demo/SCRIPT.mjs'));
  rejected(root, { force: true }, /SCRIPT|script|ausente/);
});

test("error of JSON external does not disclose content and does not change fixture", t => {
  const root = completeCatalogFixture(t);
  const sentinel = 'SYNTHETIC_SECRET_ALPHA';
  const path = '.pbai4devs/external-skills/CATALOG.json';
  write(root, path, sentinel);
  const before = snapshot(root);
  for (const operation of [() => buildCatalog(root), () => run(root, { force: true })]) {
    assert.throws(operation, error => {
      assert.equal(error.message, `JSON invalido: ${path}`);
      assert.ok(!error.message.includes('SYNTHETIC'));
      assert.ok(!String(error.stack).includes('SYNTHETIC'));
      return true;
    });
    assert.deepEqual(snapshot(root), before);
  }
  const child = spawnSync(process.execPath, [cli, '--check', '--root', root], { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 2);
  assert.equal(child.stderr.trim(), `JSON invalido: ${path}`);
  assert.ok(!`${child.stdout}${child.stderr}`.includes('SYNTHETIC'));
  assert.deepEqual(snapshot(root), before);
});

for (const [path, label] of [
  ['.pbai4devs/state/agentdevkit.json', 'estado instalado'],
  ['.pbai4devs/state/derived.json', 'estado derivado'],
  ['.pbai4devs/templates/gitignore/clients.json', 'configuracao de clientes'],
]) test(`JSON inválido de ${label} não divulga conteúdo`, t => {
  const root = fixture(t);
  write(root, path, 'SYNTHETIC_SECRET_ALPHA');
  const before = snapshot(root);
  assert.throws(() => run(root, { force: true }), error => {
    assert.ok(error instanceof SyntaxError);
    assert.equal(error.message, `JSON invalido: ${label}`);
    assert.ok(!String(error.stack).includes('SYNTHETIC'));
    return true;
  });
  assert.deepEqual(snapshot(root), before);
  const child = spawnSync(process.execPath, [cli, '--check', '--root', root], { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 2);
  assert.equal(child.stderr.trim(), `JSON invalido: ${label}`);
  assert.ok(!`${child.stdout}${child.stderr}`.includes('SYNTHETIC'));
  assert.deepEqual(snapshot(root), before);
});

test('descobre principais aninhados sem transformar auxiliares em recursos', t => {
  const root = completeCatalogFixture(t);
  write(root, '.pbai4devs/skills/demo/nested/SKILL.md', '---\nname: nested\ndescription: Skill aninhada.\n---\n\n# Nested\n');
  write(root, '.pbai4devs/skills/demo/REFERENCE.md', '# Guia auxiliar\n');
  write(root, '.pbai4devs/scripts/demo/tests/fixtures/SKILL.md', '# Fixture, não skill compartilhada\n');
  const { catalog } = buildCatalog(root);
  assert.deepEqual(catalog.skills.map(entry => entry.id), ['demo', 'demo/nested']);
  assert.ok(catalog.skills[0].assets.includes('.pbai4devs/skills/demo/REFERENCE.md'));
  assert.ok(catalog.scripts[0].assets.includes('.pbai4devs/scripts/demo/tests/fixtures/SKILL.md'));
  run(root);
  assert.ok(existsSync(join(root, '.codex/skills/nested/SKILL.md')));
  assert.equal(existsSync(join(root, '.codex/skills/fixtures/SKILL.md')), false);
  assertCheckReadonly(root, {}, 0);
});

test('builder e gerenciador externo compartilham o mesmo contrato de validacao', t => {
  const cases = [
    [true, value => value],
    [true, value => ({ ...value, allowlist: ['Fixture/Skills'] })],
    [false, value => ({ ...value, allowlist: ['fixture/skills', 'Fixture/Skills'] })],
    [false, value => ({ ...value, skills: [{ ...value.skills[0], name: 'Invalid Name' }] })],
    [false, value => ({ ...value, allowlist: ['-fixture/skills'], skills: [{ ...value.skills[0], repository: '-fixture/skills' }] })],
    [false, value => ({ ...value, skills: [{ ...value.skills[0], path: 'skills/demo:other/SKILL.md' }] })],
    [false, value => ({ ...value, skills: [{ ...value.skills[0], licenseSource: 'https://example.com/LICENSE' }] })],
    [false, value => ({ ...value, skills: [{ ...value.skills[0], licenseSource: 'https://github.com/fixture/skills/blob/main/LICENSE' }] })],
    [true, value => ({ ...value, skills: [{ ...value.skills[0], licenseSource: `https://github.com/fixture/skills/blob/${'a'.repeat(40)}/LICENSE` }] })],
  ];
  for (const [valid, update] of cases) {
    const value = update(externalConfig());
    const root = fixture(t, true);
    write(root, '.pbai4devs/external-skills/CATALOG.json', JSON.stringify(value));
    const before = snapshot(root);
    if (valid) {
      assert.doesNotThrow(() => validateExternalCatalog(value));
      const built = buildCatalog(root);
      assert.equal(built.catalog.externalSkills[0].name, value.skills[0].name);
      assert.equal(built.catalog.externalSkills[0].repository, value.skills[0].repository);
    } else {
      assert.throws(() => validateExternalCatalog(value));
      assert.throws(() => buildCatalog(root));
      rejected(root, { force: true });
    }
    assert.deepEqual(snapshot(root), before);
  }
});

test("formats by type preserve groups and generate only the chosen native format", t => {
  const root = fixture(t, true);
  write(root, source, skill);
  write(root, '.pbai4devs/commands/projeto/check/COMMAND.md', '---\ndescription: Checagem.\n---\n\n# Checagem\n');
  write(root, '.pbai4devs/rules/projeto/style/RULE.md', '---\ntrigger: glob\nglobs: "**/*.js"\ndescription: Estilo.\n---\n\n# Estilo\n');
  write(root, '.pbai4devs/agents/review/security/AGENT.md', '---\nname: security\ndescription: Perfil.\n---\n\n# Perfil\n');
  write(root, '.pbai4devs/espelhos.conf', [
    'agente|.codex|agrupado', 'agente|.claude|agrupado', 'agente|.cursor|agrupado', 'agente|.github|agrupado',
    'formato|.claude|skills|plano', 'formato|.claude|commands|arquivo',
    'formato|.cursor|rules|mdc', 'formato|.github|rules|instrucoes', 'formato|.github|commands|prompt', 'formato|.github|agents|agente',
  ].join('\n') + '\n');
  run(root);
  assert.ok(existsSync(join(root, '.codex/skills/projeto/demo/SKILL.md')));
  assert.ok(existsSync(join(root, '.claude/skills/demo/SKILL.md')));
  assert.ok(existsSync(join(root, '.claude/commands/projeto/check.md')));
  assert.ok(existsSync(join(root, '.github/agents/review/security.agent.md')));
  assert.ok(existsSync(join(root, '.github/prompts/projeto/check.prompt.md')));
  assert.ok(existsSync(join(root, '.github/instructions/projeto/style.instructions.md')));
  assert.match(read(root, '.cursor/rules/projeto/style.mdc'), /globs: "\*\*\/\*\.js"/);
  assert.equal(existsSync(join(root, '.github/commands/projeto/check/COMMAND.md')), false);
  assert.equal(existsSync(join(root, '.cursor/rules/projeto/style/RULE.md')), false);
  assertCheckReadonly(root, {}, 0);
});

test("Copilot preserves scope glob and leaves manual and model decision in explicit references", t => {
  const root = fixture(t, true);
  write(root, source, skill);
  for (const [name, fields] of [
    ['sempre', 'trigger: always_on\ndescription: Sempre.\n'],
    ['escopo', 'trigger: glob\nglobs: "src/**/*.ts"\ndescription: Tipos.\n'],
    ['manual', 'trigger: manual\ndescription: Manual.\n'],
    ['decisao', 'trigger: model_decision\ndescription: Decisão.\n'],
  ]) write(root, `.pbai4devs/rules/${name}/RULE.md`, `---\n${fields}---\n\n# ${name}\n`);
  write(root, '.pbai4devs/espelhos.conf', 'agente|.github|agrupado\nformato|.github|rules|instrucoes\nagente|.cursor|agrupado\nformato|.cursor|rules|mdc\nagente|.agents|agrupado\n');
  run(root);
  assert.match(read(root, '.github/instructions/sempre.instructions.md'), /applyTo: "\*\*"/);
  assert.match(read(root, '.github/instructions/escopo.instructions.md'), /applyTo: "src\/\*\*\/\*\.ts"/);
  for (const name of ['manual', 'decisao']) {
    assert.equal(existsSync(join(root, `.github/instructions/${name}.instructions.md`)), false);
    assert.match(read(root, `.github/rules/${name}/RULE.md`), /Leia e siga \[origem\]/);
    assert.ok(existsSync(join(root, `.agents/rules/${name}/RULE.md`)));
    assert.ok(existsSync(join(root, `.cursor/rules/${name}.mdc`)));
    assert.ok(resourceTargets(root, `.pbai4devs/rules/${name}/RULE.md`, 'rules').includes(`.github/rules/${name}/RULE.md`));
  }
  assertCheckReadonly(root, {}, 0);
});

test("Copilot refuses native manual instruction without metadata when creating a new file", t => {
  const root = fixture(t, true);
  const rule = '.pbai4devs/rules/manual/RULE.md';
  write(root, rule, '---\ntrigger: manual\ndescription: Manual.\n---\n\n# Manual\n');
  write(root, '.pbai4devs/espelhos.conf', `agente|.github|agrupado\nformato|.github|rules|instrucoes\nnativo|.github/instructions/manual.instructions.md|${rule}\n`);
  const before = snapshot(root);
  assert.throws(() => run(root), /YAML nativo explicito/);
  assert.deepEqual(snapshot(root), before);
});

test("Copilot respects YAML explicit native and human frontmatter", t => {
  const root = fixture(t, true);
  write(root, source, skill);
  const glob = '.pbai4devs/rules/escopo/RULE.md', manual = '.pbai4devs/rules/manual/RULE.md';
  write(root, glob, '---\ntrigger: glob\nglobs: "src/**/*.ts"\ndescription: Escopo.\n---\n\n# Escopo\n');
  write(root, manual, '---\ntrigger: manual\ndescription: Manual.\n---\n\n# Manual\n');
  write(root, '.pbai4devs/rules/escopo/copilot.yaml', '---\napplyTo: "custom/**/*.js"\n---\n');
  write(root, '.pbai4devs/rules/manual/copilot.yaml', '---\napplyTo: "explicit/**/*.md"\n---\n');
  const human = '---\napplyTo: "custom/**/*.js"\n---\n\n# Instrução humana\n\nPreservar o texto.\n';
  write(root, '.github/instructions/escopo.instructions.md', human);
  write(root, '.pbai4devs/espelhos.conf', [
    'agente|.github|agrupado', 'formato|.github|rules|instrucoes',
    `nativo|.github/instructions/escopo.instructions.md|${glob}|.pbai4devs/rules/escopo/copilot.yaml`,
    `nativo|.github/instructions/manual.instructions.md|${manual}|.pbai4devs/rules/manual/copilot.yaml`,
  ].join('\n') + '\n');
  run(root);
  const result = read(root, '.github/instructions/escopo.instructions.md');
  assert.ok(result.startsWith(human)); assert.match(result, /BEGIN AGENTDEVKIT/);
  assert.match(read(root, '.github/instructions/manual.instructions.md'), /applyTo: "explicit\/\*\*\/\*\.md"/);
  assert.equal(existsSync(join(root, '.github/rules/manual/RULE.md')), false);
  assertCheckReadonly(root, {}, 0);
});

test("Copilot preserves ambiguous human collisions and only complements proven scope equal", t => {
  const root = fixture(t, true);
  const items = [
    ['global', 'always_on', '', '---\napplyTo: "**"\n---\n\n# Global humano\n', true],
    ['glob', 'glob', 'globs: "src/**/*.ts"\n', "---\napplyTo: 'src/**/*.ts'\n---\n\n# Glob humano\n", true],
    ['divergente', 'glob', 'globs: "src/**/*.ts"\n', '---\napplyTo: "**"\n---\n\n# Divergente\n', false],
    ['sem-yaml', 'glob', 'globs: "src/**/*.ts"\n', '# Sem YAML\n', false],
    ['duplicado', 'glob', 'globs: "src/**/*.ts"\n', '---\napplyTo: "src/**/*.ts"\napplyTo: "**"\n---\n\n# Duplicado\n', false],
    ['extra', 'glob', 'globs: "src/**/*.ts"\n', '---\napplyTo: "src/**/*.ts"\nexcludeAgent: "code-review"\n---\n\n# Extra\n', false],
    ['manual', 'manual', '', '# Manual sem YAML\n', false],
    ['decisao', 'model_decision', '', '---\napplyTo: "**"\n---\n\n# Decisão humana\n', false],
  ];
  const rows = ['agente|.github|agrupado', 'formato|.github|rules|instrucoes'];
  for (const [name, trigger, fields, content] of items) {
    const rule = `.pbai4devs/rules/${name}/RULE.md`;
    write(root, rule, `---\ntrigger: ${trigger}\n${fields}description: Exemplo.\n---\n\n# ${name}\n`);
    write(root, `.github/instructions/${name}.instructions.md`, content);
    if (['manual', 'decisao'].includes(name)) rows.push(`nativo|.github/instructions/${name}.instructions.md|${rule}`);
  }
  write(root, '.pbai4devs/espelhos.conf', rows.join('\n') + '\n');
  const messages = [];
  const result = run(root, { check: true, output: line => messages.push(line) });
  assert.equal(result.exitCode, 1);
  for (const [name, , , original, compatible] of items) {
    const target = `.github/instructions/${name}.instructions.md`;
    assert.equal(read(root, target), original);
    if (!compatible) {
      assert.ok(result.preserved.some(item => item.path === target && item.reason === 'copilot-scope-preserved'));
    }
  }
  assert.ok(messages.some(line => line.includes('Escopo Copilot humano diferente ou ambiguo')));
  assert.throws(() => run(root, { force: true }), /Conteudo proprio preservado/);
  for (const [name, , , original] of items) assert.equal(read(root, `.github/instructions/${name}.instructions.md`), original);
  for (const [name, trigger, fields, original, compatible] of items.filter(item => item[4])) {
    const separate = fixture(t, true), target = `.github/instructions/${name}.instructions.md`;
    write(separate, `.pbai4devs/rules/${name}/RULE.md`, `---\ntrigger: ${trigger}\n${fields}description: Exemplo.\n---\n\n# ${name}\n`);
    write(separate, target, original);
    write(separate, '.pbai4devs/espelhos.conf', 'agente|.github|agrupado\nformato|.github|rules|instrucoes\n');
    run(separate);
    assert.match(read(separate, target), /BEGIN AGENTDEVKIT/);
    assertCheckReadonly(separate, {}, 0);
  }
});

test("Copilot applies YAML native only when the human frontmatter is identical", t => {
  const root = fixture(t, true);
  const native = '---\napplyTo: "docs/**/*.md"\ndescription: "Regra de projeto"\n---\n';
  for (const name of ['igual', 'diferente', 'ambiguo', 'sem-escopo']) {
    write(root, `.pbai4devs/rules/${name}/RULE.md`, `---\ntrigger: manual\ndescription: Exemplo.\n---\n\n# ${name}\n`);
    write(root, `.pbai4devs/rules/${name}/copilot.yaml`, name === 'ambiguo' ? '---\napplyTo: "docs/**/*.md"\napplyTo: "**"\n---\n' : name === 'sem-escopo' ? '---\ndescription: Manual\n---\n' : native);
  }
  const equal = `${native}\n# Humano igual\n`, different = '---\napplyTo: "**"\n---\n\n# Humano diferente\n';
  write(root, '.github/instructions/igual.instructions.md', equal);
  write(root, '.github/instructions/diferente.instructions.md', different);
  const ambiguous = `${read(root, '.pbai4devs/rules/ambiguo/copilot.yaml')}\n# Ambíguo\n`;
  const noScope = `${read(root, '.pbai4devs/rules/sem-escopo/copilot.yaml')}\n# Sem escopo\n`;
  write(root, '.github/instructions/ambiguo.instructions.md', ambiguous);
  write(root, '.github/instructions/sem-escopo.instructions.md', noScope);
  write(root, '.pbai4devs/espelhos.conf', [
    'agente|.github|agrupado', 'formato|.github|rules|instrucoes',
    ...['igual', 'diferente', 'ambiguo', 'sem-escopo'].map(name => `nativo|.github/instructions/${name}.instructions.md|.pbai4devs/rules/${name}/RULE.md|.pbai4devs/rules/${name}/copilot.yaml`),
  ].join('\n') + '\n');
  assert.equal(run(root, { check: true }).exitCode, 1);
  assert.throws(() => run(root, { force: true }), /Conteudo proprio preservado/);
  assert.equal(read(root, '.github/instructions/igual.instructions.md'), equal);
  assert.equal(read(root, '.github/instructions/diferente.instructions.md'), different);
  assert.equal(read(root, '.github/instructions/ambiguo.instructions.md'), ambiguous);
  assert.equal(read(root, '.github/instructions/sem-escopo.instructions.md'), noScope);
  const separate = fixture(t, true);
  write(separate, '.pbai4devs/rules/igual/RULE.md', '---\ntrigger: manual\ndescription: Exemplo.\n---\n\n# igual\n');
  write(separate, '.pbai4devs/rules/igual/copilot.yaml', native);
  write(separate, '.github/instructions/igual.instructions.md', equal);
  write(separate, '.pbai4devs/espelhos.conf', 'agente|.github|agrupado\nformato|.github|rules|instrucoes\nnativo|.github/instructions/igual.instructions.md|.pbai4devs/rules/igual/RULE.md|.pbai4devs/rules/igual/copilot.yaml\n');
  run(separate);
  assert.ok(read(separate, '.github/instructions/igual.instructions.md').startsWith(equal));
  assert.match(read(separate, '.github/instructions/igual.instructions.md'), /BEGIN AGENTDEVKIT/);
  assertCheckReadonly(separate, {}, 0);
});

test("Copilot preserves even managed block when the human scope changes", t => {
  const root = fixture(t, true);
  const target = '.github/instructions/escopo.instructions.md';
  write(root, '.pbai4devs/rules/escopo/RULE.md', '---\ntrigger: glob\nglobs: "src/**/*.ts"\ndescription: Escopo.\n---\n\n# Escopo\n');
  write(root, '.pbai4devs/espelhos.conf', 'agente|.github|agrupado\nformato|.github|rules|instrucoes\n');
  write(root, target, '---\napplyTo: "src/**/*.ts"\n---\n\n# Humano\n');
  run(root);
  const changed = read(root, target).replace('src/**/*.ts', '**');
  write(root, target, changed);
  const result = run(root, { check: true });
  assert.equal(result.exitCode, 1);
  assert.throws(() => run(root, { force: true }), /Conteudo proprio preservado/);
  assert.equal(read(root, target), changed);
  assert.ok(result.preserved.some(item => item.path === target && item.reason === 'copilot-scope-preserved'));
  assertCheckReadonly(root, {}, 1);
});

test("tracked instruction migration blocks transaction and preserves index and file", t => {
  const root = fixture(t, true);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  git('init', '-q');
  const rule = '.pbai4devs/rules/demo/RULE.md', old = '.github/instructions/demo.instructions.md';
  write(root, '.pbai4devs/espelhos.conf', 'agente|.github|agrupado\nformato|.github|rules|instrucoes\n');
  write(root, rule, '---\ntrigger: glob\nglobs: "src/**/*.ts"\ndescription: Demo.\n---\n\n# Demo\n');
  run(root);
  git('add', '-f', old);
  write(root, rule, '---\ntrigger: manual\ndescription: Demo.\n---\n\n# Demo\n');
  const index = readFileSync(join(root, '.git/index'));
  const contents = read(root, old);
  const planned = run(root, { check: true });
  assert.equal(planned.exitCode, 1);
  assert.ok(planned.preserved.some(item => item.path === old && item.reason === 'tracked-stale-file-preserved'));
  assert.throws(() => run(root, { force: true }), /obsoleto rastreado no indice Git/);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  assert.equal(read(root, old), contents);
  assert.equal(existsSync(join(root, '.github/rules/demo/RULE.md')), false);
  assert.match(git('status', '--short', '--', old), /^A /);
});

test("Copilot migration removes only provenly managed global reference", t => {
  const root = fixture(t, true);
  write(root, source, skill);
  const rule = '.pbai4devs/rules/manual/RULE.md';
  write(root, rule, '---\ntrigger: manual\ndescription: Manual.\n---\n\n# Manual\n');
  write(root, '.pbai4devs/espelhos.conf', 'agente|.github|agrupado\nformato|.github|rules|instrucoes\n');
  const old = '.github/instructions/manual.instructions.md';
  write(root, old, `---\napplyTo: '**'\n---\n\n# Manual\n\n${marker}\nLeia e siga [origem](../../.pbai4devs/rules/manual/RULE.md).\n`);
  recordOwned(root, [old]);
  assert.equal(run(root, { check: true }).exitCode, 1);
  run(root);
  assert.equal(existsSync(join(root, old)), false);
  assert.ok(existsSync(join(root, '.github/rules/manual/RULE.md')));
  assertCheckReadonly(root, {}, 0);

  const other = '.github/instructions/extra.instructions.md';
  const human = `---\napplyTo: '**'\n---\n\n# Manual humano\n\n${marker}\nLeia e siga [origem](../../.pbai4devs/rules/manual/RULE.md).\n`;
  write(root, other, human);
  run(root, { force: true });
  assert.equal(read(root, other), human, 'referência sem ownership deve permanecer');
  const second = fixture(t, true);
  write(second, rule, '---\ntrigger: manual\ndescription: Manual.\n---\n\n# Manual\n');
  write(second, '.pbai4devs/espelhos.conf', 'agente|.github|agrupado\nformato|.github|rules|instrucoes\n');
  write(second, old, human);
  recordOwned(second, [old]);
  write(second, old, human + '\nConteúdo editado por pessoa.\n');
  const edited = read(second, old);
  run(second, { force: true });
  assert.equal(read(second, old), edited, 'referência gerenciada editada deve permanecer');
});

test('manifesto de descoberta humano permanece intacto mesmo com force', t => {
  const root = fixture(t, true);
  write(root, source, skill);
  write(root, '.pbai4devs/espelhos.conf', 'agente|.agents|agrupado\ndescoberta|.agents|antigravity\n');
  const custom = '{"entries":[{"path":".agents/skills/custom"}]}\n';
  write(root, '.agents/skills.json', custom);
  const result = run(root, { force: true, generateEntrypoints: true });
  assert.equal(read(root, '.agents/skills.json'), custom);
  assert.ok(result.preserved.some(item => item.path === '.agents/skills.json'));
  assert.ok(!result.ownedOutputs.includes('.agents/skills.json'));
  assertCheckReadonly(root, { generateEntrypoints: true }, 0);
});

test("unknown formats or outside client fail before mutating", t => {
  const root = fixture(t, true);
  write(root, source, skill);
  for (const row of [
    'formato|.missing|skills|agrupado', 'formato|.codex|unknown|agrupado',
    'formato|.codex|skills|mdc', 'formato|.codex|rules|prompt',
    'fallback|.codex|.missing|skills', 'fallback|.codex|.codex|skills',
    'fallback|.codex|.agents|rules',
    'formato|.codex|skills|plano\nformato|.codex|skills|agrupado',
    'descoberta|.codex|antigravity', 'descoberta|.agents|antigravity',
  ]) {
    write(root, '.pbai4devs/espelhos.conf', 'agente|.codex|agrupado\n' + row + '\n');
    rejected(root);
  }
  assert.equal(resourcePath('.pbai4devs/commands/team/check/COMMAND.md', 'commands', 'arquivo'), 'commands/team/check.md');
  assert.throws(() => resourcePath(source, 'skills', 'arquivo'), /Skills/);
});

test("Direct sync refusal concurrent exchange of fallback obstruction", t => {
  const root = fixture(t, true);
  write(root, source, skill);
  write(root, '.pbai4devs/espelhos.conf', [
    'agente|.agents|agrupado', 'agente|.codex|agrupado',
    'formato|.codex|skills|nenhum', 'fallback|.codex|.agents|skills',
  ].join('\n') + '\n');
  write(root, '.agents/skills/projeto', 'Obstrução humana.');
  let called = false;
  assert.throws(() => synchronize({ root, localIgnores: false, generateEntrypoints: false, output() {
    if (called) return;
    called = true;
    rmSync(join(root, '.agents/skills/projeto')); // It simulates human change after planning.
  } }), /mudou apos o planejamento/);
  assert.equal(called, true);
  assert.equal(existsSync(join(root, '.codex')), false);
  assert.equal(existsSync(join(root, '.agents/skills/projeto/demo/SKILL.md')), false);
});
