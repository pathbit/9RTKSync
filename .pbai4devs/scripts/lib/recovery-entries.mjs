import { lstatSync } from 'node:fs';
import { join, posix } from 'node:path';

const invalid = () => Object.assign(new Error('Recovery plan contains an inconsistent path.'), { code: 'E_RECOVERY_BACKUP_INPUT' });

// Both planners already hold the original file bytes they used to approve
// changes. Use those bytes and record every directory the writer may touch.
export function buildRecoveryEntries(root, fileChanges, directoryChanges = []) {
  const directoryActions = new Map();
  const entries = new Map();
  function checkPath(path) {
    if (typeof path !== 'string' || /[\\:\0]/.test(path) || path.split('/').some(part =>
      !part || part === '.' || part === '..' || ['.git', '.agent-tests'].includes(part.toLowerCase()))) throw invalid();
  }
  function parents(path) {
    for (let parent = posix.dirname(path); parent !== '.'; parent = posix.dirname(parent)) {
      if (!directoryActions.has(parent)) directoryActions.set(parent, 'retain');
    }
  }
  for (const { path, action, before } of fileChanges) {
    checkPath(path);
    if (entries.has(path) || !['create', 'remove', 'update'].includes(action)) throw invalid();
    if (action === 'create' ? before !== null : !before || !Buffer.isBuffer(before.data)) throw invalid();
    entries.set(path, before === null
      ? { path, action, type: 'absent', mode: null }
      : { path, action, type: 'file', mode: before.mode, data: before.data });
    parents(path);
  }
  for (const { path, action } of directoryChanges) {
    checkPath(path);
    if (!['retain', 'remove'].includes(action)) throw invalid();
    if (action === 'remove' || !directoryActions.has(path)) directoryActions.set(path, action);
    parents(path);
  }
  // Parents first. Never traverse a known symbolic link or a non-directory.
  for (const path of [...directoryActions.keys()].sort()) {
    const plannedFile = entries.get(path);
    if (plannedFile) {
      if (plannedFile.action !== 'remove') throw invalid();
      continue;
    }
    const parent = entries.get(posix.dirname(path));
    // A managed file removed to make room for a directory has no previous
    // descendants. Their first action is creation, on either platform.
    const unavailableParent = parent?.type === 'absent' || parent?.type === 'file' && parent.action === 'remove';
    const info = unavailableParent ? undefined : lstatSync(join(root, ...path.split('/')), { throwIfNoEntry: false });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw invalid();
    entries.set(path, info
      ? { path, action: directoryActions.get(path), type: 'directory', mode: info.mode & 0o777 }
      : { path, action: 'create', type: 'absent', mode: null });
  }
  return [...entries.values()];
}
