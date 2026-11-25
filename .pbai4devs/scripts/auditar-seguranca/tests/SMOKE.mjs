import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SecurityAudit } from '../SCRIPT.mjs';
import { ToolManager } from '../../preparar-ferramentas/SCRIPT.mjs';
import { zipFixture } from './zip-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const manager = new ToolManager({ root });
for (const name of ['gitleaks', 'osv-scanner', 'opengrep']) manager.check(name);
const base = join(root, '.agent-tests/security-smoke'); fs.mkdirSync(base, { recursive: true });
const work = fs.mkdtempSync(join(base, 'run-'));
const fixture = join(work, 'project'); fs.mkdirSync(fixture);
const write = (file, bytes) => { fs.mkdirSync(dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
for (const file of ['scripts/preparar-ferramentas/SCRIPT.mjs', 'scripts/lib/native-release.mjs', 'scripts/lib/runtime.mjs', 'scripts/auditar-seguranca/rules/javascript.yml']) write(join(fixture, '.pbai4devs', file), fs.readFileSync(join(root, '.pbai4devs', file)));
for (const name of ['gitleaks', 'osv-scanner', 'opengrep']) {
  const source = join(root, '.pbai4devs/tools', name), target = join(fixture, '.pbai4devs/tools', name);
  for (const file of ['TOOL.json', 'SCRIPT.mjs']) write(join(target, file), fs.readFileSync(join(source, file)));
  const current = JSON.parse(fs.readFileSync(join(source, '.local/CURRENT.json')));
  const definition = JSON.parse(fs.readFileSync(join(source, 'TOOL.json')));
  for (const path of Object.values(definition.envPaths || {})) fs.mkdirSync(join(target, '.local', path), { recursive: true });
  write(join(target, '.local/CURRENT.json'), fs.readFileSync(join(source, '.local/CURRENT.json')));
  const version = `${current.version}-${current.platform}`;
  fs.cpSync(join(source, '.local/versions', version), join(target, '.local/versions', version), { recursive: true });
}
const syntheticSecret = 'ghp_' + 'a2f80b357bba4272fc7bb1382e82cdb36045';
write(join(fixture, 'app/index.js'), `import { exec } from 'node:child_process';
function unsafe(req, db) {
  eval(req.query.code);
  exec(req.body.command);
  db.query('select * from users where id=' + req.params.id);
  const tls = { rejectUnauthorized: false };
  return tls;
}
const apiKey = '${syntheticSecret}';
`);
const lock = version => JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'fixture', version: '1.0.0', dependencies: { 'security-fixture-lib': version } }, 'node_modules/security-fixture-lib': { version, resolved: `https://registry.npmjs.org/security-fixture-lib/-/security-fixture-lib-${version}.tgz` } } });
write(join(fixture, 'app/package-lock.json'), lock('1.0.0'));
const audit = new SecurityAudit({ root: fixture });
const vulnerability = { schema_version: '1.6.0', id: 'TEST-2099-0001', modified: '2025-01-01T00:00:00Z', published: '2025-01-01T00:00:00Z', summary: 'Synthetic vulnerability used only by local tests', affected: [{ package: { ecosystem: 'npm', name: 'security-fixture-lib' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.0.1' }] }], versions: ['1.0.0'] }] };
const archive = zipFixture({ 'TEST-2099-0001.json': JSON.stringify(vulnerability) });
audit.fetcher = async () => new Response(archive);
await audit.updateData(['npm']);
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = digest(join(fixture, 'app/index.js'));
const bad = await audit.run({ target: 'app' });
write(join(work, 'unsafe-report.json'), JSON.stringify(bad, null, 2));
assert.equal(bad.status, 'findings', JSON.stringify(bad.checks));
for (const check of bad.checks) assert.equal(check.status, 'findings', check.tool);
assert.equal(digest(join(fixture, 'app/index.js')), before);
assert.ok(!JSON.stringify(bad).includes(syntheticSecret));
assert.ok(bad.findings.some(finding => finding.rule === 'TEST-2099-0001'));
for (const id of ['pbai-eval-input', 'pbai-shell-input', 'pbai-sql-input', 'pbai-tls-verification-disabled']) assert.ok(bad.findings.some(finding => finding.rule === id), id);
write(join(fixture, 'app/index.js'), `import { execFile } from 'node:child_process';
function safe(req, db) {
  JSON.parse(req.query.data);
  execFile('printf', ['%s', req.body.message]);
  db.query('select * from users where id = ?', [req.params.id]);
  return { rejectUnauthorized: true };
}
`);
write(join(fixture, 'app/package-lock.json'), lock('1.0.1'));
const good = await audit.run({ target: 'app' });
write(join(work, 'safe-report.json'), JSON.stringify(good, null, 2));
assert.equal(good.status, 'passed', JSON.stringify(good.checks)); assert.equal(good.findings.length, 0);
write(join(fixture, 'app/package-lock.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'fixture', version: '1.0.0' } } }));
const empty = await audit.run({ target: 'app', checks: ['dependencies'] });
write(join(work, 'no-dependencies-report.json'), JSON.stringify(empty, null, 2));
assert.equal(empty.status, 'not-applicable', JSON.stringify(empty.checks));
const report = { status: 'passed', work, tools: bad.checks.map(item => ({ tool: item.tool, version: item.version })), positiveFindings: bad.findings.length, negativeFindings: good.findings.length, noDependencies: empty.status, offline: true, sourcePreserved: true };
write(join(work, 'REPORT.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
