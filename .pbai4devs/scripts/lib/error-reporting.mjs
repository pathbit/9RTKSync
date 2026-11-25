import { types as utilTypes } from 'node:util';

// Boundaries retain their cause but expose only their already mapped diagnostics.
const mappedBoundaries = new WeakSet();
const diagnosticWrappers = new WeakSet();

export function markDiagnosticsBoundary(error) {
  mappedBoundaries.add(error);
  return error;
}

// Traverse only wrappers created here and the first cause of an aggregate.
// Never cross a mapped boundary, follow arbitrary causes, or loop on cycles.
export function primaryDiagnosticError(error) {
  let current = error;
  const seen = new Set();
  while (current && typeof current === 'object' && !seen.has(current) && seen.size < 4096) {
    seen.add(current);
    if (mappedBoundaries.has(current)) break;
    let next;
    try {
      if (diagnosticWrappers.has(current)) next = current.cause;
      else if (current instanceof AggregateError && Array.isArray(current.errors) && current.errors.length) next = current.errors[0];
    } catch { break; }
    if (!next || typeof next !== 'object') break;
    current = next;
  }
  return current;
}

// Preserve structured diagnostics across nested causes and AggregateErrors.
export function collectErrorDiagnostics(error) {
  const seen = new Set(), paths = new Set(), cleanup = new Map(), pending = [error], limit = 4096;
  let truncated = false, possiblePartial = false, steps = 0;
  const standard = [null, Object.prototype, Array.prototype, Error.prototype,
    AggregateError.prototype, TypeError.prototype, RangeError.prototype,
    ReferenceError.prototype, SyntaxError.prototype, URIError.prototype, EvalError.prototype];
  const inspectable = item => {
    if (!item || typeof item !== 'object') return false;
    if (utilTypes.isProxy(item)) { truncated = true; return false; }
    try {
      const proto = Object.getPrototypeOf(item);
      if (utilTypes.isProxy(proto) || !standard.includes(proto)) truncated = true;
    }
    catch { truncated = true; return false; }
    return true;
  };
  const read = (item, key) => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor) {
        // Inherited diagnostics are not trusted; detect them without reading
        // property values or traversing a proxy prototype.
        let prototype = Object.getPrototypeOf(item), depth = 0;
        while (prototype) {
          if (utilTypes.isProxy(prototype) || ++depth > 32) { truncated = true; break; }
          if (Object.getOwnPropertyDescriptor(prototype, key)) { truncated = true; break; }
          prototype = Object.getPrototypeOf(prototype);
        }
        return undefined;
      }
      if (!Object.hasOwn(descriptor, 'value')) { truncated = true; return undefined; }
      return descriptor.value;
    } catch { truncated = true; return undefined; }
  };
  const visitArray = (array, visit) => {
    if (array === undefined || array === null) return;
    if (typeof array !== 'object') { truncated = true; return; }
    if (!inspectable(array)) return;
    if (!Array.isArray(array)) { truncated = true; return; }
    const length = read(array, 'length');
    if (!Number.isSafeInteger(length) || length < 0) { truncated = true; return; }
    for (let index = 0; index < length; index++) {
      if (++steps > limit) { truncated = true; return; }
      visit(read(array, String(index)));
    }
  };
  while (pending.length && seen.size < limit) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    if (!inspectable(item)) continue;
    seen.add(item);
    if (read(item, 'diagnosticsTruncated') === true) truncated = true;
    if (read(item, 'operationMayBePartial') === true) possiblePartial = true;
    for (const key of ['rollbackPreservedPaths', 'uncertainPaths']) {
      const values = read(item, key);
      visitArray(values, path => {
        if (typeof path === 'string') paths.add(path);
        else if (path !== undefined) truncated = true;
      });
    }
    const failures = read(item, 'cleanupFailures');
    visitArray(failures, failure => {
      if (failure === undefined) return;
      if (!inspectable(failure)) { truncated = true; return; }
      const path = read(failure, 'path'), message = read(failure, 'message');
      if (typeof path !== 'string' || typeof message !== 'string') { truncated = true; return; }
      const key = JSON.stringify([path, message]);
      cleanup.set(key, { path, message });
    });
    const cause = mappedBoundaries.has(item) ? undefined : read(item, 'cause');
    const errors = mappedBoundaries.has(item) ? undefined : read(item, 'errors');
    if (cause) pending.push(cause);
    visitArray(errors, item => { if (pending.length < limit) pending.push(item); else truncated = true; });
  }
  return { preservedPaths: [...paths], cleanupFailures: [...cleanup.values()], truncated: truncated || pending.length > 0, possiblePartial };
}

