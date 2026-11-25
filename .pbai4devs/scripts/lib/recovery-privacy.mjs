import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync } from 'node:fs';
import { isAbsolute, win32 } from 'node:path';
import { classifyMacAcl, inspectMacAcl, inspectMacDirectoryAcl } from './xattr-probe.mjs';

const failure = code => Object.assign(new Error('Private recovery storage could not be established.'), { code });

// Windows PowerShell 5.1 supplies the .NET Framework ACL APIs. Paths are JSON
// data on stdin. The fixed command never evaluates user input or emits it.
const aclCommand = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
  $reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8, $false)
  try { $request = ConvertFrom-Json -InputObject ($reader.ReadToEnd()) }
  finally { $reader.Dispose() }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $trusted = @($sid, 'S-1-5-18', 'S-1-5-32-544')
  if ($request.create) {
    # CreateDirectoryW applies the protected DACL in the same operation as
    # exclusive creation. An existing directory is never re-permissioned.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PrivateRecoveryDirectory {
    [StructLayout(LayoutKind.Sequential)]
    private struct Attributes {
        public int Length;
        public IntPtr Descriptor;
        public int InheritHandle;
    }
    [DllImport("kernel32.dll", ExactSpelling=true, CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CreateDirectoryW(string path, ref Attributes attributes);
    public static int Create(string path, byte[] descriptor) {
        var pin = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        try {
            var attributes = new Attributes {
                Length = Marshal.SizeOf(typeof(Attributes)), Descriptor = pin.AddrOfPinnedObject()
            };
            return CreateDirectoryW(path, ref attributes) ? 0 : Marshal.GetLastWin32Error();
        } finally { pin.Free(); }
    }
}
'@
    $sddl = 'O:{0}D:P(A;OICI;FA;;;{0})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)' -f $sid
    $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($sddl)
    $bytes = [byte[]]::new($descriptor.BinaryLength)
    $descriptor.GetBinaryForm($bytes, 0)
    $result = [PrivateRecoveryDirectory]::Create($request.create, $bytes)
    if ($result -eq 183 -or $result -eq 80) { exit 3 }
    if ($result -eq 3 -or $result -eq 2) { exit 4 }
    if ($result -eq 5) { exit 5 }
    if ($result -ne 0) { exit 2 }
  }
  foreach ($path in $request.paths) {
    $attributes = [IO.File]::GetAttributes($path)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }
    $directory = ($attributes -band [IO.FileAttributes]::Directory) -ne 0
    $sections = [Security.AccessControl.AccessControlSections]'Access, Owner'
    if ($directory) { $acl = [IO.Directory]::GetAccessControl($path, $sections) }
    else { $acl = [IO.File]::GetAccessControl($path, $sections) }
    $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
    if ($null -eq $raw.DiscretionaryAcl -or $trusted -notcontains $raw.Owner.Value) { exit 1 }
    if ($request.create -and (!$directory -or !$acl.AreAccessRulesProtected)) { exit 1 }
    $currentHasAccess = $false
    foreach ($ace in $raw.DiscretionaryAcl) {
      if ($ace.AceType -ne [Security.AccessControl.AceType]::AccessAllowed -or
          $trusted -notcontains $ace.SecurityIdentifier.Value) { exit 1 }
      $full = [int][Security.AccessControl.FileSystemRights]::FullControl
      $flags = [int]$ace.AceFlags
      # An inheritable full-control grant must also apply to the directory itself.
      if ($ace.SecurityIdentifier.Value -eq $sid -and ($ace.AccessMask -band $full) -eq $full -and
          ($flags -band 8) -eq 0 -and (!$directory -or ($flags -band 15) -eq 3)) { $currentHasAccess = $true }
    }
    if (!$currentHasAccess) { exit 1 }
  }
  $ack = [Text.Encoding]::ASCII.GetBytes('ok')
  $output = [Console]::OpenStandardOutput()
  $output.Write($ack, 0, $ack.Length)
  $output.Flush()
} catch { exit 2 }
`;

function windowsAcl(paths, create) {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !win32.isAbsolute(systemRoot)) throw failure('E_RECOVERY_ACL_UNAVAILABLE');
  const executable = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = Buffer.from(aclCommand, 'utf16le').toString('base64');
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
    input: JSON.stringify({ paths, create }), encoding: 'utf8', timeout: 60000, maxBuffer: 16384, windowsHide: true,
  });
  if (!result.error && !result.signal && result.status === 0 && result.stdout === 'ok') return;
  const codes = { 1: 'E_RECOVERY_ACL_UNSAFE', 3: 'EEXIST', 4: 'ENOENT', 5: 'EACCES' };
  throw failure(codes[result.status] || 'E_RECOVERY_ACL_UNAVAILABLE');
}

export function createPrivateRecoveryDirectory(path) {
  if (typeof path !== 'string' || path.includes('\0') || !isAbsolute(path)) throw failure('E_RECOVERY_INPUT');
  if (process.platform === 'win32') windowsAcl([path], win32.toNamespacedPath(path));
  else {
    mkdirSync(path, { mode: 0o700 });
    if (process.platform === 'darwin') assertMacAcl(inspectMacDirectoryAcl(path));
  }
}

function assertMacAcl(state) {
  if (state !== 'empty') throw failure(state === 'present' ? 'E_RECOVERY_ACL_UNSAFE' : 'E_RECOVERY_ACL_UNAVAILABLE');
}

function macAcls(paths, knownKind) {
  if (paths.length === 1) {
    const directory = knownKind ? knownKind === 'directory' : lstatSync(paths[0]).isDirectory();
    assertMacAcl(directory ? inspectMacDirectoryAcl(paths[0]) : inspectMacAcl(paths[0]));
    return;
  }
  // Large journals are read at every transition. Batch ls so native ACL
  // inspection is bounded without spawning one process per historical file.
  // -q prevents control characters in names from becoming extra output rows.
  for (let index = 0; index < paths.length; index += 32) {
    const batch = paths.slice(index, index + 32);
    const result = spawnSync('/bin/ls', ['-qlde', '--', ...batch], {
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, timeout: 5000, maxBuffer: 256 * 1024,
    });
    if (result.error || result.signal || result.status !== 0 || result.stderr.length) throw failure('E_RECOVERY_ACL_UNAVAILABLE');
    const output = result.stdout.toString('utf8');
    if (/^[ \t]+\d+:[ \t]/m.test(output)) throw failure('E_RECOVERY_ACL_UNSAFE');
    const rows = output.split('\n');
    if (rows.pop() !== '' || rows.length !== batch.length) throw failure('E_RECOVERY_ACL_UNAVAILABLE');
    for (const row of rows) {
      const kind = row.startsWith('d') ? 'directory' : 'file';
      assertMacAcl(classifyMacAcl({ ...result, stdout: Buffer.from(row + '\n') }, kind));
    }
  }
}

export function assertPrivateRecoveryPaths(paths, knownKind) {
  if (!Array.isArray(paths) || !paths.length || paths.some(path => typeof path !== 'string' || path.includes('\0') || !isAbsolute(path))) {
    throw failure('E_RECOVERY_INPUT');
  }
  if (process.platform === 'win32') windowsAcl(paths);
  if (process.platform === 'darwin') macAcls(paths, knownKind);
}
