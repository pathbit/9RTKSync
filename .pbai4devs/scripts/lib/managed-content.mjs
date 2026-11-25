import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';

export const managedBegin = '<!-- BEGIN AGENTDEVKIT -->';
export const managedEnd = '<!-- END AGENTDEVKIT -->';
export const nativeZcodeAgent = path => /^\.zcode\/agents\/[^/]+\.md$/.test(path);
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { code: 'E_MANAGED_BLOCK' }); };

export function canonicalEntrypoint(path) {
  return ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'].find(name => name.toLowerCase() === path.toLowerCase()) || null;
}

export function resolveEntrypoint(root, canonical) {
  if (!canonicalEntrypoint(canonical)) fail(`Entrada desconhecida: ${canonical}`);
  let names;
  try { names = readdirSync(root); }
  catch (error) { if (error.code === 'ENOENT') return canonical; throw error; }
  const matches = names.filter(name => name.toLowerCase() === canonical.toLowerCase());
  if (matches.length > 1) fail(`Entradas ambiguas: ${matches.sort().join(', ')}`);
  return matches[0] || canonical;
}

export function entrypointReference(root, path) {
  const canonical = canonicalEntrypoint(path);
  if (canonical === 'AGENTS.md') return 'Leia e siga [.pbai4devs/INSTRUCTIONS.md](.pbai4devs/INSTRUCTIONS.md).';
  if (canonical === 'CLAUDE.md') return `@${resolveEntrypoint(root, 'AGENTS.md')}`;
  if (canonical === 'GEMINI.md') return `@./${resolveEntrypoint(root, 'AGENTS.md')}`;
  fail(`Entrada desconhecida: ${path}`);
}

export function renderEntrypointImports(root, text) {
  const name = resolveEntrypoint(root, 'AGENTS.md');
  return text.replace(/^(@(?:\.\/)?)AGENTS\.md(?=\r?$)/gim, (_match, prefix) => `${prefix}${name}`);
}

export function managedText(value) {
  const text = Buffer.isBuffer(value) ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value) : String(value ?? '');
  if (text.includes('\0')) fail('Conteudo binario nao pode receber instrucoes Markdown.');
  return text;
}

function locate(value) {
  const text = managedText(value);
  let fence = null, start = null, finish = null, offset = 0;
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    if (!match[0]) continue;
    const line = match[1];
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    } else if (marker) fence = marker[1];
    else if (line === managedBegin) {
      if (start !== null || finish !== null) fail('Marcadores AgentDevKit duplicados.');
      start = offset;
    } else if (line === managedEnd) {
      if (start === null || finish !== null) fail('Marcadores AgentDevKit incompletos.');
      finish = offset + line.length;
    }
    offset += match[0].length;
  }
  if ((start === null) !== (finish === null)) fail('Marcadores AgentDevKit incompletos.');
  return { text, start, finish, fence, block: start === null ? null : text.slice(start, finish) };
}

export function extractManagedBlock(value) { return locate(value).block; }
export function managedBlockDigest(value) { const block = extractManagedBlock(value); return block === null ? null : digest(block); }

export function mergeManagedContent(value, body, { expectedHash, eolMode } = {}) {
  const current = locate(value), eol = current.text.match(eolMode === 'toml' ? /\r\n|\n/ : /\r\n|\n|\r/)?.[0] || '\n';
  const content = managedText(body).trim().replace(/\r\n|\r|\n/g, eol);
  if (!content || content.includes(managedBegin) || content.includes(managedEnd)) fail('Referencia AgentDevKit invalida.');
  const block = `${managedBegin}${eol}${content}${eol}${managedEnd}`;
  if (current.block !== null && (expectedHash ? digest(current.block) !== expectedHash : current.block !== block)) fail('Bloco AgentDevKit alterado; conteudo preservado.');
  if (current.fence && current.block === null) fail('Bloco de codigo Markdown nao fechado; conteudo preservado.');
  const separator = !current.text || current.text.endsWith(eol + eol) ? '' : /[\r\n]$/.test(current.text) ? eol : eol + eol;
  const text = current.block === null ? `${current.text}${separator}${block}${eol}`
    : current.text.slice(0, current.start) + block + current.text.slice(current.finish);
  return { text, block, sha256: digest(block), changed: text !== current.text };
}

export function stripManagedContent(value, expectedHash) {
  const current = locate(value);
  if (current.block === null) return current.text;
  if (!expectedHash || digest(current.block) !== expectedHash) fail('Bloco AgentDevKit alterado; conteudo preservado.');
  return current.text.slice(0, current.start) + current.text.slice(current.finish);
}
