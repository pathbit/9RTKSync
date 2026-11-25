import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { assertUnredirectedGitEnvironment } from '../lib/git-environment.mjs';
import { requireNode, projectRoot } from '../lib/runtime.mjs';
import { buildCatalog } from '../lib/catalog.mjs';
import { planClaudeRule, serializeClaudePaths } from '../lib/claude-rule-scope.mjs';
import { canMigrateClaudeReference, isLegacyExact, legacyClaudeGitSource } from '../lib/claude-legacy-exact.mjs';
import { adapterManifest } from '../lib/adapters.mjs';
import { mayReferenceClaudeRule, resemblesClaudeReference, scanRetainedClaude } from '../lib/claude-retained.mjs';
import { canonicalEntrypoint, extractManagedBlock, mergeManagedContent, nativeZcodeAgent, stripManagedContent } from '../lib/managed-content.mjs';
import { stripTomlContent } from '../lib/managed-toml.mjs';
import { mergeGitignore, validateIgnoreClients, renderClientIgnore, isGeneratedOutput, planLocalIgnore, checkLocalIgnore, assertLocalIgnoreUnchanged, planUntrack, isBlockingLocalIgnore, ignoreBegin, ignoreEnd } from '../lib/gitignore.mjs';
import { stateDirectory } from '../lib/state-path.mjs';
import { inspectProjectRecovery } from '../lib/project-recovery.mjs';
import { auxiliary, principals, compare, sorted, fail, parseJson, normalize, read, stat } from './shared.mjs';
import { marker, header, copilotApplyTo, isReference, link } from './references.mjs';
import { indexAttributeFilesMatch, indexFileMatches } from './git-safety.mjs';
import { readDerivedOwnership, derivedContent, validResourcePath } from './derived-state.mjs';
import { migrateClients, parseManifest, resolveNativeTargets } from './manifest.mjs';
import { planCatalogOutputs, planEntrypointOutputs } from './projections.mjs';
import { applySynchronization } from './apply.mjs';
import { planSyncOperations } from './operations.mjs';
import { inspectSyncMetadata } from './metadata.mjs';
import { openSyncWorkspace, trackNativeOutputs } from './workspace.mjs';
import { assertPrivateSyncStage } from './private-stage.mjs';

export function synchronize(options = {}) {
  return runSynchronization(options);
}

export function synchronizePrivateStage(options, handle) {
  return runSynchronization(options ?? {}, { handle });
}

