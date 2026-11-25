import { inspectLinuxXattr, inspectMacAcl, inspectMacXattrBlocker } from '../lib/xattr-probe.mjs';
import { fileOwnerIssue } from '../lib/file-owner.mjs';
import { checkWindowsFileChanges, inspectMacWriteProtection, nativeMetadataCopySupported } from '../lib/native-metadata.mjs';
import { sorted, stat } from './shared.mjs';

// A replacement or removal would break a pre-existing hardlink relationship.
// This check does not prevent another process from changing links later.
export function assertNoSharedHardlinks(safe, path) {
  const info = stat(safe(path));
  const ownerIssue = fileOwnerIssue(info);
  if (ownerIssue) throw Object.assign(new Error(`E_PROTECTED_METADATA: ${path}`), { code: ownerIssue === 'file-owner-unverified' ? 'E_METADATA_UNSUPPORTED' : 'E_PROTECTED_METADATA', path, metadataReason: ownerIssue });
  if (info?.isFile() && (!Number.isSafeInteger(info.nlink) || info.nlink < 1)) {
    throw Object.assign(new Error(`E_METADATA_UNSUPPORTED: ${path}`), { code: 'E_METADATA_UNSUPPORTED', path });
  }
  if (info?.isFile() && info.nlink > 1) {
    throw Object.assign(new Error(`E_PROTECTED_METADATA: ${path}`), { code: 'E_PROTECTED_METADATA', path });
  }
}

export function assertWritableMetadata(logicalOperations, safe, output) {
  const xattrUnverified = [];
  for (const { path } of logicalOperations) assertNoSharedHardlinks(safe, path);
  if (process.platform === 'win32') {
    checkWindowsFileChanges(logicalOperations.filter(item => stat(safe(item.path))?.isFile()).map(item => ({
      path: safe(item.path), displayPath: item.path, update: item.action === 'write',
    })));
  }
  // Conservatively reject special-mode regular files before backup or writes.
  // macOS only: inspect listed ACLs and xattrs; directory effects need separate gates.
  if (process.platform === 'darwin' || process.platform === 'linux') {
    for (const { path, action } of logicalOperations) {
      const info = stat(safe(path));
      const ownerIssue = fileOwnerIssue(info);
      if (ownerIssue) throw Object.assign(new Error(`E_PROTECTED_METADATA: ${path}`), { code: ownerIssue === 'file-owner-unverified' ? 'E_METADATA_UNSUPPORTED' : 'E_PROTECTED_METADATA', path, metadataReason: ownerIssue });
      // Positive detection is useful but an empty/inaccessible Linux listing
      // is inconclusive; this guard is not complete metadata protection.
      if (info?.isFile() && process.platform === 'linux') {
        const xattrs = inspectLinuxXattr(safe(path));
        if (xattrs === 'present' && !(action === 'write' && nativeMetadataCopySupported)) throw Object.assign(new Error(`E_PROTECTED_METADATA: ${path}`), { code: 'E_PROTECTED_METADATA', path });
        if (xattrs !== 'present') xattrUnverified.push(path);
      }
      if (info?.isFile() && process.platform === 'darwin') {
        const protection = inspectMacWriteProtection(safe(path));
        if (protection !== 'clear') {
          const code = protection === 'protected' ? 'E_PROTECTED_METADATA' : 'E_METADATA_UNSUPPORTED';
          throw Object.assign(new Error(`${code}: ${path}`), { code, path });
        }
        const acl = inspectMacAcl(safe(path));
        if (acl !== 'empty' && !(action === 'write' && nativeMetadataCopySupported && acl === 'present')) {
          const code = acl === 'present' ? 'E_PROTECTED_METADATA' : 'E_METADATA_UNSUPPORTED';
          throw Object.assign(new Error(`${code}: ${path}`), { code, path });
        }
        const blocker = inspectMacXattrBlocker(safe(path), action === 'write' && nativeMetadataCopySupported);
        if (blocker) {
          const code = blocker === 'xattr-present' ? 'E_PROTECTED_METADATA' : 'E_METADATA_UNSUPPORTED';
          throw Object.assign(new Error(`${code}: ${path}`), { code, path });
        }
      }
      if (info?.isFile() && (info.mode & 0o7000)) {
        throw Object.assign(new Error(`E_PROTECTED_METADATA: ${path}`), { code: 'E_PROTECTED_METADATA', path });
      }
    }
  }
  if (xattrUnverified.length) output('Atributos estendidos Linux nao foram totalmente verificados; a substituicao pode perde-los. Revise e mantenha uma copia que os preserve.');
}

export function inspectSyncMetadata(logicalOperations, safe, output) {
  const hardlinkBlockers = [], hardlinkUnverified = [], aclBlockers = [], xattrBlockers = [], xattrUnverified = [], ownerBlockers = [];
  for (const { path, action } of logicalOperations) {
    const info = stat(safe(path));
    if (!info?.isFile()) continue;
    const ownerIssue = fileOwnerIssue(info);
    if (ownerIssue) ownerBlockers.push({ path, code: ownerIssue });
    if (!Number.isSafeInteger(info.nlink) || info.nlink < 1) hardlinkUnverified.push(path);
    else if (info.nlink > 1) hardlinkBlockers.push(path);
    if (process.platform === 'darwin') {
      const acl = inspectMacAcl(safe(path));
      const safeUpdate = action === 'write' && nativeMetadataCopySupported
        && acl === 'present' && inspectMacWriteProtection(safe(path)) === 'clear';
      if (acl !== 'empty' && !safeUpdate) aclBlockers.push({ path, code: acl === 'present' ? 'acl-present' : 'acl-unverified' });
      if (inspectMacXattrBlocker(safe(path), action === 'write' && nativeMetadataCopySupported)) xattrBlockers.push(path);
    }
    if (process.platform === 'linux') {
      const status = inspectLinuxXattr(safe(path));
      if (status === 'present') {
        if (!(action === 'write' && nativeMetadataCopySupported)) xattrBlockers.push(path);
      } else xattrUnverified.push(path);
    }
  }
  if (hardlinkBlockers.length) output(`Hardlinks compartilhados exigem revisao: ${sorted(hardlinkBlockers).join(', ')}`);
  if (hardlinkUnverified.length) output(`Contagem de hardlinks nao verificada: ${sorted(hardlinkUnverified).join(', ')}`);
  if (aclBlockers.length) output(`ACL presente ou nao verificada; revise: ${sorted(aclBlockers.map(item => item.path)).join(', ')}`);
  if (ownerBlockers.length) output(`Proprietario ou leitura do arquivo exige revisao: ${sorted(ownerBlockers.map(item => item.path)).join(', ')}`);
  if (xattrBlockers.length) {
    const reason = process.platform === 'darwin' ? 'presentes ou nao verificados' : 'detectados';
    output(`Atributos estendidos ${reason}; revise: ${sorted(xattrBlockers).join(', ')}`);
  }
  if (xattrUnverified.length) output('Atributos estendidos Linux nao foram totalmente verificados; a substituicao pode perde-los. Revise e mantenha uma copia que os preserve.');
  return { hardlinkBlockers, hardlinkUnverified, aclBlockers, xattrBlockers, xattrUnverified, ownerBlockers };
}
