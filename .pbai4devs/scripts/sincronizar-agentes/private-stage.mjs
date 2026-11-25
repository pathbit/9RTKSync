import { lstatSync, mkdtempSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { assertPrivateRecoveryPaths, createPrivateRecoveryDirectory } from '../lib/recovery-privacy.mjs';
import { fail } from './shared.mjs';

const privateStages = new WeakMap();

export function createPrivateSyncStage() {
  const prefix = join(realpathSync(tmpdir()), 'agentdevkit-');
  const path = process.platform === 'win32' ? prefix + randomUUID() : mkdtempSync(prefix);
  if (process.platform === 'win32') createPrivateRecoveryDirectory(path);
  else assertPrivateRecoveryPaths([path], 'directory');
  const handle = Object.freeze({ path });
  privateStages.set(handle, lstatSync(path, { bigint: true }));
  return handle;
}

export function assertPrivateSyncStage(root, handle) {
  const saved = privateStages.get(handle);
  if (!saved || resolve(root || '') !== handle.path) fail('Estágio privado inválido.');
  const current = lstatSync(handle.path, { bigint: true });
  if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== saved.dev || current.ino !== saved.ino ||
      realpathSync(handle.path) !== handle.path || process.platform !== 'win32' &&
      (current.uid !== BigInt(process.geteuid()) || current.mode & 0o077n)) fail('Estágio privado alterado.');
  assertPrivateRecoveryPaths([handle.path], 'directory');
}
