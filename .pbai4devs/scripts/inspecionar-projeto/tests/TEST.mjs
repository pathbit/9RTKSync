import '../../lib/test-git-environment.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { projectRoot, requireNode } from '../../lib/runtime.mjs';
import { inspectDocumentation, inspectProject } from '../SCRIPT.mjs';
import { adapterManifest } from '../../lib/adapters.mjs';

requireNode();
const script = join(projectRoot, '.pbai4devs/scripts/inspecionar-projeto/SCRIPT.mjs');
function fixture(t) {
  const home = join(projectRoot, '.agent-tests');
  mkdirSync(home, { recursive: true });
  const root = mkdtempSync(join(home, 'inspecionar-projeto-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = name => mkdirSync(join(root, name), { recursive: true });
  const file = (name, data = '') => { const target = join(root, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, data); };
  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' });
    assert.ifError(result.error);
    return { ...result, report: result.stdout.trim() ? JSON.parse(result.stdout) : undefined };
  };
  return { root, directory, file, run };
}

test("inventory several specs in stable order", t => {
  const root = mkdtempSync(join(tmpdir(), 'adk-spec-inventory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = (name, content) => {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  file('.pbai4devs/state/configuracao/ESTADO.md', '---\npreparacao: concluido\nconfiguracao_tecnica: pendente\ndocumentos:\n  prd: docs/prd.md\n  ux_ui: docs/ux.md\n  design: docs/design.md\n  roadmap: docs/roadmap.md\n  specs: docs/specs\n---\n');
  for (const name of ['prd', 'ux', 'design']) file(`docs/${name}.md`, '---\nstatus: aprovado\n---\n');
  file('docs/roadmap.md', '---\nstatus: aprovado\n---\n# Roadmap\n- [ ] [Primeira](specs/01/SPEC.md)\n');
  const spec = number => file(`docs/specs/${String(number).padStart(2, '0')}/SPEC.md`, '---\nstatus: aprovado\n---\n# Spec\n');
  spec(1);
  spec(26);
  let report = inspectProject(root).maturity.planning.specs;
  assert.equal(report.present, true);
  assert.equal(report.complete, true);
  assert.deepEqual(report.items.map(item => item.path), ['docs/specs/01/SPEC.md', 'docs/specs/26/SPEC.md']);
  assert.equal(report.items[0].roadmapState, 'open');
  for (let number = 25; number >= 2; number--) spec(number);
  report = inspectProject(root).maturity.planning.specs;
  assert.equal(report.complete, true);
  assert.deepEqual(report.items.map(item => item.path), Array.from({ length: 26 }, (_, i) => `docs/specs/${String(i + 1).padStart(2, '0')}/SPEC.md`));
  assert.ok(report.items.every(item => item.status === 'aprovado'));
});

test("late changes in specs folder invalidate inventory", t => {
  for (const mode of ['insert', 'remove']) {
    {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'adk-spec-race-')));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const file = (name, content) => { const target = join(root, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); };
      file('.pbai4devs/state/configuracao/ESTADO.md', '---\npreparacao: concluido\nconfiguracao_tecnica: pendente\ndocumentos:\n  prd: docs/prd.md\n  ux_ui: docs/ux.md\n  design: docs/design.md\n  roadmap: docs/roadmap.md\n  specs: docs/specs\n---\n');
      for (const name of ['prd', 'ux', 'design']) file(`docs/${name}.md`, '---\nstatus: aprovado\n---\n');
      file('docs/roadmap.md', '---\nstatus: aprovado\n---\n# Roadmap\n- [ ] [Spec](specs/01/SPEC.md)\n');
      const content = '---\nstatus: aprovado\n---\n# Spec\n';
      file('docs/specs/01/SPEC.md', content);
      if (mode === 'remove') file('docs/specs/02/SPEC.md', content);
      const original = fs.openSync; let changed = false, result;
      try {
        fs.openSync = (...args) => {
          const name = String(args[0]);
          if (!changed && name.startsWith(join(root, 'docs/specs') + sep) && basename(name) === 'SPEC.md') {
            changed = true;
            if (mode === 'insert') file('docs/specs/02/SPEC.md', content);
            else rmSync(join(root, 'docs/specs', basename(dirname(name)) === '01' ? '02' : '01'), { recursive: true });
          }
          return original(...args);
        };
        result = inspectProject(root).maturity.planning.specs;
      } finally { fs.openSync = original; }
      assert.equal(changed, true, mode);
      assert.equal(result.complete, false, mode);
      assert.deepEqual(result.items, [], mode);
    }
  }
});

