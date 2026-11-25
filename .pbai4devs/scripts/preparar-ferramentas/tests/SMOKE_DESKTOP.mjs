#!/usr/bin/env node
// Opens only a Chrome test and reads your window by accessibility.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { findExecutable, projectRoot, requireNode } from '../../lib/runtime.mjs';

requireNode();
const output = join(projectRoot, '.agent-tests/tools-desktop');
mkdirSync(output, { recursive: true });
const session = `desktop-smoke-${process.pid}`;
const title = `Prova desktop ${process.pid}`;
const application = process.env.AGENT_DESKTOP_TEST_APP || (process.platform === 'darwin' ? 'Google Chrome' : 'chrome');
const paths = [process.env.AGENT_BROWSER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'google-chrome', 'chromium', 'chrome'].filter(Boolean);
const browserPath = paths.map(path => findExecutable(path)).find(Boolean);
assert.ok(browserPath, 'Configure AGENT_BROWSER_EXECUTABLE_PATH para um Chrome instalado.');

function run(tool, args, log, allowFailure = false) {
  const result = spawnSync(process.execPath, [join(projectRoot, '.pbai4devs/tools', tool, 'SCRIPT.mjs'), 'run', ...args],
    { cwd: projectRoot, encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (log) writeFileSync(join(output, log), JSON.stringify({ status: result.status, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2) + '\n');
  assert.ifError(result.error);
  if (!allowFailure) assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

let passed = false;
try {
  const html = `<title>${title}</title><h1>Prova controlada</h1><button>Confirmar teste</button>`;
  run('agent-browser', ['--session', session, '--headed', '--args', '--force-renderer-accessibility', '--executable-path', browserPath, 'open', 'data:text/html,' + encodeURIComponent(html)], 'open.json');
  let ownWindow;
  for (let attempt = 0; attempt < 10 && !ownWindow; attempt++) {
    const response = JSON.parse(run('agent-desktop', ['list-windows', '--app', application]));
    assert.equal(response.ok, true);
    const windows = Array.isArray(response.data) ? response.data : response.data.windows || [];
    ownWindow = windows.find(window => JSON.stringify(window).includes(title));
    if (!ownWindow) await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(ownWindow, 'Janela isolada de teste nao encontrada.');
  const id = ownWindow.id || ownWindow.window_id || ownWindow.windowId;
  assert.ok(id, 'Identificador da janela ausente.');
  writeFileSync(join(output, 'window.json'), JSON.stringify(ownWindow, null, 2) + '\n');
  let result;
  for (let attempt = 0; attempt < 4; attempt++) {
    result = JSON.parse(run('agent-desktop', ['snapshot', '--app', application, '--window-id', String(id), '--max-depth', '20', '--timeout-ms', '15000'], 'snapshot.json', true));
    if (result.ok || result.error?.disposition?.retry !== 'safe') break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal(result.ok, true);
  assert.match(JSON.stringify(result.data), /Confirmar teste/);
  passed = true;
} finally {
  run('agent-browser', ['--session', session, 'close'], 'close.json');
}
assert.ok(passed);
console.log('agent-desktop-accessibility=passed; physical-input=none');
