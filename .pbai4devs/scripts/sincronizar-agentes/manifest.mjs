import { posix } from 'node:path';
import { adapters, resolveAdapters } from '../lib/adapters.mjs';
import { clientResourcePath, resourcePath } from '../lib/resource-path.mjs';
import { planClaudeRule } from '../lib/claude-rule-scope.mjs';
import { adapterManifestHeader } from '../lib/adapter-manifest.mjs';
import { auxiliary, fail, read, stat, reserved, principals, sorted } from './shared.mjs';
import { header } from './references.mjs';

const layouts = new Set(['agrupado', 'plano', 'arquivo', 'mdc', 'instrucoes', 'prompt', 'agente', 'nenhum']);
export const migrateClients = 'Revise os clientes legados com agentdevkit update --dry-run e selecione clientes ativos com --agents.';

export function parseManifest(rows, configText, { absolute, safe, preserveBoundary, preserveNativeType, installed, privateStage }) {
  const agents = new Map();
  const formats = new Map();
  const fallbacks = new Map();
  const discoveries = new Set();
  const ignoreRoots = new Set();
  const natives = [];
  const legacy = [];
  function ignoreRoot(target) {
    if (!/^\.[^/]+$/.test(target) || reserved.has(target.toLowerCase())) fail(`Pasta de agente invalida: ${target}`);
    const info = preserveBoundary(target) ? null : stat(safe(target));
    preserveNativeType(target, info, 'isDirectory');
    for (const known of ignoreRoots) if (known !== target && known.toLowerCase() === target.toLowerCase()) fail('Raizes de agentes diferem somente por maiusculas/minusculas.');
    ignoreRoots.add(target);
  }
  for (const [index, row] of rows.entries()) {
    if (!row || row.startsWith('#')) continue;
    const fields = row.split('|');
    if (fields.length < 2 || fields.length > 4) fail('Campos invalidos no manifesto.');
    if (fields.slice(1).some(field => field.split('/')[0].toLowerCase() === '.gemini')) fail(migrateClients);
    const [type, target, source = '', metadata = ''] = fields;
    if (!preserveBoundary(target)) safe(target);
    if (type === 'agente') {
      if (fields.length > 3) fail(`Pasta de agente invalida: ${target}`);
      ignoreRoot(target);
      const mode = source || 'agrupado';
      if (!['agrupado', 'plano'].includes(mode)) fail(`Layout invalido: ${mode}`);
      for (const known of agents.keys()) if (known !== target && known.toLowerCase() === target.toLowerCase()) fail('Raizes de agentes diferem somente por maiusculas/minusculas.');
      if (agents.has(target) && agents.get(target) !== mode) fail(`Layouts conflitantes: ${target}`);
      agents.set(target, mode);
    } else if (type === 'formato') {
      if (fields.length !== 4 || !Object.hasOwn(principals, source) || !layouts.has(metadata)) fail(`Formato invalido: ${row}`);
      if (source === 'skills' && !['agrupado', 'plano', 'nenhum'].includes(metadata)) fail(`Skills exigem formato agrupado, plano ou nenhum: ${row}`);
      if ((metadata === 'mdc' || metadata === 'instrucoes') && source !== 'rules' || metadata === 'prompt' && source !== 'commands' || metadata === 'agente' && source !== 'agents') fail(`Formato incompativel com recurso: ${row}`);
      const key = `${target}/${source}`;
      if (formats.has(key)) fail(`Formato duplicado: ${key}`);
      formats.set(key, metadata);
    } else if (type === 'descoberta') {
      if (fields.length !== 3 || target !== '.agents' || source !== 'antigravity' || discoveries.has(target)) fail(`Descoberta invalida: ${row}`);
      discoveries.add(target);
    } else if (type === 'fallback') {
      if (fields.length !== 4 || metadata !== 'skills' || target === source || fallbacks.has(target)) fail(`Fallback invalido: ${row}`);
      fallbacks.set(target, source);
    } else if (type === 'gitignore') {
      if (fields.length !== 2) fail('gitignore aceita somente a pasta de destino.');
      ignoreRoot(target);
    } else if (type === 'documento') legacy.push(index);
    else if (type === 'nativo') {
      safe(source);
      if (metadata) {
        safe(metadata);
        if (posix.dirname(metadata) !== posix.dirname(source) || !/\.ya?ml$/.test(metadata)) fail(`Metadados fora da pasta da origem ou sem YAML: ${metadata}`);
        if (stat(absolute(source))?.isFile()) {
          if (!stat(absolute(metadata))?.isFile()) fail(`Metadados ausentes: ${metadata}`);
          const text = read(absolute(metadata));
          if (text.slice(header(text).length).trim()) fail(`Metadados devem conter apenas YAML: ${metadata}`);
        }
      }
      natives.push({ target, source, metadata, index });
    } else fail(`Tipo invalido no manifesto: ${type}`);
  }
  const generatedConfig = configText.startsWith('# Gerado por AgentDevKit;');
  if (!agents.size && configText !== adapterManifestHeader) fail('Nenhum agente cadastrado; confira o manifesto.');
  if (!privateStage && installed?.clients) {
    const active = resolveAdapters(installed.clients, { stored: true });
    const invalidSkillRoot = active.skillRoots.some(root => agents.has(root) && (
      discoveries.has(root) || Object.keys(principals).some(kind => kind !== 'skills' && formats.get(`${root}/${kind}`) !== 'nenhum')
      || natives.some(({ target }) => target.startsWith(`${root}/`) && !target.startsWith(`${root}/skills/`))
    ));
    if ((generatedConfig || !active.roots.length) && (
      active.roots.some(root => !ignoreRoots.has(root)) || [...ignoreRoots].some(root => !active.roots.includes(root))
    ) || invalidSkillRoot) {
      fail('O manifesto diverge dos clientes selecionados. Confira agentdevkit sync --dry-run antes de sincronizar.');
    }
  }
  for (const key of formats.keys()) if (!agents.has(key.split('/')[0])) fail(`Formato fora dos agentes: ${key}`);
  for (const [target, source] of fallbacks) if (!agents.has(target) || !agents.has(source) || formats.get(`${target}/skills`) !== 'nenhum' || formats.get(`${source}/skills`) === 'nenhum') fail(`Fallback fora dos agentes: ${target}`);
  for (const root of discoveries) if (!agents.has(root)) fail(`Descoberta fora dos agentes: ${root}`);
  return { agents, formats, fallbacks, discoveries, ignoreRoots, natives, legacy };
}