test("aggregate limit of inputs discards partial inventory", t => {
  const root = mkdtempSync(join(tmpdir(), 'adk-spec-entries-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = (name, content) => { const target = join(root, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); };
  file('.pbai4devs/state/configuracao/ESTADO.md', '---\ndocumentos:\n  specs: docs/specs\n---\n');
  for (let folder = 0; folder < 4; folder++) {
    file(`docs/specs/${folder}/SPEC.md`, '# Spec\n');
    for (let index = 0; index < 130; index++) file(`docs/specs/${folder}/nota-${index}.md`, '');
  }
  const specs = inspectProject(root).maturity.planning.specs;
  assert.equal(specs.present, true); assert.equal(specs.complete, false); assert.deepEqual(specs.items, []);
});

test("spec change already read invalidates inventory even with the same size", t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'adk-spec-content-race-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = (name, content) => { const target = join(root, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); };
  file('.pbai4devs/state/configuracao/ESTADO.md', '---\ndocumentos:\n  specs: docs/specs\n---\n');
  const content = '---\nstatus: aprovado\n---\n# Spec\n';
  for (const name of ['01', '02']) file(`docs/specs/${name}/SPEC.md`, content);
  const original = fs.openSync; let first, changed = false, specs;
  try {
    fs.openSync = (...args) => {
      const name = String(args[0]);
      if (name.startsWith(join(root, 'docs/specs') + sep) && basename(name) === 'SPEC.md') {
        if (!first) first = name;
        else if (name !== first && !changed) { changed = true; writeFileSync(first, content.replace('aprovado', 'rascunho')); }
      }
      return original(...args);
    };
    specs = inspectProject(root).maturity.planning.specs;
  } finally { fs.openSync = original; }
  assert.equal(changed, true);
  assert.equal(specs.complete, false); assert.deepEqual(specs.items, []);
});

test('limite agregado de bytes permite o teto e recusa leitura parcial acima dele', t => {
  const root = mkdtempSync(join(tmpdir(), 'adk-spec-bytes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = (name, content) => { const target = join(root, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); };
  file('.pbai4devs/state/configuracao/ESTADO.md', '---\ndocumentos:\n  specs: docs/specs\n---\n');
  const content = Buffer.alloc(1024 * 1024, 32); content.write('---\nstatus: aprovado\n---\n# Spec\n');
  for (let index = 0; index < 16; index++) file(`docs/specs/${String(index).padStart(2, '0')}/SPEC.md`, content);
  let specs = inspectProject(root).maturity.planning.specs;
  assert.equal(specs.complete, true); assert.equal(specs.items.length, 16);
  file('docs/specs/16/SPEC.md', '# Spec\n');
  specs = inspectProject(root).maturity.planning.specs;
  assert.equal(specs.complete, false); assert.deepEqual(specs.items, []);
});

test("identifies repository without application and informs missing structure", t => {
  const { run } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.mode, 'agentes-sem-aplicacao');
  assert.ok(result.report.structure.missing.includes('Makefile'));
  assert.equal(run('--check').status, 1);
});

test("ignores agents, dependencies, state and symbolic links", t => {
  const { root, file, run } = fixture(t);
  file('.pbai4devs/tools/node_modules/example/package.json', '{"scripts":{"wrong":"secret"}}');
  file('node_modules/example/package.json', '{}');
  file('.git/package.json', '{}');
  file('.agent-tests/package.json', '{}');
  assert.equal(run().report.mode, 'agentes-sem-aplicacao');
  try { symlinkSync(join(projectRoot, 'README.md'), join(root, 'linked.py')); }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.diagnostic('Link simbólico indisponível sem permissão do Windows.');
  }
  assert.equal(run().report.mode, 'agentes-sem-aplicacao');
});

test('descobre linguagens e comandos sem expor valores nem executar Python', t => {
  const { root, file, run } = fixture(t);
  const secret = 'THIS_VALUE_MUST_NEVER_APPEAR_393838';
  file('.env', `TOKEN=${secret}`);
  file('backend/pyproject.toml', `[project]\nname="existing"\n[project.scripts]\nserve="app:main"\n[tool.private]\npassword="${secret}"`);
  file('backend/app.py', `password="${secret}"`);
  file('deploy/docker-compose.dev.yml', `services:\n  app:\n    environment:\n      TOKEN: ${secret}\n`);
  file('Dockerfile', `ENV TOKEN=${secret}`);
  file('Makefile', `dev:\n\t@echo ${secret}\ntest check:\n\t@echo ok\n`);
  file('package.json', JSON.stringify({ scripts: { dev: `echo ${secret}`, test: 'exit 0' }, config: { token: secret } }));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.mode, 'aplicacao-detectada');
  assert.deepEqual(result.report.languages, ['javascript', 'python']);
  assert.ok(result.report.compose.includes('deploy/docker-compose.dev.yml'));
  assert.ok(result.report.structure.missing.includes('src'));
  assert.deepEqual(result.report.commands.find(row => row.file === 'package.json').names, ['dev', 'test']);
  assert.deepEqual(result.report.commands.find(row => row.file === 'Makefile').names, ['check', 'dev', 'test']);
  assert.deepEqual(result.report.commands.find(row => row.file === 'backend/pyproject.toml').names, ['serve']);
  assert.ok(!result.stdout.includes(secret));
  assert.ok(!result.stderr.includes(secret));
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), `TOKEN=${secret}`);
});

