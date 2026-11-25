import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertNoNestedGit } from '../lib/git-environment.mjs';
import { planUntrack } from '../lib/gitignore.mjs';
import { assertGitReadableForChanges } from './git-safety.mjs';
import { compare, fail, sorted, stat, topPaths } from './shared.mjs';

// Ordered logical file actions the execution loop would attempt. Parent
// chains are lexical candidates, checked again at the point of use; they
// do not describe temporary names, backups or rollback and are not a
// recovery plan.
export function parentChain(path) {
  const parents = [];
  for (let parent = posix.dirname(path); parent !== '.'; parent = posix.dirname(parent)) parents.push(parent);
  return parents;
}

function captureSyncInputs(logicalOperations, mergedInputs, safe) {
  function capture(value) {
    const file = safe(value), info = stat(file);
    if (!info) return null;
    if (info.isFile()) return { mode: info.mode & 0o777, data: readFileSync(file) };
    if (!info.isDirectory()) fail(`Tipo de arquivo nao suportado: ${value}`);
    return { mode: info.mode & 0o777, children: Object.fromEntries(readdirSync(file).sort(compare).map(name => [name, capture(`${value}/${name}`)])) };
  }
  function fingerprint(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  const transactionRoots = topPaths(logicalOperations.map(operation => operation.path));
  const originals = new Map(transactionRoots.map(value => [value, capture(value)]));
  for (const [path, bytes] of mergedInputs) {
    const boundary = transactionRoots.find(root => path === root || path.startsWith(root + '/'));
    if (!boundary) continue;
    let snapshot = originals.get(boundary);
    for (const segment of path.slice(boundary.length).split('/').filter(Boolean)) snapshot = snapshot?.children?.[segment];
    if (bytes === null ? snapshot != null : !snapshot?.data?.equals(bytes)) fail(`Arquivo mudou apos planejar: ${path}`);
  }
  const currentHashes = new Map([...originals].map(([value, content]) => [value, fingerprint(content)]));
  return { capture, fingerprint, transactionRoots, originals, currentHashes };
}

export function planSyncOperations({
  root, workspace, check, remove, backup, writes, rootEntries, manifestWrite,
  conflicts, protectedConflicts, remember,
}) {
  const { absolute, safe, mergedInputs } = workspace;
  const removals = topPaths(remove);
  const backups = topPaths(backup);
  const rootEntryChanges = [...rootEntries].filter(([name, content]) => !stat(absolute(name)) || readFileSync(absolute(name), 'utf8') !== content);
  const logicalOperations = [
    ...removals.map(path => ({ path, action: 'remove' })),
    ...[...writes, ...rootEntryChanges, ...(manifestWrite ? [manifestWrite] : [])].map(([path, content]) =>
      ({ path, action: 'write', content, parents: parentChain(path) })),
  ];
  for (const operation of logicalOperations) {
    if (typeof operation.path !== 'string' || !['remove', 'write'].includes(operation.action)
      || operation.action === 'write' && typeof operation.content !== 'string' && !Buffer.isBuffer(operation.content)) {
      fail('Plano de operacoes logicas invalido; nenhuma alteracao foi aplicada.');
    }
  }
  const backupCandidate = backups.length ? `.agent-tests/sync-backup.${randomUUID()}` : null;
  const nestedCandidates = [...logicalOperations.map(operation => operation.path), ...(backupCandidate ? [backupCandidate] : [])];
  try { assertNoNestedGit(root, nestedCandidates); }
  catch (error) {
    if (!check || error.code !== 'E_NESTED_GIT') throw error;
    conflicts.add(error.nestedGitPath); protectedConflicts.add(error.nestedGitPath); remember(error.nestedGitPath, 'nested-git');
  }
  // Every planned write/removal may cover a different staged version. Compare
  // the worktree bytes with the index before touching any path, even in force
  // mode, and repeat immediately before applying the transaction.
  const affected = sorted(logicalOperations.map(operation => operation.path));
  const emptyHash = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
  const affectedBefore = new Map();
  const affectedHashes = Object.fromEntries(affected.flatMap(value => {
    const info = stat(safe(value));
    if (info && !info.isFile()) return []; // A type conflict already blocks application.
    const digest = info ? createHash('sha256').update(readFileSync(absolute(value))).digest('hex') : null;
    affectedBefore.set(value, digest);
    return [[value, digest ?? emptyHash]];
  }));
  const hadGit = Object.keys(affectedHashes).length ? assertGitReadableForChanges(root) : false;
  const affectedIndex = planUntrack(root, affectedHashes, { gitlinkBoundaries: backupCandidate ? [backupCandidate] : [] });
  for (const path of affectedIndex.gitlinkConflicts || []) {
    conflicts.add(path); protectedConflicts.add(path); remember(path, 'gitlink');
  }
  for (const path of affectedIndex.paths) {
    if (!removals.includes(path)) continue;
    conflicts.add(path);
    protectedConflicts.add(path);
    remember(path, 'tracked-stale-file-preserved');
  }
  for (const path of affectedIndex.conflicts) {
    conflicts.add(path);
    remember(path, 'staged-content-preserved');
  }
  const snapshot = captureSyncInputs(logicalOperations, mergedInputs, safe);
  return {
    logicalOperations, removals, backups, backupCandidate, rootEntryChanges,
    affectedBefore, affectedHashes, affectedIndex, hadGit, snapshot,
  };
}
