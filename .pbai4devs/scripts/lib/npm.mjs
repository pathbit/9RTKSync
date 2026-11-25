import { existsSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

export function npmCandidates({ node = process.execPath, environment = process.env } = {}) {
  const candidates = [join(dirname(node), 'node_modules/npm/bin/npm-cli.js'), join(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js'), environment.npm_execpath];
  for (const entry of (environment.PATH || environment.Path || '').split(delimiter).filter(Boolean)) {
    for (const name of ['npm', 'npm.cmd']) {
      const file = join(entry, name);
      if (existsSync(file)) candidates.push(realpathSync(file), join(entry, 'node_modules/npm/bin/npm-cli.js'));
    }
  }
  return [...new Set(candidates.filter(file => file && file.endsWith('npm-cli.js') && existsSync(file) && statSync(file).isFile()).map(file => realpathSync(file)))];
}

export function findNpmCli(options) {
  return npmCandidates(options)[0] || null;
}
