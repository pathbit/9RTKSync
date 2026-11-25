import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { adapterManifest } from '../../lib/adapters.mjs';
import { skill, source, read, write, run, snapshot, fixture, rejected, assertCheckReadonly } from './fixtures.mjs';

test('metadados humanos editados bloqueiam sync; fontes sem conflito atualizam', t => {
  const root = fixture(t);
  run(root);
  const editedPath = '.codex/commands/check.md';
  const human = read(root, editedPath).replace('description: Comando.', 'description: Obsoleto.\nlocal-only: true');
  write(root, editedPath, human);
  write(root, '.pbai4devs/commands/check/COMMAND.md', '---\nname: check-novo\ndescription: Comando atualizado.\n---\n\n# Comando\n');
  write(root, '.pbai4devs/rules/example/RULE.md', '---\ntrigger: glob\nglobs: "**/*.ts"\ndescription: Regra atualizada.\n---\n\n# Regra\n');
  write(root, '.pbai4devs/agents/revisor/AGENT.md', '---\nname: revisor\ndescription: Perfil atualizado.\n---\n\n# Revisor\n');
  for (const force of [false, true]) {
    const before = snapshot(root), check = run(root, { check: true, force });
    assert.notEqual(check.exitCode, 0);
    assert.ok(check.conflictPaths.includes(editedPath));
    assert.deepEqual(snapshot(root), before);
    rejected(root, { force }, /Conteudo proprio preservado/);
    assert.equal(read(root, editedPath), human);
  }

  const clean = fixture(t);
  run(clean);
  write(clean, '.pbai4devs/commands/check/COMMAND.md', '---\nname: check-novo\ndescription: Comando atualizado.\n---\n\n# Comando\n');
  write(clean, '.pbai4devs/rules/example/RULE.md', '---\ntrigger: glob\nglobs: "**/*.ts"\ndescription: Regra atualizada.\n---\n\n# Regra\n');
  write(clean, '.pbai4devs/agents/revisor/AGENT.md', '---\nname: revisor\ndescription: Perfil atualizado.\n---\n\n# Revisor\n');
  // The fixture removes the generated rule after a conservative refusal.
  const beforeCleanCheck = snapshot(clean), cleanCheck = run(clean, { check: true });
  assert.notEqual(cleanCheck.exitCode, 0);
  assert.deepEqual(cleanCheck.conflictPaths, ['.claude/rules/example/RULE.md']);
  assert.deepEqual(snapshot(clean), beforeCleanCheck);
  rejected(clean, {}, /Conteudo proprio preservado/);
  rmSync(join(clean, '.claude/rules/example/RULE.md'));
  run(clean);
  assert.match(read(clean, '.codex/commands/check.md'), /Comando atualizado\./);
  assert.match(read(clean, '.codex/rules/example.md'), /trigger: glob\nglobs: "\*\*\/\*\.ts"/);
  assert.match(read(clean, '.codex/agents/revisor.md'), /Perfil atualizado\./);
  assert.match(read(clean, '.opencode/agents/revisor/AGENT.md'), /edit: deny/);
  assert.match(read(clean, '.kimi-code/agents/revisor.md'), /tools: \[Read, Grep, Glob\]/);
  assert.match(read(clean, '.github/instructions/demo.instructions.md'), /applyTo: '\*\*'/);
  assertCheckReadonly(clean, {}, 0);
});

