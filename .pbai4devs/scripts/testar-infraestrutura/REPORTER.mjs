import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export function isTestEvent(data) {
  return data?.details?.type === 'test';
}

// Emit evidence from runner events, not from text printed by a test.
export default async function* reporter(source) {
  let observed = 0, counts, fileSummaries = 0;
  const skipped = [], pending = [];
  const canonical = path => { try { return realpathSync(resolve(path)); } catch { return resolve(path); } };
  const entry = process.env.ADK_INFRA_ENTRY ? canonical(process.env.ADK_INFRA_ENTRY) : null;
  for await (const event of source) {
    if (['test:pass', 'test:fail'].includes(event.type)) {
      if (isTestEvent(event.data)) observed++;
      if (event.data.skip) {
        const path = typeof event.data.file === 'string' ? relative(process.cwd(), event.data.file) : '';
        const reason = typeof event.data.skip === 'string' && event.data.skip.trim() ? event.data.skip : null;
        skipped.push({
          name: event.data.name,
          file: path && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path) ? path.replaceAll('\\', '/') : null,
          reason,
          kind: event.data.details?.type ?? null,
          event: event.type,
          booleanSkip: event.data.skip === true,
          todo: Boolean(event.data.todo),
        });
      }
      if (event.data.todo) pending.push({ name: event.data.name });
      yield `${event.type === 'test:fail' ? 'FAIL' : event.data.skip ? 'SKIP' : event.data.todo ? 'TODO' : 'PASS'} ${JSON.stringify(event.data.name)}\n`;
      if (event.type === 'test:fail' && event.data.details?.error) yield `ERROR ${JSON.stringify(event.data.details.error.stack || event.data.details.error.message || 'Falha sem detalhes.')}\n`;
    }
    if (event.type === 'test:stdout' || event.type === 'test:stderr') yield `OUTPUT ${JSON.stringify(String(event.data.message ?? ''))}\n`;
    if (event.type === 'test:summary') {
      if (!event.data?.file) counts = event.data?.counts;
      else if (!entry || canonical(event.data.file) === entry) fileSummaries++;
    }
  }
  yield `\nADK_INFRA_EVIDENCE ${JSON.stringify({ observed, fileSummaries, counts, skipped, pending })}\n`;
}
