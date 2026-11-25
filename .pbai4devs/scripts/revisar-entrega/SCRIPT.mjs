#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isMain, projectRoot, requireNode } from '../lib/runtime.mjs';

const fail = message => { throw new Error(message); };
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const portable = value => value.split(sep).join('/');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const completed = value => nonempty(value) && !/^(?:a definir|pendente|pending|todo|tbd|\.\.\.)[.!]?$/i.test(value.trim());
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const decodeGit = data => {
  try { return data ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data) : ''; }
  catch { fail('Caminho ou saida Git nao e UTF-8 valido.'); }
};

function pathInRoot(root, input) {
  if (!nonempty(input) || !input.isWellFormed() || /[\0\r\n]/.test(input)) fail('Caminho invalido.');
  const name = portable(relative(root, resolve(root, input)));
  if (!name || name === '..' || name.startsWith('../') || isAbsolute(name) || name.split('/').some(part => part.toLowerCase() === '.git')) fail(`Caminho fora do escopo: ${input}`);
  let current = root;
  for (const part of name.split('/')) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) fail(`Link simbolico nao permitido: ${name}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return name;
}

function git(root, args, allowFailure = false, input) {
  const raw = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: root, input, timeout: 15000, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' } });
  const result = { ...raw, stdout: decodeGit(raw.stdout), stderr: raw.stderr?.toString('utf8') || '' };
  if ((result.error || result.status !== 0) && !allowFailure) fail(`Git: ${result.error?.message || result.stderr?.trim() || 'operacao falhou'}`);
  return result;
}

function indexStatEqual(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

// Inspect the index without asking Git to load it: loading a split index can
// touch sharedindex metadata even when optional locks are disabled.
function inspectIndex(root) {
  const split = git(root, ['config', '--bool', '--get', 'core.splitIndex'], true);
  if (split.error || ![0, 1].includes(split.status) || (split.status === 0 && !['true', 'false'].includes(split.stdout.trim()))) fail('Nao foi possivel verificar split-index Git.');
  if (split.status === 0 && split.stdout.trim() === 'true') fail('Split-index Git nao suportado para revisao; preserve a configuracao e consulte o responsavel.');
  const name = git(root, ['rev-parse', '--git-path', 'index']).stdout.replace(/\r?\n$/, '');
  if (!name || /[\0\r\n]/.test(name)) fail('Caminho do indice Git nao suportado.');
  const path = resolve(root, name);
  let before;
  try { before = lstatSync(path, { bigint: true }); } catch (error) { if (error.code === 'ENOENT') return { path, missing: true }; throw error; }
  if (!before.isFile() || before.isSymbolicLink() || before.ino === 0n || before.size > 134217728n) fail('Indice Git nao e arquivo regular suportado.');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let data, after;
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !indexStatEqual(before, opened)) fail('Indice Git mudou antes da leitura.');
    data = readFileSync(fd);
    const finished = fstatSync(fd, { bigint: true }); after = lstatSync(path, { bigint: true });
    if (!indexStatEqual(opened, finished) || !indexStatEqual(finished, after) || BigInt(data.length) !== before.size) fail('Indice Git mudou durante a leitura.');
  } finally { closeSync(fd); }
  if (data.length < 32 || data.toString('ascii', 0, 4) !== 'DIRC') fail('Indice Git invalido.');
  const hashes = [['sha1', 20], ['sha256', 32]].filter(([algo, size]) => data.length >= size + 12 && createHash(algo).update(data.subarray(0, -size)).digest().equals(data.subarray(-size)));
  if (hashes.length !== 1) fail('Checksum ou formato do indice Git nao comprovado.');
  const objectSize = hashes[0][1], end = data.length - objectSize, version = data.readUInt32BE(4), count = data.readUInt32BE(8);
  if (![2, 3, 4].includes(version)) fail('Versao do indice Git nao suportada.');
  let offset = 12, submodule = false, hidden = false, sparse = false;
  for (let i = 0; i < count; i++) {
    const start = offset, fixed = 42 + objectSize;
    if (start + fixed > end) fail('Entrada do indice Git truncada.');
    const mode = data.readUInt32BE(start + 24), flags = data.readUInt16BE(start + 40 + objectSize);
    if ((mode & 0o170000) === 0o160000) submodule = true;
    if ((mode & 0o170000) === 0o040000) sparse = true;
    if (flags & 0x8000) hidden = true;
    offset = start + fixed;
    if (flags & 0x4000) {
      if (version < 3 || offset + 2 > end) fail('Entrada estendida do indice Git invalida.');
      if (data.readUInt16BE(offset) & 0x4000) hidden = true;
      offset += 2;
    }
    if (version === 4) {
      let size = 0, byte;
      do { if (offset >= end || ++size > 10) fail('Caminho comprimido do indice Git invalido.'); byte = data[offset++]; } while (byte & 0x80);
    }
    const nul = data.indexOf(0, offset);
    if (nul < offset || nul >= end) fail('Caminho do indice Git truncado.');
    offset = version === 4 ? nul + 1 : start + Math.ceil((nul + 1 - start) / 8) * 8;
    if (offset > end || (version !== 4 && data.subarray(nul, offset).some(byte => byte !== 0))) fail('Entrada do indice Git invalida.');
  }
  while (offset < end) {
    if (offset + 8 > end) fail('Extensao do indice Git truncada.');
    const signature = data.toString('ascii', offset, offset + 4), size = data.readUInt32BE(offset + 4);
    if (signature === 'link') fail('Split-index Git nao suportado para revisao; preserve a configuracao e consulte o responsavel.');
    if (signature === 'sdir') sparse = true;
    offset += 8 + size;
    if (offset > end) fail('Extensao do indice Git truncada.');
  }
  return { path, stat: after, hash: createHash('sha256').update(data).digest('hex'), submodule, hidden, sparse };
}

function repository(root) {
  if (Object.entries(process.env).some(([key, value]) => key.toUpperCase().startsWith('GIT_TRACE') && value && value !== '0')) fail('Variaveis GIT_TRACE ativas nao sao suportadas na revisao.');
  if (Object.entries(process.env).some(([key, value]) => key.toUpperCase().startsWith('GIT_TEST_') && value)) fail('Variaveis GIT_TEST_ nao sao suportadas na revisao.');
  const canonical = realpathSync(root);
  const top = git(canonical, ['rev-parse', '--show-toplevel']).stdout.trim();
  if (realpathSync(top) !== canonical) fail('Use a raiz do repositorio.');
  requireCompleteObjects(canonical, 'revisao de entrega');
  inspectIndex(canonical);
  return canonical;
}

function head(root) {
  const result = git(root, ['rev-parse', '--verify', 'HEAD'], true);
  return result.status === 0 ? result.stdout.trim() : null;
}

function ignored(root, file) {
  return git(root, ['check-ignore', '--no-index', '-q', '--', file], true).status === 0;
}

function tracked(root, file) {
  return git(root, ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', file], true).status === 0;
}

function ignoredPaths(root, files) {
  if (!files.length) return new Set();
  const raw = spawnSync('git', ['-c', 'core.fsmonitor=false', 'check-ignore', '--no-index', '--stdin', '-z'], { cwd: root, input: Buffer.from(files.join('\0') + '\0'), timeout: 15000, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' } });
  const result = { ...raw, stdout: decodeGit(raw.stdout), stderr: raw.stderr?.toString('utf8') || '' };
  if (result.error || ![0, 1].includes(result.status)) fail(`Git: ${result.error?.message || result.stderr?.trim() || 'falha ao conferir ignores'}`);
  return new Set(result.stdout.split('\0').filter(Boolean));
}

function stagedDeletions(root) {
  return new Set(git(root, ['diff', '--cached', '--diff-filter=D', '--no-renames', '--ignore-submodules=none', '--name-only', '-z', '--']).stdout.split('\0').filter(Boolean));
}

function ensureNoAppliedFilters(root, indexed) {
  const configured = git(root, ['config', '--get-regexp', '^filter\\.'], true);
  if (configured.error || ![0, 1].includes(configured.status)) fail('Nao foi possivel verificar filtros Git.');
  if (configured.status !== 0 || !indexed) return;
  const paths = new Set(indexed.split('\0').filter(Boolean));
  const result = git(root, ['check-attr', '-z', '--stdin', '--all'], false, Buffer.from(indexed));
  const fields = result.stdout.split('\0');
  if (fields.pop() !== '' || fields.length % 3) fail('Resposta ambigua dos atributos Git.');
  for (let i = 0; i < fields.length; i += 3) {
    if (!paths.has(fields[i])) fail('Caminho inesperado nos atributos Git.');
    if (fields[i + 1] === 'filter') fail('Coleta automatica nao suporta filtro Git aplicado; use --scope para revisar caminhos especificos.');
  }
}

function changedFiles(root) {
  const before = inspectIndex(root);
  if (before.submodule || before.sparse || before.hidden) fail('Coleta automatica nao suporta submodulo, sparse-index ou flags que ocultam alteracoes; use --scope.');
  const indexed = git(root, ['ls-files', '-z']).stdout;
  ensureNoAppliedFilters(root, indexed);
  const status = git(root, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--ignore-submodules=none']).stdout;
  const entries = status.split('\0');
  if (entries.pop() !== '') fail('Status Git incompleto.');
  const names = entries.map(entry => {
    if (entry.length < 4 || entry[2] !== ' ' || !/^[ MADRCUT?!]{2}$/.test(entry.slice(0, 2)) || entry.slice(0, 2) === '!!') fail('Status Git ambiguo.');
    return entry.slice(3);
  });
  const after = inspectIndex(root);
  if (before.path !== after.path || !!before.missing !== !!after.missing || (!before.missing && (!indexStatEqual(before.stat, after.stat) || before.hash !== after.hash))) fail('Indice Git mudou durante a coleta; resultado descartado.');
  return [...new Set(names)].sort();
}

function snapshot(root, mode, paths, documents = [], spec = null) {
  const names = mode === 'git' ? [...changedFiles(root), ...paths] : paths;
  const selected = [...new Set(names.map(file => pathInRoot(root, file)))].sort();
  const deleted = stagedDeletions(root), local = ignoredPaths(root, selected);
  const files = selected.map(path => {
    if (path.toLowerCase().startsWith('.agent-tests/')) fail('Artefatos nao fazem parte do escopo versionado.');
    const absolute = join(root, path);
    if (!existsSync(absolute)) return { path, sha256: null };
    if (!lstatSync(absolute).isFile()) fail(`Escopo exige arquivos: ${path}`);
    return { path, sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex'), ...(deleted.has(path) && local.has(path) ? { indexAction: 'untrack' } : {}) };
  });
  if (!files.length) fail('Nenhuma alteracao para revisar; indique --scope para uma revisao especifica.');
  return { mode, head: head(root), files, documents, spec };
}

export function specCriteria(text) {
  const section = text.match(/^## (?:Crit[eé]rios de aceite|Acceptance criteria)\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/im)?.[1];
  const ids = [...new Set((section || '').match(/\bAC-\d{3,}\b/g) || [])];
  if (!ids.length) fail('A spec deve definir criterios AC-001, AC-002... na secao Criterios de aceite.');
  return ids;
}

function expectedDocuments(root, state, extra = []) {
  const existing = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'SECURITY.md'].filter(file => existsSync(join(root, file)));
  const changed = state.files.filter(file => /\.mdc?$/i.test(file.path)).map(file => file.path);
  const candidates = [...new Set([...existing, ...changed].map(file => pathInRoot(root, file)))];
  const local = ignoredPaths(root, candidates);
  const versioned = new Set(git(root, ['ls-files', '-z']).stdout.split('\0').filter(Boolean));
  return [...new Set([...candidates.filter(file => !local.has(file) || versioned.has(file)), ...extra.map(file => pathInRoot(root, file))])].sort();
}

function requireCompleteObjects(root, operation) {
  const partial = git(root, ['config', '--get-regexp', '^(extensions\\.partialclone|remote\\..*\\.promisor)$'], true);
  if (partial.error || ![0, 1].includes(partial.status)) fail('Nao foi possivel verificar clone parcial.');
  if (partial.status === 0) fail(`Clone parcial ou remote promisor nao suportado para ${operation}.`);
}

function stagedBlobDigest(root, object, path) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(object)) fail(`Objeto preparado invalido: ${path}`);
  const blob = spawnSync('git', ['-c', 'core.fsmonitor=false', 'cat-file', 'blob', object], { cwd: root, timeout: 15000, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' } });
  if (blob.error || blob.status !== 0 || !blob.stdout) fail(`Blob preparado indisponivel ou muito grande: ${path}`);
  return createHash('sha256').update(blob.stdout).digest('hex');
}

function checkIndex(root, state) {
  const staged = new Set(git(root, ['diff', '--cached', '--name-only', '-z', '--no-renames', '--ignore-submodules=none', '--']).stdout.split('\0').filter(Boolean));
  const deleted = stagedDeletions(root);
  const indexed = new Set(git(root, ['ls-files', '-z']).stdout.split('\0').filter(Boolean));
  const local = ignoredPaths(root, state.files.filter(file => file.indexAction === 'untrack').map(file => file.path));
  let checkedObjects = false;
  for (const file of state.files) {
    if (file.indexAction === 'untrack') {
      if (!staged.has(file.path) || !deleted.has(file.path) || indexed.has(file.path) || file.sha256 === null || !existsSync(join(root, file.path)) || !local.has(file.path)) fail(`Acao de desindexacao mudou: ${file.path}`);
      continue;
    }
    if (file.indexAction !== undefined) fail(`Acao de indice invalida: ${file.path}`);
    if (!staged.has(file.path)) continue;
    // Diff can hide mismatches behind index flags or a clean filter. Compare
    // the raw staged blob to the reviewed bytes without running either.
    const flags = git(root, ['--literal-pathspecs', 'ls-files', '-v', '--stage', '-z', '--', file.path]).stdout.split('\0').filter(Boolean);
    if (flags.length !== (indexed.has(file.path) ? 1 : 0)) fail(`Flags do indice Git ambiguas: ${file.path}`);
    const deletedButPresent = !indexed.has(file.path) && file.sha256 !== null;
    if (deletedButPresent) fail(`Indice Git difere do arquivo testado: ${file.path}`);
    if (!flags.length) continue;
    const match = /^([A-Za-z]) (\d{6}) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/.exec(flags[0]);
    if (!match || match[5] !== file.path || match[4] !== '0') fail(`Flags do indice Git ambiguas: ${file.path}`);
    if (match[1] === 'S' || /^[a-z]$/.test(match[1])) fail(`Arquivo preparado usa assume-unchanged ou skip-worktree: ${file.path}`);
    if (!['100644', '100755'].includes(match[2])) fail(`Tipo de arquivo preparado nao comprovado: ${file.path}`);
    if (!checkedObjects) { requireCompleteObjects(root, 'revisao de indice'); checkedObjects = true; }
    if (stagedBlobDigest(root, match[3], file.path) !== file.sha256) fail(`Indice Git difere dos bytes testados: ${file.path} (confira filtros e CRLF).`);
  }
}

function artifact(root, file, prefix, mustExist) {
  const path = pathInRoot(root, file);
  if (!path.startsWith(prefix + '/')) fail(`Evidencia deve ficar em ${prefix}/: ${path}`);
  if (!ignored(root, path) || tracked(root, path)) fail(`Artefato deve estar ignorado e fora do indice Git: ${path}`);
  if (mustExist && (!existsSync(join(root, path)) || !lstatSync(join(root, path)).isFile() || lstatSync(join(root, path)).size === 0)) fail(`Evidencia ausente ou vazia: ${path}`);
  return path;
}

export function prepareReview({ root = projectRoot, id, execution = new Date().toISOString().replace(/[^a-z0-9]/gi, '').toLowerCase(), spec = null, scope = [], documents = [], output } = {}) {
  requireNode(); root = repository(root);
  if (!slug.test(id || '') || !slug.test(execution)) fail('Use referencia e execucao como slugs em minusculas.');
  const reference = spec ? pathInRoot(root, spec) : null;
  if (reference && ignored(root, reference) && !tracked(root, reference)) fail('A spec deve ser um documento versionavel, fora dos artefatos ignorados.');
  const criteria = reference ? specCriteria(readFileSync(join(root, reference), 'utf8')) : ['AC-001'];
  let state = snapshot(root, scope.length ? 'scope' : 'git', [...scope, ...(reference ? [reference] : [])]);
  const requiredDocs = expectedDocuments(root, state, documents);
  const localDocuments = ignoredPaths(root, requiredDocs);
  for (const file of requiredDocs) if (localDocuments.has(file) && !tracked(root, file)) fail(`Documento deve ser versionavel: ${file}`);
  state = snapshot(root, scope.length ? 'scope' : 'git', [...state.files.map(file => file.path), ...requiredDocs], requiredDocs, reference);
  const prefix = `.agent-tests/${id}/${execution}`;
  const file = artifact(root, output || `${prefix}/revisao.json`, prefix, false);
  const baselineFile = artifact(root, `${prefix}/baseline.json`, prefix, false);
  if (existsSync(join(root, file)) || existsSync(join(root, baselineFile))) fail(`Relatorio ja existe; preserve-o e use outra execucao: ${file}`);
  const baseline = { version: 1, reference: id, execution, spec: reference, snapshot: state, criteria };
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, baselineFile), JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx' });
  const report = {
    version: 1, reference: id, execution, spec: reference, snapshot: state,
    baseline: { file: baselineFile, sha256: digest(join(root, baselineFile)) },
    documentation: expectedDocuments(root, state, documents).map(path => ({ path, decision: 'pending', reason: '' })),
    validation: criteria.map(criterion => ({ criterion, method: '', prerequisite: '', assertion: '', evidence: [], status: 'pending' })),
    review: { status: 'pending', reviewer: '', findings: [] },
  };
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return { file, report };
}

function readReviewJson(file, label) {
  const text = readFileSync(file, 'utf8');
  try { return JSON.parse(text); }
  catch { throw new SyntaxError(`JSON invalido: ${label}.`); }
}

function validateReview(file, { root = projectRoot, requireSeal = true } = {}) {
  requireNode(); root = repository(root);
  const reportPath = pathInRoot(root, file);
  const report = readReviewJson(join(root, reportPath), 'relatorio de revisao');
  if (report.version !== 1 || !slug.test(report.reference || '') || !slug.test(report.execution || '')) fail('Cabecalho de revisao invalido.');
  const prefix = `.agent-tests/${report.reference}/${report.execution}`;
  artifact(root, reportPath, prefix, true);
  const baselineFile = artifact(root, `${prefix}/baseline.json`, prefix, true);
  const baseline = readReviewJson(join(root, baselineFile), 'baseline de revisao');
  if (report.baseline?.file !== baselineFile || report.baseline.sha256 !== digest(join(root, baselineFile)) ||
      baseline.reference !== report.reference || baseline.execution !== report.execution || baseline.spec !== report.spec ||
      JSON.stringify(baseline.snapshot) !== JSON.stringify(report.snapshot)) fail('Baseline gerada diverge do relatorio; preserve os metadados e refaca o preparo.');
  const state = report.snapshot;
  if (!state || !['git', 'scope'].includes(state.mode) || !Array.isArray(state.files) || !Array.isArray(state.documents) || report.spec !== state.spec) fail('Snapshot ausente ou referencias alteradas.');
  const requiredDocs = state.documents.map(file => pathInRoot(root, file));
  const currentDocuments = expectedDocuments(root, state, requiredDocs);
  if (currentDocuments.some(path => !requiredDocs.includes(path) || !state.files.some(file => file.path === path))) {
    fail('Documentos obrigatorios mudaram depois do snapshot; refaca a revisao.');
  }
  const current = snapshot(root, state.mode, state.files.map(file => file.path), requiredDocs, state.spec);
  if (JSON.stringify(current) !== JSON.stringify(state)) fail('Arquivos ou HEAD mudaram depois do snapshot; refaca a revisao.');
  checkIndex(root, state);
  if (!Array.isArray(report.documentation) || !Array.isArray(report.validation)) fail('Documentacao e validacoes sao obrigatorias.');
  const docs = new Map();
  for (const item of report.documentation) {
    const path = pathInRoot(root, item.path);
    if (docs.has(path) || !['updated', 'no-impact', 'not-applicable'].includes(item.decision) || !completed(item.reason)) fail(`Decisao de documentacao pendente/invalida: ${path}`);
    if (item.decision !== 'not-applicable' && !existsSync(join(root, path))) fail(`Documento ausente: ${path}`);
    if (item.decision === 'not-applicable' && existsSync(join(root, path))) fail(`Documento existente exige decisao de impacto: ${path}`);
    docs.set(path, item);
  }
  for (const path of currentDocuments) if (!docs.has(path)) fail(`Documento sem revisao: ${path}`);
  const ids = new Set();
  const proofs = new Set();
  for (const item of report.validation) {
    if (!/^AC-\d{3,}$/.test(item.criterion || '') || ids.has(item.criterion)) fail('Criterio invalido ou duplicado.');
    ids.add(item.criterion);
    if (![item.method, item.prerequisite, item.assertion].every(completed)) fail(`Plano de validacao incompleto: ${item.criterion}`);
    if (item.status !== 'passed' || !Array.isArray(item.evidence) || !item.evidence.length) fail(`Criterio sem prova aprovada: ${item.criterion}`);
    for (const proof of item.evidence) proofs.add(artifact(root, proof, prefix, true));
  }
  if (!ids.size) fail('Nenhum criterio de aceite.');
  for (const id of baseline.criteria) if (!ids.has(id)) fail(`Criterio da spec sem resultado: ${id}`);
  if (report.review?.status !== 'approved' || !nonempty(report.review.reviewer) || !Array.isArray(report.review.findings)) fail('Revisao independente pendente.');
  if (report.review.findings.some(item => !nonempty(item.id) || !nonempty(item.description) || item.status !== 'resolved')) fail('Achados de revisao ainda abertos.');
  const seal = {
    reportHash: digest(join(root, reportPath)), baselineHash: digest(join(root, baselineFile)),
    evidence: [...proofs].sort().map(path => ({ path, sha256: digest(join(root, path)) })),
  };
  if (requireSeal) {
    if (!existsSync(join(root, prefix, 'seal.json'))) fail('Revisao nao selada; conclua a revisao independente e execute seal.');
    const sealPath = artifact(root, `${prefix}/seal.json`, prefix, true);
    const recorded = readReviewJson(join(root, sealPath), 'selo de revisao');
    if (JSON.stringify(recorded) !== JSON.stringify(seal)) fail('Relatorio, baseline ou evidencia alterados apos selar a revisao.');
  }
  return { root, prefix, seal, snapshot: state, result: { status: 'passed', reviewVerification: 'not-verified', report: reportPath, criteria: ids.size, documents: docs.size } };
}

export function checkReview(file, { root = projectRoot } = {}) { return validateReview(file, { root, requireSeal: true }).result; }

// A review may cover only part of a project. A commit includes the entire index,
// so every staged path must be covered by a sealed review before committing.
export function checkCommit(reports, { root = projectRoot } = {}) {
  requireNode(); root = repository(root);
  if (!Array.isArray(reports) || !reports.length) fail('Informe um ou mais relatorios selados, sem repeticao.');
  reports = reports.map(file => pathInRoot(root, file));
  if (new Set(reports).size !== reports.length) fail('Informe relatorios selados sem repeticao.');
  const baselineHead = head(root);
  const staged = () => git(root, ['diff', '--cached', '--raw', '-z', '--no-abbrev', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--']).stdout;
  const before = staged();
  if (!before) fail('Nenhuma alteracao preparada para commit.');
  const reviews = reports.map(file => validateReview(file, { root, requireSeal: true }));
  if (head(root) !== baselineHead || staged() !== before) fail('HEAD ou indice preparado mudou durante a verificacao.');
  const fields = before.split('\0');
  if (fields.pop() !== '' || fields.length % 2) fail('Diff preparado incompleto ou ambiguo.');
  const paths = new Map();
  for (let i = 0; i < fields.length; i += 2) {
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]+) ([a-f0-9]+) ([AMD])$/.exec(fields[i]);
    if (!match) fail('Tipo de alteracao preparada nao suportado.');
    const [, oldMode, newMode, , object, action] = match, path = pathInRoot(root, fields[i + 1]);
    const valid = action === 'A' ? oldMode === '000000' && newMode === '100644'
      : action === 'D' ? oldMode === '100644' && newMode === '000000'
        : oldMode === '100644' && newMode === '100644';
    if (!valid || paths.has(path) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(object)) fail(`Tipo ou modo preparado nao comprovado: ${path}`);
    paths.set(path, { action, object });
  }
  const covered = new Map(reviews.flatMap(review => review.snapshot.files.map(file => [file.path, file])));
  const missing = [...paths.keys()].filter(path => !covered.has(path));
  if (missing.length) fail(`Arquivos preparados sem revisao selada: ${missing.join(', ')}`);
  requireCompleteObjects(root, 'check-commit');
  for (const [path, entry] of paths) {
    if (entry.action === 'D') {
      const reviewed = covered.get(path);
      if (reviewed.sha256 !== null && reviewed.indexAction !== 'untrack') fail(`Exclusao preparada difere do arquivo revisado: ${path}`);
      continue;
    }
    if (stagedBlobDigest(root, entry.object, path) !== covered.get(path).sha256) fail(`Blob preparado difere dos bytes revisados: ${path}`);
  }
  for (const file of reports) validateReview(file, { root, requireSeal: true });
  if (head(root) !== baselineHead || staged() !== before) fail('HEAD ou indice preparado mudou durante a verificacao.');
  return { status: 'passed', reviewVerification: 'not-verified', head: baselineHead, reports: reports.length, staged: paths.size, stagedSha256: createHash('sha256').update(before).digest('hex') };
}

// This deliberately permits only a fast-forward and regular non-executable
// files. Existing review snapshots do not record modes or merge results.
export function checkMerge(reports, destination, { root = projectRoot } = {}) {
  requireNode(); root = repository(root);
  if (!Array.isArray(reports) || !reports.length) fail('Informe um ou mais relatorios selados, sem repeticao.');
  reports = reports.map(file => pathInRoot(root, file));
  if (new Set(reports).size !== reports.length) fail('Informe relatorios selados sem repeticao.');
  if (typeof destination !== 'string' || !destination.startsWith('refs/heads/') || git(root, ['check-ref-format', destination], true).status !== 0) fail('Destino deve ser uma branch local completa: refs/heads/<nome>.');
  const currentBranch = git(root, ['symbolic-ref', '--quiet', 'HEAD'], true);
  if (currentBranch.status !== 0) fail('Confira a branch de origem; HEAD destacado nao e aceito.');
  const sourceRef = currentBranch.stdout.trim();
  if (!sourceRef.startsWith('refs/heads/') || git(root, ['check-ref-format', sourceRef], true).status !== 0) fail('A origem deve ser uma branch local valida.');
  if (sourceRef === destination) fail('Origem e destino devem ser branches distintas.');
  for (const ref of [sourceRef, destination]) if (git(root, ['symbolic-ref', '--quiet', ref], true).status === 0) fail(`Branch simbolica nao e aceita: ${ref}`);
  const resolveCommit = ref => {
    const out = git(root, ['rev-parse', '--verify', `${ref}^{commit}`], true);
    const value = out.stdout?.trim();
    if (out.status !== 0 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value || '')) fail(`Branch ou commit invalido: ${ref}`);
    return value;
  };
  const source = resolveCommit(sourceRef), target = resolveCommit(destination);
  if (head(root) !== source) fail('HEAD diverge da branch de origem.');
  if (git(root, ['merge-base', '--is-ancestor', target, source], true).status !== 0) fail('Apenas fast-forward comprovado e suportado; revise o resultado integrado para historico divergente.');
  const bytes = args => {
    const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: root, timeout: 15000, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' } });
    if (result.error || result.status !== 0) fail(`Git: ${result.error?.message || result.stderr?.toString().trim() || 'operacao falhou'}`);
    return result.stdout;
  };
  const decode = data => { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); } catch { fail('Caminho Git nao e UTF-8 valido.'); } };
  const raw = bytes(['diff', '--raw', '-z', '--no-abbrev', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', target, source, '--']);
  const parts = decode(raw).split('\0');
  if (parts.pop() !== '' || parts.length % 2) fail('Diff Git incompleto ou ambiguo.');
  const changes = new Map();
  for (let i = 0; i < parts.length; i += 2) {
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]+) ([a-f0-9]+) ([AMD])$/.exec(parts[i]);
    if (!match) fail('Tipo de alteracao Git nao suportado.');
    const [, beforeMode, afterMode, , , action] = match, path = pathInRoot(root, parts[i + 1]);
    if (changes.has(path) || !['000000', '100644'].includes(beforeMode) || !['000000', '100644'].includes(afterMode)) fail(`Tipo ou modo nao comprovado: ${path}`);
    changes.set(path, action);
  }
  if (!changes.size) fail('Nao ha alteracoes para integrar.');
  const reviewed = new Set();
  const verified = reports.map(file => validateReview(file, { root, requireSeal: true }));
  for (const review of verified) {
    if (review.snapshot.head !== source) fail('Relatorio nao corresponde ao commit de origem.');
    for (const item of review.snapshot.files) {
      const path = pathInRoot(root, item.path);
      if (item.indexAction !== undefined) fail(`Acao de indice nao pode comprovar merge: ${path}`);
      const tree = decode(bytes(['--literal-pathspecs', 'ls-tree', '-z', '--full-tree', source, '--', path]));
      if (!tree) {
        if (item.sha256 !== null) fail(`Conteudo revisado nao esta no commit de origem: ${path}`);
      } else {
        const m = /^(\d{6}) blob ([a-f0-9]+)\t([^\0]+)\0$/.exec(tree);
        if (!m || m[1] !== '100644' || m[3] !== path) fail(`Arquivo, link ou modo nao comprovado no commit: ${path}`);
        if (item.sha256 !== createHash('sha256').update(bytes(['cat-file', 'blob', m[2]])).digest('hex')) fail(`Conteudo revisado difere do commit de origem: ${path}`);
      }
      if (changes.has(path)) reviewed.add(path);
    }
  }
  const missing = [...changes.keys()].filter(path => !reviewed.has(path));
  if (missing.length) fail(`Alteracoes sem revisao selada: ${missing.join(', ')}`);
  // Detect moved refs or changed worktree/reports during the validation.
  if (git(root, ['symbolic-ref', '--quiet', 'HEAD']).stdout.trim() !== sourceRef || resolveCommit(sourceRef) !== source || resolveCommit(destination) !== target || head(root) !== source) fail('Origem ou destino mudou durante a verificacao.');
  for (const file of reports) validateReview(file, { root, requireSeal: true });
  if (git(root, ['symbolic-ref', '--quiet', 'HEAD']).stdout.trim() !== sourceRef || resolveCommit(sourceRef) !== source || resolveCommit(destination) !== target || head(root) !== source) fail('Origem ou destino mudou durante a verificacao.');
  return { status: 'passed', reviewVerification: 'not-verified', sourceRef, source, destination, target, changes: changes.size, reports: reports.length, mode: 'fast-forward' };
}

export function sealReview(file, options) {
  const checked = validateReview(file, { ...options, requireSeal: false });
  const path = artifact(checked.root, `${checked.prefix}/seal.json`, checked.prefix, false);
  if (existsSync(join(checked.root, path))) return checkReview(file, options);
  writeFileSync(join(checked.root, path), JSON.stringify(checked.seal, null, 2) + '\n', { flag: 'wx' });
  return checkReview(file, options);
}

const usage = 'Uso: revisar-entrega prepare --id <slug> [--execution <slug>] [--spec <arquivo>] [--scope <arquivo>] [--document <arquivo>] [--output <artefato>]; seal|check <revisao.json>; check-commit <revisao.json> [...]; check-merge --destino refs/heads/<branch> <revisao.json> [...]';
export function main(args = process.argv.slice(2)) {
  requireNode(); const [mode, ...rest] = args;
  if (!mode || ['--help', '-h'].includes(mode)) { console.log(usage); return 0; }
  if (mode === 'check' && rest.length === 1) { console.log(JSON.stringify(checkReview(rest[0]))); return 0; }
  if (mode === 'seal' && rest.length === 1) { console.log(JSON.stringify(sealReview(rest[0]))); return 0; }
  if (mode === 'check-commit' && rest.length) { console.log(JSON.stringify(checkCommit(rest))); return 0; }
  if (mode === 'check-merge' && rest.length >= 3 && rest[0] === '--destino') { console.log(JSON.stringify(checkMerge(rest.slice(2), rest[1]))); return 0; }
  if (mode !== 'prepare') fail(usage);
  const options = { scope: [], documents: [] };
  const fields = { '--id': 'id', '--execution': 'execution', '--spec': 'spec', '--output': 'output' };
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1]; if (!value || value.startsWith('--')) fail(usage);
    if (rest[i] === '--scope') options.scope.push(value);
    else if (rest[i] === '--document') options.documents.push(value);
    else if (fields[rest[i]]) { if (options[fields[rest[i]]] !== undefined) fail('Opcao duplicada.'); options[fields[rest[i]]] = value; }
    else fail(usage);
  }
  console.log(JSON.stringify({ report: prepareReview(options).file, status: 'pending' })); return 0;
}

if (isMain(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
