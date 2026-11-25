import { chmodSync, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { assertLinuxXattrsUnchanged, inspectLinuxXattr } from '../lib/xattr-probe.mjs';
import { assertNoNestedGit } from '../lib/git-environment.mjs';
import { withPotentialPartial, withUncertainPath } from '../lib/error-reporting.mjs';
import { applyLocalIgnore, assertLocalIgnoreUnchanged, planUntrack } from '../lib/gitignore.mjs';
import { nativeMetadataCopySupported, publishFileReplacement, stageReplacementWithNativeMetadata } from '../lib/native-metadata.mjs';
import { assertRecoveryStageVolume, inspectProjectRecovery, startProjectRecovery, completeProjectRecovery } from '../lib/project-recovery.mjs';
import { buildRecoveryEntries } from '../lib/recovery-entries.mjs';
import { fail, stat } from './shared.mjs';
import { assertGitReadableForChanges } from './git-safety.mjs';
import { prepareLegacyBackup } from './backup.mjs';
import { assertNoSharedHardlinks, assertWritableMetadata } from './metadata.mjs';
import { parentChain } from './operations.mjs';
import { assertPrivateSyncStage } from './private-stage.mjs';

export function applySynchronization({
  root, absolute, safe, stageHandle, output, localPlan, logicalOperations, removals,
  backupCandidate, backups, firstFileStats, affectedHashes, affectedBefore, affectedIndex, hadGit,
  snapshot, beginMutation, assertFallbackChecks, assertClaudeMigrationInputs,
  migratedClaude, claudeRuleInputs, retiredClaude,
}) {
  const privateStage = stageHandle !== undefined;
  if (privateStage) assertPrivateSyncStage(root, stageHandle);
  const { capture, fingerprint, transactionRoots, originals, currentHashes } = snapshot;
  const touched = new Set(), createdDirectories = new Set();
  let transaction, startingRecovery = false;
  assertWritableMetadata(logicalOperations, safe, output);
  function ensureDirectory(value, parents = parentChain(value)) {
    const missing = [];
    for (const parent of parents) {
      if (stat(safe(parent))) break;
      missing.push(parent);
    }
    for (const directory of missing.reverse()) {
      mkdirSync(safe(directory)); createdDirectories.add(directory);
    }
  }
  function mutate(value, action, text) {
    const boundary = transactionRoots.find(root => value === root || value.startsWith(root + '/'));
    if (!boundary || fingerprint(capture(boundary)) !== currentHashes.get(boundary)) fail(`Arquivo mudou apos planejar: ${value}`);
    touched.add(value);
    action();
    const result = stat(safe(value));
    const matches = text === null ? !result : result?.isFile() && readFileSync(absolute(value)).equals(Buffer.from(text));
    if (!matches) fail(`Mudanca concorrente preservada: ${value}`);
    currentHashes.set(boundary, fingerprint(capture(boundary)));
  }

  function atomic(value, text, parents) {
    const target = safe(value);
    const boundary = transactionRoots.find(item => value === item || value.startsWith(item + '/'));
    let original = originals.get(boundary);
    for (const segment of value.slice(boundary.length).split('/').filter(Boolean)) original = original?.children?.[segment];
    ensureDirectory(value, parents);
    if (!original) {
      // Creating in the actual parent preserves inherited permissions. A
      // failed write can leave partial bytes, which remain for manual review.
      let fd, identity, primary, failed = false;
      try {
        fd = openSync(target, 'wx');
        identity = fstatSync(fd, { bigint: true });
        writeFileSync(fd, text);
      } catch (error) { primary = error; failed = true; }
      if (fd !== undefined) {
        try { closeSync(fd); }
        catch (error) {
          if (failed) primary = new AggregateError([primary, error], 'Falha ao gravar e fechar arquivo.', { cause: primary });
          else primary = error;
          failed = true;
        }
      }
      if (failed) throw withUncertainPath(primary, value);
      const published = lstatSync(target, { bigint: true });
      if (!published.isFile() || published.isSymbolicLink() || !identity.ino || published.dev !== identity.dev || published.ino !== identity.ino) {
        throw withUncertainPath(Object.assign(new Error('Identidade de publicação incerta.'), { code: 'E_CHANGED' }), value);
      }
      return;
    }

    const current = stat(target);
    if (!current?.isFile() || (current.mode & 0o777) !== original.mode) fail(`Arquivo mudou apos planejar: ${value}`);
    assertNoSharedHardlinks(safe, value);
    const stagedTarget = transaction ? join(transaction.stage, ...value.split('/')) : target;
    if (transaction) mkdirSync(dirname(stagedTarget), { recursive: true, mode: 0o700 });
    const temporary = `${stagedTarget}.sync.${randomUUID()}`;
    try {
      writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
      if (process.platform === 'linux') assertLinuxXattrsUnchanged(target, current, lstatSync(target), value);
      if (nativeMetadataCopySupported) stageReplacementWithNativeMetadata(target, temporary, text, original.mode, value);
      if (process.platform !== 'win32') chmodSync(temporary, original.mode);
      const staged = lstatSync(temporary, { bigint: true });
      assertNoSharedHardlinks(safe, value);
      const beforePublication = lstatSync(safe(value));
      assertLinuxXattrsUnchanged(target, current, beforePublication, value);
      if (!beforePublication.isFile() || beforePublication.dev !== current.dev || beforePublication.ino !== current.ino ||
          beforePublication.mode !== current.mode || !readFileSync(target).equals(original.data)) {
        throw Object.assign(new Error('Arquivo mudou antes da publicação.'), { code: 'E_CHANGED', path: value });
      }
      const windows = process.platform === 'win32';
      const expected = windows ? lstatSync(target, { bigint: true }) : staged;
      const hashes = windows ? {
        before: createHash('sha256').update(original.data).digest('hex'),
        after: createHash('sha256').update(text).digest('hex'),
      } : undefined;
      publishFileReplacement(temporary, target, value, hashes);
      const published = lstatSync(target, { bigint: true });
      if (!published.isFile() || published.isSymbolicLink() || !expected.ino || published.dev !== expected.dev || published.ino !== expected.ino) {
        throw withUncertainPath(Object.assign(new Error('Identidade de publicação incerta.'), { code: 'E_CHANGED' }), value);
      }
    } catch (error) { throw withUncertainPath(error, temporary); }
  }
  let backupRoot;
  try {
    beginMutation();
    assertFallbackChecks();
    assertClaudeMigrationInputs();
    if (localPlan) assertLocalIgnoreUnchanged(localPlan);
    if (Object.keys(affectedHashes).length) {
      if (!assertGitReadableForChanges(root) && hadGit) fail('Git deixou de estar disponivel antes da sincronizacao; arquivos preservados.');
      const current = planUntrack(root, affectedHashes);
      if (current.conflicts.length || current.index !== affectedIndex.index || current.paths.some(path => removals.some(value => path === value || path.startsWith(value + '/')))) fail('Indice Git mudou antes da sincronizacao; conteudo preservado.');
    }
    if (!privateStage && logicalOperations.length) {
      for (const [path, expected] of currentHashes) {
        if (fingerprint(capture(path)) !== expected) fail(`Arquivo mudou antes da captura de recuperação: ${path}`);
      }
      const fileChanges = new Map();
      for (const { path, action } of logicalOperations) {
        const boundary = transactionRoots.find(item => path === item || path.startsWith(item + '/'));
        let before = originals.get(boundary);
        for (const segment of path.slice(boundary.length).split('/').filter(Boolean)) before = before?.children?.[segment];
        if (before && !before.data) fail(`Tipo de arquivo não suportado na recuperação: ${path}`);
        fileChanges.set(path, { path, action: action === 'remove' ? 'remove' : before ? 'update' : 'create', before: before || null });
      }
      const entries = buildRecoveryEntries(root, [...fileChanges.values()]);
      startingRecovery = true;
      transaction = startProjectRecovery(root, entries);
      for (const { path, action } of fileChanges.values()) {
        if (action === 'update') assertRecoveryStageVolume(transaction, safe(path), path);
      }
    }
    prepareLegacyBackup({ root, safe, backups, backupCandidate, firstFileStats, output }, path => { backupRoot = path; });
    assertClaudeMigrationInputs();
    for (const { path, action, content, parents } of logicalOperations) {
      assertNoNestedGit(root, [path]);
      if (migratedClaude.has(path)) assertClaudeMigrationInputs(claudeRuleInputs.get(path));
      if (action === 'remove') mutate(path, () => {
        if (retiredClaude.has(path)) {
          const index = planUntrack(root, { [path]: affectedBefore.get(path) });
          if (index.paths.length || index.conflicts.length) fail(`Arquivo Claude rastreado no indice Git; remocao bloqueada: ${path}`);
        }
        if (process.platform === 'darwin') assertWritableMetadata([{ path, action }], safe, output);
        else assertNoSharedHardlinks(safe, path);
        const target = safe(path);
        if (process.platform === 'linux' && stat(target)?.isFile() && inspectLinuxXattr(target) === 'present') {
          throw Object.assign(new Error(`E_PROTECTED_METADATA: ${path}`), { code: 'E_PROTECTED_METADATA', path });
        }
        // Only a regular file can enter the removal plan. Never recurse if
        // another process replaces it with a directory before this call.
        rmSync(target, { force: true });
      }, null);
      else if (action === 'write') mutate(path, () => atomic(path, content, parents), content);
      else fail(`Operacao logica desconhecida: ${action}`);
    }
    assertFallbackChecks();
    // Directory ownership is not recorded: keep even empty parent directories.
    const migratedIgnore = localPlan && applyLocalIgnore(localPlan, { migrateLegacy: true }).migration;
    if (migratedIgnore) output(`Exclusao legada migrada. Backup local: ${migratedIgnore.backup}`);
    if (transaction) completeProjectRecovery(transaction);
  } catch (cause) {
    let error = cause;
    if (transaction || touched.size || createdDirectories.size) error = withPotentialPartial(error);
    if (backupRoot) error = withUncertainPath(error, backupRoot);
    for (const path of [...touched, ...createdDirectories]) error = withUncertainPath(error, path);
    const operation = transaction || cause?.recovery;
    if ((startingRecovery || operation) && !privateStage) {
      if (operation?.backup) {
        error = withUncertainPath(error, operation.backup);
        error.transaction = { generation: operation.generation, id: operation.id, backup: operation.backup,
          stage: operation.stage, journal: operation.journal };
      }
      error.recovery = inspectProjectRecovery(root);
      const publication = cause?.operation ?? cause?.cause?.operation;
      if (publication) error.operation = publication;
    }
    throw error;
  }
  return backupRoot;
}