test("manifests with alternative box follow the volume and preserve the spelling of the path", t => {
  const { root, file, run } = fixture(t);
  const module = 'Módulo local';
  file(`${module}/PACKAGE.JSON`, '{"scripts":{"start":"echo test"}}');
  file(`${module}/PACKAGE-LOCK.JSON`, '{}');
  file(`${module}/REQUIREMENTS.TXT`, 'example');
  file(`${module}/MAKEFILE`, 'build:\n\t@echo test\n');
  const matchesCaseVariant = fs.existsSync(join(root, module, 'package.json'));
  const { report } = run();
  if (matchesCaseVariant) {
    assert.deepEqual(report.manifests.toSorted(), [`${module}/PACKAGE.JSON`, `${module}/REQUIREMENTS.TXT`]);
    assert.deepEqual(report.lockfiles, [`${module}/PACKAGE-LOCK.JSON`]);
    assert.deepEqual(report.commands.toSorted((a, b) => a.file.localeCompare(b.file)), [
      { file: `${module}/MAKEFILE`, names: ['build'] }, { file: `${module}/PACKAGE.JSON`, names: ['start'] },
    ]);
  } else {
    assert.deepEqual(report.manifests, []);
    assert.deepEqual(report.lockfiles, []);
    assert.deepEqual(report.commands, []);

    file(`${module}/package.json`, '{"scripts":{"test":"echo ok"}}');
    const withDistinctFiles = run().report;
    assert.deepEqual(withDistinctFiles.manifests, [`${module}/package.json`]);
    assert.deepEqual(withDistinctFiles.commands, [{ file: `${module}/package.json`, names: ['test'] }]);
  }
});

test("accepts complete structure and configured agent roots", t => {
  const { directory, file, run } = fixture(t);
  for (const name of ['.pbai4devs', '.agents', '.agent', '.gemini', '.claude', '.codex', '.cursor', '.github', '.opencode', 'src', 'tests', 'infra']) directory(name);
  for (const name of ['.gitignore', '.gitattributes', '.editorconfig', '.dockerignore', 'README.md', 'Makefile']) file(name);
  file('infra/compose/docker-compose.local.yml', 'services: {}\n');
  const result = run('--check');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.contract.complete, true);
  assert.deepEqual(result.report.structure.missing, []);
  file('.pbai4devs/espelhos.conf', 'agente|.github|plano\nagente|.dsh|plano\n');
  file('.dsh/skills/tool/package.json', '{"scripts":{"hidden":"secret"}}');
  const configured = run('--check');
  assert.equal(configured.status, 0, configured.stderr);
  assert.ok(configured.report.structure.present.includes('.dsh'));
  assert.ok(!configured.report.manifests.some(name => name.startsWith('.dsh/')));
  file('.pbai4devs/espelhos.conf', 'agente|.github|plano\nagente|.dsh|plano\ngitignore|.vscode\n');
  assert.equal(run('--check').status, 0, 'Uma entrada de ignore não exige a pasta do editor.');
  file('.pbai4devs/espelhos.conf', 'agente|.github|plano\nagente|.dsh|plano\nagente|.vscode|plano\n');
  const missingEditor = run('--check');
  assert.equal(missingEditor.status, 1);
  assert.deepEqual(missingEditor.report.structure.missing, ['.vscode']);
  directory('.vscode');
  assert.equal(run('--check').status, 0);
});