export function attachErrorDiagnostics(error) {
  const result = collectErrorDiagnostics(error);
  if (result.preservedPaths.length) error.rollbackPreservedPaths = result.preservedPaths;
  if (result.cleanupFailures.length) error.cleanupFailures = result.cleanupFailures;
  if (result.truncated) error.diagnosticsTruncated = true;
  return error;
}

// Preserve the original cause and code if an error cannot be annotated.
export function withUncertainPath(error, path) {
  try {
    const existing = Array.isArray(error?.uncertainPaths) ? error.uncertainPaths : [];
    error.uncertainPaths = [...new Set([...existing, path])];
    if (Array.isArray(error.uncertainPaths) && error.uncertainPaths.includes(path)) return error;
  } catch { /* Fall back to an extensible error below. */ }
  let message = 'An operation failed with an uncertain path.', code, hardlinkUnsupported, nestedGitPath, exitCode;
  try {
    const currentMessage = error?.message;
    if (typeof currentMessage === 'string') message = currentMessage;
    code = error?.code; hardlinkUnsupported = error?.hardlinkUnsupported;
    nestedGitPath = error?.nestedGitPath; exitCode = error?.exitCode;
  } catch { /* Preserve the original as cause. */ }
  const reported = new Error(message, { cause: error });
  diagnosticWrappers.add(reported);
  if (code !== undefined) reported.code = code;
  if (hardlinkUnsupported) reported.hardlinkUnsupported = true;
  if (typeof nestedGitPath === 'string') reported.nestedGitPath = nestedGitPath;
  if (Number.isInteger(exitCode)) reported.exitCode = exitCode;
  reported.uncertainPaths = [path];
  return reported;
}

// Preserve the cause even when a caller supplied an immutable error.
export function withPotentialPartial(error) {
  try {
    error.operationMayBePartial = true;
    if (error.operationMayBePartial === true) return error;
  } catch { /* Wrap an immutable error. */ }
  let message = 'An operation may have left partial changes.', code, exitCode, nestedGitPath, hardlinkUnsupported;
  try {
    const currentMessage = error?.message;
    if (typeof currentMessage === 'string') message = currentMessage;
    code = error?.code; exitCode = error?.exitCode; nestedGitPath = error?.nestedGitPath; hardlinkUnsupported = error?.hardlinkUnsupported;
  } catch { /* Preserve the original as cause. */ }
  const reported = new Error(message, { cause: error });
  diagnosticWrappers.add(reported);
  if (code !== undefined) reported.code = code;
  if (Number.isInteger(exitCode)) reported.exitCode = exitCode;
  if (typeof nestedGitPath === 'string') reported.nestedGitPath = nestedGitPath;
  if (hardlinkUnsupported) reported.hardlinkUnsupported = true;
  reported.operationMayBePartial = true;
  return reported;
}

// Only mark errors from an attempted exclusive hardlink publication.
export function explainUnsupportedHardlink(error) {
  const code = error?.code;
  if (['ENOTSUP', 'EOPNOTSUPP'].includes(code)) {
    const message = `Hardlinks are not supported by this filesystem: ${error.message}`;
    try {
      error.hardlinkUnsupported = true;
      error.message = message;
      if (error.hardlinkUnsupported === true && error.message === message) return error;
    } catch { /* Preserve immutable errors as the cause below. */ }
    const wrapped = new Error(message, { cause: error });
    wrapped.code = code;
    wrapped.hardlinkUnsupported = true;
    return wrapped;
  }
  return error;
}
