import { posix } from 'node:path';
import { fail, normalize } from './shared.mjs';

export const marker = '<!-- gerado: sincronizar-agentes -->';
export const tomlMarker = '# gerado: sincronizar-agentes';

export function header(text) {
  const lines = normalize(text).split('\n');
  if (lines[0] !== '---') fail('Frontmatter YAML ausente.');
  const end = lines.indexOf('---', 1);
  if (end < 0) fail('Frontmatter YAML sem fechamento.');
  return lines.slice(0, end + 1).join('\n') + '\n';
}

// Accept only unambiguous quoted scalars for applyTo and optional description.
export function copilotApplyTo(text) {
  let front;
  try { front = header(text); } catch { return null; }
  const lines = front.trimEnd().split('\n').slice(1, -1);
  const fields = {};
  for (const line of lines) {
    const match = line.match(/^(applyTo|description):\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(fields, match[1])) return null;
    const value = match[2]; let parsed;
    if (/^"(?:[^"\\]|\\.)*"$/.test(value)) {
      try { parsed = JSON.parse(value); } catch { return null; }
    } else if (/^'(?:[^']|'')*'$/.test(value)) parsed = value.slice(1, -1).replace(/''/g, "'");
    else return null;
    if (typeof parsed !== 'string' || !parsed.trim()) return null;
    fields[match[1]] = parsed;
  }
  return fields.applyTo || null;
}

export function isReference(text) {
  let body = normalize(text);
  // Recognize retired Gemini CLI output for ownership checks during migration.
  if (body.startsWith(tomlMarker + '\n')) {
    const lines = body.trimEnd().split('\n');
    if (lines.length !== 3 || !lines[1].startsWith('description = ') || !lines[2].startsWith('prompt = ')) return false;
    try {
      const description = JSON.parse(lines[1].slice('description = '.length));
      const prompt = JSON.parse(lines[2].slice('prompt = '.length));
      const match = typeof prompt === 'string' && prompt.match(/^@\{(\.pbai4devs\/commands\/[^{}\r\n]+\/COMMAND\.md)\}\n\n\{\{args\}\}$/);
      return typeof description === 'string' && Boolean(description.trim()) && Boolean(match) && !match[1].split('/').some(part => part === '..' || part === '.');
    } catch { return false; }
  }
  if (body.startsWith('---\n')) {
    try { body = body.slice(header(body).length); } catch { return false; }
  }
  let title = false;
  const action = [];
  for (const line of body.split('\n')) {
    if (!line.trim() || line === marker) continue;
    if (!title && line.startsWith('# ')) { title = true; continue; }
    action.push(line);
  }
  const instruction = action.join(' ').replace(/\s+/g, ' ').replace(/\) \.$/, ').');
  return title && (/^(Leia e siga|Leia) \[[^\]]+\]\([^)]*\)( ao realizar operações Git)?\.$/.test(instruction) || /^@\[[^\]\r\n]+\](?:\([^)]*\))?$/.test(instruction));
}

export function link(target, source) {
  return posix.relative(posix.dirname(target), source).split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase())).join('/');
}
