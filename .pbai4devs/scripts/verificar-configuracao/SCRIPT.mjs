#!/usr/bin/env node
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMain, projectRoot, requireNode } from '../lib/runtime.mjs';
import { stateDirectory } from '../lib/state-path.mjs';

const limit = 'O estado não comprova evidências nem impede um agente de escrever.';
const blocked = motivo => ({ status: 'bloqueado', motivo, limite: limit });

// Read only the two indicators; never print arbitrary state content.
export function verifyConfiguration(root = projectRoot, { preparationOnly = false } = {}) {
  requireNode();
  try {
    root = realpathSync(resolve(root));
    const parts = `${stateDirectory(root)}/configuracao/ESTADO.md`.split('/');
    let current = root; let info;
    for (let index = 0; index < parts.length; index++) {
      current = join(current, parts[index]);
      info = lstatSync(current);
      if (info.isSymbolicLink() || (index < parts.length - 1 && !info.isDirectory())) return blocked('estado-inseguro');
    }
    if (!info.isFile() || info.size > 1024 * 1024) return blocked('estado-invalido');
    const text = readFileSync(current, 'utf8').replaceAll('\r\n', '\n');
    const header = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
    if (header === undefined) return blocked('estado-invalido');
    const values = {};
    for (const line of header.split('\n')) {
      if (!line.trim() || line.trimStart().startsWith('#') || /^[ \t]/.test(line)) continue;
      // Explicit mapping keys and merge keys may hide duplicate indicators.
      if (/^(?:\?|<<\s*:)/.test(line)) return blocked('estado-invalido');
      const match = line.match(/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[a-zA-Z_][a-zA-Z0-9_.-]*)[ \t]*:(.*)$/);
      if (!match) return blocked('estado-invalido');
      if (/^[!&*]/.test(match[2].trim())) return blocked('estado-invalido');
      let key = match[1];
      if (key.startsWith('"')) {
        try { key = JSON.parse(key); } catch { return blocked('estado-invalido'); }
      } else if (key.startsWith("'")) key = key.slice(1, -1).replaceAll("''", "'");
      if (!['preparacao', 'configuracao_tecnica'].includes(key)) continue;
      if (Object.hasOwn(values, key)) return blocked('estado-invalido');
      const value = match[2].trim().match(/^(?:concluido|pendente|'(?:concluido|pendente)'|"(?:concluido|pendente)")(?:[ \t]+#.*)?$/)?.[0];
      if (!value) return blocked('estado-invalido');
      values[key] = value.replace(/[ \t]+#.*$/, '').replace(/^['"]|['"]$/g, '');
    }
    if (!Object.hasOwn(values, 'preparacao') || !preparationOnly && !Object.hasOwn(values, 'configuracao_tecnica')) return blocked('estado-invalido');
    if (values.preparacao !== 'concluido') return blocked(preparationOnly ? 'preparacao-pendente' : 'configuracao-pendente');
    if (!preparationOnly && values.configuracao_tecnica !== 'concluido') return blocked('configuracao-pendente');
    return { status: 'verificar-evidencias', estado: values, limite: limit };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return blocked('estado-ausente');
    return blocked('estado-inacessivel-ou-inseguro');
  }
}

export function main(args = process.argv.slice(2)) {
  if (args.length && !(args.length === 1 && args[0] === '--preparacao')) throw new Error('Uso: verificar-configuracao [--preparacao].');
  const report = verifyConfiguration(projectRoot, { preparationOnly: args.length === 1 });
  console.log(JSON.stringify(report));
  return report.status === 'bloqueado' ? 1 : 0;
}

if (isMain(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
