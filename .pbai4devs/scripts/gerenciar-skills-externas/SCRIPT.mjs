#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot, requireNode, isMain } from '../lib/runtime.mjs';
import { ToolManager, binaryInvocation, toolEnvironment } from '../preparar-ferramentas/SCRIPT.mjs';

const fail = message => { throw new Error(message); };
const json = (file, label = 'arquivo local') => {
  const text = readFileSync(file, 'utf8');
  try { return JSON.parse(text); } catch { throw new SyntaxError(`JSON invalido (${label}).`); }
};
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const repository = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const stat = file => { try { return lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

export function safePath(root, path) {
  const full = resolve(root, path); const part = relative(root, full);
  if (isAbsolute(part) || part === '..' || part.startsWith(`..${sep}`)) fail('Caminho fora da pasta permitida.');
  let current = root;
  for (const name of part.split(sep).filter(Boolean)) {
    if (stat(current)?.isDirectory() && readdirSync(current).some(existing => existing !== name && existing.toLowerCase() === name.toLowerCase())) fail(`Caixa conflitante: ${full}`);
    current = join(current, name);
    if (stat(current)?.isSymbolicLink()) fail(`Link simbolico nao permitido: ${full}`);
  }
  return full;
}

export function validateCatalog(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.allowlist) || !Array.isArray(value.skills)) fail('Catalogo externo invalido.');
  const allowed = new Set(); const ids = new Set();
  for (const source of value.allowlist) {
    if (typeof source !== 'string' || !repository.test(source) || allowed.has(source.toLowerCase())) fail('Origem duplicada ou invalida na allowlist.');
    allowed.add(source.toLowerCase());
  }
  for (const entry of value.skills) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('Entrada de skill invalida.');
    if (!slug.test(entry.id || '') || ids.has(entry.id)) fail('Identificador de skill invalido ou duplicado.');
    ids.add(entry.id);
    if (!repository.test(entry.repository || '') || !allowed.has(entry.repository.toLowerCase())) fail(`Origem fora da allowlist: ${entry.id}`);
    if (!/^[a-f0-9]{40}$/.test(entry.commit || '')) fail(`Use SHA completo e imutavel: ${entry.id}`);
    if (typeof entry.path !== 'string' || !entry.path.endsWith('/SKILL.md') || entry.path.includes('\\') || /[\x00-\x1f]/.test(entry.path) || entry.path.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) fail(`Caminho de skill invalido: ${entry.id}`);
    if (!slug.test(entry.name || '') || typeof entry.license !== 'string' || !entry.license.trim() || typeof entry.use !== 'string' || !entry.use.trim() || !['candidate', 'reviewed'].includes(entry.status)) fail(`Metadados incompletos: ${entry.id}`);
    if (entry.notes !== undefined && typeof entry.notes !== 'string') fail(`Notas invalidas: ${entry.id}`);
    if (entry.licenseSource !== undefined) {
      const license = new URL(entry.licenseSource);
      if (license.origin !== 'https://github.com' || !license.pathname.startsWith(`/${entry.repository}/blob/${entry.commit}/`)) fail(`Referencia de licenca deve usar a mesma origem e pin: ${entry.id}`);
    }
  }
  return value;
}

export function loadCatalog(root = projectRoot) {
  return validateCatalog(json(safePath(realpathSync(root), '.pbai4devs/external-skills/CATALOG.json'), 'CATALOG.json'));
}

export function sourceUrl(entry) {
  return `https://github.com/${entry.repository}/tree/${entry.commit}/${posix.dirname(entry.path).split('/').map(encodeURIComponent).join('/')}`;
}

export function skillsArguments(entry, list = false) {
  return ['add', sourceUrl(entry), '--skill', entry.name, ...(list ? ['--list'] : ['--agent', 'universal', '--copy', '--yes'])];
}

