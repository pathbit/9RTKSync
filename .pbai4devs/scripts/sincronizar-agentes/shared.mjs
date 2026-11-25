import { lstatSync, readFileSync } from 'node:fs';

export const principals = { skills: 'SKILL.md', agents: 'AGENT.md', commands: 'COMMAND.md', rules: 'RULE.md' };
export const auxiliary = ['templates', 'scripts', 'tools', 'external-skills', 'state', 'estado', 'tests', 'docs', 'adapters'];
export const reserved = new Set(['.git', '.pbai4devs', '.agent-tests']);
export const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const sorted = values => [...new Set(values)].sort(compare);
export const fail = message => { throw new Error(message); };
export const parseJson = (text, label) => {
  try { return JSON.parse(text); } catch { throw new SyntaxError(`JSON invalido: ${label}`); }
};
export const normalize = text => text.replace(/\r\n?/g, '\n');
export const read = file => normalize(readFileSync(file, 'utf8'));
export const stat = file => {
  try { return lstatSync(file); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error; }
};
export function topPaths(paths) {
  const result = [];
  for (const path of sorted(paths)) if (!result.some(parent => path.startsWith(parent + '/'))) result.push(path);
  return result;
}
