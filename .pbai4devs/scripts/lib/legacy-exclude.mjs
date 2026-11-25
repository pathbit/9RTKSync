import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

// Byte signature of the stock 0.0.21 policy with no generated entrypoints.
// Reproduced with the published 0.0.21 planner and the archived package policy.
const stockBodyHash = 'a36d313b9e7f65316a5bad6dcf4ef97c98eecced86a377dcb062b0462075ca31';
const stockOutputs = [
  '/.pbai4devs/agents.json',
  '/.pbai4devs/catalog.json',
  '/.pbai4devs/espelhos.conf',
  '/.pbai4devs/estado/agentdevkit.json',
  '/.pbai4devs/estado/derived.json',
  '/.pbai4devs/rules.json',
  '/.pbai4devs/skills.json',
  '/.pbai4devs/state/agentdevkit.json',
  '/.pbai4devs/state/derived.json',
];
const maxExcludeSize = 1024n * 1024n;
const digest = value => createHash('sha256').update(value).digest('hex');
const sameFile = (left, right) => ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']
  .every(key => left[key] === right[key]);

function readExclude(path) {
  let seen;
  try { seen = lstatSync(path, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; return undefined; }
  if (!seen.isFile() || !seen.ino || seen.nlink !== 1n || seen.size > maxExcludeSize) return undefined;
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const opened = fstatSync(fd, { bigint: true });
    if (!sameFile(seen, opened)) return undefined;
    const bytes = Buffer.alloc(Number(opened.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) return undefined;
      offset += count;
    }
    if (!sameFile(opened, fstatSync(fd, { bigint: true })) || !sameFile(opened, lstatSync(path, { bigint: true }))) return undefined;
    return { bytes, mode: Number(seen.mode & 0o7777n) };
  } catch { return undefined; }
  finally { if (fd !== undefined) closeSync(fd); }
}

function historicalBody(body) {
  if (digest(body) === stockBodyHash) return true;

  // 0.0.21 appended sorted, unique locally generated outputs after the roots.
  // Apart from the fixed outputs, recognize only its built-in entrypoint names.
  const rootEnd = '/.dsh/\n';
  const start = body.indexOf(rootEnd) + rootEnd.length;
  const end = body.indexOf('\n# Estado privado dos clientes\n', start);
  if (start < rootEnd.length || end <= start || body[end - 1] !== '\n') return false;
  const outputs = body.slice(start, end - 1).split('\n');
  if (outputs.length < stockOutputs.length || outputs.length > stockOutputs.length + 3) return false;
  const entrypoints = outputs.filter(line => !stockOutputs.includes(line));
  if (entrypoints.some(line => !/^\/(?:AGENTS|CLAUDE|GEMINI)\.md$/i.test(line))
    || new Set(entrypoints.map(line => line.toLowerCase())).size !== entrypoints.length
    || outputs.join('\n') !== [...stockOutputs, ...entrypoints].sort().join('\n')) return false;
  return digest(body.slice(0, start) + stockOutputs.join('\n') + '\n' + body.slice(end)) === stockBodyHash;
}

export function inspectLegacyExclude(root, location, isOnlyWorktree) {
  if (!location) return { status: 'absent' };
  const { exclude, prefix } = location;
  const snapshot = readExclude(exclude);
  if (snapshot === null) return { status: 'absent' };
  if (snapshot === undefined) return { status: 'unverified' };

  // Latin-1 gives one character per byte. Existing human lines need not be
  // UTF-8 and must survive byte for byte, including their line endings.
  const { bytes: before, mode } = snapshot;
  const text = before.toString('latin1');
  const markers = [...text.matchAll(/(?:^|\n)(# (?:BEGIN|END) AGENTDEVKIT LOCAL[^\n]*)/g)];
  if (!markers.length) return { status: 'absent' };
  if (prefix || exclude !== join(root, '.git', 'info', 'exclude')) return { status: 'shared' };
  const isolated = isOnlyWorktree();
  if (isolated !== true) return { status: isolated === false ? 'shared' : 'unverified' };
  const id = digest(root).slice(0, 16);
  if (markers.length !== 2 || markers[0][1] !== `# BEGIN AGENTDEVKIT LOCAL ${id}`
    || markers[1][1] !== `# END AGENTDEVKIT LOCAL ${id}`) return { status: 'unverified' };
  const [begin, end] = markers.map(marker => marker.index + (marker[0][0] === '\n' ? 1 : 0));
  const bodyStart = begin + markers[0][1].length + 1;
  const finish = end + markers[1][1].length + 1;
  if (text[finish - 1] !== '\n' || end <= bodyStart) return { status: 'unverified' };
  const body = text.slice(bodyStart, end);
  if (!historicalBody(body)) return { status: 'unverified' };

  // In one exclude file, the last matching pattern wins. Keep the final
  // copy of each identical rule in its original position and leave all
  // non-duplicate rules in order, including negations and private patterns.
  const rules = body.split('\n').filter(line => line && !line.startsWith('#'));
  const seen = new Set();
  const retained = rules.slice().reverse().filter(line => {
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  }).reverse();
  const after = Buffer.concat([
    before.subarray(0, begin),
    Buffer.from(retained.join('\n') + '\n', 'latin1'),
    before.subarray(finish),
  ]);
  return {
    status: 'migration',
    edit: { path: exclude, before, after, mode, removedDuplicates: rules.length - retained.length, removedMarkers: 2 },
  };
}
