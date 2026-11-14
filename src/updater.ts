// Updates from GitHub releases. Terra asks GitHub for the newest release (the
// only thing sent is the request itself), downloads it in the background
// and, when the user agrees, closes, swaps in the new version and reopens.
//
// How it's swapped depends on how Terra was installed:
//   Setup.exe (Squirrel): run the new Setup.exe, which updates in place.
//   PowerShell line / portable zip: unpack the new zip over the app folder.
import { app, net } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RELEASES = 'https://api.github.com/repos/ttttima/Terra-Browser/releases';

export interface ReadyUpdate {
  version: string;
  file: string;
}

type InstallKind = 'squirrel' | 'folder';

/** Squirrel keeps each version in ...\terra\app-x.y.z with Update.exe above. */
function installKind(): InstallKind {
  const dir = path.dirname(process.execPath);
  return /^app-\d/.test(path.basename(dir)) &&
    fs.existsSync(path.join(dir, '..', 'Update.exe'))
    ? 'squirrel'
    : 'folder';
}

export const updatesSupported = () =>
  app.isPackaged && process.platform === 'win32';

function newer(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

let ready: ReadyUpdate | null = null;
let checking: Promise<ReadyUpdate | null> | null = null;

/**
 * Finds a newer release and downloads it. Resolves with the downloaded
 * update, or null when Terra is up to date (or offline).
 */
export function checkForUpdate(): Promise<ReadyUpdate | null> {
  if (ready) return Promise.resolve(ready);
  checking ??= (async () => {
    try {
      const response = await net.fetch(RELEASES, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Terra',
        },
      });
      if (!response.ok) return null;
      const releases = (await response.json()) as {
        draft: boolean;
        tag_name: string;
        assets: { name: string; browser_download_url: string }[];
      }[];
      const release = releases.find((r) => !r.draft);
      if (!release) return null;
      const version = release.tag_name.replace(/^v/, '');
      if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
      if (!newer(version, app.getVersion())) return null;

      // The zip is named "...-portable-win.zip", not "...-portable.zip": Nya
      // 0.6.0 looked for the latter and would unpack Terra over itself but
      // keep starting its old Nya.exe, which can't run the new files.
      const pattern =
        installKind() === 'squirrel' ? /Setup\.exe$/i : /portable.*\.zip$/i;
      const asset = release.assets.find((a) => pattern.test(a.name));
      if (!asset) return null;

      const dir = path.join(app.getPath('userData'), 'updates');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, asset.name);
      const download = await net.fetch(asset.browser_download_url);
      if (!download.ok) return null;
      fs.writeFileSync(file, Buffer.from(await download.arrayBuffer()));
      ready = { version, file };
      return ready;
    } catch {
      return null;
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/** Closes Terra, installs the downloaded update and starts the new version. */
export function installUpdate(update: ReadyUpdate) {
  const exe = process.execPath;
  const dir = path.dirname(exe);
  const kind = installKind();
  const script = path.join(os.tmpdir(), `terra-update-${Date.now()}.ps1`);
  const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;

  // Wait until every Terra process from this folder has exited, so no file is
  // still in use, then swap and restart.
  const wait = `
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Process -Name 'Terra' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith(${quote(kind === 'squirrel' ? path.dirname(dir) : dir)}, 'OrdinalIgnoreCase') }) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
`;
  const body =
    kind === 'squirrel'
      ? `Start-Process -FilePath ${quote(update.file)}`
      : `
$temp = Join-Path ([IO.Path]::GetTempPath()) ('terra-update-' + [guid]::NewGuid())
Expand-Archive -Path ${quote(update.file)} -DestinationPath $temp -Force
$source = $temp
if (-not (Test-Path (Join-Path $source 'Terra.exe'))) { $source = (Get-ChildItem $temp -Directory | Select-Object -First 1).FullName }
Copy-Item -Path (Join-Path $source '*') -Destination ${quote(dir)} -Recurse -Force
Get-ChildItem ${quote(dir)} -Recurse -File | Unblock-File
$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Terra'
$entry = Get-ItemProperty $key -ErrorAction SilentlyContinue
if ($entry -and $entry.InstallLocation -eq ${quote(dir)}) { Set-ItemProperty $key -Name DisplayVersion -Value ${quote(update.version)} }
Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
# Windows keeps showing a cached copy of the old icon on the desktop and taskbar; ask it to redraw.
Start-Process -FilePath (Join-Path $env:WINDIR 'System32\\ie4uinit.exe') -ArgumentList '-show' -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue
Remove-Item ${quote(update.file)} -Force -ErrorAction SilentlyContinue
Start-Process -FilePath ${quote(exe)}
`;
  fs.writeFileSync(
    script,
    `${wait}${body}\nRemove-Item $PSCommandPath -Force\n`,
  );
  // Started through "cmd /c start" so it keeps running after Terra quits:
  // Node ends ordinary child processes with their parent, and PowerShell
  // won't run as a detached process without a console.
  spawn(
    'cmd.exe',
    [
      '/d',
      '/s',
      '/c',
      `"start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}""`,
    ],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true,
    },
  ).unref();
  app.quit();
}