export function runSkills(root, cwd, args) {
  const manager = new ToolManager({ root }); const entry = manager.entry('skills'); const installed = manager.check('skills'); const runtime = manager.runtime('skills');
  const [file, argv] = binaryInvocation(installed.prefix, entry.download.package, args, entry.binary || entry.name, runtime.file);
  const environment = toolEnvironment(entry, manager.local('skills'), runtime);
  environment.DISABLE_TELEMETRY = '1'; environment.CI = '1'; environment.XDG_STATE_HOME = join(cwd, '.state');
  const result = spawnSync(file, argv, { cwd, env: environment, encoding: 'utf8', timeout: 180000, windowsHide: true });
  if (result.error || result.status !== 0) fail(`skills: ${result.error?.message || result.stderr?.trim().slice(0, 600) || result.stdout?.trim().slice(0, 600) || result.status}`);
  return result.stdout || '';
}

function descriptor(entry) {
  return { id: entry.id, name: entry.name, repository: entry.repository, commit: entry.commit, path: entry.path, license: entry.license };
}

function payloadHash(folder) {
  const hash = createHash('sha256');
  function visit(path) {
    for (const name of readdirSync(path).sort()) {
      const file = safePath(folder, relative(folder, join(path, name))); const info = lstatSync(file);
      if (info.isDirectory()) visit(file);
      else if (info.isFile()) {
        const label = relative(folder, file).split(sep).join('/'); const content = readFileSync(file);
        hash.update(`${Buffer.byteLength(label)}:${label}:${content.length}:`); hash.update(content);
      } else fail(`Arquivo de skill nao regular: ${file}`);
    }
  }
  visit(folder);
  return hash.digest('hex');
}

