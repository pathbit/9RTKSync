import { posix } from 'node:path';
import { canonicalEntrypoint, resolveEntrypoint } from '../lib/managed-content.mjs';
import { auxiliary, compare, fail, parseJson, reserved, sorted } from './shared.mjs';

function replaceJsonMember(bytes, member, value) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail('Invalid UTF-8 in derived state.');
  let i = 0;
  const space = () => { while (/\s/.test(text[i] || '') && i < text.length) i++; };
  const stringEnd = () => {
    if (text[i++] !== '"') fail('Invalid JSON member.');
    while (i < text.length) {
      const char = text[i++];
      if (char === '\\') { i++; continue; }
      if (char === '"') return;
    }
    fail('Unterminated JSON string.');
  };
  space(); if (text[i++] !== '{') fail('Invalid derived state.');
  const properties = [];
  while (true) {
    space(); if (text[i] === '}') break;
    const start = i; stringEnd(); const key = JSON.parse(text.slice(start, i));
    space(); if (text[i++] !== ':') fail('Invalid JSON member.');
    space(); const valueStart = i;
    if (text[i] === '"') stringEnd();
    else if (text[i] === '{' || text[i] === '[') {
      const stack = [];
      do {
        const char = text[i];
        if (char === '"') { stringEnd(); continue; }
        i++;
        if (char === '{' || char === '[') stack.push(char);
        else if (char === '}' || char === ']') stack.pop();
      } while (stack.length && i < text.length);
      if (stack.length) fail('Invalid derived state.');
    } else { while (i < text.length && text[i] !== ',' && text[i] !== '}') i++; while (i > valueStart && /\s/.test(text[i - 1])) i--; }
    const end = i; properties.push({ key, start, valueStart, end });
    space(); if (text[i] === ',') { i++; continue; } if (text[i] === '}') break;
    fail('Invalid JSON member separator.');
  }
  const matches = properties.filter(item => item.key === member);
  if (matches.length > 1) fail('Ambiguous derived state member.');
  if (!matches.length) {
    if (value === undefined) return bytes;
    const insertion = `${properties.length ? ',' : ''}\n  ${JSON.stringify(member)}: ${JSON.stringify(value, null, 2)}\n`;
    const next = text.slice(0, i) + insertion + text.slice(i);
    try { JSON.parse(next); } catch { fail('Unable to preserve derived state safely.'); }
    return Buffer.from(next);
  }
  const current = matches[0], index = properties.indexOf(current);
  let next;
  if (value !== undefined) next = text.slice(0, current.valueStart) + JSON.stringify(value, null, 2) + text.slice(current.end);
  else if (index > 0) next = text.slice(0, properties[index - 1].end) + text.slice(current.end);
  else if (properties.length > 1) next = text.slice(0, current.start) + text.slice(properties[1].start);
  else next = text.slice(0, current.start) + text.slice(current.end);
  try { JSON.parse(next); } catch { fail('Unable to preserve derived state safely.'); }
  return Buffer.from(next);
}


// Compare owned fields structurally, preserving all other JSON bytes.
export function derivedContent(original, previous, next) {
  if (!original) return JSON.stringify(next, null, 2) + '\n';
  const keys = ['schemaVersion', 'entries', 'outputs', 'files', 'blocks', 'removedBlocks', 'removedFiles', 'catalogs', 'config'];
  const canonical = value => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, canonical(value[key])]))
    : Array.isArray(value) ? value.map(canonical) : value;
  let result = original;
  for (const key of keys) {
    if (JSON.stringify(canonical(previous[key])) !== JSON.stringify(canonical(next[key]))) result = replaceJsonMember(result, key, next[key]);
  }
  return result.toString('utf8');
}

export const validResourcePath = path => {
  if (typeof path !== 'string' || !/^\.[A-Za-z0-9][A-Za-z0-9._-]*\/.+/.test(path)) return false;
  const [root, scope] = path.split('/');
  return !reserved.has(root.toLowerCase()) && ![...auxiliary, 'workflows'].includes(scope.toLowerCase())
    && !['readme.md', 'instructions.md'].includes(posix.basename(path).toLowerCase())
    && (/\.(md|mdc)$/i.test(path) || path.startsWith('.gemini/commands/') && path.endsWith('.toml'));
};

