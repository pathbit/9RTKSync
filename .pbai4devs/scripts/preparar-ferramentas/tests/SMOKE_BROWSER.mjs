#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExecutable, projectRoot, requireNode } from '../../lib/runtime.mjs';

requireNode();
const here = dirname(fileURLToPath(import.meta.url));
const tool = join(projectRoot, '.pbai4devs/tools/agent-browser/SCRIPT.mjs');
const candidates = [process.env.AGENT_BROWSER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Chromium/Application/chrome.exe'),
  'google-chrome', 'chromium', 'chromium-browser'].filter(Boolean);
const browser = candidates.map(name => findExecutable(name)).find(Boolean);
if (!browser) { console.error('Navegador ausente; defina AGENT_BROWSER_EXECUTABLE_PATH.'); process.exit(69); }
const output = join(projectRoot, '.agent-tests/tools-browser');
mkdirSync(output, { recursive: true });
const session = `agents-tool-smoke-${process.pid}`;
const run = (args, file, useSession = true) => {
  const result = spawnSync(process.execPath, [tool, 'run', ...(useSession ? ['--session', session] : []), ...args],
    { cwd: projectRoot, encoding: 'utf8', timeout: 45000, windowsHide: true });
  if (file) writeFileSync(join(output, file), `${result.stdout || ''}${result.stderr || ''}`);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
};
const close = () => {
  const result = spawnSync(process.execPath, [tool, 'run', '--session', session, 'close'],
    { encoding: 'utf8', timeout: 10000, windowsHide: true });
  writeFileSync(join(output, 'close.json'), JSON.stringify({ status: result.status, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2) + '\n');
  assert.ifError(result.error);
  assert.equal(result.status, 0, 'Falha ao encerrar a sessao do navegador; veja close.json.');
};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  try { close(); } catch (error) { console.error(error.message); }
  process.exit(signal === 'SIGINT' ? 130 : 143);
});
try {
  run(['skills', 'get', 'core'], 'guide.txt', false);
  const fixture = 'data:text/html;charset=utf-8,' + encodeURIComponent(readFileSync(join(here, 'FIXTURE.html'), 'utf8'));
  run(['--executable-path', browser, 'open', fixture], 'open.txt');
  run(['snapshot', '-i'], 'snapshot.txt');
  run(['find', 'label', 'Nome', 'fill', 'Agente'], 'fill.txt');
  run(['find', 'text', 'Confirmar', 'click'], 'click.txt');
  run(['snapshot'], 'result.txt');
  assert.equal(run(['get', 'text', '[role="status"]']), 'Ola, Agente');
  run(['screenshot', join(output, 'tela.png')], 'screenshot.txt');
} finally { close(); }
console.log('agent-browser-functional=passed');