export class ExternalSkills {
  constructor({ root = projectRoot, catalog, run = runSkills } = {}) {
    requireNode(); this.root = realpathSync(root); this.catalog = validateCatalog(catalog ?? loadCatalog(this.root)); this.run = run;
    this.home = safePath(this.root, '.pbai4devs/external-skills');
  }
  entry(id, reviewed = false) {
    const entry = this.catalog.skills.find(item => item.id === id);
    if (!entry) fail(`Skill externa desconhecida: ${id}`);
    if (reviewed && entry.status !== 'reviewed') fail(`Revise origem, pin, licenca e instrucoes antes de instalar: ${id}`);
    return entry;
  }
  local(id) { this.entry(id); return safePath(this.home, `.local/${id}`); }
  validatePayload(folder, entry) {
    safePath(this.home, relative(this.home, folder));
    // O CLI skills usa .agents no staging universal, independentemente do hub.
    const skills = safePath(folder, '.agents/skills');
    const names = readdirSync(skills).sort();
    if (names.length !== 1 || names[0] !== entry.name) fail(`Esperada somente a skill ${entry.name}.`);
    const payload = safePath(folder, `.agents/skills/${entry.name}`); const file = safePath(payload, 'SKILL.md');
    const text = readFileSync(file, 'utf8'); const lines = text.replaceAll('\r', '').split('\n'); const closing = lines.indexOf('---', 1);
    if (lines[0] !== '---' || closing < 1 || !lines.slice(1, closing).some(line => new RegExp(`^name:\\s*['\"]?${entry.name}['\"]?\\s*$`).test(line))) fail('Nome ou frontmatter da skill instalado divergente.');
    const lock = json(safePath(folder, 'skills-lock.json'), 'skills-lock.json'); const source = lock.skills?.[entry.name];
    if (lock.version !== 2 || Object.keys(lock.skills || {}).length !== 1 || source?.sourceType !== 'github' || source.source?.toLowerCase() !== entry.repository.toLowerCase() || source.ref !== entry.commit || source.skillPath !== entry.path || !/^[a-f0-9]{64}$/.test(source.computedHash || '')) fail('Proveniencia do lock diverge do catalogo revisado.');
    for (const name of readdirSync(folder)) if (!['.agents', '.state', 'skills-lock.json', 'CURRENT.json'].includes(name)) fail(`Saida inesperada do CLI: ${name}`);
    if (readdirSync(join(folder, '.agents')).some(name => name !== 'skills')) fail('Saida inesperada fora da origem unica da skill.');
    return { file, hash: payloadHash(payload) };
  }
  check(id) {
    const entry = this.entry(id, true); const folder = this.local(id);
    const receiptPath = safePath(folder, 'CURRENT.json');
    if (!existsSync(receiptPath)) fail(`Skill ausente: ${id}; use install ${id}.`);
    const receipt = json(receiptPath, 'CURRENT.json');
    if (JSON.stringify(receipt.source) !== JSON.stringify(descriptor(entry))) fail(`Pin ou origem mudou; revise o catalogo e use update ${id}.`);
    const payload = this.validatePayload(folder, entry);
    if (payload.hash !== receipt.payloadHash) fail(`Conteudo local alterado: ${id}; use update ${id} para restaurar o pin revisado.`);
    return { id, commit: entry.commit, file: payload.file, license: entry.license };
  }
  read(id) { const info = this.check(id); return { ...info, content: readFileSync(info.file, 'utf8') }; }
  async lock(id, action) {
    this.entry(id, true); const local = safePath(this.home, '.local'); mkdirSync(local, { recursive: true });
    const lock = safePath(local, `.${id}.lock`);
    try { mkdirSync(lock); } catch (error) { if (error.code === 'EEXIST') fail(`Operacao em andamento: ${id}`); throw error; }
    try { return await action(local); } finally { rmSync(lock, { recursive: true, force: true }); }
  }
  async install(id) {
    this.entry(id, true);
    if (stat(this.local(id))) return { ...this.check(id), changed: false };
    return this.replace(id);
  }
  async update(id) {
    this.entry(id, true);
    try { return { ...this.check(id), changed: false }; } catch { return this.replace(id); }
  }
  async replace(id) {
    const entry = this.entry(id, true);
    return this.lock(id, async local => {
      const stage = mkdtempSync(join(local, `.stage-${id}-`)); const target = this.local(id); let previous;
      try {
        await this.run(this.root, stage, skillsArguments(entry));
        const payload = this.validatePayload(stage, entry);
        writeFileSync(join(stage, 'CURRENT.json'), JSON.stringify({ source: descriptor(entry), payloadHash: payload.hash, installedAt: new Date().toISOString() }, null, 2) + '\n');
        if (stat(target)) { previous = join(local, `.previous-${id}-${randomUUID()}`); renameSync(target, previous); }
        try { renameSync(stage, target); }
        catch (error) { if (previous) renameSync(previous, target); throw error; }
        if (previous) rmSync(previous, { recursive: true, force: true });
        return { ...this.check(id), changed: true };
      } finally { rmSync(stage, { recursive: true, force: true }); }
    });
  }
  async discover(id) {
    const entry = this.entry(id); const local = safePath(this.home, '.local'); mkdirSync(local, { recursive: true });
    const stage = mkdtempSync(join(local, `.discover-${id}-`));
    try { return await this.run(this.root, stage, skillsArguments(entry, true)); }
    finally { rmSync(stage, { recursive: true, force: true }); }
  }
}

export async function main(input = process.argv.slice(2), manager) {
  requireNode(); const [mode = 'help', id, ...extra] = input;
  if (['help', '--help', '-h'].includes(mode)) { console.log('Uso: list | discover <id> | install <id> | check <id> | update <id> | read <id>. Atualizacoes exigem pin revisado no CATALOG.json.'); return 0; }
  manager ??= new ExternalSkills();
  if (mode === 'list' && !id && !extra.length) { for (const entry of manager.catalog.skills) console.log(JSON.stringify(entry)); return 0; }
  if (!['discover', 'install', 'check', 'update', 'read'].includes(mode) || !id || extra.length) fail('Use uma acao e um unico id do catalogo; consulte --help.');
  const result = await manager[mode](id); console.log(typeof result === 'string' ? result.trim() : JSON.stringify(result)); return 0;
}

if (isMain(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
