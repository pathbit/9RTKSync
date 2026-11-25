import { lstatSync, opendirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { nativePathBoundary } from './native-paths.mjs';

// It doesn't guarantee atomicity against rival exchange of ancestors.
export function scanRetainedClaude(root) {
  const base = '.claude/rules', retained = new Map();
  const unknown = () => retained.set(base, 'claude-scan-incomplete');
  try {
    const obstruction = nativePathBoundary(root, base, []);
    if (obstruction) retained.set(obstruction.path, obstruction.reason);
    else {
      let rootInfo;
      try { rootInfo = lstatSync(join(root, base)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (rootInfo && !rootInfo.isDirectory()) retained.set(base, 'non-directory');
      else if (rootInfo) {
        const stack = [{ folder: base, depth: 0 }]; let visited = 0, truncated = false;
        while (stack.length && !truncated) {
          const { folder, depth } = stack.pop();
          if (depth > 64) { truncated = true; break; }
          const directory = opendirSync(join(root, folder));
          try {
            let entry;
            while ((entry = directory.readSync())) {
              if (++visited > 10000) { truncated = true; break; }
              const item = `${folder}/${entry.name}`, info = lstatSync(join(root, item));
              if (info.isSymbolicLink()) retained.set(item, 'symbolic-link');
              else if (info.isDirectory()) stack.push({ folder: item, depth: depth + 1 });
              else if (info.isFile() && /\.md$/i.test(entry.name)) retained.set(item, 'claude-activation-unverified');
            }
          } finally { directory.closeSync(); }
        }
        if (truncated) unknown();
      }
    }
  } catch { unknown(); }
  return [...retained].map(([path, reason]) => ({ path, reason })).sort((a, b) => a.path.localeCompare(b.path));
}

// An example marker surrounded by fences does not identify active reference.
// For unregistered mixed notes, require marker and real link to the source.
export function resemblesClaudeReference(target, text) {
  let fence = null, marker = false, pointer = false;
  const lines = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n');
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/.test(line));
    if (end < 0) return false;
    start = end + 1;
  }
  for (const line of lines.slice(start)) {
    if (fence) {
      const close = line.match(/^( *)(`+|~+)[ \t]*$/);
      if (close && close[1].length <= fence.indent && close[2][0] === fence.marker[0] && close[2].length >= fence.marker.length) fence = null;
      continue;
    }
    const opening = line.match(/^( {0,3}(?:[-+*][ \t]+|[0-9]{1,9}[.)][ \t]+)?)(`{3,}|~{3,})(.*)$/);
    if (opening && (opening[2][0] !== '`' || !opening[3].includes('`'))) {
      fence = { marker: opening[2], indent: Math.max(3, opening[1].length) }; continue;
    }
    if (/^ {0,3}<!-- gerado: sincronizar-agentes -->[ \t]*$/.test(line)) marker = true;
    const match = line.match(/^ {0,3}Leia(?: e siga)? \[origem\]\(([^)]+)\)\.(?:[ \t]+.*)?$/);
    if (match) {
      try {
        const resolved = posix.normalize(posix.join(posix.dirname(target), decodeURIComponent(match[1])));
        if (/^\.pbai4devs\/rules\/.+\/RULE\.md$/.test(resolved)) pointer = true;
      } catch { /* Invalid escapes do not prove a reference. */ }
    }
  }
  return marker && pointer;
}

// The marker can signal a rule reference, even inside an example.
// Treat unknown syntax conservatively when ownership or activation is unclear.
export function mayReferenceClaudeRule(_target, text) {
  if (!/\[origem\]/i.test(text)) return false;
  try { return /\.pbai4devs\/rules\//i.test(decodeURIComponent(text)); }
  catch { return true; }
}