test("complete structure with selection none dispenses all client folders", t => {
  const { root, directory, file, run } = fixture(t);
  for (const name of ['.pbai4devs', 'src', 'tests', 'infra']) directory(name);
  for (const name of ['.gitignore', '.gitattributes', '.editorconfig', '.dockerignore', 'README.md', 'Makefile']) file(name);
  file('infra/compose/compose.local.yml', 'services: {}\n');
  const legacy = run('--check');
  assert.equal(legacy.status, 1, 'Sem manifesto, vale a compatibilidade dos clientes ativos.');
  assert.ok(legacy.report.structure.missing.includes('.codex'));
  for (const retired of ['.agent', '.gemini']) assert.ok(!legacy.report.structure.missing.includes(retired));
  file('.pbai4devs/espelhos.conf', adapterManifest(root, { clients: ['none'] }));
  const result = run('--check');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.contract.complete, true);
  assert.deepEqual(result.report.structure.missing, []);
});

test("Invalid manifests generate warning without revealing its content", t => {
  const { file, run } = fixture(t);
  const secret = 'MALFORMED_PRIVATE_VALUE';
  file('package.json', '{ malformed ' + secret);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.report.warnings.some(row => row.file === 'package.json'));
  assert.ok(!result.stdout.includes(secret));
});

test("rejects origins outside fixtures and unknown options", () => {
  for (const args of [['--root', dirname(projectRoot)], ['--root', '.pbai4devs'], ['--root', 'examples'], ['--root', 'examples/custom'], ['--unknown']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(typeof JSON.parse(result.stderr).error, 'string');
  }
});

test("classifies signs of maturity without confusing planning with working product", t => {
  const { directory, file, run } = fixture(t);
  const state = stage => file('.pbai4devs/state/configuracao/ESTADO.md', `---\npreparacao: concluido\nconfiguracao_tecnica: ${stage}\ndocumentos:\n  prd: docs/PRD.md\n  ux_ui: docs/UX.md\n  design: docs/DESIGN.md\n  releases: docs/releases\n---\n# Estado\n`);
  assert.equal(run().report.maturity.level, 'preparacao');
  state('pendente'); file('docs/PRD.md', '---\nstatus: rascunho\n---\n# PRD\n');
  assert.equal(run().report.maturity.level, 'descoberta');
  for (const name of ['PRD', 'DESIGN']) file(`docs/${name}.md`, `---\nstatus: aprovado\n---\n# ${name}\n`);
  file('docs/UX.md', '---\nstatus: nao-aplicavel\n---\n# UX\n');
  assert.equal(run().report.maturity.level, 'planejado');
  file('package.json', '{"scripts":{"test":"node --test"}}'); file('src/main.mjs', 'export const answer = 42;');
  assert.equal(run().report.maturity.level, 'implementacao');
  for (const name of ['.agents', '.agent', '.gemini', '.claude', '.codex', '.cursor', '.github', '.opencode', 'tests', 'infra']) directory(name);
  for (const name of ['.gitignore', '.gitattributes', '.editorconfig', '.dockerignore', 'README.md', 'Makefile']) file(name);
  file('infra/compose/compose.local.yml', 'services: {}\n'); state('concluido');
  assert.equal(run('--check').report.maturity.level, 'configurado');
  file('docs/releases/v1/RELEASE.md', '---\nstatus: publicado\n---\n# Release\n');
  const result = run('--check'); assert.equal(result.status, 0);
  assert.equal(result.report.maturity.level, 'manutencao');
  assert.equal(result.report.maturity.released, true);
  assert.match(result.report.maturity.limits[0], /nao substitui/);
});

test("inspection reads legacy decisions and reports conflict between state folders", t => {
  const { file, run } = fixture(t);
  const decisions = '---\npreparacao: concluido\nconfiguracao_tecnica: pendente\n---\n# Estado\n';
  file('.pbai4devs/estado/configuracao/ESTADO.md', decisions);
  const legacy = run();
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.equal(legacy.report.maturity.configuration.present, true);
  assert.equal(legacy.report.maturity.configuration.preparacao, 'concluido');
  file('.pbai4devs/state/configuracao/ESTADO.md', decisions);
  const conflict = run();
  assert.equal(conflict.status, 2);
  assert.match(JSON.parse(conflict.stderr).error, /coexistem/);
});

test("Playwright examples and caches did not see actual project application", t => {
  const { file, run } = fixture(t);
  for (const folder of ['examples/generated/a', 'examples/fixture', 'tmp/examples/a', 'TEMP/project', '.PLAYWRIGHT-MCP', 'playwright-results']) {
    file(`${folder}/package.json`, '{}'); file(`${folder}/main.mjs`, 'export const fake=1;');
  }
  file('.PLAYWRIGHT-state.js', 'export const transient = true;');
  const report = run().report;
  assert.equal(report.mode, 'agentes-sem-aplicacao');
  assert.deepEqual(report.manifests, []); assert.deepEqual(report.sources, []);
});

test("accepts to inspect scenario in examples/generated without releasing other folders", t => {
  const base = join(projectRoot, 'examples/generated'); mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'inspector-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), '{}');
  const result = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mode, 'aplicacao-detectada');
});

