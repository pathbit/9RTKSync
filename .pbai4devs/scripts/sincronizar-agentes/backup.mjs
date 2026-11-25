import { constants, closeSync, fchmodSync, fstatSync, ftruncateSync, futimesSync, lstatSync, mkdirSync, openSync, readSync, writeSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectMacDirectoryAcl } from '../lib/xattr-probe.mjs';
import { assertNoNestedGit } from '../lib/git-environment.mjs';
import { withUncertainPath } from '../lib/error-reporting.mjs';
import { planUntrack } from '../lib/gitignore.mjs';
import { copyFileWithNativeMetadata, nativeMetadataCopySupported } from '../lib/native-metadata.mjs';
import { createPrivateRecoveryDirectory } from '../lib/recovery-privacy.mjs';
import { fail, stat } from './shared.mjs';

export function prepareLegacyBackup({ root, safe, backups, backupCandidate, firstFileStats, output }, rememberBackupRoot) {
  if (!backups.length) return;
  let backupRoot;
  const originalCwd = process.cwd();
  let changedCwd = false, backupFailure;
  const checkBackupBoundary = () => {
    assertNoNestedGit(root, [backupCandidate]);
    if ((planUntrack(root, {}, { gitlinkBoundaries: [backupCandidate] }).gitlinkConflicts || []).length) fail('Backup em submódulo Git; arquivos preservados.');
  };
  try {
    checkBackupBoundary();
    const agentTests = safe('.agent-tests');
    mkdirSync(agentTests, { recursive: true });
    const agentTestsInfo = lstatSync(agentTests, { bigint: true });
    if (!agentTestsInfo.isDirectory() || agentTestsInfo.isSymbolicLink()) fail('Pasta de backup insegura; arquivos preservados.');
    process.chdir(agentTests);
    changedCwd = true;
    const pinnedAgentTests = lstatSync('.', { bigint: true });
    if (pinnedAgentTests.dev !== agentTestsInfo.dev || pinnedAgentTests.ino !== agentTestsInfo.ino) fail('Pasta de backup mudou; arquivos preservados.');
    checkBackupBoundary();
    const backupName = backupCandidate.slice('.agent-tests/'.length);
    backupRoot = safe(backupCandidate);
    rememberBackupRoot(backupRoot);
    if (process.platform === 'win32') createPrivateRecoveryDirectory(backupRoot);
    else mkdirSync(backupName, { mode: 0o700 });
    const info = lstatSync(backupName, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && (info.mode & 0o077n)) fail('Pasta de backup insegura; arquivos preservados.');
    if (process.platform === 'darwin' && inspectMacDirectoryAcl(backupRoot) !== 'empty') throw Object.assign(new Error('ACL do backup nao verificada como privada.'), { code: 'E_BACKUP' });
    process.chdir(backupName);
    const pinnedBackup = lstatSync('.', { bigint: true });
    if (pinnedBackup.dev !== info.dev || pinnedBackup.ino !== info.ino) fail('Pasta de backup mudou; arquivos preservados.');
    checkBackupBoundary();
    for (const value of backups) if (stat(safe(value))) {
      const backup = posix.join(backupCandidate, value);
      checkBackupBoundary(); assertNoNestedGit(root, [backup]);
      const destination = value;
      const absoluteDestination = join(backupRoot, ...value.split('/'));
      mkdirSync(dirname(destination), { recursive: true });
      checkBackupBoundary(); assertNoNestedGit(root, [backup]);
      // Only regular files enter the backup plan. Hold the source open and
      // create the destination exclusively, so a concurrent file is never
      // silently replaced. Ancestor checks are not atomic with these calls.
      const source = safe(value), before = lstatSync(source, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink()) fail('Origem de backup deixou de ser arquivo; arquivos preservados.');
      let sourceFd, destinationFd, verificationFd, primaryError, primaryFailed = false;
      const closeFailures = [];
      try {
        sourceFd = openSync(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
        const opened = fstatSync(sourceFd, { bigint: true });
        const same = item => item.isFile() && !item.isSymbolicLink() && item.dev === opened.dev && item.ino === opened.ino
          && item.mode === opened.mode && item.size === opened.size && item.mtimeNs === opened.mtimeNs && item.ctimeNs === opened.ctimeNs;
        if (!same(before)) fail('Origem de backup mudou; arquivos preservados.');
        const first = firstFileStats?.get(value);
        const accessTime = first && same(first) ? first.atimeNs : opened.atimeNs;
        if (opened.size > BigInt(Number.MAX_SAFE_INTEGER)) fail('Origem de backup excede limite seguro.');
        const mode = Number(opened.mode & 0o7777n);
        // Open the no-atime reader while the new file is private and still
        // owner-readable; the source mode may grant read access only to a
        // different principal. The backup directory has already been checked.
        destinationFd = openSync(destination, 'wx+', nativeMetadataCopySupported ? 0o600 : mode);
        if (process.platform === 'linux') {
          if (!constants.O_NOATIME) fail('Horario de acesso do backup nao verificavel; arquivos preservados.');
          fchmodSync(destinationFd, 0o600);
          const created = fstatSync(destinationFd, { bigint: true });
          verificationFd = openSync(destination, constants.O_RDONLY | constants.O_NOATIME | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
          const verifier = fstatSync(verificationFd, { bigint: true });
          if (!created.isFile() || !verifier.isFile() || !created.ino || verifier.dev !== created.dev || verifier.ino !== created.ino) fail('Backup mudou; arquivos preservados.');
        }
        const buffer = Buffer.alloc(65536), sourceHash = createHash('sha256'); let total = 0n, count;
        while ((count = readSync(sourceFd, buffer, 0, buffer.length, null)) > 0) {
          total += BigInt(count);
          if (total > opened.size) fail('Origem de backup mudou; arquivos preservados.');
          sourceHash.update(buffer.subarray(0, count));
          for (let offset = 0; offset < count;) {
            const written = writeSync(destinationFd, buffer, offset, count - offset, null);
            if (written <= 0) throw Object.assign(new Error('Falha ao escrever backup.'), { code: 'EIO' });
            offset += written;
          }
        }
        if (total !== opened.size) fail('Origem de backup mudou; arquivos preservados.');
        if (!same(fstatSync(sourceFd, { bigint: true })) || !same(lstatSync(source, { bigint: true }))) fail('Origem de backup mudou; arquivos preservados.');
        const initialCopy = fstatSync(destinationFd, { bigint: true }), copyHash = createHash('sha256');
        if (!initialCopy.isFile() || initialCopy.size !== opened.size || initialCopy.nlink !== 1n) fail('Backup mudou; arquivos preservados.');
        let position = 0, copied;
        while (position < Number(opened.size)) {
          copied = readSync(destinationFd, buffer, 0, Math.min(buffer.length, Number(opened.size) - position), position);
          if (!copied) fail('Backup incompleto; arquivos preservados.');
          copyHash.update(buffer.subarray(0, copied)); position += copied;
        }
        const sourceDigest = sourceHash.digest('hex');
        const sameCopy = (item, reference) => item.isFile() && !item.isSymbolicLink() && item.dev === reference.dev && item.ino === reference.ino
          && item.mode === reference.mode && item.size === reference.size && item.nlink === 1n
          && item.mtimeNs === reference.mtimeNs && item.ctimeNs === reference.ctimeNs;
        if (sourceDigest !== copyHash.digest('hex') || !sameCopy(fstatSync(destinationFd, { bigint: true }), initialCopy)
          || !sameCopy(lstatSync(destination, { bigint: true }), initialCopy)) fail('Backup mudou; arquivos preservados.');
        if (nativeMetadataCopySupported) {
          copyFileWithNativeMetadata(source, destination, { destinationIdentity: fstatSync(destinationFd, { bigint: true }), metadataOnly: true });
          if (process.platform === 'darwin') {
            // macOS cp -p carries ACLs and xattrs by copying the source
            // bytes too. Restore the already verified stream through the
            // open descriptor, then prove its digest again.
            ftruncateSync(destinationFd, 0);
            const restoredHash = createHash('sha256'); position = 0;
            while (position < Number(opened.size)) {
              copied = readSync(sourceFd, buffer, 0, Math.min(buffer.length, Number(opened.size) - position), position);
              if (!copied) fail('Origem de backup mudou; arquivos preservados.');
              restoredHash.update(buffer.subarray(0, copied));
              let offset = 0;
              while (offset < copied) {
                const written = writeSync(destinationFd, buffer, offset, copied - offset, position + offset);
                if (written <= 0) throw Object.assign(new Error('Falha ao escrever backup.'), { code: 'EIO' });
                offset += written;
              }
              position += copied;
            }
            if (restoredHash.digest('hex') !== sourceDigest) fail('Origem de backup mudou; arquivos preservados.');
          }
        }
        if (process.platform === 'darwin') fchmodSync(destinationFd, mode);
        if (!same(fstatSync(sourceFd, { bigint: true })) || !same(lstatSync(source, { bigint: true }))) fail('Origem de backup mudou; arquivos preservados.');
        const completed = fstatSync(destinationFd, { bigint: true });
        if (!completed.isFile() || completed.size !== opened.size || completed.nlink !== 1n || completed.mode !== opened.mode) fail('Backup mudou; arquivos preservados.');
        const finalCopyHash = createHash('sha256'); position = 0;
        while (position < Number(opened.size)) {
          copied = readSync(destinationFd, buffer, 0, Math.min(buffer.length, Number(opened.size) - position), position);
          if (!copied) fail('Backup incompleto; arquivos preservados.');
          finalCopyHash.update(buffer.subarray(0, copied)); position += copied;
        }
        if (sourceDigest !== finalCopyHash.digest('hex') || !sameCopy(fstatSync(destinationFd, { bigint: true }), completed)
          || !sameCopy(lstatSync(destination, { bigint: true }), completed)) fail('Backup mudou; arquivos preservados.');
        // Restore timestamps, verify bytes, then restore them again because
        // macOS has no portable O_NOATIME reader.
        futimesSync(destinationFd, Number(accessTime) / 1e9, Number(opened.mtimeNs) / 1e9);
        const timestamped = fstatSync(destinationFd, { bigint: true });
        if (timestamped.dev !== completed.dev || timestamped.ino !== completed.ino || timestamped.size !== completed.size || timestamped.mode !== completed.mode
          || !timestamped.isFile() || timestamped.nlink !== 1n) fail('Backup mudou; arquivos preservados.');
        const reader = verificationFd ?? destinationFd;
        const finalHash = createHash('sha256'); position = 0;
        while (position < Number(opened.size)) {
          copied = readSync(reader, buffer, 0, Math.min(buffer.length, Number(opened.size) - position), position);
          if (!copied) fail('Backup incompleto; arquivos preservados.');
          finalHash.update(buffer.subarray(0, copied)); position += copied;
        }
        const checked = fstatSync(destinationFd, { bigint: true });
        const checkedNamed = lstatSync(destination, { bigint: true });
        if (sourceDigest !== finalHash.digest('hex') || checked.dev !== timestamped.dev || checked.ino !== timestamped.ino
          || checked.mode !== timestamped.mode || checked.size !== timestamped.size || checked.nlink !== 1n
          || checked.atimeNs !== checkedNamed.atimeNs || checked.mtimeNs !== checkedNamed.mtimeNs || checked.ctimeNs !== checkedNamed.ctimeNs
          || !same(fstatSync(sourceFd, { bigint: true })) || !same(lstatSync(source, { bigint: true }))) fail('Backup mudou; arquivos preservados.');
        futimesSync(destinationFd, Number(accessTime) / 1e9, Number(opened.mtimeNs) / 1e9);
        const final = fstatSync(destinationFd, { bigint: true });
        const finalNamed = lstatSync(destination, { bigint: true });
        if (!finalNamed.isFile() || finalNamed.isSymbolicLink() || finalNamed.dev !== final.dev || finalNamed.ino !== final.ino
          || finalNamed.mode !== final.mode || finalNamed.size !== final.size || finalNamed.nlink !== 1n
          || finalNamed.atimeNs !== final.atimeNs || finalNamed.mtimeNs !== final.mtimeNs || finalNamed.ctimeNs !== final.ctimeNs) fail('Backup mudou; arquivos preservados.');
      } catch (error) {
        primaryError = error;
        primaryFailed = true;
      } finally {
        for (const [fd, path] of [[verificationFd, absoluteDestination], [destinationFd, absoluteDestination], [sourceFd, source]]) if (fd !== undefined) {
          try { closeSync(fd); } catch (error) { closeFailures.push({ error, path }); }
        }
      }
      if (closeFailures.length) {
        const cause = primaryFailed ? primaryError : closeFailures[0].error;
        const reported = new AggregateError([...(primaryFailed ? [primaryError] : []), ...closeFailures.map(item => item.error)], cause?.message || 'Falha ao fechar backup.', { cause });
        if (cause?.code) reported.code = cause.code;
        reported.cleanupFailures = closeFailures.map(item => ({ path: item.path, message: /^[A-Z0-9_]+$/.test(item.error?.code || '') ? item.error.code : 'close failed' }));
        throw reported;
      }
      if (primaryFailed) throw primaryError;
      checkBackupBoundary();
    }
  } catch (error) { backupFailure = withUncertainPath(error, backupRoot || join(root, '.agent-tests')); }
  finally {
    if (changedCwd) try { process.chdir(originalCwd); }
    catch (error) {
      const restoration = withUncertainPath(error, originalCwd);
      if (!backupFailure) backupFailure = restoration;
      else {
        const primary = backupFailure;
        backupFailure = new AggregateError([primary, restoration], primary.message, { cause: primary });
        if (primary.code) backupFailure.code = primary.code;
        backupFailure.operationMayBePartial = true;
      }
    }
  }
  if (backupFailure) throw backupFailure;
  output(`Backup local (integridade não verificada): ${backupCandidate}`);
}
