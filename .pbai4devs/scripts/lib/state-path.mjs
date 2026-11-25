import { lstatSync } from 'node:fs';
import { join } from 'node:path';

// Preserve legacy installations until the CLI migrates them. Do not silently
// choose between two independently populated state trees.
export function stateDirectory(root) {
  const inspect = relative => {
    let item;
    try { item = lstatSync(join(root, relative)); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
    if (item.isSymbolicLink()) throw new Error(`Link simbolico: ${relative}`);
    if (!item.isDirectory()) throw new Error(`Pasta de estado inválida: ${relative}`);
    return item;
  };
  if (!inspect('.pbai4devs')) return '.pbai4devs/state';
  const current = inspect('.pbai4devs/state');
  const legacy = inspect('.pbai4devs/estado');
  if (current && legacy) throw new Error('Pastas .pbai4devs/state e .pbai4devs/estado coexistem; preserve os dados e resolva o conflito antes de continuar.');
  return legacy ? '.pbai4devs/estado' : '.pbai4devs/state';
}
