import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalEntrypoint, resolveEntrypoint, entrypointReference, renderEntrypointImports, extractManagedBlock, mergeManagedContent } from '../lib/managed-content.mjs';
import { fail, compare, stat } from './shared.mjs';
import { selectedEntrypoints } from './manifest.mjs';

export function planCatalogOutputs({
  built, discoveries, entries, sources, safe, absolute, ownedPaths, preserveBoundary,
  preserveNativeType, captureInput, remember, installed, previousCatalogs, previousOutputs,
  conflicts, protectedConflicts, force, backup,
}) {
  const registries = new Map();
  const discoveryOutputs = {};
  const catalogOutputs = {};
  for (const [target, content] of built.outputs) {
    const info = stat(safe(target));
    if (info && !info.isFile()) fail(`Registro nao e arquivo: ${target}`);
    const current = info ? readFileSync(absolute(target)) : null;
    captureInput(target, current);
    const currentHash = current && createHash('sha256').update(current).digest('hex');
    const known = current && [installed?.files?.[target], previousCatalogs[target]].some(digest => digest && digest === currentHash);
    if (current && !known) {
      // Identical bytes do not establish ownership. An unowned catalogue can
      // remain if already current, but it cannot be adopted or regenerated.
      remember(target, 'existing-catalog');
      if (current.toString('utf8') !== content) { conflicts.add(target); protectedConflicts.add(target); }
      continue;
    }
    const nextHash = createHash('sha256').update(content).digest('hex');
    if (installed?.files?.[target] !== nextHash) catalogOutputs[target] = nextHash;
    if (!current || current.toString('utf8') !== content) {
      registries.set(target, content);
      if (force && info) backup.add(target);
    }
  }
  for (const agent of discoveries) {
    for (const kind of ['skills', 'rules', 'agents']) {
      const manifest = `${agent}/${kind}.json`;
      if (preserveBoundary(manifest)) continue;
      const paths = [...entries].filter(([target, value]) => target.startsWith(`${agent}/`) && sources.get(value.source) === kind)
        .map(([target]) => kind === 'skills' ? posix.dirname(target) : target).sort(compare);
      const content = JSON.stringify({ entries: paths.map(path => ({ path })) }, null, 2) + '\n';
      const info = stat(safe(manifest));
      if (preserveNativeType(manifest, info, 'isFile')) continue;
      if (info && !info.isFile()) fail(`Registro nao e arquivo: ${manifest}`);
      if (info && !ownedPaths.has(manifest)) { remember(manifest); continue; }
      const current = info ? readFileSync(absolute(manifest)) : null;
      captureInput(manifest, current);
      const priorHashes = [previousOutputs[manifest], installed?.files?.[manifest]];
      const unchanged = current === null || priorHashes.includes(createHash('sha256').update(current).digest('hex'));
      if (!unchanged) { remember(manifest, 'edited-generated-file'); continue; }
      const nextHash = createHash('sha256').update(content).digest('hex');
      if (installed?.files?.[manifest] !== nextHash || Object.hasOwn(previousOutputs, manifest)) discoveryOutputs[manifest] = nextHash;
      if (!info || readFileSync(absolute(manifest), 'utf8') !== content) {
        if (info && force) backup.add(manifest);
        registries.set(manifest, content);
      }
    }
  }
  return { registries, discoveryOutputs, catalogOutputs };
}

export function planEntrypointOutputs({
  manifest, generateEntrypoints, installed, previousEntries, previousOutputs, priorBlocks,
  safe, absolute, root, preserveBoundary, preserveNativeType, captureInput, remember,
  remove, managedBlocks,
}) {
  const { discoveries } = manifest;
  const rootEntries = new Map();
  const nextEntries = generateEntrypoints ? {} : { ...previousEntries.entries };
  function retireProjectedFile(target, digest) {
    const canonical = canonicalEntrypoint(target);
    if (priorBlocks[target] || canonical && Object.keys(priorBlocks).some(path => canonicalEntrypoint(path) === canonical)) return;
    const file = safe(target), info = stat(file);
    if (!info) return;
    if (!info.isFile()) fail(`Tipo alterado em caminho gerenciado: ${target}`);
    const bytes = readFileSync(file);
    if (createHash('sha256').update(bytes).digest('hex') !== digest) {
      remember(target, 'edited-generated-file');
      return;
    }
    captureInput(target, bytes);
    remove.add(target);
  }
  for (const [target, digest] of Object.entries(previousOutputs)) {
    if (!discoveries.has(target.split('/')[0])) retireProjectedFile(target, digest);
  }
  if (generateEntrypoints) {
    const previous = previousEntries;
    const entrypoints = selectedEntrypoints(manifest, installed);
    for (const [name, digest] of Object.entries(previousEntries.entries)) {
      const canonical = canonicalEntrypoint(name);
      if (!entrypoints.includes(canonical)) retireProjectedFile(resolveEntrypoint(root, canonical), digest);
    }
    for (const canonical of entrypoints) {
      const name = resolveEntrypoint(root, canonical);
      const template = `.pbai4devs/templates/entrypoints/${canonical}`;
      if (!stat(safe(template))?.isFile()) continue;
      if (preserveBoundary(name)) continue;
      const info = stat(safe(name));
      if (preserveNativeType(name, info, 'isFile')) continue;
      const current = info?.isFile() ? readFileSync(absolute(name)) : null;
      captureInput(name, current);
      const previousHash = previous.entries[name] ?? installed?.files?.[name];
      const previousBlockHash = priorBlocks[name] ?? Object.entries(priorBlocks).find(([path]) => canonicalEntrypoint(path) === canonical)?.[1];
      if (current && (previousBlockHash || createHash('sha256').update(current).digest('hex') !== previousHash)) {
        const merged = mergeManagedContent(current, entrypointReference(root, canonical), { expectedHash: previousBlockHash });
        if (!previousBlockHash && previousHash !== createHash('sha256').update(current).digest('hex') && extractManagedBlock(current)) {
          remember(name, 'existing-managed-block'); continue;
        }
        captureInput(name, current);
        managedBlocks[name] = merged.sha256;
        rootEntries.set(name, merged.text);
        remember(name, 'existing-file-extended');
        continue;
      }
      if (current && createHash('sha256').update(current).digest('hex') === installed?.files?.[name]) {
        const content = renderEntrypointImports(root, current.toString('utf8'));
        rootEntries.set(name, content);
        const nextHash = createHash('sha256').update(content).digest('hex');
        if (nextHash !== installed.files[name]) nextEntries[name] = nextHash;
        continue;
      }
      const content = renderEntrypointImports(root, readFileSync(absolute(template), 'utf8'));
      const nextHash = createHash('sha256').update(content).digest('hex');
      nextEntries[name] = nextHash;
      rootEntries.set(name, content);
    }
  }
  return { rootEntries, nextEntries };
}