function runSynchronization({ root = projectRoot, check = false, force = false, localIgnores = true, generateEntrypoints = true, recordDerivedState = true, inspectEffects = false, outputBlocked, output = console.log }, privateAccess) {
  const privateStage = privateAccess !== undefined;
  const stageHandle = privateAccess?.handle;
  if (privateStage) assertPrivateSyncStage(root, stageHandle);
  requireNode();
  if (inspectEffects && !check) fail('Inspecao de efeitos exige modo de consulta.');
  assertUnredirectedGitEnvironment();
  root = realpathSync(resolve(root));
  if (!privateStage) {
    const recovery = inspectProjectRecovery(root);
    if (recovery.status !== 'ready') {
      const message = 'A recuperação precisa de revisão antes da sincronização. Consulte agentdevkit recovery.';
      if (check) {
        output(message);
        if (recovery.backup) output(`Backup da operação: ${JSON.stringify(recovery.backup)}`);
        return { recovery, exitCode: 2 };
      }
      throw Object.assign(new Error(message), {
        code: recovery.status === 'pending' ? 'E_RECOVERY_PENDING' : 'E_RECOVERY_STORE', recovery,
      });
    }
  }
  const workspace = openSyncWorkspace(root, force && !check && !privateStage);
  const { absolute, safe, firstFileStats, captureInput } = workspace;
  const config = '.pbai4devs/espelhos.conf';
  const configExists = stat(safe(config));
  const configBytes = configExists ? readFileSync(absolute(config)) : null;
  captureInput(config, configBytes);
  const stateRoot = stateDirectory(root);
  const stateFile = `${stateRoot}/agentdevkit.json`;
  const installedBytes = stat(safe(stateFile)) ? readFileSync(safe(stateFile)) : null;
  const installed = installedBytes ? parseJson(normalize(installedBytes.toString('utf8')), 'estado instalado') : null;
  if (!privateStage && Array.isArray(installed?.clients) && installed.clients.some(id => typeof id === 'string' && id.split(',').some(value => value.trim().toLowerCase() === 'gemini'))) {
    fail(migrateClients);
  }
  const configText = configExists ? read(safe(config)) : adapterManifest(root, { clients: installed ? installed.clients : ['none'] });
  const rows = configText.split('\n');
  const entryRegistry = `${stateRoot}/derived.json`;
  const registryBytes = stat(safe(entryRegistry)) ? readFileSync(absolute(entryRegistry)) : null;
  captureInput(entryRegistry, registryBytes);
  const {
    previousEntries, previousOutputs, previousCatalogs, removedBlocks, removedFiles, effectiveRemovedFiles,
    unverifiedRemovals, unknownRemovedFiles, priorFiles, priorBlocks, ownedPaths,
  } = readDerivedOwnership(registryBytes, { root, safe, installed, output });
  const {
    preserved, remember, preserveBoundary, unavailable, assertFallbackChecks, scan,
    claimed, preserveUnknown, preserveNativeType, referenceFile, protectedPath, beginMutation,
  } = trackNativeOutputs(root, workspace, { rows, ownedPaths, priorFiles, outputBlocked });
  const manifest = parseManifest(rows, configText, {
    absolute, safe, preserveBoundary, preserveNativeType, installed, privateStage,
  });
  const { agents, discoveries, ignoreRoots, legacy } = manifest;
  const managed = value => [...agents.keys()].some(agent => value.startsWith(agent + '/'));
  const built = buildCatalog(root, { captureRuleInputs: agents.has('.claude') });
  const { sources, rules, entries, omittedClaude, invalidClaude, claudeScopeBoundaries, missing, targets } = resolveNativeTargets(manifest, built, {
    check, safe, absolute, preserveUnknown, unavailable, managed, referenceFile,
  });
  const remove = new Set();
  const backup = new Set();
  const conflicts = new Set();
  const protectedConflicts = new Set();
  const protectedClaudeStale = new Set();
  const retiredClaude = new Set();
  const claudeRuleInputs = new Map();
  const migratedClaude = new Set();
  const claudeMigrationInputs = new Map();
  function canMigrateClaude(target, current, replacement) {
    return canMigrateClaudeReference({
      target, current, replacement, recordedHash: priorFiles[target],
      blocked: installed?.blocks?.[target] || previousEntries.blocks?.[target]
        || removedBlocks.has(target) || Object.hasOwn(removedFiles, target),
    });
  }
  function captureClaudeMigration(target) {
    migratedClaude.add(target);
    claudeMigrationInputs.set(stateFile, installedBytes);
    claudeMigrationInputs.set(entryRegistry, registryBytes);
    claudeMigrationInputs.set(config, configBytes);
    for (const [path, expected] of claudeRuleInputs.get(target)) {
      const previous = claudeMigrationInputs.get(path);
      if (previous && !previous.equals(expected)) fail(`Arquivo mudou apos planejar: ${path}`);
      claudeMigrationInputs.set(path, expected);
    }
  }
  function assertClaudeMigrationInputs(inputs = claudeMigrationInputs) {
    for (const [path, expected] of inputs) {
      const file = safe(path), info = stat(file);
      if (expected ? !info?.isFile() || !readFileSync(file).equals(expected) : info) fail(`Arquivo mudou apos planejar: ${path}`);
    }
  }
  const omittedStagedConflicts = [];
  for (const [target] of invalidClaude) {
    conflicts.add(target); protectedConflicts.add(target);
    if (preserveBoundary(target)) { claudeScopeBoundaries.add(target); continue; }
    if (stat(safe(target))) remember(target, 'claude-scope-invalid');
  }
  for (const [target, { source, trigger }] of omittedClaude) {
    claudeRuleInputs.set(target, [[source, built.ruleInputs.get(source)]]);
    if (preserveBoundary(target)) { claudeScopeBoundaries.add(target); continue; }
    const info = stat(safe(target));
    if (info) {
      const current = info.isFile() && info.size <= 1024 * 1024 ? readFileSync(safe(target)) : null;
      if (source === legacyClaudeGitSource && trigger === 'model_decision' && canMigrateClaude(target, current, null)) {
        captureInput(target, current);
        captureClaudeMigration(target);
        retiredClaude.add(target);
        remove.add(target);
        continue;
      }
      remember(target, 'claude-scope-preserved');
      conflicts.add(target); protectedConflicts.add(target);
      if (current) {
        const indexPlan = planUntrack(root, { [target]: createHash('sha256').update(current).digest('hex') });
        omittedStagedConflicts.push(...indexPlan.conflicts);
      }
    }
  }
  const expected = new Map();
  const stagedLineEndingCandidates = new Set();
  // Preserving a human file does not reverse an earlier ownership tombstone.
  const preservedHumanFiles = new Set();
  const managedBlocks = {};
  const generatedFiles = {};
  const rememberGenerated = (target, content) => {
    const hash = createHash('sha256').update(content).digest('hex');
    if (installed?.files?.[target] !== hash || Object.hasOwn(previousEntries.files ?? {}, target)) generatedFiles[target] = hash;
  };
  const retiredBlocks = new Set();
  const changed = [];
  function planRemove(value, custom = false) {
    safe(value);
    if (unknownRemovedFiles.has(value)) { remember(value, 'removed-file-unverified'); conflicts.add(value); protectedConflicts.add(value); return; }
    if ((omittedClaude.has(value) && !retiredClaude.has(value)) || protectedClaudeStale.has(value)) { remember(value, 'claude-scope-preserved'); conflicts.add(value); protectedConflicts.add(value); return; }
    if (isGeneratedOutput(value)) { remember(value, 'local-output'); return; }
    if (!managed(value) || protectedPath(value)) fail(`Limpeza fora dos espelhos ou caminho protegido: ${value}`);
    // Directories, unowned files and edited references can contain project
    // data even when --force is used. Only a recorded, unchanged reference
    // may be removed; empty directories are never removed recursively.
    if (!stat(safe(value))?.isFile() || !referenceFile(value)) {
      remember(value, 'existing-file');
      if (custom) { conflicts.add(value); protectedConflicts.add(value); }
      return;
    }
    remove.add(value);
    if (custom) backup.add(value);
  }
  function cleanScope(value) {
    if (preserveBoundary(value)) return;
    const info = stat(safe(value));
    if (!info) return;
    if (isGeneratedOutput(value, info.isDirectory())) { remember(value, 'local-output'); return; }
    const files = info.isDirectory() ? scan(value, { prune: true }) : [value];
    if (info.isDirectory() && !files.length) { remember(value, 'existing-directory'); return; }
    let hasHumanContent = false;
    for (const file of files) {
      if (expected.has(file) || priorBlocks[file] || protectedPath(file)) continue;
      if (referenceFile(file)) planRemove(file);
      else if (claimed(file)) { remember(file, 'edited-generated-file'); hasHumanContent = true; }
      else { remember(file); hasHumanContent = true; }
    }
    if (hasHumanContent && info.isDirectory()) remember(value);
  }
  const { registries, discoveryOutputs, catalogOutputs } = planCatalogOutputs({
    built, discoveries, entries, sources, safe, absolute, ownedPaths, preserveBoundary,
    preserveNativeType, captureInput, remember, installed, previousCatalogs, previousOutputs,
    conflicts, protectedConflicts, force, backup,
  });
  const ignoreFiles = new Map();
  const clientSettingsPath = '.pbai4devs/templates/gitignore/clients.json';
  if (!stat(safe(clientSettingsPath))?.isFile()) fail(`Configuracao .gitignore ausente: ${clientSettingsPath}`);
  const ignoreClients = validateIgnoreClients(parseJson(read(absolute(clientSettingsPath)), 'configuracao de clientes'));
  const ignoreTemplates = new Map([
    ['.pbai4devs/.gitignore', '.pbai4devs/templates/gitignore/shared.ignore'],
  ]);
  for (const folder of sorted(ignoreRoots)) {
    const target = `${folder}/.gitignore`;
    if (!preserveBoundary(target) && stat(safe(target))) remember(target, 'existing-ignore');
  }
  for (const [target, template] of ignoreTemplates) {
    if (preserveBoundary(target)) continue;
    if (!stat(safe(template))?.isFile()) fail(`Template .gitignore ausente ou invalido: ${template}`);
    const info = stat(safe(target));
    if (target !== '.pbai4devs/.gitignore' && preserveNativeType(target, info, 'isFile')) continue;
    if (info && !info.isFile()) fail(`.gitignore nao e arquivo: ${target}`);
    let merged;
    const current = info ? readFileSync(absolute(target), 'utf8') : '';
    captureInput(target, info ? Buffer.from(current) : null);
    if (info) {
      const start = current.indexOf(ignoreBegin), finish = current.indexOf(ignoreEnd);
      const blockHash = start >= 0 && finish > start ? createHash('sha256').update(current.slice(start, finish + ignoreEnd.length)).digest('hex') : null;
      const fileHash = createHash('sha256').update(current).digest('hex');
      if (blockHash && ([installed?.blocks?.[target], previousEntries.blocks?.[target]].includes(blockHash) || priorFiles[target] === fileHash)) managedBlocks[target] = blockHash;
      else remember(target, 'existing-ignore');
      continue;
    }
    if (target !== '.pbai4devs/.gitignore' && info && !ownedPaths.has(target) && !current.split(/\r?\n/).some(line => [ignoreBegin, ignoreEnd].includes(line))) { remember(target); continue; }
    try {
      let patterns = readFileSync(absolute(template), 'utf8');
      if (target !== '.pbai4devs/.gitignore') patterns = renderClientIgnore(patterns, ignoreClients[posix.dirname(target)]);
      else if (installed?.local === true) patterns = `${patterns.trimEnd()}\n*`;
      merged = mergeGitignore(current, patterns);
    }
    catch (error) { fail(`${target}: ${error.message}`); }
    if (merged.hasBlock) {
      const start = current.indexOf(ignoreBegin), finish = current.indexOf(ignoreEnd);
      const blockHash = start >= 0 && finish > start ? createHash('sha256').update(current.slice(start, finish + ignoreEnd.length)).digest('hex') : null;
      const fileHash = createHash('sha256').update(current).digest('hex');
      const known = [installed?.blocks?.[target], previousEntries.blocks?.[target]].some(hash => hash && hash === blockHash)
        || priorFiles[target] && priorFiles[target] === fileHash;
      if (!known) {
        // A marker or identical contents is not proof that this block belongs
        // to the kit. Do not adopt, replace or remove it even with --force.
        remember(target, 'existing-ignore-block');
        if (merged.text !== current) { conflicts.add(target); protectedConflicts.add(target); }
        continue;
      }
    }
    const start = merged.text.indexOf(ignoreBegin), finish = merged.text.indexOf(ignoreEnd);
    if (start >= 0 && finish > start) managedBlocks[target] = createHash('sha256').update(merged.text.slice(start, finish + ignoreEnd.length)).digest('hex');
    if (merged.text !== current) {
      ignoreFiles.set(target, merged.text);
      if (force && info && merged.hasBlock) backup.add(target);
    }
  }
  for (const target of targets) {
    const { source, metadata } = entries.get(target);
    let ancestor = posix.dirname(target);
    while (ancestor.includes('/')) {
      const info = stat(safe(ancestor));
      if (info && !info.isDirectory()) {
        if (force) planRemove(ancestor, true); else conflicts.add(ancestor);
      }
      ancestor = posix.dirname(ancestor);
    }
    const info = stat(safe(target));
    const targetBytes = info?.isFile() ? readFileSync(absolute(target)) : null;
    captureInput(target, targetBytes);
    const installedHash = installed?.files?.[target], derivedHash = previousEntries.files?.[target];
    const currentHash = targetBytes && createHash('sha256').update(targetBytes).digest('hex');
    const conflictingRecords = Boolean(installedHash && derivedHash && installedHash !== derivedHash
      && (!targetBytes || currentHash !== derivedHash));
    // When only one whole-file record exists, preserve a later human edit
    // unless a separately recorded Markdown block actually validates.
    let derivedOnlyDiverged = Boolean(derivedHash && targetBytes && currentHash !== derivedHash
      && (!installedHash || installedHash === derivedHash) && /\.(md|mdc)$/i.test(target));
    if (derivedOnlyDiverged && !conflictingRecords && targetBytes) {
      const text = targetBytes.toString('utf8'), normalized = Buffer.from(text.replaceAll('\r\n', '\n'));
      const lineEndingOnly = Buffer.from(text).equals(targetBytes) && text.includes('\r\n') && !text.replaceAll('\r\n', '').includes('\r')
        && createHash('sha256').update(normalized).digest('hex') === derivedHash;
      const currentInfo = lineEndingOnly ? lstatSync(safe(target), { bigint: true }) : null;
      if (lineEndingOnly && currentInfo.isFile() && !currentInfo.isSymbolicLink()
        && indexFileMatches(root, target, targetBytes, currentInfo)
        && indexAttributeFilesMatch(root, target, safe)) {
        derivedOnlyDiverged = false;
        stagedLineEndingCandidates.add(target);
      }
    }
    if (derivedOnlyDiverged && priorBlocks[target]) {
      const existingBlock = extractManagedBlock(targetBytes);
      if (existingBlock && createHash('sha256').update(existingBlock).digest('hex') === priorBlocks[target]) derivedOnlyDiverged = false;
    }
    if (unknownRemovedFiles.has(target)) {
      remember(target, 'removed-file-unverified'); conflicts.add(target); protectedConflicts.add(target);
      preservedHumanFiles.add(target); if (targetBytes) expected.set(target, targetBytes); continue;
    }
    if (conflictingRecords || derivedOnlyDiverged) {
      // Diagnostic only: matching normalized bytes does not establish ownership
      // or authorize replacing the user's line endings.
      let reason = 'derived-reference-diverged';
      if (derivedOnlyDiverged && !conflictingRecords && targetBytes.includes(13)) {
        const text = targetBytes.toString('utf8');
        if (Buffer.from(text).equals(targetBytes) && !text.replaceAll('\r\n', '').includes('\r')
          && createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex') === derivedHash) reason = 'line-ending-diverged';
      }
      remember(target, reason); conflicts.add(target); protectedConflicts.add(target);
      preservedHumanFiles.add(target); if (targetBytes) expected.set(target, targetBytes); continue;
    }
    const reference = targetBytes && (referenceFile(target, targetBytes)
      || stagedLineEndingCandidates.has(target) && isReference(normalize(targetBytes.toString('utf8'))));
    const mixed = info?.isFile() && /\.(md|mdc)$/i.test(target) && (priorBlocks[target] || !reference);
    if (info && !mixed && (!info.isFile() || !reference)) {
      scan(target);
      if (force) planRemove(target, true); else conflicts.add(target);
    }
    const claudeRule = target.startsWith('.claude/rules/') ? rules.get(source) : undefined;
    const ruleSourceBytes = claudeRule ? built.ruleInputs.get(source) : null;
    const metadataBytes = claudeRule && metadata ? readFileSync(safe(metadata)) : null;
    const nativeMetadata = metadataBytes ? normalize(metadataBytes.toString('utf8')) : undefined;
    const sourceText = ruleSourceBytes ? normalize(ruleSourceBytes.toString('utf8')) : read(safe(source));
    if (claudeRule) {
      claudeRuleInputs.set(target, metadata ? [[source, ruleSourceBytes], [metadata, metadataBytes]] : [[source, ruleSourceBytes]]);
      // Exact legacy reference does not establish ownership or native activation.
      const legacyName = target.match(/^\.claude\/rules\/([a-z0-9]+(?:-[a-z0-9]+)*)\/RULE\.md$/)?.[1];
      const legacyTitle = sourceText.match(/^# [^\r\n]+$/m)?.[0];
      const legacyGenerated = legacyName && legacyTitle && !metadata && claudeRule.trigger === 'always_on'
        && source === `.pbai4devs/rules/${legacyName}/RULE.md`
        ? Buffer.from(`---\ndescription: ${JSON.stringify(claudeRule.description)}\n---\n\n${legacyTitle}\n\n${marker}\nLeia e siga [origem](${link(target, source)}).\n`) : null;
      if (legacyGenerated && targetBytes && isLegacyExact(ruleSourceBytes, targetBytes, legacyGenerated, legacyName)
        && !installed?.files?.[target] && !installed?.blocks?.[target]
        && !previousEntries.files?.[target] && !previousEntries.blocks?.[target]
        && !previousEntries.entries?.[target] && !previousOutputs[target] && !previousCatalogs[target]
        && !removedBlocks.has(target) && !Object.hasOwn(removedFiles, target)) {
        captureInput(target, targetBytes); preservedHumanFiles.add(target);
        remember(target, 'legacy-claude-scope-unverified'); expected.set(target, targetBytes);
        claudeScopeBoundaries.add(target); continue;
      }
      const scope = planClaudeRule({ trigger: claudeRule.trigger, nativeMetadata, ...(mixed ? { humanFile: targetBytes.toString('utf8') } : {}) });
      if (scope.status === 'blocked' || scope.status === 'reference-only') fail(`Escopo Claude invalido ou nao comprovado: ${target}: ${scope.reason || scope.status}.`);
      if (mixed) {
        if (priorBlocks[target]) managedBlocks[target] = priorBlocks[target];
        remember(target, 'claude-scope-preserved');
        conflicts.add(target); protectedConflicts.add(target);
        expected.set(target, targetBytes);
        continue;
      }
    }
    if (mixed && target.startsWith('.github/instructions/') && target.endsWith('.instructions.md') && rules.has(source)) {
      const rule = rules.get(source);
      let compatible = false;
      if (metadata) {
        try {
          const native = read(safe(metadata));
          compatible = copilotApplyTo(native) !== null && header(targetBytes.toString('utf8')) === header(native);
        } catch { /* Preserve ambiguous human metadata. */ }
      } else if (['always_on', 'glob'].includes(rule.trigger)) {
        const actual = copilotApplyTo(targetBytes.toString('utf8'));
        compatible = actual !== null && actual === (rule.trigger === 'glob' ? rule.globs : '**');
      }
      if (!compatible) {
        // Existing owned blocks remain intact too: removing them would change
        // human bytes. Report the collision for the user to review.
        if (priorBlocks[target]) managedBlocks[target] = priorBlocks[target];
        remember(target, 'copilot-scope-preserved');
        conflicts.add(target);
        protectedConflicts.add(target);
        expected.set(target, targetBytes);
        continue;
      }
    }
    let frontmatter;
    if (claudeRule) {
      const scope = planClaudeRule({ trigger: claudeRule.trigger, nativeMetadata });
      if (scope.status !== 'ready') fail(`Escopo Claude invalido ou nao comprovado: ${target}.`);
      frontmatter = scope.activation === 'paths' ? serializeClaudePaths(scope.paths) : `---\ndescription: ${JSON.stringify(claudeRule.description)}\n---\n`;
    } else if (metadata) frontmatter = header(read(safe(metadata)));
    else if (target.endsWith('.mdc')) {
      const rule = built.catalog.rules.find(entry => entry.path === source);
      if (!rule) fail(`Regra Cursor exige RULE.md: ${source}`);
      frontmatter = `---\ndescription: ${JSON.stringify(rule.trigger === 'manual' ? '' : rule.description)}\nalwaysApply: ${rule.trigger === 'always_on'}\n${rule.trigger === 'glob' ? `globs: ${JSON.stringify(rule.globs)}\n` : ''}---\n`;
    } else if (target.startsWith('.github/instructions/') && target.endsWith('.instructions.md') && rules.has(source)) {
      const rule = rules.get(source);
      if (!['always_on', 'glob'].includes(rule.trigger) && !mixed) fail(`Regra ${rule.trigger} exige metadados nativos explicitos: ${target}`);
      frontmatter = mixed ? '' : `---\napplyTo: ${JSON.stringify(rule.trigger === 'glob' ? rule.globs : '**')}\n---\n`;
    } else frontmatter = target.endsWith('.instructions.md') ? "---\napplyTo: '**'\n---\n" : header(sourceText);
    const title = sourceText.match(/^# .+$/m)?.[0];
    if (!title) fail(`Titulo ausente: ${source}`);
    const ruleInclusion = /^\.(?:agents|agent)\/rules\//.test(target);
    const inclusion = ruleInclusion ? `@[origem](${link(target, source)})` : `Leia e siga [origem](${link(target, source)}).`;
    const current = mixed ? targetBytes : null;
    // Compare the complete native frontmatter; differing mixed files keep the
    // existing merge behavior.
    const rule = !metadata && target.startsWith('.github/instructions/') && target.endsWith('.instructions.md') ? rules.get(source) : null;
    const exactFrontmatter = rule && ['always_on', 'glob'].includes(rule.trigger)
      ? `---\napplyTo: ${JSON.stringify(rule.trigger === 'glob' ? rule.globs : '**')}\n---\n` : frontmatter;
    const exactGenerated = `${exactFrontmatter}\n${title}\n\n${marker}\n${inclusion}\n`;
    if (current && stagedLineEndingCandidates.has(target) && normalize(current.toString('utf8')) === exactGenerated) {
      captureInput(target, current); preservedHumanFiles.add(target);
      remember(target, 'existing-reference-satisfied'); expected.set(target, current); continue;
    }
    // Preserve an already satisfied installed reference byte-for-byte when
    // only its line endings differ. This does not claim ownership or permit
    // replacing it, and does not apply when the generated content changed.
    if (current && !priorBlocks[target] && !previousEntries.files?.[target]
      && !previousEntries.blocks?.[target] && !previousEntries.entries?.[target]
      && !previousOutputs[target] && !previousCatalogs[target] && !removedBlocks.has(target)
      && !Object.hasOwn(removedFiles, target)) {
      const text = current.toString('utf8'), normalized = text.replaceAll('\r\n', '\n');
      if (text.includes('\r\n') && Buffer.from(text).equals(current) && normalized === exactGenerated
        && (!installedHash || createHash('sha256').update(normalized).digest('hex') === installedHash)) {
        captureInput(target, current); preservedHumanFiles.add(target);
        remember(target, 'existing-reference-satisfied'); expected.set(target, current); continue;
      }
    }
    if (current && !installed?.files?.[target] && !installed?.blocks?.[target]
      && !previousEntries.files?.[target] && !previousEntries.blocks?.[target]
      && !previousEntries.entries?.[target] && !previousOutputs[target] && !previousCatalogs[target]
      && !removedBlocks.has(target) && !Object.hasOwn(removedFiles, target)
      && current.equals(Buffer.from(exactGenerated))) {
      captureInput(target, current); preservedHumanFiles.add(target);
      remember(target, 'existing-reference-satisfied'); expected.set(target, current); continue;
    }
    if (current && nativeZcodeAgent(target)) {
      // Its Markdown body is an active system prompt. A generic block would
      // change the behavior of the agent already defined by the project.
      if (priorBlocks[target]) managedBlocks[target] = priorBlocks[target];
      preservedHumanFiles.add(target);
      remember(target, 'zcode-agent-preserved'); expected.set(target, current); continue;
    }
    const merged = mixed ? mergeManagedContent(current, inclusion, { expectedHash: priorBlocks[target] }) : null;
    if (current && !stagedLineEndingCandidates.has(target) && !priorBlocks[target]
      && priorFiles[target] !== createHash('sha256').update(current).digest('hex') && extractManagedBlock(current)) {
      remember(target, 'existing-managed-block'); expected.set(target, current); continue;
    }
    const content = merged ? merged.text : `${frontmatter}\n${title}\n\n${marker}\n${inclusion}\n`;
    if (target.startsWith('.claude/rules/') && info?.isFile() && !targetBytes.equals(Buffer.from(content))) {
      if (!canMigrateClaude(target, targetBytes, Buffer.from(content))) {
        remember(target, 'claude-metadata-unverified'); conflicts.add(target); protectedConflicts.add(target);
        expected.set(target, targetBytes);
        continue;
      }
      captureClaudeMigration(target);
    }
    if (mixed) { captureInput(target, current); managedBlocks[target] = merged.sha256; remember(target, 'existing-file-extended'); }
    else rememberGenerated(target, content);
    expected.set(target, content);
    if (!info?.isFile() || readFileSync(absolute(target), 'utf8') !== content) changed.push(target);
  }
  if (agents.has('.claude')) {
    // Claude carries rules even in ignored directories like .local/.cache.
    // Scan limit or error blocks the writing and maintains the provenance.
    for (const item of scanRetainedClaude(root)) {
      const file = item.path;
      if (item.reason === 'claude-scan-incomplete') {
        remember(file, item.reason); conflicts.add(file); protectedConflicts.add(file); continue;
      }
      if (item.reason !== 'claude-activation-unverified') {
        remember(file, item.reason); claudeScopeBoundaries.add(file); continue;
      }
      if (expected.has(file) || retiredClaude.has(file)) continue;
      if (!ownedPaths.has(file)) {
        const info = stat(safe(file));
        if (!info?.isFile() || info.size > 1024 * 1024) { claudeScopeBoundaries.add(file); continue; }
        const text = read(safe(file));
        if (!resemblesClaudeReference(file, text)) {
          if (mayReferenceClaudeRule(file, text)) { remember(file, 'claude-scope-unverified'); claudeScopeBoundaries.add(file); }
          continue;
        }
      }
      // Hash doesn't prove that it does, so, ACL or xattrs haven't changed.
      protectedClaudeStale.add(file); remember(file, 'claude-metadata-unverified');
      conflicts.add(file); protectedConflicts.add(file);
    }
  }
  for (const agent of agents.keys()) {
    for (const kind of [...auxiliary, 'README.md', 'INSTRUCTIONS.md']) cleanScope(`${agent}/${kind}`);
    for (const kind of Object.keys(principals)) {
      const scope = `${agent}/${kind}`;
      if (preserveBoundary(scope)) continue;
      const info = stat(safe(scope));
      if (!info) continue;
      const files = scan(scope, { prune: true });
      if (!info.isDirectory()) { if (claimed(scope)) { if (force) planRemove(scope, true); else conflicts.add(scope); } else remember(scope); continue; }
      for (const file of files) if (!expected.has(file)) {
        if (priorBlocks[file]) continue;
        if (referenceFile(file)) planRemove(file);
        else if (claimed(file)) remember(file, 'edited-generated-file');
        else remember(file);
      }
      function directories(value) {
        for (const name of readdirSync(safe(value))) {
          const child = `${value}/${name}`;
          if (preserveBoundary(child)) continue;
          if (!stat(safe(child))?.isDirectory()) continue;
          if (isGeneratedOutput(child, true)) continue;
          if (![...expected.keys()].some(target => target.startsWith(child + '/'))) cleanScope(child);
          directories(child);
        }
      }
      directories(scope);
    }
    for (const file of scan(agent, { markdownOnly: true, prune: true })) {
      if (protectedPath(file) || expected.has(file) || priorBlocks[file] || !read(absolute(file)).includes(marker)) continue;
      if (referenceFile(file)) planRemove(file);
      else remember(file, 'edited-generated-file');
    }
  }
  for (const { target } of missing) cleanScope(target);
  const { rootEntries, nextEntries } = planEntrypointOutputs({
    manifest, generateEntrypoints, installed, previousEntries, previousOutputs, priorBlocks,
    safe, absolute, root, preserveBoundary, preserveNativeType, captureInput, remember,
    remove, managedBlocks,
  });
  for (const [target, digest] of Object.entries(priorBlocks)) {
    if (!(validResourcePath(target) || canonicalEntrypoint(target))) continue;
    if (unknownRemovedFiles.has(target)) {
      // Preserve the original overlay separately; it is not a newly managed
      // block and must not clear an existing removedBlocks entry.
      remember(target, 'removed-file-unverified'); continue;
    }
    if (managedBlocks[target]) continue;
    if (canonicalEntrypoint(target) && Object.keys(managedBlocks).some(path => canonicalEntrypoint(path) === canonicalEntrypoint(target))) { removedBlocks.add(target); continue; }
    if (!generateEntrypoints && canonicalEntrypoint(target)) { managedBlocks[target] = digest; continue; }
    if (generatedFiles[target] || nextEntries[target]) { removedBlocks.add(target); continue; }
    if (expected.has(target) || rootEntries.has(target) || preserveBoundary(target)) continue;
    const info = stat(safe(target));
    if (!info) continue;
    if (!info.isFile()) fail(`Tipo alterado em caminho gerenciado: ${target}`);
    const current = readFileSync(absolute(target));
    const content = target.endsWith('.toml') ? stripTomlContent(current, digest) : stripManagedContent(current, digest);
    captureInput(target, current);
    expected.set(target, content);
    if (readFileSync(absolute(target), 'utf8') !== content) changed.push(target);
    retiredBlocks.add(target);
    removedBlocks.add(target);
    remember(target, 'existing-file-extended');
  }
  const omittedRows = new Set([...legacy, ...missing.map(native => native.index)]);
  const finalConfig = rows.filter((row, index) => !omittedRows.has(index)).join('\n').replace(/\n*$/, '\n');
  const configChanged = !configExists || configText !== finalConfig;
  const configHash = configExists ? createHash('sha256').update(readFileSync(absolute(config))).digest('hex') : null;
  const configKnown = configExists && [installed?.files?.[config], previousEntries.config].some(hash => hash && hash === configHash);
  if (configExists && !configKnown) {
    remember(config, 'existing-configuration');
    if (configChanged) { conflicts.add(config); protectedConflicts.add(config); }
  }
  const next = { schemaVersion: 1, entries: nextEntries };
  if (Object.keys(discoveryOutputs).length) next.outputs = discoveryOutputs;
  if (Object.keys(catalogOutputs).length) next.catalogs = catalogOutputs;
  const nextConfigHash = createHash('sha256').update(finalConfig).digest('hex');
  if ((!configExists || configKnown) && installed?.files?.[config] !== nextConfigHash) next.config = nextConfigHash;
  if (Object.keys(generatedFiles).length) next.files = generatedFiles;
  const derivedBlocks = Object.fromEntries(Object.entries(managedBlocks).filter(([path, hash]) => installed?.blocks?.[path] !== hash || Object.hasOwn(previousEntries.blocks ?? {}, path)));
  for (const [path, digest] of Object.entries(previousEntries.blocks ?? {})) {
    if (unknownRemovedFiles.has(path)) derivedBlocks[path] = digest;
  }
  if (Object.keys(derivedBlocks).length) next.blocks = derivedBlocks;
  for (const path of Object.keys(managedBlocks)) removedBlocks.delete(path);
  if (removedBlocks.size) next.removedBlocks = sorted(removedBlocks);
  for (const path of expected.keys()) if (!preservedHumanFiles.has(path)) delete effectiveRemovedFiles[path];
  for (const path of remove) if (validResourcePath(path) && installed?.files?.[path] && !expected.has(path)) effectiveRemovedFiles[path] = installed.files[path];
  if (Object.keys(effectiveRemovedFiles).length) next.removedFiles = Object.fromEntries(Object.entries(effectiveRemovedFiles).sort(([a], [b]) => compare(a, b)));
  const registryContent = derivedContent(registryBytes, previousEntries, next);
  if (recordDerivedState && (Object.keys(nextEntries).length || Object.keys(discoveryOutputs).length || Object.keys(catalogOutputs).length || next.config || Object.keys(generatedFiles).length || Object.keys(derivedBlocks).length || removedBlocks.size || Object.keys(effectiveRemovedFiles).length || stat(safe(entryRegistry))) && (!stat(safe(entryRegistry)) || readFileSync(absolute(entryRegistry), 'utf8') !== registryContent)) registries.set(entryRegistry, registryContent);
  const ownedOutputs = sorted([...targets, ...built.outputs.keys(), '.pbai4devs/espelhos.conf', ...rootEntries.keys(), ...(recordDerivedState && (stat(safe(entryRegistry)) || registries.has(entryRegistry)) ? [entryRegistry] : []),
    ...[...discoveries].flatMap(agent => ['skills', 'rules', 'agents'].map(kind => `${agent}/${kind}.json`)),
    ...[...ignoreTemplates.keys()].filter(target => {
      if (target === '.pbai4devs/.gitignore') return false;
      if (preserved.has(target) || preserveBoundary(target)) return false;
      const content = ignoreFiles.get(target) ?? readFileSync(absolute(target), 'utf8');
      const start = content.indexOf(ignoreBegin), finish = content.indexOf(ignoreEnd);
      return start >= 0 && finish > start && !(content.slice(0, start) + content.slice(finish + ignoreEnd.length)).trim();
    }),
  ]).filter(path => !managedBlocks[path] && !retiredBlocks.has(path) && ![...preserved.keys()].some(value => path === value || path.startsWith(`${value}/`)));
  const localPlan = localIgnores ? planLocalIgnore(root, { outputs: ownedOutputs }) : null;
  const localStatus = localPlan ? checkLocalIgnore(localPlan) : { changed: 0, missing: [], trackedOutputs: [] };
  const {
    logicalOperations, removals, backups, backupCandidate, rootEntryChanges,
    affectedBefore, affectedHashes, affectedIndex, hadGit, snapshot,
  } = planSyncOperations({
    root, workspace, check, remove, backup, rootEntries,
    writes: [...changed.map(path => [path, expected.get(path)]), ...registries, ...ignoreFiles],
    manifestWrite: configChanged ? [config, finalConfig] : null,
    conflicts, protectedConflicts, remember,
  });
  const summary = { changed: changed.length + rootEntryChanges.length, stale: removals.length, conflicts: conflicts.size, missing: missing.length, legacy: legacy.length, registries: registries.size, gitignores: ignoreFiles.size, manifests: configExists ? 0 : 1, localIgnores: localStatus.changed + localStatus.missing.length + localStatus.trackedOutputs.length + (localStatus.pending?.filter(isBlockingLocalIgnore).length || 0) + (localStatus.status === 'no-git' ? 1 : 0) };
  const retainedClaudeRules = agents.has('.claude') ? [] : scanRetainedClaude(root);
  // Any obstruction in rules can hide instructions, even without omissions.
  const activeClaudeBoundaries = agents.has('.claude') ? [...preserved].filter(([path, item]) =>
    (path === '.claude' || path === '.claude/rules' || path.startsWith('.claude/rules/'))
      && ['symbolic-link', 'non-directory', 'non-file'].includes(item.reason)) : [];
  const dirty = Object.values(summary).some(Boolean) || unverifiedRemovals.length > 0 || retainedClaudeRules.length > 0 || claudeScopeBoundaries.size > 0 || activeClaudeBoundaries.length > 0;
  if (retainedClaudeRules.length || claudeScopeBoundaries.size || activeClaudeBoundaries.length) output('Escopo Claude nao verificado: regras preservadas podem continuar ativas globalmente; revise-as.');
  output(`${summary.changed} desatualizadas; ${summary.stale} obsoletas; ${summary.conflicts} conflitos; ${summary.missing} origens nativas ausentes; ${summary.legacy} documentos antigos; ${summary.registries} indices derivados; ${summary.gitignores} gitignores; ${summary.localIgnores} exclusoes locais.`);
  const conflictPaths = sorted(conflicts);
  if (conflictPaths.length) {
    output(`Conflitos preservados: ${conflictPaths.slice(0, 10).map(path => JSON.stringify(path)).join(', ')}${conflictPaths.length > 10 ? ` (+${conflictPaths.length - 10})` : ''}`);
  }
  if (localPlan?.worktreeScope) output('Apontamentos, artefatos e dados privados podem ficar visíveis. Confira o status antes de adicionar arquivos. Regras antigas podem afetar outras worktrees.');
  const pending = localStatus.pending || [];
  const displayedPending = [...pending.filter(isBlockingLocalIgnore), ...pending.filter(item => !isBlockingLocalIgnore(item))];
  for (const item of displayedPending.slice(0, 12)) output(`${isBlockingLocalIgnore(item) ? 'Pendente' : 'Aviso'}: ${item.code}: ${item.path}`);
  if (pending.length > 12) output(`+${pending.length - 12}; use agentdevkit sync --check --json para detalhes.`);
  assertFallbackChecks();
  if (localStatus.status === 'no-git') output('Git indisponivel ou nao inicializado: apos instalar e iniciar Git, execute sync --check para verificar arquivos visiveis.');
  const preservedPaths = sorted(preserved.keys()).map(path => preserved.get(path));
  const lineEndingConflicts = preservedPaths.filter(item => item.reason === 'line-ending-diverged').map(item => item.path);
  if (lineEndingConflicts.length) output(`Finais de linha divergentes preservados; revise antes de sincronizar: ${lineEndingConflicts.slice(0, 10).map(path => JSON.stringify(path)).join(', ')}${lineEndingConflicts.length > 10 ? ` (+${lineEndingConflicts.length - 10})` : ''}`);
  const claudeRetiredTargets = [...omittedClaude.entries()].map(([target, item]) => ({ target, source: item.source, trigger: item.trigger }));
  // Um alvo legado preservado pode continuar sendo carregado globalmente.
  // An omission describes the plan, does not prove the active status of the client.
  const claudeScopeConflicted = claudeScopeBoundaries.size > 0 || activeClaudeBoundaries.length > 0 || [...conflicts].some(path => path.startsWith('.claude/rules/'));
  const scopeOmissions = [...omittedClaude.entries()]
    .filter(([, item]) => ![...entries].some(([target, entry]) => target.startsWith('.claude/rules/') && entry.source === item.source))
    .map(([target, item]) => ({ target, source: item.source, trigger: item.trigger, status: claudeScopeConflicted ? 'activation-unverified' : 'explicit-reference-planned' }));
  if (scopeOmissions.length) output(claudeScopeConflicted
    ? 'Escopo Claude nao verificado: arquivos preservados podem continuar ativos globalmente; revise as regras e o escopo.'
    : `Plano Claude sem nova ativacao automatica: ${scopeOmissions.map(item => item.source).join(', ')}. Leia as fontes explicitamente; outras regras podem estar ativas e a equivalencia de escopo nao foi comprovada.`);
  const copilotCollisions = preservedPaths.filter(item => item.reason === 'copilot-scope-preserved').map(item => item.path);
  if (copilotCollisions.length) output(`Escopo Copilot humano diferente ou ambiguo; arquivos preservados para revisao: ${copilotCollisions.join(', ')}`);
  const zcodeCollisions = preservedPaths.filter(item => item.reason === 'zcode-agent-preserved').map(item => item.path);
  if (zcodeCollisions.length) output(`Perfis ZCode do projeto preservados (${zcodeCollisions.slice(0, 10).map(path => JSON.stringify(path)).join(', ')}${zcodeCollisions.length > 10 ? ` e mais ${zcodeCollisions.length - 10}` : ''}).`);
  if (check) {
    const { hardlinkBlockers, hardlinkUnverified, aclBlockers, xattrBlockers, xattrUnverified, ownerBlockers } = inspectSyncMetadata(logicalOperations, safe, output);
    return {
      ...summary, hardlinkBlockers: sorted(hardlinkBlockers), hardlinkUnverified: sorted(hardlinkUnverified), aclBlockers, ownerBlockers, xattrBlockers: sorted(xattrBlockers), xattrUnverified: sorted(xattrUnverified), conflictPaths, ownedOutputs, managedBlocks, preserved: preservedPaths, scopeOmissions, claudeRetiredTargets, retainedClaudeRules, unverifiedRemovals, exitCode: dirty || hardlinkBlockers.length || hardlinkUnverified.length || aclBlockers.length || ownerBlockers.length || xattrBlockers.length ? 1 : 0,
      ...(inspectEffects ? { logicalEffects: {
        completeness: 'incomplete', mutationAuthorized: false,
        exclusions: ['temporary-files', 'backups', 'rollback', 'conditional-directory-changes', 'local-ignore', 'external-callbacks'],
        operations: logicalOperations.map(({ path, action, parents }) => ({ path, action,
          ...(affectedBefore.has(path) ? { beforeHash: affectedBefore.get(path) } : { beforeHashStatus: 'unsupported' }),
          ...(parents ? { parents: [...parents] } : {}) })),
      } } : {}),
    };
  }
  if (affectedIndex.gitlinkConflicts?.length) fail(`Backup em submódulo Git; arquivos preservados: ${affectedIndex.gitlinkConflicts.join(', ')}`);
  if (omittedStagedConflicts.length) fail(`Indice Git contem alteracoes proprias; arquivos preservados: ${sorted(omittedStagedConflicts).join(', ')}`);
  if (affectedIndex.conflicts.length) fail(`Indice Git contem alteracoes proprias; arquivos preservados: ${sorted(affectedIndex.conflicts).join(', ')}`);
  if (affectedIndex.paths.some(path => removals.includes(path))) fail(`Arquivo obsoleto rastreado no indice Git; remocao bloqueada: ${affectedIndex.paths.filter(path => removals.includes(path)).join(', ')}`);
  if (protectedConflicts.size) {
    const prefix = [...protectedConflicts].some(path => unknownRemovedFiles.has(path))
      ? 'Conteudo preservado ou historico de remocao pendente; revise antes de sincronizar'
      : 'Conteudo proprio preservado; resolva a colisao antes de sincronizar';
    fail(`${prefix}: ${sorted(protectedConflicts).join(', ')}`);
  }
  if (conflicts.size) fail(`Use --force para reconstruir somente os caminhos gerenciados: ${sorted(conflicts).join(', ')}`);
  if (localStatus.missing.length) fail(`Regras humanas reabrem derivados locais: ${localStatus.missing.join(', ')}`);
  if (localPlan) assertLocalIgnoreUnchanged(localPlan);
  const backupRoot = applySynchronization({
    root, absolute, safe, stageHandle, output, localPlan, logicalOperations, removals,
    backupCandidate, backups, firstFileStats, affectedHashes, affectedBefore, affectedIndex, hadGit,
    snapshot, beginMutation,
    assertFallbackChecks, assertClaudeMigrationInputs, migratedClaude, claudeRuleInputs,
    retiredClaude,
  });
  return { ...summary, ownedOutputs, managedBlocks, preserved: preservedPaths, scopeOmissions, claudeRetiredTargets, retainedClaudeRules, exitCode: 0,
    ...(backupRoot ? { backupRoot } : {}), ...(privateStage ? { claudeRuleInputs } : {}) };
}
