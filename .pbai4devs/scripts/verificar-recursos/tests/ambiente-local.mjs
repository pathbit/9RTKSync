import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { projectRoot } from '../../lib/runtime.mjs';

const templates = join(projectRoot, '.pbai4devs/templates/ambiente-local');
function fixture(t) {
  const home = join(projectRoot, '.agent-tests');
  mkdirSync(home, { recursive: true });
  const root = mkdtempSync(join(home, 'ambiente-local-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFileSync(join(templates, 'Makefile.template'), join(root, 'Makefile'));
  copyFileSync(join(templates, 'compose.local.yml.template'), join(root, 'compose.local.yml'));
  return root;
}

test("models require real commands and explicit local configuration", () => {
  const makefile = readFileSync(join(templates, 'Makefile.template'), 'utf8');
  const setup = makefile.slice(makefile.indexOf('\nsetup:'), makefile.indexOf('\nup:'));
  assert.ok(setup.indexOf('$(SETUP_COMMAND)') < setup.indexOf('$(DOCTOR_COMMANDS)'));
  for (const command of ['SETUP_COMMAND', 'BUILD_COMMAND', 'TEST_COMMAND', 'LINT_COMMAND']) {
    assert.ok(makefile.includes(`$(if $(strip $(${command})),,$(error Defina ${command}`));
  }
  assert.match(makefile, /docker version\r?\ndocker compose version\r?\n\$\(COMPOSE\) config --quiet/);
  const compose = readFileSync(join(templates, 'compose.local.yml.template'), 'utf8');
  for (const name of ['COMPOSE_PROJECT_NAME', 'APP_IMAGE', 'APP_PORT', 'APP_CONTAINER_PORT', 'APP_HEALTHCHECK']) assert.ok(compose.includes(`\${${name}:?`));
  assert.ok(compose.includes('127.0.0.1:'));
  assert.ok(compose.includes('healthcheck:'));
});

test('Makefile prepara o ambiente antes de validar e propaga falhas', t => {
  if (process.platform === 'win32') { t.skip('Fixture de Make opcional para POSIX; contrato validado em Node em todos os sistemas.'); return; }
  const available = spawnSync('make', ['--version'], { encoding: 'utf8' });
  if (available.error || available.status !== 0) { t.skip('make ausente; contrato do modelo validado em Node.'); return; }
  const root = fixture(t);
  const log = join(root, 'order.log');
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const node = quote(process.execPath);
  const stub = join(root, 'docker-stub.mjs');
  const setup = join(root, 'setup.mjs');
  const failure = join(root, 'failure.mjs');
  writeFileSync(stub, `import { appendFileSync, existsSync } from 'node:fs';\nconst command = process.argv.slice(2).join(' ');\nappendFileSync(process.env.AGENT_TEMPLATE_ORDER, command + '\\n');\nif (!['version', 'compose version', 'compose -f compose.local.yml config --quiet'].includes(command)) process.exit(99);\nif (command.endsWith('config --quiet') && !existsSync('.env')) process.exit(1);\n`);
  writeFileSync(setup, `import { appendFileSync, copyFileSync } from 'node:fs';\nappendFileSync(process.env.AGENT_TEMPLATE_ORDER, 'setup\\n');\ncopyFileSync('.env.example', '.env');\n`);
  writeFileSync(failure, 'process.exit(7);\n');
  writeFileSync(join(root, '.env.example'), 'FIXTURE_ENV=ready\n');
  writeFileSync(join(root, 'fixture.mk'), `include Makefile\ndefine DOCTOR_COMMANDS\n${node} ${quote(stub)} version\n${node} ${quote(stub)} compose version\n${node} ${quote(stub)} compose -f compose.local.yml config --quiet\nendef\n`);
  const run = args => spawnSync('make', ['-f', 'fixture.mk', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, AGENT_TEMPLATE_ORDER: log } });
  const result = run(['setup', `SETUP_COMMAND=${node} ${quote(setup)}`]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(existsSync(join(root, '.env')));
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['setup', 'version', 'compose version', 'compose -f compose.local.yml config --quiet']);
  for (const [target, variable] of [['setup', 'SETUP_COMMAND'], ['build', 'BUILD_COMMAND'], ['test', 'TEST_COMMAND'], ['lint', 'LINT_COMMAND']]) {
    writeFileSync(log, '');
    const missing = run([target]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, new RegExp(variable));
    assert.equal(readFileSync(log, 'utf8'), '');
    const failed = run([target, `${variable}=${node} ${quote(failure)}`]);
    assert.notEqual(failed.status, 0);
    assert.equal(readFileSync(log, 'utf8'), '');
  }
});

test("Compose accepts explicit values and rejects incomplete configuration", t => {
  const available = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  if (available.error || available.status !== 0) { t.skip('Docker Compose CLI ausente; nenhum daemon é necessário.'); return; }
  const root = fixture(t);
  const empty = join(root, 'empty.env');
  writeFileSync(empty, '');
  const env = { ...process.env };
  for (const name of ['COMPOSE_PROJECT_NAME', 'APP_IMAGE', 'APP_PORT', 'APP_CONTAINER_PORT', 'APP_HEALTHCHECK']) delete env[name];
  const args = ['compose', '--env-file', empty, '-f', join(root, 'compose.local.yml'), 'config', '--quiet'];
  const valid = spawnSync('docker', args, { cwd: root, encoding: 'utf8', env: { ...env, COMPOSE_PROJECT_NAME: 'agents-template-check', APP_IMAGE: 'example/app:1.0', APP_PORT: '39001', APP_CONTAINER_PORT: '3000', APP_HEALTHCHECK: 'test -f /tmp/ready' } });
  assert.equal(valid.status, 0, valid.stderr);
  const missing = spawnSync('docker', args, { cwd: root, encoding: 'utf8', env });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /COMPOSE_PROJECT_NAME|APP_IMAGE|APP_PORT|APP_CONTAINER_PORT|APP_HEALTHCHECK/);
});
