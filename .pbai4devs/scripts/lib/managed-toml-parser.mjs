import { extractManagedBlock, managedText } from './managed-content.mjs';

// Localized editing of Gemini's root prompt; not a general TOML serializer.
const fail = message => { throw Object.assign(new Error(message), { code: 'E_MANAGED_BLOCK' }); };
const horizontal = character => character === ' ' || character === '\t';
const whitespace = character => horizontal(character) || character === '\n' || character === '\r';
const escapes = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };

function scalar(code) {
  if (code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) fail('Escape Unicode TOML invalido.');
  return String.fromCodePoint(code);
}

function stringAt(text, start, key = false) {
  const quote = text[start];
  if (!['"', "'"].includes(quote)) fail('O prompt TOML deve ser uma string.');
  const multiline = text.slice(start, start + 3) === quote.repeat(3);
  if (key && multiline) fail('Chave TOML multiline nao suportada.');
  const basic = quote === '"';
  let position = start + (multiline ? 3 : 1), value = '';
  if (multiline) {
    if (text.slice(position, position + 2) === '\r\n') position += 2;
    else if (text[position] === '\n') position++;
  }
  while (position < text.length) {
    const character = text[position];
    if (character === quote) {
      if (!multiline) return { start, end: position + 1, value };
      let count = 1;
      while (text[position + count] === quote) count++;
      if (count >= 3) {
        if (count > 5) fail('Delimitador TOML ambiguo.');
        return { start, end: position + count, value: value + quote.repeat(count - 3) };
      }
      value += quote.repeat(count); position += count; continue;
    }
    if (basic && character === '\\') {
      const escaped = text[++position];
      if (multiline && whitespace(escaped)) {
        let cursor = position, lineBreak = false;
        while (whitespace(text[cursor])) {
          if (text[cursor] === '\r') {
            if (text[cursor + 1] !== '\n') fail('TOML exige LF ou CRLF.');
            lineBreak = true; cursor += 2;
          } else { if (text[cursor] === '\n') lineBreak = true; cursor++; }
        }
        if (!lineBreak) fail('Continuacao de string TOML invalida.');
        position = cursor; continue;
      }
      if (Object.hasOwn(escapes, escaped)) { value += escapes[escaped]; position++; continue; }
      if (escaped === 'u' || escaped === 'U') {
        const width = escaped === 'u' ? 4 : 8, digits = text.slice(position + 1, position + 1 + width);
        if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(digits)) fail('Escape Unicode TOML invalido.');
        value += scalar(Number.parseInt(digits, 16)); position += width + 1; continue;
      }
      fail('Escape TOML nao suportado.');
    }
    const code = text.charCodeAt(position);
    if (code === 0x7f || code < 0x20 && character !== '\t' && !(multiline && ['\r', '\n'].includes(character))) fail('Controle invalido em string TOML.');
    if (!multiline && ['\r', '\n'].includes(character)) fail('String TOML de uma linha interrompida.');
    if (character === '\r' && text[position + 1] !== '\n') fail('TOML exige LF ou CRLF.');
    value += character; position++;
  }
  fail('String TOML sem fechamento.');
}

function keyAt(text, start) {
  let position = start;
  const path = [];
  while (true) {
    while (horizontal(text[position])) position++;
    if (['"', "'"].includes(text[position])) {
      const part = stringAt(text, position, true); path.push(part.value); position = part.end;
    } else {
      const part = /^[A-Za-z0-9_-]+/.exec(text.slice(position));
      if (!part) fail('Chave TOML nao suportada.');
      path.push(part[0]); position += part[0].length;
    }
    while (horizontal(text[position])) position++;
    if (text[position] !== '.') break;
    position++;
  }
  return { path, end: position };
}

function valueEnd(text, start, comments = []) {
  if (['"', "'"].includes(text[start])) return stringAt(text, start).end;
  const stack = [];
  let position = start;
  while (position < text.length) {
    const character = text[position];
    if (['"', "'"].includes(character)) { position = stringAt(text, position).end; continue; }
    if (character === '#') {
      if (!stack.length) break;
      const commentStart = position;
      while (position < text.length && !['\r', '\n'].includes(text[position])) position++;
      comments.push({ start: commentStart, end: position, text: text.slice(commentStart, position) });
      continue;
    }
    if (['\n', '\r'].includes(character) && !stack.length) break;
    if (character === '[' || character === '{') stack.push(character);
    if (character === ']' || character === '}') {
      if (stack.pop() !== (character === ']' ? '[' : '{')) fail('Valor TOML desbalanceado.');
    }
    position++;
  }
  if (stack.length || !text.slice(start, position).trim()) fail('Valor TOML incompleto.');
  return position;
}

function statementEnd(text, start, comments = []) {
  let position = start;
  while (horizontal(text[position])) position++;
  if (text[position] === '#') {
    const commentStart = position;
    while (position < text.length && !['\r', '\n'].includes(text[position])) position++;
    comments.push({ start: commentStart, end: position, text: text.slice(commentStart, position) });
  }
  if (position < text.length && !['\r', '\n'].includes(text[position])) fail('Texto inesperado apos valor TOML.');
  if (text[position] === '\r') {
    if (text[position + 1] !== '\n') fail('TOML exige LF ou CRLF.');
    return position + 2;
  }
  return text[position] === '\n' ? position + 1 : position;
}

export function locatePrompt(input) {
  let text;
  try { text = managedText(input); }
  catch (error) {
    if (error.code === 'E_MANAGED_BLOCK') throw error;
    fail('Texto TOML deve ser UTF-8 valido.');
  }
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) fail('Unicode TOML invalido.');
  }
  let position = text.startsWith('\ufeff') ? 1 : 0, root = true, insertion = text.length, prompt = null, reserved = false;
  const comments = [];
  while (position < text.length) {
    const lineStart = position;
    while (horizontal(text[position])) position++;
    if (position === text.length) break;
    if (text[position] === '#' || ['\r', '\n'].includes(text[position])) { position = statementEnd(text, position, comments); continue; }
    if (text[position] === '[') {
      const arrayTable = text[position + 1] === '[';
      const header = keyAt(text, position + (arrayTable ? 2 : 1));
      if (text.slice(header.end, header.end + (arrayTable ? 2 : 1)) !== (arrayTable ? ']]' : ']')) fail('Tabela TOML invalida.');
      if (root) insertion = lineStart;
      root = false;
      if (header.path[0] === 'prompt') reserved = true;
      position = statementEnd(text, header.end + (arrayTable ? 2 : 1), comments); continue;
    }
    const key = keyAt(text, position);
    if (text[key.end] !== '=') fail('Atribuicao TOML invalida.');
    position = key.end + 1;
    while (horizontal(text[position])) position++;
    if (root && key.path[0] === 'prompt') {
      if (key.path.length !== 1 || prompt || reserved) fail('Prompt TOML duplicado ou ambiguo.');
      prompt = stringAt(text, position);
      position = prompt.end;
    } else position = valueEnd(text, position, comments);
    position = statementEnd(text, position, comments);
  }
  if (reserved) fail('Prompt TOML ocupa uma tabela; conteudo preservado.');
  return { text, prompt, insertion, comments };
}

export function extractTomlManagedBlock(input) {
  const { prompt } = locatePrompt(input);
  return prompt ? extractManagedBlock(prompt.value) : null;
}