test("updates sources, adds customers, removes resources and grouped migration to plan", t => {
  const root = fixture(t);
  run(root);
  write(root, source, skill.replace('Exemplo.', 'Atualizado.'));
  write(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf') + 'agente|.extra|plano\n');
  assertCheckReadonly(root);
  run(root);
  assert.match(read(root, '.extra/skills/demo/SKILL.md'), /Atualizado/);
  rmSync(join(root, '.pbai4devs/rules/example/RULE.md'));
  write(root, '.pbai4devs/espelhos.conf', read(root, '.pbai4devs/espelhos.conf').replace('agente|.claude\n', 'agente|.claude|plano\n'));
  assertCheckReadonly(root);
  rejected(root, { force: true }, /Conteudo proprio preservado/);
  // Removal is a simulated manual decision in fixture, not due to hash.
  rmSync(join(root, '.claude/rules/example/RULE.md'));
  run(root);
  assert.equal(existsSync(join(root, '.claude/skills/projeto/demo/SKILL.md')), false);
  assert.ok(existsSync(join(root, '.claude/skills/projeto')));
  assert.ok(existsSync(join(root, '.claude/skills/demo/SKILL.md')));
  assert.equal(existsSync(join(root, '.codex/rules/example.md')), false);
  assert.deepEqual(JSON.parse(read(root, '.pbai4devs/rules.json')).entries, []);
  assertCheckReadonly(root, {}, 0);
});

test("without state or manifest only generates common input and updates what is proper", t => {
  const root = fixture(t, true);
  write(root, source, skill);
  rmSync(join(root, '.pbai4devs/espelhos.conf'));
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) write(root, `.pbai4devs/templates/entrypoints/${name}`, `---\ndescription: Entrada.\n---\n\n# ${name}\n`);
  write(root, 'CLAUDE.md', '# Instruções humanas\n');
  assertCheckReadonly(root, { generateEntrypoints: true });
  const first = run(root, { generateEntrypoints: true });
  assert.ok(first.ownedOutputs.includes('AGENTS.md'));
  assert.equal(first.ownedOutputs.includes('CLAUDE.md'), false);
  assert.equal(read(root, 'CLAUDE.md'), '# Instruções humanas\n');
  for (const path of ['.agents', '.claude', '.codex', '.gemini', 'GEMINI.md']) {
    assert.equal(existsSync(join(root, path)), false, path);
  }
  assertCheckReadonly(root, { generateEntrypoints: true }, 0);
  write(root, '.pbai4devs/templates/entrypoints/AGENTS.md', '---\ndescription: Entrada.\n---\n\n# Atualizada\n');
  run(root, { generateEntrypoints: true });
  assert.match(read(root, 'AGENTS.md'), /# Atualizada/);
  write(root, 'AGENTS.md', read(root, 'AGENTS.md') + '\nTexto humano.\n');
  const second = run(root, { generateEntrypoints: true });
  assert.equal(second.ownedOutputs.includes('AGENTS.md'), false);
  assert.match(read(root, 'AGENTS.md'), /Texto humano/);
});

test("stateless, manifesto Codex activates shared skills without Antigravity entry", t => {
  const root = fixture(t, true);
  write(root, source, skill);
  for (const name of ['AGENTS.md', 'GEMINI.md']) write(root, `.pbai4devs/templates/entrypoints/${name}`, `---\ndescription: Entrada.\n---\n\n# ${name}\n`);
  write(root, '.pbai4devs/espelhos.conf', adapterManifest(root, { clients: ['codex'] }));
  const result = run(root, { generateEntrypoints: true });
  assert.ok(result.ownedOutputs.includes('AGENTS.md'));
  assert.ok(result.ownedOutputs.includes('.agents/skills/projeto/demo/SKILL.md'));
  assert.equal(existsSync(join(root, 'GEMINI.md')), false);
  assertCheckReadonly(root, { generateEntrypoints: true }, 0);
});

test("Exchange of Antigravity to Codex only removes intact derived projections", t => {
  const root = fixture(t, true);
  const config = '.pbai4devs/espelhos.conf';
  const edited = '.agents/agents.json';
  const retired = ['GEMINI.md', '.agents/skills.json', '.agents/rules.json'];
  write(root, source, skill);
  for (const name of ['AGENTS.md', 'GEMINI.md']) write(root, `.pbai4devs/templates/entrypoints/${name}`, `---\ndescription: Entrada.\n---\n\n# ${name}\n`);
  write(root, config, adapterManifest(root, { clients: ['antigravity'] }));
  run(root, { generateEntrypoints: true });
  for (const path of [...retired, edited]) assert.ok(existsSync(join(root, path)), path);
  const human = '{"entries":[],"nota":"Mantida pela equipe"}\n';
  write(root, edited, human);
  write(root, config, adapterManifest(root, { clients: ['codex'] }));
  assertCheckReadonly(root, { generateEntrypoints: true }, 1);
  const changed = run(root, { generateEntrypoints: true });
  for (const path of retired) assert.equal(existsSync(join(root, path)), false, path);
  assert.equal(read(root, edited), human);
  assert.ok(changed.preserved.some(item => item.path === edited));
  assert.ok(existsSync(join(root, '.agents/skills/projeto/demo/SKILL.md')));
  assertCheckReadonly(root, { generateEntrypoints: true }, 0);
});

test('manifestos Antigravity acompanham skills, regras e agentes agrupados', t => {
  const root = fixture(t, true);
  write(root, source, skill);
  write(root, '.pbai4devs/rules/projeto/style/RULE.md', '---\ntrigger: always_on\ndescription: Estilo.\n---\n\n# Estilo\n');
  write(root, '.pbai4devs/agents/review/security/AGENT.md', '---\nname: security\ndescription: Perfil.\n---\n\n# Perfil\n');
  write(root, '.pbai4devs/espelhos.conf', 'agente|.agents|agrupado\ndescoberta|.agents|antigravity\n');
  const before = snapshot(root);
  assert.equal(run(root, { check: true, generateEntrypoints: true }).exitCode, 1);
  assert.deepEqual(snapshot(root), before);
  run(root, { generateEntrypoints: true });
  assert.deepEqual(JSON.parse(read(root, '.agents/skills.json')).entries, [{ path: '.agents/skills/projeto/demo' }]);
  assert.deepEqual(JSON.parse(read(root, '.agents/rules.json')).entries, [{ path: '.agents/rules/projeto/style/RULE.md' }]);
  assert.deepEqual(JSON.parse(read(root, '.agents/agents.json')).entries, [{ path: '.agents/agents/review/security/AGENT.md' }]);
  write(root, '.pbai4devs/skills/projeto/new-skill/SKILL.md', skill.replace('name: demo', 'name: new-skill'));
  run(root, { generateEntrypoints: true });
  assert.equal(JSON.parse(read(root, '.agents/skills.json')).entries.length, 2);
  rmSync(join(root, '.pbai4devs/skills/projeto/demo'), { recursive: true });
  run(root, { generateEntrypoints: true });
  assert.deepEqual(JSON.parse(read(root, '.agents/skills.json')).entries, [{ path: '.agents/skills/projeto/new-skill' }]);
  assert.equal(existsSync(join(root, '.agents/skills/projeto/demo/SKILL.md')), false);
  assert.ok(existsSync(join(root, '.agents/skills/projeto/demo')));
  assertCheckReadonly(root, { generateEntrypoints: true }, 0);
});