test("arbitrary status and out-of-root references do not expose configuration data", t => {
  const { file, run } = fixture(t); const secret = 'PRIVATE_STATUS_192819';
  file('.pbai4devs/state/configuracao/ESTADO.md', `---\npreparacao: ${secret}\nconfiguracao_tecnica: ${secret}\ndocumentos:\n  prd: ../outside.md\n  design: docs/DESIGN.md\n---\n# Estado\n`);
  file('docs/DESIGN.md', `---\nstatus: ${secret}\n---\n# Design\n`);
  const result = run(); assert.equal(result.status, 0);
  assert.equal(result.report.maturity.planning.prd.path, null);
  assert.equal(result.report.maturity.planning.ready, false);
  assert.ok(!result.stdout.includes(secret));
});

test("empty documentary inventory does not create files or assume approval", t => {
  const { root, run } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.report.documentation.files, []);
  assert.deepEqual(result.report.documentation.configured, []);
  assert.equal(result.report.documentation.scan.truncated, false);
  assert.equal(result.report.documentation.scan.complete, true);
  assert.deepEqual(readdirSync(root), []);
  assert.match(result.report.documentation.limits.at(-1), /nao cria documentos/);
});

test("discovers real documentation without imposing box, docs folder or frontmatter", t => {
  const { root, file, run } = fixture(t);
  const content = 'DOC_CONTENT_MUST_NOT_BE_EMITTED_182711';
  for (const name of ['Readme.md', 'CONTRIBUTING.rst', 'SECURITY.adoc', 'History.md', 'ARCHITECTURE.md', 'AGENTS.md', 'LICENSE', 'examples/README', '_examples/server/README.md', 'wiki/guide.mdx', 'rfcs/001-change.md', 'packages/docs/content/api.mdx', '.github/CONTRIBUTING.md', '.github/SECURITY.md', '.github/copilot-instructions.md']) file(name, content);
  for (const name of ['node_modules/lib/README.md', '.pbai4devs/README.md', '.claude/skills/private/SKILL.md', '.github/skills/demo/SKILL.md', '.github/agents/revisor.agent.md', 'examples/generated/fixture/README.md', '.PLAYWRIGHT-MCP/README.md', 'tmp/README.md']) file(name, content);
  for (const dir of ['.Copilot', '.zcode', '.kimi-code', '.minimax', '.mimocode', '.dsh']) {
    file(dir + '/README.md', content);
    file(dir + '/package.json', '{"name":"client-cache"}');
  }
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const docs = result.report.documentation;
  assert.equal(docs.files.length, 15);
  assert.ok(docs.exclusions.directories.includes('.copilot'));
  assert.deepEqual(result.report.manifests, [], 'configuração de clientes não vira manifesto da aplicação');
  assert.equal(docs.files.find(item => item.path === 'Readme.md').role, 'readme');
  assert.equal(docs.files.find(item => item.path === 'rfcs/001-change.md').role, 'decision');
  assert.equal(docs.files.find(item => item.path === 'ARCHITECTURE.md').role, 'design');
  assert.equal(docs.files.find(item => item.path === 'AGENTS.md').role, 'instructions');
  assert.equal(docs.files.find(item => item.path === '.github/copilot-instructions.md').role, 'instructions');
  assert.equal(docs.files.find(item => item.path === '.github/CONTRIBUTING.md').role, 'contribution');
  assert.equal(docs.files.find(item => item.path === 'LICENSE').role, 'license');
  assert.ok(docs.exclusions.paths.includes('.github/skills'));
  assert.equal(docs.files.find(item => item.path === 'wiki/guide.mdx').sha256, createHash('sha256').update(content).digest('hex'));
  assert.ok(docs.files.every(item => item.origin === 'inferred' && item.kind === 'file'));
  assert.ok(!result.stdout.includes(content));
  assert.equal(readFileSync(join(root, 'Readme.md'), 'utf8'), content);
});

