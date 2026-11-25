// Minimal frontmatter subset used for project configuration and status.
// This is not a general YAML validator; ambiguous document maps are discarded.
export function parseProjectMetadata(input) {
  const text = input.replaceAll('\r\n', '\n'), header = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  const result = { fields: {}, documents: {} }; if (!header) return result;
  if (header.includes('\r')) return result;
  let documents = false, invalidDocuments = false, lastKey = null;
  const seen = new Set(), duplicates = new Set(), seenDocuments = new Set(), duplicateDocuments = new Set();
  const scalar = raw => {
    const value = raw.trim();
    if (!value || ['null', '~'].includes(value)) return null;
    if (value.startsWith('"')) { try { return JSON.parse(value); } catch { return null; } }
    return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replaceAll("''", "'") : value;
  };
  for (const line of header.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const top = line.match(/^(?:([\p{L}_][\p{L}\p{N}_.-]*)|"([^"\n]+)"|'([^'\n]+)'):\s*(.*)$/u);
    if (top) {
      const key = top[1] || top[2] || top[3];
      lastKey = key;
      if (key.includes('\\')) return { fields: {}, documents: {} };
      if (seen.has(key)) duplicates.add(key);
      seen.add(key); result.fields[key] = duplicates.has(key) ? null : scalar(top[4]);
      if (key === 'documentos' && duplicates.has(key)) { invalidDocuments = true; result.documents = {}; }
      documents = key === 'documentos' && !invalidDocuments && !top[4].trim();
    } else if (!/^\s/.test(line)) return { fields: {}, documents: {} };
    else if (documents) {
      const item = line.match(/^  (?:([\p{L}_][\p{L}\p{N}_.-]*)|"([^"\n]+)"|'([^'\n]+)'):\s*(.*)$/u);
      if (item) {
        const key = item[1] || item[2] || item[3];
        if (key.includes('\\')) { invalidDocuments = true; result.documents = {}; documents = false; continue; }
        if (seenDocuments.has(key)) duplicateDocuments.add(key);
        seenDocuments.add(key); result.documents[key] = duplicateDocuments.has(key) ? null : scalar(item[4]);
      } else { invalidDocuments = true; result.documents = {}; documents = false; }
    } else if (lastKey) result.fields[lastKey] = null;
  }
  return result;
}
