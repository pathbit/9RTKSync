import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
function fixture(t, code = '') {
  const root = mkdtempSync(join(tmpdir(), 'adk-raw-stream-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.pbai4devs'));
  for (const group of ['scripts', 'tools']) cpSync(join(source, '.pbai4devs', group), join(root, '.pbai4devs', group), {
    recursive: true,
    filter: path => !['.local', '.cache', 'node_modules', 'tests'].includes(basename(path)),
  });
  mkdirSync(join(root, 'fixtures'));
  writeFileSync(join(root, 'fixtures/target.mjs'), code);
  const selector = join(root, '.pbai4devs/scripts/executar-script/SCRIPT.mjs');
  const bootstrap = join(root, '.pbai4devs/scripts/preparar-ferramentas/BOOTSTRAP.mjs');
  const run = (entry, args, extraEnv = {}) => spawnSync(process.execPath, [entry, ...args], {
    cwd: root, encoding: null, timeout: 60000, maxBuffer: 12 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: '', ...extraEnv },
  });
  return { root, selector, bootstrap, run, target: 'fixtures/target.mjs' };
}
const status = (result, code) => {
  assert.equal(result.status, code, `${result.error?.message || ''}\n${result.stderr?.toString()}`);
};

test("Raw preserves JSON and opaque arguments after target name in both streams", t => {
  const f = fixture(t, 'process.stdout.write(JSON.stringify({args:process.argv.slice(2)})); process.stderr.write("TARGET-ERR\\n");');
  const args = ['--raw', '--plan', '--', '', 'espaço ☃', '$(nao-executar)', '--no-install'];
  for (const [entry, prefix] of [[f.selector, ['--raw']], [f.bootstrap, ['--executar', '--no-install', '--raw']]]) {
    const r = f.run(entry, [...prefix, f.target, ...args]); status(r, 0);
    assert.deepEqual(JSON.parse(r.stdout.toString()), { args });
    assert.match(r.stderr.toString(), /runtime=node/);
    assert.match(r.stderr.toString(), /TARGET-ERR/);
    if (entry === f.bootstrap) assert.match(r.stderr.toString(), /"platform"/);
  }
});

test('raw transmite bytes binarios grandes sem inserir metadados nem buffer do seletor', t => {
  const f = fixture(t, 'process.stdout.write(Buffer.alloc(3*1024*1024, 0xa5));');
  for (const [entry, prefix] of [[f.selector, ['--raw']], [f.bootstrap, ['--executar', '--no-install', '--raw']]]) {
    const r = f.run(entry, [...prefix, f.target]); status(r, 0);
    assert.deepEqual(r.stdout, Buffer.alloc(3*1024*1024, 0xa5));
    assert.match(r.stderr.toString(), /runtime=node/);
  }
});

test('raw plan e help escrevem orientacao em stderr sem executar alvo, diagnostico ou cache', t => {
  const f = fixture(t, `import {writeFileSync} from 'node:fs'; writeFileSync('executed','yes');`);
  const diagnostic = join(f.root, '.pbai4devs/scripts/diagnosticar-ambiente/SCRIPT.mjs');
  writeFileSync(diagnostic, `import {writeFileSync} from 'node:fs'; writeFileSync('diagnosed','yes'); process.exit(38);`);
  for (const [entry, args] of [[f.selector, ['--raw', '--plan', f.target]], [f.selector, ['--plan', '--raw', f.target]], [f.bootstrap, ['--executar', '--no-install', '--plan', '--raw', f.target]], [f.bootstrap, ['--executar', '--raw', '--plan', '--no-install', f.target]], [f.selector, ['--raw', '--help']], [f.bootstrap, ['--executar', '--raw', '--help']]]) {
    const r = f.run(entry,args); status(r, 0); assert.equal(r.stdout.length, 0);
    assert.match(r.stderr.toString(), /runtime=node|Uso:/);
    assert.equal(existsSync(join(f.root,'executed')), false);
    assert.equal(existsSync(join(f.root,'diagnosed')), false);
    assert.equal(existsSync(join(f.root,'.pbai4devs/tools/.cache/runtime')), false);
  }
});

