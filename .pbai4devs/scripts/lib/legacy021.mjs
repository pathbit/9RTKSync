import { createHash } from 'node:crypto';
import smol from './smol-toml.cjs';
const { parse } = smol;
import { locatePrompt } from './managed-toml-parser.mjs';
import { extractManagedBlock } from './managed-content.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { code: 'E_PROTOTYPE_CONFLICT' }); };
const encode = value => JSON.stringify(value).slice(1, -1).replace(/\x7f/g, '\\u007F');
function prepare(input, expectedHash) {
  const p = locatePrompt(input);
  if (!p.prompt) fail('prompt ausente');
  let parsed;
  try { parsed = parse(p.text, { integersAsBigInt: true }); } catch { fail('TOML inválido'); }
  if (parsed.prompt !== p.prompt.value) fail('parsers discordam');
  if (p.text[p.prompt.start] !== '"' || p.text.slice(p.prompt.start, p.prompt.start + 3) === '"""') fail('representação não suportada');
  const block = extractManagedBlock(p.prompt.value);
  if (!block || typeof expectedHash !== 'string' || digest(block) !== expectedHash) fail('bloco não comprovado ou alterado');
  const decodedStart = p.prompt.value.indexOf(block);
  if (decodedStart < 0 || p.prompt.value.indexOf(block, decodedStart + 1) !== -1) fail('bloco ambíguo');
  const raw = encode(block), literal = p.text.slice(p.prompt.start + 1, p.prompt.end - 1);
  const pos = literal.indexOf(raw);
  if (pos < 0 || literal.indexOf(raw, pos + 1) !== -1) fail('codificação bruta ambígua ou não canônica');
  return { ...p, block, decodedStart, rawStart: p.prompt.start + 1 + pos, rawEnd: p.prompt.start + 1 + pos + raw.length };
}
function apply(p, replacement, expectedValue) {
  const output = p.text.slice(0, p.rawStart) + encode(replacement) + p.text.slice(p.rawEnd);
  const actual = locatePrompt(output);
  let parsed;
  try { parsed = parse(output, { integersAsBigInt: true }); } catch { fail('TOML resultante inválido'); }
  if (!actual.prompt || actual.prompt.value !== expectedValue || parsed.prompt !== expectedValue) fail('valor resultante divergente');
  return output;
}
export function removeLegacy(input, expectedHash) {
  const observed = locatePrompt(input);
  if (!observed.prompt || !/^[0-9a-f]{64}$/.test(expectedHash || '')) fail('prompt ausente ou hash inválido');
  let parsed;
  try { parsed = parse(observed.text, { integersAsBigInt: true }); } catch { fail('TOML inválido'); }
  if (parsed.prompt !== observed.prompt.value) fail('parsers discordam');
  if (extractManagedBlock(observed.prompt.value) === null) return { text: observed.text, status: 'absent' };
  const p = prepare(input, expectedHash);
  const expected = p.prompt.value.slice(0, p.decodedStart) + p.prompt.value.slice(p.decodedStart + p.block.length);
  return { text: apply(p, '', expected), status: 'removed' };
}
