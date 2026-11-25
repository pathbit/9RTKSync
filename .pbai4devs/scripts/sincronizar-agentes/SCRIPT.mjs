#!/usr/bin/env node
import { collectErrorDiagnostics } from '../lib/error-reporting.mjs';
import { requireNode, isMain } from '../lib/runtime.mjs';
import { fail } from './shared.mjs';
import { synchronize } from './synchronize.mjs';

// agentdevkit-manifest: selective-clients-v1
export { gitIndexStatIdentityMatches } from './git-safety.mjs';
export { header, isReference } from './references.mjs';
export { resourcePath } from '../lib/resource-path.mjs';
export { createPrivateSyncStage } from './private-stage.mjs';
export { synchronize, synchronizePrivateStage } from './synchronize.mjs';

// Internal planning evidence only: paths do not describe every filesystem
// effect and are not a backup or permission to mutate a project.
export function inspectSyncEffects(options = {}) {
  return synchronize({ ...options, check: true, inspectEffects: true });
}

export function main(args = process.argv.slice(2)) {
  requireNode();
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--check') options.check = true;
    else if (option === '--force') options.force = true;
    else if (option === '--root') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) fail('--root exige um caminho.');
      options.root = args[++index];
    } else if (option === '--documento') fail('--documento foi removido: somente skills, agents, commands e rules sao sincronizados.');
    else fail(`Opcao desconhecida: ${option}`);
  }
  return synchronize(options).exitCode;
}

if (isMain(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) {
    const knownCode = /^(EIO|EACCES|EPERM|ENOENT|EEXIST|ENOSPC|EXDEV|ENOTSUP|EOPNOTSUPP|E_CHANGED|E_PROTECTED_METADATA|E_METADATA_COPY|E_METADATA_UNSUPPORTED|E_RECOVERY_[A-Z_]{1,40})$/.test(error.code);
    if (error.recovery) {
      console.error(`Sincronização interrompida. Causa: ${knownCode ? error.code : 'falha de operação'}.`);
      const state = error.recovery;
      if (Number.isSafeInteger(state.generation)) console.error(`Geração observada: ${state.generation}.`);
      if (state.phase === 'claim' || state.phase === 'begin') console.error(`Fase observada: ${state.phase}.`);
      if (error.operation?.publication === 'possible' && ['claim', 'begin', 'done', 'resolved'].includes(error.operation.kind)) {
        console.error(`Publicação do registro ${error.operation.kind} incerta. Estado observado do diário: ${error.recovery.status}.`);
      }
      const backup = error.transaction?.backup ?? error.recovery.backup;
      if (backup) console.error(`Backup da operação: ${JSON.stringify(backup)}`);
      console.error('Interrompa outros escritores, preserve uma cópia do projeto e compare os caminhos com o manifesto. Consulte agentdevkit recovery.');
    } else if (knownCode && error.metadataTargetVerified === true && typeof error.path === 'string') {
      console.error(`Sincronização interrompida. Causa: ${error.code}. Caminho: ${JSON.stringify(error.path)}.`);
    } else {
      const message = String(error.message), limit = 1200;
      console.error(message.length <= limit ? message : `${message.slice(0, limit)}… (${message.length - limit} caracteres adicionais)`);
    }
    const diagnostics = collectErrorDiagnostics(error);
    const paths = [...new Set([...diagnostics.preservedPaths, ...diagnostics.cleanupFailures.map(item => item.path)])];
    if (paths.length) console.error(`Revise os caminhos preservados: ${paths.slice(0, 5).map(path => JSON.stringify(path)).join(', ')}${paths.length > 5 ? ` (+${paths.length - 5})` : ''}`);
    if (paths.length) console.error('Os caminhos podem conter dados parciais ou de outra origem; preserve-os e revise antes de recuperar.');
    if (diagnostics.possiblePartial) console.error('A operação pode ter deixado alterações; interrompa outros processos e revise o projeto antes de tentar novamente.');
    if (diagnostics.truncated) console.error('Diagnosticos adicionais foram limitados.');
    process.exitCode = 2;
  }
}