test("registered paths have provenance without taking status or reading configuration files", t => {
  const { file, run } = fixture(t);
  file('.pbai4devs/state/configuracao/ESTADO.md', '---\ndocumentos:\n  design: architecture/current.md\n  specs: specifications\n  prd: planning/absent.md\n  readme: ../private-secret.md\n  seguranca: .env\n---\n# Estado\n');
  file('architecture/current.md', '# Existing architecture\n');
  file('specifications/current.mdx', '# Increment\n');
  file('.env', 'DO_NOT_EMIT_OR_HASH_THIS_SECRET');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const docs = result.report.documentation;
  assert.deepEqual(docs.files.find(item => item.path === 'architecture/current.md').configuredAs, ['design']);
  assert.equal(docs.files.find(item => item.path === 'specifications/current.mdx').origin, 'configured');
  assert.ok(docs.configured.some(item => item.role === 'prd' && item.kind === 'missing'));
  assert.ok(docs.warnings.some(item => item.reason === 'invalid-configured-path'));
  assert.ok(docs.warnings.some(item => item.reason === 'configured-path-not-document'));
  assert.ok(!docs.files.some(item => item.path === '.env'));
  assert.ok(!result.stdout.includes('private-secret') && !result.stdout.includes('DO_NOT_EMIT'));
  assert.equal(docs.files.some(item => Object.hasOwn(item, 'status')), false);
});

