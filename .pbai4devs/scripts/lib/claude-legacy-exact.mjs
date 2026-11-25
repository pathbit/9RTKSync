import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { parseClaudePaths, serializeClaudePaths } from './claude-rule-scope.mjs';

// Prints of the grouped notes produced by the package npm 0.0.21.
// Also require project registration: bytes published do not prove property.
const publishedLegacy = new Map([
  ['ambiente-local', '3542912aa258ff8bbcb2ac00eca03f818a0a3ff09f8e483549738acb281ac1f5'],
  ['documentacao', '6ba43da42ad690b30013b5c2abb09948a690c33cf9271979eee12e6054d8e9bf'],
  ['estrutura', 'bccad1b81ca67f9a1c9cd28ba88e17d772347c38df891161ab7b21bd9e99189f'],
  ['execucao-local', '456ec4b421ccb9c3a88f2054048e0a69b88decc2d4fc507b12b1f3e753b5339b'],
  ['git', '85740f1ed2fd6b647827b64049e8ab96ecea129c847085f079c9726392d04466'],
  ['proximos-passos', '0b7ead5e0c00a9a83b65c30da39a9ded716ef618216d7b17c2a78ef8f2584499'],
  ['qualidade', 'a7333da1d6f9037d99fe46934fb12b5d4c76eb61a12bfb94a825891f4f75ffa6'],
  ['seguranca', 'd00ea76b714edbd2d6e632524f77405bf0261278d3e8fb5d377c1ffe61a8a0af'],
]);
export const legacyClaudeGitTarget = '.claude/rules/git/RULE.md';
export const legacyClaudeGitSource = '.pbai4devs/rules/git/RULE.md';

function modernReference(target, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024) return null;
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) return null;
  const match = /^(---\n(description|paths): ([^\r\n]+)\n---\n)\n# [^\r\n]+\n\n<!-- gerado: sincronizar-agentes -->\nLeia e siga \[origem\]\(([^)\r\n]+)\)\.\n$/.exec(text);
  if (!match || match[0] !== text) return null;
  const [, header, type, value, href] = match;
  try {
    const folder = posix.dirname(target);
    const source = posix.normalize(posix.join(folder, decodeURIComponent(href)));
    if (!/^\.pbai4devs\/rules\/(?:[^/\\\x00-\x1f]+\/)+RULE\.md$/.test(source)) return null;
    const canonicalLink = posix.relative(folder, source).split('/').map(part =>
      encodeURIComponent(part).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())).join('/');
    if (href !== canonicalLink) return null;
    if (type === 'paths') {
      const parsed = parseClaudePaths(header);
      if (!parsed.ok || serializeClaudePaths(parsed.paths) !== header) return null;
      return { source, scope: header };
    }
    const description = JSON.parse(value);
    return typeof description === 'string' && description.trim() && JSON.stringify(description) === value
      ? { source, scope: 'global' } : null;
  } catch { return null; }
}

export function canMigrateClaudeReference({ target, current, replacement, recordedHash, blocked }) {
  if (blocked || !recordedHash || !Buffer.isBuffer(current) || current.length > 1024 * 1024
    || !target.startsWith('.claude/rules/')) return false;
  const digest = createHash('sha256').update(current).digest('hex');
  if (recordedHash !== digest) return false;
  if (replacement === null) return target === legacyClaudeGitTarget && digest === publishedLegacy.get('git');
  const next = modernReference(target, replacement);
  if (!next) return false;
  const name = /^\.claude\/rules\/([a-z0-9-]+)\/RULE\.md$/.exec(target)?.[1];
  if (name && name !== 'git' && publishedLegacy.get(name) === digest) {
    return next.source === `.pbai4devs/rules/${name}/RULE.md` && next.scope === 'global';
  }
  const prior = modernReference(target, current);
  return Boolean(prior && prior.source === next.source && prior.scope === next.scope);
}

// Conservative subset: two keys, ordem/espacos/LF fixed and description YAML
// Just restricted. Don't try to recognize YAML It doesn't even show authorship.
export function isLegacyExact(sourceBytes, wrapperBytes, generatedBytes, name) {
  if (!Buffer.isBuffer(sourceBytes) || !Buffer.isBuffer(wrapperBytes) || !Buffer.isBuffer(generatedBytes) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return false;
  const source = sourceBytes.toString('utf8');
  if (!Buffer.from(source,'utf8').equals(sourceBytes)) return false;
  const match=source.match(/^---\ntrigger: always_on\ndescription: ([\p{L}][\p{L}\p{N} .,-]*)\n---\n/u);
  if (!match) return false;
  const description=match[1];
  if(description!==description.trim() || /^(?:null|true|false|yes|no|on|off|y|n)$/i.test(description)) return false;
  const title=source.match(/^# [^\r\n]+$/m)?.[0];
  if(!title)return false;
  const body=`\n${title}\n\n<!-- gerado: sincronizar-agentes -->\nLeia e siga [origem](../../../.pbai4devs/rules/${name}/RULE.md).\n`;
  const old=Buffer.from(match[0]+body);
  const current=Buffer.from(`---\ndescription: ${JSON.stringify(description)}\n---\n`+body);
  return wrapperBytes.equals(old) && generatedBytes.equals(current);
}
