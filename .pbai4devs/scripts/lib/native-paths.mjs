import { lstatSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { types as utilTypes } from 'node:util';
const missing = error => { try { if (utilTypes.isProxy(error)) return false; const d = Object.getOwnPropertyDescriptor(error, 'code'); return Boolean(d && 'value' in d && ['ENOENT', 'ENOTDIR'].includes(d.value)); } catch { return false; } };

// Inspect native paths without opening a symlink target. Callers restrict this
// exception to user-owned adapter paths; canonical kit files stay strict.
export function nativePathBoundary(root, path, ownedPaths = [], { preserveRootAliases = false } = {}) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /[|\\\x00-\x1f\x7f:]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw Object.assign(new Error(`Caminho invalido: ${path}`), { code: 'E_PATH' });
  }
  const parts = path.split('/');
  let current = root;
  for (const [index, part] of parts.entries()) {
    try {
      const aliases = lstatSync(current).isDirectory() ? readdirSync(current).filter(name => name.toLowerCase() === part.toLowerCase() && name !== part).sort() : [];
      if (aliases.length) {
        const rootEntry = parts.length === 1 && ['README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md'].includes(path);
        const owned = [...ownedPaths].some(value => value.toLowerCase() === path.toLowerCase() || value.toLowerCase().startsWith(`${path.toLowerCase()}/`));
        if (preserveRootAliases && rootEntry && !owned) return { path: aliases[0], reason: 'case-variant' };
        throw Object.assign(new Error(`Caminhos diferem somente por maiusculas/minusculas: ${path}`), { code: 'E_PATH' });
      }
    } catch (error) { if (missing(error)) return null; throw error; }
    current = join(current, part);
    let info;
    try { info = lstatSync(current); }
    catch (error) { if (missing(error)) return null; throw error; }
    const reason = info.isSymbolicLink() ? 'symbolic-link' : index < parts.length - 1 && !info.isDirectory() ? 'non-directory' : null;
    if (!reason) continue;
    const boundary = parts.slice(0, index + 1).join('/');
    if ([...ownedPaths].some(value => value === boundary || value.startsWith(`${boundary}/`))) {
      throw Object.assign(new Error(`${reason === 'symbolic-link' ? 'Link simbolico' : 'Ancestral nao e diretorio'} em caminho gerenciado: ${boundary}`), { code: reason === 'symbolic-link' ? 'E_SYMLINK' : 'E_PATH' });
    }
    return { path: boundary, reason };
  }
  return null;
}
