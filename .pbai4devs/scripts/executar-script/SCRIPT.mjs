#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isMain, projectRoot, requireNode } from '../lib/runtime.mjs';
import { parseScriptConfig } from '../lib/script-config.mjs';

const fail = message => { throw Object.assign(new Error(message), { exitCode: 2 }); };
const within = (root, path) => { const part = relative(root, path); return !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`); };

function checkedPath(root, path) {
  if (!within(root, path)) fail('Script fora do repositorio.');
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch { fail(`Script ausente: ${path}`); }
    if (stat.isSymbolicLink()) fail('Link simbolico nao permitido em scripts.');
  }
  if (!within(root, realpathSync(path))) fail('Script fora do repositorio.');
  return path;
}

function configuredExecutor(root, config) {
  checkedPath(root, config);
  if (!lstatSync(config).isFile()) fail('SCRIPT.conf deve ser um arquivo.');
  try { return parseScriptConfig(readFileSync(config, 'utf8')); }
  catch (error) { fail(error.message); }
}

export function resolveScript(input, { root = projectRoot } = {}) {
  if (typeof input !== 'string' || !input || input.includes('\0')) fail('Informe o nome ou caminho de um script.');
  root = realpathSync(root);
  let path = resolve(root, input);
  if (!within(root, path)) fail('Script fora do repositorio.');
  if (!existsSync(path)) path = resolve(root, '.pbai4devs/scripts', input);
  checkedPath(root, path);
  const directory = lstatSync(path).isDirectory() ? path : dirname(path);
  if (!lstatSync(path).isDirectory() && !['.mjs', '.js', '.cjs'].includes(extname(path))) fail('Use um script JavaScript Node (.mjs, .js ou .cjs).');
  const config = join(directory, 'SCRIPT.conf');
  if (lstatSync(config, { throwIfNoEntry: false })) {
    if (configuredExecutor(root, config) === 'playwright-mcp') {
      const file = checkedPath(root, join(directory, 'SCRIPT.js'));
      if (!lstatSync(file).isFile()) fail('SCRIPT.js do conector deve ser um arquivo.');
      if (!lstatSync(path).isDirectory() && path !== file) fail('O executor Playwright exige o arquivo SCRIPT.js configurado.');
      return { root, file, executor: 'playwright-mcp' };
    }
  }
  if (lstatSync(path).isDirectory()) {
    path = ['SCRIPT.mjs', 'SCRIPT.cjs', 'SCRIPT.js'].map(name => join(directory, name)).find(existsSync);
    if (!path) fail('Nenhum SCRIPT.mjs encontrado; scripts shell e Python nao sao executados.');
    checkedPath(root, path);
  }
  if (!lstatSync(path).isFile()) fail('O caminho nao e um arquivo de script.');
  return { root, file: path, executor: 'node' };
}

export function main(input = process.argv.slice(2), options = {}) {
  requireNode();
  const args = [...input]; let plan = false, raw = false;
  while (['--plan', '--raw'].includes(args[0])) {
    if (args[0] === '--plan') { if (plan) fail('--plan duplicado.'); plan = true; }
    else { if (raw) fail('--raw duplicado.'); raw = true; }
    args.shift();
  }
  const usage = 'Uso: node SCRIPT.mjs [--plan] [--raw] <nome-ou-caminho> [argumentos]';
  if (['--help', '-h'].includes(args[0])) { (raw ? process.stderr : process.stdout).write(`${usage}\n`); return 0; }
  if (!args.length) fail(usage);
  const selected = resolveScript(args.shift(), options);
  (raw ? process.stderr : process.stdout).write(`${selected.executor === 'node' ? 'runtime=node' : 'executor=playwright-mcp'}\nfile=${relative(selected.root, selected.file).split(sep).join('/')}\n`);
  if (plan) return 0;
  if (selected.executor === 'playwright-mcp') {
    console.error('Use o conector Playwright pelo agente; este script nao e um programa Node.');
    return 69;
  }
  const result = spawnSync(process.execPath, [selected.file, ...args], { cwd: selected.root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (isMain(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
}
