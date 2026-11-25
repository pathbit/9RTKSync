#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ToolManager } from '../preparar-ferramentas/SCRIPT.mjs';
import { findExecutable, isMain, projectRoot, requireNode } from '../lib/runtime.mjs';

export function diagnose({ root = projectRoot, environment = process.env, probe = spawnSync, probeDocker = true } = {}) {
  requireNode();
  const manager = new ToolManager({ root });
  const docker = findExecutable('docker', environment);
  const execute = args => docker && probeDocker ? probe(docker, args, { env: environment, encoding: 'utf8', timeout: 5000, windowsHide: true }).status === 0 : false;
  const compose = execute(['compose', 'version']);
  const daemon = execute(['info', '--format', '{{.ServerVersion}}']);
  const status = available => !docker ? 'not-found' : !probeDocker ? 'not-requested' : available ? 'available' : 'unverified';
  const browserCandidates = [
    environment.AGENT_BROWSER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    environment.PROGRAMFILES && join(environment.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    environment['PROGRAMFILES(X86)'] && join(environment['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    environment.LOCALAPPDATA && join(environment.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    environment.LOCALAPPDATA && join(environment.LOCALAPPDATA, 'Chromium/Application/chrome.exe'),
    'google-chrome', 'chromium', 'chromium-browser',
  ].filter(Boolean);
  return {
    platform: process.platform,
    arch: process.arch,
    runtime: { name: 'node', version: process.version, executable: process.execPath },
    npm: findExecutable('npm', environment),
    git: findExecutable('git', environment),
    docker: { executable: docker, compose, daemon, composeStatus: status(compose), daemonStatus: status(daemon) },
    browsers: [...new Set(browserCandidates.map(name => findExecutable(name, environment)).filter(Boolean))],
    tools: Object.keys(manager.catalog).map(name => {
      const info = manager.info(name);
      return { name, installed: info.installed?.version || null, supported: info.supported, ...(info.issue ? { issue: info.issue } : {}) };
    }),
    playwrightMcp: 'discover-through-agent-tools',
  };
}

if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some(arg => arg !== '--no-docker-probe')) throw new Error('Uso: diagnosticar-ambiente [--no-docker-probe]');
    console.log(JSON.stringify(diagnose({ probeDocker: args.length === 0 }), null, 2));
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