test('falha diagnostica vai a stderr, impede alvo e preserva status', t => {
  const f = fixture(t, `import {writeFileSync} from 'node:fs'; writeFileSync('executed','yes');`);
  writeFileSync(join(f.root,'.pbai4devs/scripts/diagnosticar-ambiente/SCRIPT.mjs'), `process.stdout.write('DIAG-OUT\\n'); process.stderr.write('DIAG-ERR\\n'); process.exitCode=37;`);
  const r = f.run(f.bootstrap,['--executar','--no-install','--raw',f.target]); status(r,37);
  assert.equal(r.stdout.length,0); assert.match(r.stderr.toString(),/DIAG-OUT/); assert.match(r.stderr.toString(),/DIAG-ERR/);
  assert.equal(existsSync(join(f.root,'executed')),false);
});

test('raw preserva erros e retorno do alvo e status especial do Playwright', t => {
  const f = fixture(t, `process.stdout.write('OUTPUT');process.stderr.write('TARGET FAILURE\\n');process.exitCode=23;`);
  for(const [entry,prefix] of [[f.selector,['--raw']],[f.bootstrap,['--executar','--no-install','--raw']]]) {
    const r=f.run(entry,[...prefix,f.target]); status(r,23); assert.equal(r.stdout.toString(),'OUTPUT'); assert.match(r.stderr.toString(),/TARGET FAILURE/);
    const connector=f.run(entry,[...prefix,'testar-navegador']);status(connector,69);assert.equal(connector.stdout.length,0);assert.match(connector.stderr.toString(),/playwright-mcp/);
    const missing=f.run(entry,[...prefix,'missing-script']);status(missing,2);assert.equal(missing.stdout.length,0);assert.match(missing.stderr.toString(),/ausente/);
  }
});

test('modo padrao continua misturando cabecalhos em stdout', t => {
  const f=fixture(t,`process.stdout.write('TARGET');`);
  for(const [entry,prefix] of [[f.selector,[]],[f.bootstrap,['--executar','--no-install']]]){
    const r=f.run(entry,[...prefix,f.target]);status(r,0);const out=r.stdout.toString();assert.match(out,/runtime=node/);assert.match(out,/TARGET/);
    if(entry===f.bootstrap){assert.match(out,/node=/);assert.match(out,/"platform"/);}
  }
});

test("duplicate flags fail before target; target flags are opaque",t=>{
 const f=fixture(t,`process.stdout.write(JSON.stringify(process.argv.slice(2)));`);
 for(const [entry,prefix] of [[f.selector,[]],[f.bootstrap,['--executar','--no-install']]]){
  const bad=f.run(entry,[...prefix,'--raw','--raw',f.target]);status(bad,entry===f.selector?2:1);assert.equal(bad.stdout.length,0);assert.match(bad.stderr.toString(),/duplicado/);
  const ok=f.run(entry,[...prefix,'--raw',f.target,'--raw','--plan']);status(ok,0);assert.deepEqual(JSON.parse(ok.stdout.toString()),['--raw','--plan']);
 }
});

test("raw does not silence preloads: environment can emit stdout before kit", t => {
  const f = fixture(t, `process.stdout.write('TARGET');`);
  const preload = join(f.root, 'fixtures/preload.cjs');
  writeFileSync(preload, `process.stdout.write('PRELOAD|');`);
  const env = { NODE_OPTIONS: `--require ${JSON.stringify(preload)}` };
  const target = f.run(f.selector, ['--raw', f.target], env); status(target, 0);
  assert.equal(target.stdout.toString(), 'PRELOAD|PRELOAD|TARGET');
  for (const [entry, args] of [[f.selector, ['--raw', '--plan', f.target]], [f.selector, ['--raw', '--help']], [f.bootstrap, ['--executar', '--raw', '--help']]]) {
    const result = f.run(entry, args, env); status(result, 0);
    assert.equal(result.stdout.toString(), 'PRELOAD|');
  }
  // Probe ignores synchronous preload stdout, but the main processes
  // they still issue it before the --raw processing kit.
  const plan = f.run(f.bootstrap, ['--executar', '--no-install', '--raw', '--plan', f.target], env);
  status(plan, 0); assert.equal(plan.stdout.toString(), 'PRELOAD|PRELOAD|');
  assert.match(plan.stderr.toString(), /runtime=node/);
  const execute = f.run(f.bootstrap, ['--executar', '--no-install', '--raw', f.target], env);
  status(execute, 0); assert.equal(execute.stdout.toString(), 'PRELOAD|PRELOAD|PRELOAD|TARGET');
  assert.match(execute.stderr.toString(), /runtime=node/);
  assert.equal(existsSync(join(f.root, '.pbai4devs/tools/.cache/runtime')), false);
});
