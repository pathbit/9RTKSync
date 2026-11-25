// Insulated planning: does not read or change files and does not prove equivalence
// with other customers' globs. The accepted syntax is a subset of YAML.
// YAML invalid in Claude can activate a rule globally: in case of doubt,
// this module blocks the generation or preserves the explicit reading reference.

const invalid = reason => ({ ok: false, reason });

function quoted(value) {
  if (/^"(?:[^"\\]|\\.)*"$/.test(value)) {
    try { const parsed = JSON.parse(value); return typeof parsed === 'string' ? parsed : null; } catch { return null; }
  }
  if (/^'(?:[^']|'')*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  return null;
}

// Deliberate restriction: do not interpret commas, keys, classes or escapes
// They are valid in some dialects, but have not been proven.
// by this planner; never try to divide them or convert them implicitly.
function safePattern(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) return false;
  // JSON aceita surrogates isolados que alguns parsers YAML rejeitam. Claude
  // could then ignore the frontmatter and charge the rule globally.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029\ufffe\uffff\\,{}\[\]]/.test(value) || value.startsWith('!') || value.startsWith('//') || /^[A-Za-z]:/.test(value)) return false;
  const relative = value.startsWith('/') ? value.slice(1) : value;
  return Boolean(relative) && relative.split('/').every(part => part && part !== '.' && part !== '..');
}

/** Reads path frontmatter only with list JSON or list of quoted strings. */
export function parseClaudePaths(text, { metadataOnly = true, allowGlobal = false } = {}) {
  if (typeof text !== 'string') return invalid('metadata-not-text');
  if (Buffer.byteLength(text, 'utf8') > 4 * 1024 * 1024) return invalid('metadata-too-large');
  if (text.includes('\r') && /\r(?!\n)/.test(text)) return invalid('invalid-line-ending');
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.startsWith('\uFEFF')) return invalid('bom-not-supported');
  if (!normalized.startsWith('---\n')) return allowGlobal && !normalized.startsWith('---') ? { ok: true, paths: null } : invalid('frontmatter-required');
  const lines = normalized.split('\n');
  const end = lines.indexOf('---', 1);
  if (end < 0) return invalid('frontmatter-unclosed');
  if (metadataOnly && lines.slice(end + 1).some(line => !/^ *$/.test(line))) return invalid('metadata-body-not-allowed');
  const fields = lines.slice(1, end);
  if (fields.some(line => line.includes('\t'))) return invalid('tabs-not-supported');
  if (fields.length === 0 && allowGlobal) return { ok: true, paths: null };
  if (!fields.length || !/^paths:(?: |$)/.test(fields[0])) return invalid('only-paths-supported');
  const rest = fields[0].slice('paths:'.length).replace(/^ +| +$/g, '');
  let paths;
  if (rest) {
    if (fields.length !== 1) return invalid('extra-or-duplicate-fields');
    if (!rest.startsWith('[')) return invalid('paths-list-required');
    try { paths = JSON.parse(rest); } catch { return invalid('invalid-json-list'); }
  } else {
    paths = [];
    for (const line of fields.slice(1)) {
      const match = /^  - (.+)$/.exec(line);
      if (!match) return invalid('invalid-list-entry');
      const entry = quoted(match[1]);
      if (entry === null) return invalid('quoted-string-required');
      paths.push(entry);
    }
  }
  if (!Array.isArray(paths) || !paths.length || paths.some(path => !safePattern(path))) return invalid('unsupported-or-empty-paths');
  if (new Set(paths).size !== paths.length) return invalid('duplicate-paths');
  return { ok: true, paths };
}

/** Produz YAML no subconjunto JSON, validado novamente antes de ser retornado. */
export function serializeClaudePaths(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.some(path => !safePattern(path)) || new Set(paths).size !== paths.length) {
    throw new TypeError('paths deve conter padrões distintos no subconjunto suportado.');
  }
  const serialized = `---\npaths: ${JSON.stringify(paths)}\n---\n`;
  const parsed = parseClaudePaths(serialized);
  if (!parsed.ok || JSON.stringify(parsed.paths) !== JSON.stringify(paths)) throw new Error(`Frontmatter Claude inválido: ${parsed.reason || 'round-trip'}.`);
  return serialized;
}

/**
 * Plans only activation; does not record or recognize property by content.
 * Native Metadata is YAML Claude's explicit, not another client's global list.
 * HumanFile, when provided, is always preserved even if the scope coincides.
 */
export function planClaudeRule({ trigger, nativeMetadata, humanFile } = {}) {
  const hasHuman = humanFile !== undefined;
  if (hasHuman && typeof humanFile !== 'string') throw new TypeError('humanFile deve ser texto quando informado.');
  const result = { action: hasHuman ? 'preserve-human' : 'none', equivalence: 'not-verified' };
  if (!['always_on', 'glob', 'manual', 'model_decision'].includes(trigger)) return { ...result, status: 'blocked', reason: 'invalid-trigger' };
  if (trigger !== 'glob' && nativeMetadata !== undefined) return { ...result, status: 'blocked', reason: 'metadata-not-applicable' };
  if (trigger === 'manual' || trigger === 'model_decision' || (trigger === 'glob' && nativeMetadata === undefined)) {
    return { ...result, status: hasHuman ? 'preserved' : 'reference-only', activation: 'explicit-only', nativeDirectory: 'references/rules', reason: trigger === 'glob' ? 'native-scope-not-provided' : 'no-native-equivalent' };
  }
  let paths = null;
  if (trigger === 'glob') {
    const parsed = parseClaudePaths(nativeMetadata);
    if (!parsed.ok) return { ...result, status: 'blocked', reason: parsed.reason };
    paths = parsed.paths;
  }
  const plan = { ...result, activation: paths ? 'paths' : 'always', nativeDirectory: 'rules', paths };
  if (!hasHuman) return { ...plan, status: 'ready', action: 'create-reference' };
  const actual = parseClaudePaths(humanFile, { metadataOnly: false, allowGlobal: true });
  const scopeMatches = actual.ok && JSON.stringify(actual.paths) === JSON.stringify(paths);
  return { ...plan, status: 'preserved', action: 'preserve-human', scopeMatches: Boolean(scopeMatches), ...(!actual.ok ? { reason: actual.reason } : {}) };
}
