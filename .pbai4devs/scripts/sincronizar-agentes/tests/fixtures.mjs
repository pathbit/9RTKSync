import '../../lib/test-git-environment.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synchronize } from '../SCRIPT.mjs';
import { toolWrapper } from '../../preparar-ferramentas/SCRIPT.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../SCRIPT.mjs');
const marker = '<!-- gerado: sincronizar-agentes -->';
const skill = '---\nname: demo\ndescription: Exemplo.\n---\n\n# Demo\n\nNAO_DUPLICAR_INSTRUCOES\n';
const source = '.pbai4devs/skills/projeto/demo/SKILL.md';
const read = (root, path) => readFileSync(join(root, path), 'utf8');
const write = (root, path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
const pointer = (origin = 'origem.md', title = 'Referencia') => `---\ndescription: Referencia.\n---\n\n# ${title}\n\n${marker}\nLeia e siga [origem](${origin}).\n`;
const recordOwned = (root, paths) => {
  const statePath = '.pbai4devs/state/agentdevkit.json';
  const previous = existsSync(join(root, statePath)) ? JSON.parse(read(root, statePath)) : {};
  write(root, statePath, JSON.stringify({ schemaVersion: 1, files: { ...previous.files, ...Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])) }, blocks: previous.blocks ?? {} }));
};
const toolConfig = (name = 'demo') => ({ name, description: `Ferramenta ${name}.`, group: 'base', source: `https://github.com/fixture/${name}`, download: { provider: 'npm', package: name, registry: 'https://registry.npmjs.org/', repository: `fixture/${name}`, channel: 'latest' }, platforms: [`${process.platform}-${process.arch}`], scripts: { entry: 'SCRIPT.mjs' }, probe: ['--version'] });
const externalConfig = () => ({ schemaVersion: 1, allowlist: ['fixture/skills'], skills: [{ id: 'external-demo', repository: 'fixture/skills', commit: 'a'.repeat(40), path: 'skills/demo/SKILL.md', name: 'external-demo', license: 'MIT', use: 'Revisar exemplo externo.', status: 'reviewed', notes: 'Sem execução automática.' }] });
const run = (root, options = {}) => synchronize({ root, localIgnores: false, generateEntrypoints: false, output() {}, ...options });
function snapshot(root) {
  const result = [];
  function visit(folder, parent = '') {
    for (const name of readdirSync(folder).sort()) {
      const file = join(folder, name), path = parent ? `${parent}/${name}` : name, item = lstatSync(file);
      if (item.isSymbolicLink()) result.push([path, 'link', readlinkSync(file)]);
      else if (item.isDirectory()) { result.push([path, 'directory']); visit(file, path); }
      else result.push([path, 'file', createHash('sha256').update(readFileSync(file)).digest('hex')]);
    }
  }
  visit(root);
  return result;
}
function fixture(t, minimal = false) {
  mkdirSync(join(project, '.agent-tests'), { recursive: true });
  const root = mkdtempSync(join(project, '.agent-tests/sync-node com espaço-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, '.pbai4devs/templates/gitignore/agents.ignore', '# Cache dos clientes\n/*\n!/.gitignore\n{{ALLOWLIST}}\n/cache/\n*.log\n');
  write(root, '.pbai4devs/templates/gitignore/clients.json', '{}\n');
  write(root, '.pbai4devs/templates/gitignore/shared.ignore', '# Estado compartilhado\n/tools/*/.local/\n/tools/.cache/\n');
  write(root, '.pbai4devs/espelhos.conf', minimal ? 'agente|.codex|plano\n' : [
    '# Clientes da fixture', 'agente|.claude', 'agente|.opencode', 'agente|.github|plano', 'agente|.codex|plano', 'agente|.cursor|plano', 'agente|.kimi-code|plano', 'agente|.vscode|plano', 'agente|.agents|plano', 'agente|.agent|plano',
    `nativo|.github/instructions/demo.instructions.md|${source}`,
    'nativo|.kimi-code/agents/revisor.md|.pbai4devs/agents/revisor/AGENT.md|.pbai4devs/agents/revisor/kimi-code.yaml',
    'nativo|.opencode/agents/revisor/AGENT.md|.pbai4devs/agents/revisor/AGENT.md|.pbai4devs/agents/revisor/opencode.yaml',
  ].join('\n') + '\n');
  if (minimal) return root;
  const ownedLegacy = ['.opencode/agents/revisor/AGENT.md'];
  write(root, source, skill);
  write(root, '.pbai4devs/skills/grupo com espaço/outro/SKILL.md', '---\nname: outro\ndescription: Outro.\n---\n\n# Outro\n');
  write(root, '.pbai4devs/agents/revisor/AGENT.md', '---\nname: revisor\ndescription: Perfil.\n---\n\n# Revisor\n');
  write(root, '.pbai4devs/rules/example/RULE.md', '---\ntrigger: always_on\ndescription: Regra.\n---\n\n# Regra\n');
  write(root, '.pbai4devs/commands/check/COMMAND.md', '---\ndescription: Comando.\n---\n\n# Comando\n');
  write(root, '.pbai4devs/agents/revisor/kimi-code.yaml', '---\nname: revisor\ntools: [Read, Grep, Glob]\n---\n');
  write(root, '.pbai4devs/agents/revisor/opencode.yaml', '---\nmode: subagent\npermission:\n  edit: deny\n---\n');
  write(root, '.pbai4devs/adapters/antigravity/agents/revisor.md', pointer('../../../agents/revisor/AGENT.md', 'Revisor'));
  write(root, '.opencode/agents/revisor/AGENT.md', `---\nmode: subagent\npermission:\n  edit: deny\n---\n\n# Revisor\n\n${marker}\nLeia e siga [origem](../../../.pbai4devs/agents/revisor/AGENT.md).\n`);
  write(root, '.github/workflows/ci.yml', 'workflow-preservado\n');
  write(root, '.vscode/settings.json', '{"fixture":"config-preservada"}\n');
  write(root, '.vscode/extensions.json', '{"recommendations":[]}\n');
  write(root, '.codex/config.toml', 'config-native-preservada\n');
  write(root, '.github/prompts/custom.prompt.md', '# Prompt proprio\n');
  write(root, '.claude/notas.md', '# Nota propria\n');
  write(root, 'README.md', 'README raiz preservado\n');
  for (const kind of ['templates', 'scripts', 'tools', 'external-skills', 'state', 'tests', 'docs', 'adapters', 'extra']) {
    write(root, `.pbai4devs/${kind}/demo/REFERENCE.md`, '---\ndescription: Exclusivo.\n---\n\n# Exclusivo\n');
    if (kind !== 'extra') {
      const target = `.claude/${kind}/demo/REFERENCE.md`;
      write(root, target, pointer(`../../../.pbai4devs/${kind}/demo/REFERENCE.md`)); ownedLegacy.push(target);
    }
  }
  write(root, '.pbai4devs/tools/demo/TOOL.json', JSON.stringify(toolConfig()));
  write(root, '.pbai4devs/tools/demo/SCRIPT.mjs', toolWrapper('demo'));
  for (const file of ['README.md', 'INSTRUCTIONS.md']) {
    write(root, `.pbai4devs/${file}`, '---\ndescription: Guia.\n---\n\n# Guia\n');
    write(root, `.claude/${file}`, pointer(`../.pbai4devs/${file}`, 'Guia'));
    ownedLegacy.push(`.claude/${file}`);
  }
  recordOwned(root, ownedLegacy);
  return root;
}

function rejected(root, options = {}, pattern) {
  const before = snapshot(root);
  assert.throws(() => run(root, options), pattern);
  assert.deepEqual(snapshot(root), before, 'Uma operação rejeitada alterou a fixture.');
}
function assertCheckReadonly(root, options = {}, exitCode = 1) {
  const before = snapshot(root);
  assert.equal(run(root, { check: true, ...options }).exitCode, exitCode);
  assert.deepEqual(snapshot(root), before, '--check alterou a fixture.');
}

export { project, cli, marker, skill, source, read, write, pointer, recordOwned, toolConfig, externalConfig, run, snapshot, fixture, rejected, assertCheckReadonly };
