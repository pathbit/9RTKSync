// Replacements create a file owned by the current effective user. Refuse
// cases where that would change the owner or leave the new file unreadable.
// This does not prove preservation of groups, ACLs or concurrent changes.
export function fileOwnerIssue(info, platform = process.platform, uid = process.geteuid?.()) {
  if (!info?.isFile() || !['linux', 'darwin'].includes(platform)) return null;
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(info.uid) || !Number.isSafeInteger(info.mode)) return 'file-owner-unverified';
  if (info.uid !== uid) return 'file-owner-different';
  if (!(info.mode & 0o400)) return 'owner-read-unverified';
  return null;
}
