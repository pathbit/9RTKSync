import { createHash } from 'node:crypto';
import smol from './smol-toml.cjs';
const { parse } = smol;
import { locatePrompt } from './managed-toml-parser.mjs';
import { extractManagedBlock } from './managed-content.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { code: 'E_PROTOTYPE_CONFLICT' }); };
function checked(input) {
  const info = locatePrompt(input);
  let parsed;
  try { parsed = parse(info.text, { integersAsBigInt: true }); } catch { fail('TOML inválido ou não suportado'); }
  if (info.prompt ? parsed.prompt !== info.prompt.value : Object.hasOwn(parsed, 'prompt')) fail('parsers discordam');
  if (!info.prompt) return info;
  const quote = info.text[info.prompt.start];
  const multi = info.text.slice(info.prompt.start, info.prompt.start + 3) === quote.repeat(3);
  return { ...info, style: quote === '"' ? multi ? 'basic-multi' : 'basic-one' : multi ? 'literal-multi' : 'literal-one', end: info.prompt.end - (multi ? 3 : 1) };
}
function rawFor(value, style) {
  if (style === 'literal-multi') {
    if (value.includes("'''")) fail('delimitador literal ambíguo');
    return value;
  }
  return JSON.stringify(value).slice(1, -1).replace(/\x7f/g, '\\u007F');
}
const encode = meta => Buffer.from(JSON.stringify(meta)).toString('base64url');
function metadata(p, expectedHash) {
  const nl = p.text.lastIndexOf('\n', p.prompt.start - 1);
  const end = nl < 0 ? (p.text.startsWith('\ufeff') ? 1 : 0) : nl + 1;
  const prev = p.text.lastIndexOf('\n', end - 2);
  const start = prev < 0 ? (p.text.startsWith('\ufeff') ? 1 : 0) : prev + 1;
  const line = p.text.slice(start, end), match = /^# ADK-TOML-META-V3 ([A-Za-z0-9_-]+)(\r?\n)$/.exec(line);
  if (!match) fail('metadados ausentes');
  const encoded = match[1];
  let meta;
  try { meta = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); if (encode(meta) !== encoded) fail('metadados não canônicos'); }
  catch { fail('metadados inválidos'); }
  if (Object.keys(meta).join(',') !== 'v,origin,style,separator,eol,pre,stmtEol,blockHash,lineEol' || meta.v !== 3
      || !['existing','literal-one','missing'].includes(meta.origin)
      || !['basic-one','basic-multi','literal-multi'].includes(meta.style)
      || !['', '\n', '\n\n', '\r\n', '\r\n\r\n'].includes(meta.separator)
      || !['\n','\r\n'].includes(meta.eol) || !['', '\n','\r\n'].includes(meta.pre)
      || meta.origin !== 'missing' && (meta.pre !== '' || meta.stmtEol !== '') || meta.origin === 'missing' && !['\n','\r\n'].includes(meta.stmtEol)
      || meta.blockHash !== expectedHash || meta.lineEol !== match[2]) fail('metadados não suportados');
  return { meta, start, end };
}
function remove(input, expectedHash) {
  const p = checked(input), block = p.prompt && extractManagedBlock(p.prompt.value);
  if (!block || typeof expectedHash !== 'string' || digest(block) !== expectedHash) fail('bloco sem procedência ou alterado');
  const info = metadata(p, expectedHash), { meta } = info;
  if (meta.style !== p.style || meta.origin === 'missing' && p.style !== 'basic-one'
      || meta.origin === 'literal-one' && p.style !== 'literal-multi') fail('representação alterada');
  const suffix = meta.separator + block + meta.eol;
  const decodedStart = p.prompt.value.indexOf(suffix);
  if (decodedStart < 0 || p.prompt.value.indexOf(suffix, decodedStart + 1) >= 0) fail('bloco deslocado ou separador divergente');
  const raw = rawFor(suffix, meta.style), literalStart = p.prompt.start + (p.style === 'basic-one' ? 1 : 3);
  const literal = p.text.slice(literalStart, p.end), offset = literal.indexOf(raw);
  if (offset < 0 || literal.indexOf(raw, offset + 1) >= 0) fail('forma bruta ambígua ou alterada');
  const rawStart = literalStart + offset;
  const human = p.prompt.value.slice(0, decodedStart) + p.prompt.value.slice(decodedStart + suffix.length);
  let output = p.text.slice(0, rawStart) + p.text.slice(rawStart + raw.length);
  output = output.slice(0, info.start) + output.slice(info.end);
  if (meta.origin === 'literal-one') {
    const restored = checked(output), inner = output.slice(restored.prompt.start + 3, restored.prompt.end - 3);
    if (inner.includes("'") || /[\r\n]/.test(inner)) fail('literal original não pode ser restaurado');
    output = output.slice(0, restored.prompt.start) + "'" + inner + "'" + output.slice(restored.prompt.end);
  } else if (meta.origin === 'missing' && human === '') {
    const restored = checked(output);
    const assignmentStart = restored.prompt.start - 'prompt = '.length;
    const prefixStart = assignmentStart - meta.pre.length;
    const assignmentEnd = restored.prompt.end + meta.stmtEol.length;
    if (prefixStart < 0 || output.slice(prefixStart, assignmentStart) !== meta.pre
        || output.slice(assignmentStart, restored.prompt.end) !== 'prompt = ""'
        || output.slice(restored.prompt.end, assignmentEnd) !== meta.stmtEol) fail('atribuição inserida alterada');
    output = output.slice(0, prefixStart) + output.slice(assignmentEnd);
  }
  const restored = checked(output);
  if (meta.origin === 'missing' && human === '' ? restored.prompt !== null : !restored.prompt || restored.prompt.value !== human || extractManagedBlock(restored.prompt.value) !== null) fail('remoção não comprovada');
  return output;
}
export { checked, rawFor, metadata, remove };
