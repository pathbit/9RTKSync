const nativeReasons = {
  win32: 'Requer Windows para verificar a resolução de alias 8.3.',
  darwin: 'Requer macOS para verificar ACLs e atributos nativos.',
  linux: 'Requer Linux para verificar atributos e diagnósticos nativos.',
};

// Os perfis nativos do CI exercitam os mesmos casos nas plataformas exigidas.
export const platformFixtures = [
  {
    native: 'win32',
    platforms: ['linux', 'darwin'],
    suite: 'sincronizar-agentes',
    file: 'LOCAL_IGNORE.mjs',
    names: ['Windows normalizes temporary aliases 8.3 before comparing the Git root'],
  },
  {
    native: 'darwin',
    platforms: ['linux'],
    suite: 'sincronizar-agentes',
    file: 'PRESERVATION.mjs',
    names: ['sync recusa apontamento CRLF com xattr no macOS', 'sync recusa apontamento CRLF com acl no macOS'],
  },
  {
    native: 'darwin',
    platforms: ['linux'],
    suite: 'testar-infraestrutura',
    file: 'TEST.mjs',
    names: [
      'ACL inherited in log directory interrupts before running suites',
      'ACL non-verifiable log interrupts without exposing diagnosis',
      'ACL log uncheckable after suite prevents recording output',
    ],
  },
  {
    native: 'linux',
    platforms: ['darwin'],
    suite: 'sincronizar-agentes',
    file: 'PRESERVATION.mjs',
    names: [
      'sync preserves Linux attribute when updating reference CRLF or refusal without change',
      'sync preserves Linux attribute in common update or refusal without changing',
      'sync warns when Linux metadata have not been verified',
    ],
  },
];

export function nativeSkipReason(native, platform = process.platform) {
  return platform === native ? false : nativeReasons[native];
}

export const platformFixturePath = ({ suite, file }) => `.pbai4devs/scripts/${suite}/tests/${file}`;

export function expectedPlatformFixture(suite, skip, platform) {
  if (skip?.kind !== 'test' || skip.event !== 'test:pass' || skip.booleanSkip !== false || skip.todo !== false) return undefined;
  return platformFixtures.find(fixture => fixture.suite === suite
    && fixture.platforms.includes(platform)
    && skip.file === platformFixturePath(fixture)
    && fixture.names.includes(skip.name)
    && skip.reason === nativeSkipReason(fixture.native, platform));
}
