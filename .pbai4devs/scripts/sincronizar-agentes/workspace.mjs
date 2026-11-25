import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { nativePathBoundary } from '../lib/native-paths.mjs';
import { canonicalEntrypoint } from '../lib/managed-content.mjs';
import { isGeneratedOutput } from '../lib/gitignore.mjs';
import { compare, fail, normalize, read, stat } from './shared.mjs';
import { isReference, marker, tomlMarker } from './references.mjs';

export function openSyncWorkspace(root, recordFileStats) {
  const absolute = value => join(root, ...value.split('/'));
  const firstFileStats = recordFileStats ? new Map() : null;
  function safe(value) {
    if (typeof value !== 'string' || !value || /^[A-Za-z]:/.test(value) || /[|\\\x00-\x1f\x7f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) fail(`Caminho invalido: ${value}`);
    let current = root;
    for (const part of value.split('/')) {
      const parent = stat(current);
      if (parent?.isDirectory()) {
        const aliases = readdirSync(current).filter(name => name.toLowerCase() === part.toLowerCase());
        if (aliases.some(name => name !== part)) fail(`Caminhos diferem somente por maiusculas/minusculas: ${value}`);
      }
      current = join(current, part);
      if (stat(current)?.isSymbolicLink()) fail(`Link simbolico: ${value}`);
    }
    // Planning reads may advance atime. Remember it before the first read
    // for the optional backup, and use it only while file identity matches.
    if (firstFileStats && !firstFileStats.has(value) && stat(current)?.isFile()) {
      firstFileStats.set(value, lstatSync(current, { bigint: true }));
    }
    return current;
  }
  const mergedInputs = new Map();
  const captureInput = (path, bytes) => { if (!mergedInputs.has(path)) mergedInputs.set(path, bytes); };
  return { absolute, safe, firstFileStats, mergedInputs, captureInput };
}

export function trackNativeOutputs(root, workspace, { rows, ownedPaths, priorFiles, outputBlocked }) {
  const { absolute, safe, captureInput } = workspace;
  const nativeRoots = new Set(rows.map(row => row.split('|')).filter(([type]) => ['agente', 'gitignore'].includes(type)).map(([, target]) => target));
  const preserved = new Map();
  const remember = (path, reason = 'user-owned') => { preserved.set(path, { path, reason }); return true; };
  function preserveBoundary(value) {
    if (!nativeRoots.has(value.split('/')[0]) && !canonicalEntrypoint(value) && value !== 'README.md') return false;
    const boundary = nativePathBoundary(root, value, ownedPaths, { preserveRootAliases: true });
    return boundary ? remember(boundary.path, boundary.reason) : false;
  }
  const fallbackChecks = new Map();
  let stageMayHaveEffects = false;
  function blockedOutput(path) {
    if (outputBlocked) return outputBlocked(path, { stageMayHaveEffects });
    let boundary = nativePathBoundary(root, path, ownedPaths, { preserveRootAliases: true });
    if (!boundary) {
      const info = stat(safe(path));
      if (info && !info.isFile()) boundary = { path, reason: 'non-file' };
    }
    if (!boundary) return { blocked: false };
    remember(boundary.path, boundary.reason);
    const info = lstatSync(absolute(boundary.path));
    return { blocked: true, ...boundary, identity: [info.dev, info.ino, info.mode, info.size, info.mtimeMs, info.ctimeMs] };
  }
  function unavailable(path) {
    const status = blockedOutput(path);
    if (fallbackChecks.has(path) && JSON.stringify(fallbackChecks.get(path)) !== JSON.stringify(status)) fail(`Caminho de skill mudou durante o planejamento: ${path}`);
    fallbackChecks.set(path, status);
    return status.blocked;
  }
  function assertFallbackChecks() {
    for (const [path, status] of fallbackChecks) if (JSON.stringify(blockedOutput(path)) !== JSON.stringify(status)) fail(`Caminho de skill mudou apos o planejamento: ${path}`);
  }
  function claimed(value) {
    if (ownedPaths.has(value)) return true;
    const info = stat(safe(value));
    if (!info?.isFile() || info.size > 1024 * 1024) return false;
    const text = read(safe(value));
    return text.split('\n').includes(marker) || text.startsWith(tomlMarker + '\n');
  }
  function preserveUnknown(value) {
    if (preserveBoundary(value)) return true;
    const info = stat(safe(value));
    if (info?.isFile() && (/\.(md|mdc)$/i.test(value) || value.startsWith('.gemini/commands/') && value.endsWith('.toml'))) return false;
    return info && !referenceFile(value) && !claimed(value) ? remember(value) : false;
  }
  function preserveNativeType(value, info, type) {
    if (!info || info[type]()) return false;
    if ([...ownedPaths].some(path => path === value || path.startsWith(`${value}/`))) fail(`Tipo alterado em caminho gerenciado: ${value}`);
    return remember(value, info.isDirectory() ? 'existing-directory' : info.isFile() ? 'existing-file' : 'existing-other');
  }
  function scan(value, { markdownOnly = false, prune = false } = {}) {
    if (preserveBoundary(value)) return [];
    const path = safe(value);
    const item = stat(path);
    if (!item) return [];
    if (item.isFile()) return !markdownOnly || /\.md$/i.test(value) ? [value] : [];
    if (!item.isDirectory()) fail(`Tipo de arquivo nao suportado: ${value}`);
    const files = [];
    function visit(folder) {
      for (const name of readdirSync(safe(folder)).sort(compare)) {
        const child = `${folder}/${name}`;
        if (preserveBoundary(child)) continue;
        const info = stat(safe(child));
        if (prune && isGeneratedOutput(child, info.isDirectory())) continue;
        if (info.isDirectory()) {
          files.push(...scan(child, { markdownOnly, prune }));
        } else if (info.isFile()) {
          if (!markdownOnly || /\.md$/i.test(name)) files.push(child);
        } else fail(`Tipo de arquivo nao suportado: ${child}`);
      }
    }
    visit(value);
    return files;
  }
  const referenceFile = (value, supplied) => {
    const info = stat(safe(value));
    if (!info?.isFile() || info.size > 1024 * 1024) return false;
    const bytes = supplied ?? readFileSync(absolute(value)), text = normalize(bytes.toString('utf8'));
    captureInput(value, bytes);
    const recordedHash = priorFiles[value];
    const recorded = recordedHash === createHash('sha256').update(bytes).digest('hex');
    return isReference(text) && recorded;
  };
  const protectedPath = value => /^(workflows(?:\/|$)|settings\.json$|extensions\.json$)/.test(value.slice(value.indexOf('/') + 1).toLowerCase());
  return {
    preserved, remember, preserveBoundary, unavailable, assertFallbackChecks, scan,
    claimed, preserveUnknown, preserveNativeType, referenceFile, protectedPath,
    beginMutation() { stageMayHaveEffects = true; },
  };
}