export function readDerivedOwnership(registryBytes, { root, safe, installed, output }) {
  const previousEntries = registryBytes ? parseJson(registryBytes.toString('utf8'), 'estado derivado') : { schemaVersion: 1, entries: {} };
  if (previousEntries?.schemaVersion !== 1 || !previousEntries.entries || typeof previousEntries.entries !== 'object' || Array.isArray(previousEntries.entries) || Object.entries(previousEntries.entries).some(([name, hash]) => !canonicalEntrypoint(name) || !/^[a-f0-9]{64}$/.test(hash))) fail('Registro de entradas derivadas invalido.');
  const previousOutputs = previousEntries.outputs ?? {};
  if (!previousOutputs || typeof previousOutputs !== 'object' || Array.isArray(previousOutputs) || Object.entries(previousOutputs).some(([path, hash]) => !/^\.[A-Za-z0-9][A-Za-z0-9._-]*\/(skills|rules|agents)\.json$/.test(path) || reserved.has(path.split('/')[0].toLowerCase()) || !/^[a-f0-9]{64}$/.test(hash))) fail('Registro de saidas derivadas invalido.');
  const previousCatalogs = previousEntries.catalogs ?? {};
  const catalogPaths = new Set(['.pbai4devs/catalog.json', '.pbai4devs/skills.json', '.pbai4devs/agents.json', '.pbai4devs/rules.json']);
  if (!previousCatalogs || typeof previousCatalogs !== 'object' || Array.isArray(previousCatalogs) || Object.entries(previousCatalogs).some(([path, hash]) => !catalogPaths.has(path) || !/^[a-f0-9]{64}$/.test(hash))) fail('Registro de catalogos derivados invalido.');
  for (const path of Object.keys(previousCatalogs)) safe(path);
  if (previousEntries.config !== undefined && (typeof previousEntries.config !== 'string' || !/^[a-f0-9]{64}$/.test(previousEntries.config))) fail('Registro de configuracao derivada invalido.');
  const validIgnoreBlock = path => path === '.pbai4devs/.gitignore' || typeof path === 'string' && /^\.[A-Za-z0-9][A-Za-z0-9._-]*\/\.gitignore$/.test(path) && !reserved.has(path.split('/')[0].toLowerCase());
  for (const [name, values] of [['files', previousEntries.files ?? {}], ['blocks', previousEntries.blocks ?? {}]]) {
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.entries(values).some(([path, hash]) => !(validResourcePath(path) || name === 'blocks' && (canonicalEntrypoint(path) || validIgnoreBlock(path))) || !/^[a-f0-9]{64}$/.test(hash))) fail(`Registro de ${name} derivados invalido.`);
    for (const path of Object.keys(values)) safe(canonicalEntrypoint(path) ? resolveEntrypoint(root, canonicalEntrypoint(path)) : path);
  }
  const removedBlocks = new Set(previousEntries.removedBlocks ?? []);
  if (!Array.isArray(previousEntries.removedBlocks ?? []) || [...removedBlocks].some(path => typeof path !== 'string' || !(validResourcePath(path) || canonicalEntrypoint(path)))) fail('Registro de blocos removidos invalido.');
  for (const path of removedBlocks) safe(canonicalEntrypoint(path) ? resolveEntrypoint(root, canonicalEntrypoint(path)) : path);
  const removedFiles = previousEntries.removedFiles ?? {};
  if (!removedFiles || typeof removedFiles !== 'object' || Array.isArray(removedFiles) || Object.entries(removedFiles).some(([path, hash]) => !validResourcePath(path) || !/^[a-f0-9]{64}$/.test(hash))) fail('Registro de arquivos removidos invalido.');
  if (Object.entries(removedFiles).some(([path, hash]) => installed?.files?.[path] && installed.files[path] !== hash)) fail('Registro de arquivos removidos diverge do estado instalado.');
  for (const path of Object.keys(removedFiles)) safe(path);
  const effectiveRemovedFiles = { ...removedFiles };
  const unverifiedRemovals = sorted(Object.keys(removedFiles).filter(path => !Object.hasOwn(installed?.files ?? {}, path)));
  const unknownRemovedFiles = new Set(unverifiedRemovals);
  if (unverifiedRemovals.length) output(`Registros de remocao sem entrada no estado instalado; preserve e revise: ${unverifiedRemovals.map(path => JSON.stringify(path)).join(', ')}.`);
  const priorFiles = { ...Object.fromEntries(Object.entries(installed?.files ?? {}).filter(([path, hash]) => effectiveRemovedFiles[path] !== hash)), ...previousEntries.files };
  const priorBlocks = { ...Object.fromEntries(Object.entries(installed?.blocks ?? {}).filter(([path]) => !removedBlocks.has(path))), ...previousEntries.blocks };
  const ownedPaths = new Set([...Object.keys(priorFiles), ...Object.keys(priorBlocks), ...Object.keys(previousEntries.entries), ...Object.keys(previousOutputs)]);
  return {
    previousEntries, previousOutputs, previousCatalogs, removedBlocks, removedFiles, effectiveRemovedFiles,
    unverifiedRemovals, unknownRemovedFiles, priorFiles, priorBlocks, ownedPaths,
  };
}
