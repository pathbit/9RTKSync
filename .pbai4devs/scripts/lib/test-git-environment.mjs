// Test processes must never inherit a repository, index or Git configuration.
// Individual fixtures may still set explicit Git variables after this import.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'agentdevkit-test-git-'));
const configuration = join(directory, 'gitconfig');
const excludes = join(directory, 'exclude');
export const testGitConfig = configuration;
writeFileSync(excludes, '');
// Explicitly override Git's XDG ignore fallback as well as global config.
writeFileSync(configuration, `[core]\n\texcludesFile = ${JSON.stringify(excludes)}\n\tfsmonitor = false\n`);
for (const key of Object.keys(process.env)) {
  if (/^GIT_/i.test(key)) delete process.env[key];
}
process.env.GIT_CONFIG_GLOBAL = configuration;
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_OPTIONAL_LOCKS = '0';
process.env.GIT_TERMINAL_PROMPT = '0';
// Keep the tiny temporary configuration for OS cleanup: removing a path that
// another process has replaced could delete files unrelated to this test.
