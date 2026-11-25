// Pure validation of a future recovery journal. This module performs no I/O
// and is not yet wired to installation or synchronization.
import { createHash } from 'node:crypto';
import { types } from 'node:util';

const maxRecords = 4000, maxRecordBytes = 4096, maxTotalBytes = 1024 * 1024;
const filename = /^(\d{12})\.(claim|begin|done|resolved)\.json$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256 = /^[0-9a-f]{64}$/;
const invalid = reason => ({ status: 'invalid', reason });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArray, 'byteLength').get;
const byteOffset = Object.getOwnPropertyDescriptor(typedArray, 'byteOffset').get;
const arrayBuffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get;

export function inspectRecoveryRecords(entries) {
  try {
    if (types.isProxy(entries) || !Array.isArray(entries) || Object.getPrototypeOf(entries) !== Array.prototype
      || Object.hasOwn(entries, Symbol.iterator)) return invalid('invalid-input');
    const count = entries.length;
    if (!Number.isSafeInteger(count) || count < 0) return invalid('invalid-input');
    if (count > maxRecords) return invalid('limit-exceeded');
    const copied = []; let total = 0;
    for (let index = 0; index < count; index++) {
      const slot = Object.getOwnPropertyDescriptor(entries, String(index));
      if (!slot || !Object.hasOwn(slot, 'value')) return invalid('invalid-input');
      const entry = slot.value;
      if (!entry || typeof entry !== 'object' || types.isProxy(entry)
        || !Object.hasOwn(entry, 'name') || !Object.hasOwn(entry, 'bytes')) return invalid('invalid-input');
      const nameProperty = Object.getOwnPropertyDescriptor(entry, 'name');
      const bytesProperty = Object.getOwnPropertyDescriptor(entry, 'bytes');
      if (!Object.hasOwn(nameProperty, 'value') || !Object.hasOwn(bytesProperty, 'value')) return invalid('invalid-input');
      const name = nameProperty.value, bytes = bytesProperty.value;
      if (typeof name !== 'string' || name.length > 64 || types.isProxy(bytes)
        || !types.isUint8Array(bytes)) return invalid('invalid-input');
      // Intrinsic accessors avoid overridden lengths and iterators on subclasses.
      const length = byteLength.call(bytes), offset = byteOffset.call(bytes), backing = arrayBuffer.call(bytes);
      if (!types.isArrayBuffer(backing)) return invalid('invalid-input');
      if (length > maxRecordBytes) return invalid('limit-exceeded');
      total += length;
      if (total > maxTotalBytes) return invalid('limit-exceeded');
      copied.push({ name, bytes: Buffer.from(new Uint8Array(backing, offset, length)) });
    }

    const generations = new Map(), names = new Set();
    for (const item of copied) {
      const match = filename.exec(item.name);
      if (!match || names.has(item.name)) return invalid('invalid-name');
      names.add(item.name);
      const generation = Number(match[1]), kind = match[2];
      if (!generation) return invalid('invalid-sequence');
      let text, value;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(item.bytes);
        value = JSON.parse(text);
      } catch { return invalid('invalid-record'); }
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1
        || value.generation !== generation || value.kind !== kind || typeof value.id !== 'string' || !uuid.test(value.id)) return invalid('invalid-record');
      const canonical = { version: 1, generation, id: value.id, kind };
      if (kind === 'claim') {
        if (value.previous !== null && (typeof value.previous !== 'string' || !sha256.test(value.previous))) return invalid('invalid-record');
        canonical.previous = value.previous;
      } else if (kind === 'begin') {
        if (typeof value.claim !== 'string' || !sha256.test(value.claim)
          || typeof value.manifest !== 'string' || !sha256.test(value.manifest)) return invalid('invalid-record');
        canonical.claim = value.claim; canonical.manifest = value.manifest;
      } else if (kind === 'done') {
        if (typeof value.begin !== 'string' || !sha256.test(value.begin)) return invalid('invalid-record');
        canonical.begin = value.begin;
      } else if (kind === 'resolved') {
        if (typeof value.claim !== 'string' || !sha256.test(value.claim)
          || (value.begin !== null && (typeof value.begin !== 'string' || !sha256.test(value.begin)))) return invalid('invalid-record');
        canonical.claim = value.claim; canonical.begin = value.begin;
      }
      if (text !== `${JSON.stringify(canonical)}\n`) return invalid('invalid-record');
      if (!generations.has(generation)) generations.set(generation, Object.create(null));
      generations.get(generation)[kind] = { value, bytes: item.bytes };
    }

    const ordered = [...generations.keys()].sort((a, b) => a - b), operationIds = new Set();
    let previous = null, resolvedCount = 0, lastTerminal;
    for (let index = 0; index < ordered.length; index++) {
      const generation = ordered[index], { claim, begin, done, resolved } = generations.get(generation);
      if (generation !== index + 1 || !claim || (done && resolved) || (done && !begin)) return invalid('invalid-sequence');
      if (operationIds.has(claim.value.id)) return invalid('invalid-sequence');
      operationIds.add(claim.value.id);
      if (claim.value.previous !== previous) return invalid('invalid-link');
      if ([begin, done, resolved].some(item => item && item.value.id !== claim.value.id)) return invalid('invalid-link');
      if (begin && begin.value.claim !== digest(claim.bytes)) return invalid('invalid-link');
      if (done && done.value.begin !== digest(begin.bytes)) return invalid('invalid-link');
      if (resolved && (resolved.value.claim !== digest(claim.bytes)
        || resolved.value.begin !== (begin ? digest(begin.bytes) : null))) return invalid('invalid-link');
      if (!done && !resolved) {
        if (index !== ordered.length - 1) return invalid('invalid-sequence');
        return { status: 'pending', generation, id: claim.value.id, phase: begin ? 'begin' : 'claim' };
      }
      lastTerminal = done ? 'done' : 'resolved';
      if (resolved) resolvedCount++;
      previous = digest((done || resolved).bytes);
    }
    return ordered.length ? { status: 'ready', generation: ordered.length, terminal: lastTerminal, resolvedCount, head: previous }
      : { status: 'ready', generation: 0, head: null };
  } catch {
    // Invalid inputs, including exotic objects, never expose their contents.
    return invalid('invalid-input');
  }
}