test("symbolic documents remain opaque without reading internal, external or absent destinations", t => {
  const { root, file, run } = fixture(t);
  const outside = mkdtempSync(join(projectRoot, '.agent-tests', 'outside-docs-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  file('docs/real.md', '# Actual document\n');
  writeFileSync(join(outside, 'private.md'), 'OUTSIDE_SECRET_MUST_NOT_APPEAR');
  try {
    symlinkSync('docs/real.md', join(root, 'README.md'));
    symlinkSync(join(outside, 'private.md'), join(root, 'CLAUDE.md'));
    symlinkSync('absent.md', join(root, 'missing.md'));
    symlinkSync(outside, join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.skip('Links simbólicos indisponíveis sem permissão do Windows.'); return;
  }
  file('.pbai4devs/state/configuracao/ESTADO.md', '---\ndocumentos:\n  design: external/private.md\n---\n# State\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const docs = result.report.documentation;
  for (const name of ['README.md', 'CLAUDE.md', 'missing.md', 'external']) {
    const item = docs.files.find(item => item.path === name);
    assert.equal(item?.kind, 'symbolic-link', name);
    assert.equal(item.sha256, undefined);
  }
  assert.ok(!docs.files.some(item => item.path === 'external/private.md'));
  assert.ok(!result.stdout.includes(outside) && !result.stdout.includes('OUTSIDE_SECRET'));
  assert.equal(docs.scan.complete, false);
  assert.ok(docs.warnings.some(item => item.file === 'external' && item.reason === 'symbolic-link-not-inspected'));
  assert.equal(readFileSync(join(outside, 'private.md'), 'utf8'), 'OUTSIDE_SECRET_MUST_NOT_APPEAR');
});

test("symbolic documental folders without registration do not hide an incomplete reading", t => {
  const { root, run } = fixture(t);
  const outside = mkdtempSync(join(projectRoot, '.agent-tests', 'outside-doc-tree-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const privateContent = 'UNREAD_EXTERNAL_DOCUMENT_719329';
  writeFileSync(join(outside, 'private.md'), privateContent);
  try {
    for (const name of ['docs', 'wiki', 'rfcs', 'examples', 'custom-docs']) symlinkSync(outside, join(root, name), process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync('absent-directory', join(root, 'missing-directory'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.skip('Links simbólicos indisponíveis sem permissão do Windows.'); return;
  }
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const docs = result.report.documentation;
  assert.equal(docs.scan.complete, false);
  assert.equal(docs.scan.bytesRead, 0);
  assert.deepEqual(docs.configured, []);
  assert.deepEqual(docs.files.map(item => item.path), ['custom-docs', 'docs', 'examples', 'missing-directory', 'rfcs', 'wiki']);
  assert.ok(docs.files.every(item => item.kind === 'symbolic-link' && item.role === 'unclassified' && !item.sha256));
  assert.equal(docs.warnings.filter(item => item.reason === 'symbolic-link-not-inspected').length, 6);
  assert.ok(!result.stdout.includes(outside) && !result.stdout.includes(privateContent));
  assert.equal(readFileSync(join(outside, 'private.md'), 'utf8'), privateContent);
  const limited = inspectDocumentation(root, { maxFiles: 1 });
  assert.equal(limited.files.length, 1);
  assert.equal(limited.scan.truncated, true);
  assert.equal(limited.scan.complete, false);
});

test("documentary limits are explicit and do not return partial inventory as complete", t => {
  const { root, file } = fixture(t);
  file('a.md', '123'); file('b.md', '456'); file('deep/nested/c.md', '789');
  const files = inspectDocumentation(root, { maxFiles: 1 });
  assert.equal(files.files.length, 1); assert.equal(files.scan.truncated, true);
  assert.equal(files.scan.complete, false);
  const entries = inspectDocumentation(root, { maxEntries: 1 });
  assert.equal(entries.scan.entries, 1); assert.equal(entries.scan.truncated, true);
  const depth = inspectDocumentation(root, { maxDepth: 0 });
  assert.ok(!depth.files.some(item => item.path.startsWith('deep/')));
  assert.ok(depth.warnings.some(item => item.reason === 'depth-limit'));
  const bytes = inspectDocumentation(root, { maxFileBytes: 2 });
  assert.equal(bytes.scan.bytesHashed, 0); assert.equal(bytes.scan.truncated, true);
  assert.ok(bytes.files.every(item => !item.sha256));
  const total = inspectDocumentation(root, { maxTotalBytes: 4 });
  assert.ok(total.scan.bytesRead <= 4); assert.ok(total.scan.bytesHashed <= 4);
  assert.equal(total.scan.truncated, true);
  for (const limits of [{ maxFiles: -1 }, { maxEntries: 25001 }, { unknown: 1 }]) assert.throws(() => inspectDocumentation(root, limits), /Limite documental/);
});

test("Repeated inventory preserves bytes, modes, paths and Git index", t => {
  const { root, file, run } = fixture(t);
  file('README.md', '# Existing\n'); file('docs/guide.md', 'No imposed frontmatter\n');
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  git('init', '--quiet', '--template='); git('add', '--', 'README.md');
  const snapshot = () => {
    const files = {};
    const visit = (folder = '') => {
      for (const name of readdirSync(join(root, folder)).sort()) {
        if (name === '.git') continue;
        const relative = folder ? `${folder}/${name}` : name;
        const info = lstatSync(join(root, relative));
        files[relative] = { mode: info.mode, kind: info.isDirectory() ? 'directory' : info.isSymbolicLink() ? 'symbolic-link' : 'file' };
        if (info.isSymbolicLink()) files[relative].target = readlinkSync(join(root, relative));
        else if (info.isDirectory()) visit(relative);
        else files[relative].sha256 = createHash('sha256').update(readFileSync(join(root, relative))).digest('hex');
      }
    };
    visit(); return { files, index: git('ls-files', '--stage'), staged: git('diff', '--cached', '--binary'), config: readFileSync(join(root, '.git/config'), 'utf8') };
  };
  const before = snapshot();
  const first = run(), second = run();
  assert.equal(first.status, 0, first.stderr); assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(first.report.documentation, second.report.documentation);
  assert.deepEqual(snapshot(), before);
});
