import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const windowsMinimumByMajor = { 23: [Infinity, 0], 24: [13, 1], 25: [4, 0] };
export const windowsNode24Minimum = [24, ...windowsMinimumByMajor[24]].join('.');

export function isSupportedNodeVersion(version, minimum = 24, platform = process.platform) {
  const match = /^(\d+)\.(\d+)\.(\d+)([-+]\S+)?$/.exec(version || '');
  if (!match || (platform === 'win32' && match[4])) return false;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (major < minimum) return false;
  // Require a Windows release with the rmSync Unicode path fix.
  const floor = platform === 'win32' ? windowsMinimumByMajor[major] : undefined;
  return !floor || minor > floor[0] || (minor === floor[0] && patch >= floor[1]);
}

export function requireNode(minimum = 24, version = process.versions.node, platform = process.platform) {
  if (process.versions.bun || !isSupportedNodeVersion(version, minimum, platform)) {
    const windows = platform === 'win32' && minimum <= 24 ? ` No Windows, use Node.js LTS ${windowsNode24Minimum}+ ou 26+.` : '';
    throw new Error(`Use Node.js >=${minimum} com npm.${windows} Se não estiver instalado: https://nodejs.org/en/download .`);
  }
}

// NODE_OPTIONS uses Node's double-quoted token syntax, not shell quoting.
// Keep option values as a single token so text in a preload path is not a flag.
function nodeOptionTokens(value) {
  const result = []; let token = '', quoted = false, escaped = false, active = false;
  for (const character of value) {
    if (escaped) { token += character; escaped = false; active = true; }
    else if (character === '\\' && quoted) escaped = true;
    else if (character === '"') { quoted = !quoted; active = true; }
    else if (character === ' ' && !quoted) { if (active) result.push(token); token = ''; active = false; }
    else { token += character; active = true; }
  }
  if (escaped) token += '\\';
  if (active) result.push(token);
  return result;
}

function preserveMainSymlinks() {
  let preserved = process.env.NODE_PRESERVE_SYMLINKS_MAIN === '1';
  for (const tokens of [nodeOptionTokens(process.env.NODE_OPTIONS || ''), process.execArgv]) {
    for (const token of tokens) {
      if (/^--preserve-symlinks-main(?:=.*)?$/.test(token)) preserved = true;
      else if (/^--no-preserve-symlinks-main(?:=.*)?$/.test(token)) preserved = false;
    }
  }
  return preserved;
}

export function isMain(metaUrl) {
  if (!process.argv[1] || typeof metaUrl !== 'string') return false;
  // In eval/print mode argv[1] is a user argument, not the entry module.
  if (process.execArgv.some(arg => /^-(?:e|p|ep|pe)$/.test(arg) || /^--(?:eval|print)(?:=|$)/.test(arg))) return false;
  const entry = resolve(process.argv[1]);
  // Only --preserve-symlinks-main keeps the main URL logical. The separate
  // --preserve-symlinks option can preserve an imported alias while the main
  // URL is physical, so comparing both paths would execute that import twice.
  if (preserveMainSymlinks()) return metaUrl === pathToFileURL(entry).href;
  try { return metaUrl === pathToFileURL(realpathSync(entry)).href; }
  catch { return false; }
}

export function findExecutable(name, environment = process.env, platform = process.platform) {
  const extensions = platform === 'win32' ? (environment.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  const names = platform === 'win32' && !/\.[^/\\]+$/.test(name) ? [name, ...extensions.map(ext => name + ext.toLowerCase())] : [name];
  const directories = isAbsolute(name) ? [''] : (environment.PATH || environment.Path || '').split(delimiter).filter(Boolean);
  for (const directory of directories) for (const candidate of names) {
    const file = directory ? join(directory, candidate) : candidate;
    try {
      if (statSync(file).isFile()) { accessSync(file, platform === 'win32' ? constants.F_OK : constants.X_OK); return resolve(file); }
    } catch { /* Candidato ausente ou sem permissao. */ }
  }
  return null;
}