export function selectedEntrypoints({ agents, formats, fallbacks, discoveries }, installed) {
  const skillProviders = new Set(fallbacks.values());
  const manifestClients = adapters.filter(({ root }) => agents.has(root) && (
    !skillProviders.has(root) || discoveries.has(root)
    || Object.keys(principals).some(kind => kind !== 'skills' && formats.get(`${root}/${kind}`) !== 'nenhum')
  )).map(({ id }) => id);
  const clients = installed ? installed.clients : manifestClients.length ? manifestClients : ['none'];
  return resolveAdapters(clients, { stored: true }).entrypoints;
}

export function resolveNativeTargets({ agents, formats, fallbacks, natives }, built, {
  check, safe, absolute, preserveUnknown, unavailable, managed, referenceFile,
}) {
  const sources = new Map(Object.keys(principals).flatMap(kind => built.catalog[kind].map(entry => [entry.path, kind])));
  const rules = new Map(built.catalog.rules.map(rule => [rule.path, rule]));
  const entries = new Map();
  const folded = new Map();
  const omittedClaude = new Map();
  const invalidClaude = new Map();
  const claudeScopeBoundaries = new Set();
  function add(target, source, metadata = '') {
    if (preserveUnknown(target)) {
      if (target.startsWith('.claude/rules/')) claudeScopeBoundaries.add(target);
      return;
    }
    safe(target);
    const alias = folded.get(target.toLowerCase());
    if (alias && alias !== target) fail(`Destinos diferem somente por maiusculas/minusculas: ${target}`);
    const previous = entries.get(target);
    if (previous && (previous.source !== source || (previous.metadata && metadata && previous.metadata !== metadata))) fail(`Destinos ou metadados em conflito: ${target}`);
    entries.set(target, { source, metadata: metadata || previous?.metadata || '' });
    folded.set(target.toLowerCase(), target);
  }
  for (const [source, kind] of sources) {
    for (const [agent, mode] of agents) {
      const format = formats.get(`${agent}/${kind}`) || mode;
      if (format === 'nenhum') {
        const primary = kind === 'skills' && fallbacks.get(agent);
        if (!primary) continue;
        const primaryFormat = formats.get(`${primary}/${kind}`) || agents.get(primary);
        const primaryTarget = `${primary}/${resourcePath(source, kind, primaryFormat)}`;
        if (!unavailable(primaryTarget)) continue;
        const target = `${agent}/${resourcePath(source, kind, mode)}`;
        if (unavailable(target)) fail(`Skill indisponivel: ${source}; caminhos ${primaryTarget} e ${target} obstruidos.`);
        add(target, source);
        continue;
      }
      const nativeTarget = `${agent}/${resourcePath(source, kind, format)}`;
      const explicitMetadata = natives.some(native => native.target === nativeTarget && native.source === source && native.metadata);
      const path = clientResourcePath(source, kind, format, agent, rules.get(source), explicitMetadata);
      if (path === null) {
        omittedClaude.set(nativeTarget, { source, trigger: rules.get(source)?.trigger });
        continue;
      }
      add(`${agent}/${path}`, source);
    }
  }
  const missing = [];
  for (const native of natives) {
    const { target, source, metadata } = native;
    if (!Object.entries(principals).some(([kind, name]) => source.startsWith(`.pbai4devs/${kind}/`) && source.slice(`.pbai4devs/${kind}/`.length).includes('/') && posix.basename(source) === name)) fail(`Origem exclusiva de .pbai4devs ou documento nao permitido: ${source}`);
    if (stat(absolute(source))?.isFile() && !sources.has(source)) fail(`Origem nativa fora do catalogo canonico: ${source}`);
    if (!managed(target)) fail(`Destino nativo fora dos agentes: ${target}`);
    const scope = target.split('/')[1].toLowerCase();
    if ([...auxiliary, 'workflows'].includes(scope) || ['readme.md', 'instructions.md'].includes(posix.basename(target).toLowerCase()) || !/\.(md|mdc)$/i.test(target)) fail(`Destino nativo nao permitido: ${target}`);
    if (target.startsWith('.claude/rules/') && rules.has(source)) {
      const scope = planClaudeRule({ trigger: rules.get(source).trigger, nativeMetadata: metadata ? read(safe(metadata)) : undefined });
      if (scope.status !== 'ready') {
        if (!check) fail(`Escopo Claude invalido ou nao comprovado: ${target}: ${scope.reason || scope.status}.`);
        invalidClaude.set(target, scope.reason || scope.status);
        entries.delete(target); folded.delete(target.toLowerCase());
        continue;
      }
    }
    if (target.startsWith('.github/instructions/') && target.endsWith('.instructions.md') && rules.has(source) && ['manual', 'model_decision'].includes(rules.get(source).trigger) && !metadata) {
      const existing = stat(safe(target));
      // A human's existing frontmatter remains authoritative. Creating or
      // refreshing a native instruction without metadata would broaden it.
      if (!existing?.isFile() || referenceFile(target)) fail(`Regra ${rules.get(source).trigger} exige YAML nativo explicito para ${target}.`);
    }
    if (stat(absolute(source))?.isFile()) add(target, source, metadata);
    else missing.push(native);
  }
  for (const target of omittedClaude.keys()) if (entries.has(target)) fail(`Destino Claude ambiguo entre regra sem escopo e outra origem: ${target}.`);
  const targets = sorted(entries.keys());
  for (const target of targets) {
    const parts = target.split('/');
    while (parts.length > 1) {
      parts.pop();
      if (folded.has(parts.join('/').toLowerCase())) fail(`Destino e ancestral de outro destino: ${target}`);
    }
  }
  return { sources, rules, entries, omittedClaude, invalidClaude, claudeScopeBoundaries, missing, targets };
}
