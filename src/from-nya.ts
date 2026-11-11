// Terra used to be called Nya. The first time Terra starts, it copies Nya's
// data folder (settings, open tabs, history, bookmarks, passwords, cookies)
// into its own so nothing is lost, then removes the old Nya app. The copy
// stays on this computer, like everything else.
import { app } from 'electron';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OLD_NAME = 'Nya';
const UNINSTALL_KEY =
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Nya';

// Caches Chromium rebuilds by itself, lock files, and Nya's downloaded
// updates: not worth copying.
const SKIP = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Crashpad',
  'updates',
  'lockfile',
  'nya-removed',
]);

export interface FromNya {
  /** Nya was the Windows default browser. */
  wasDefault: boolean;
}

function copyTree(from: string, to: string) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    try {
      if (entry.isDirectory()) copyTree(source, target);
      else if (entry.isFile() && !fs.existsSync(target)) {
        fs.copyFileSync(source, target);
      }
    } catch {
      // A file in use or unreadable: skip it, keep the rest.
    }
  }
}

function regQuery(key: string, value: string): string | null {
  try {
    const output = execFileSync('reg', ['query', key, '/v', value], {
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return (
      new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`, 'i')
        .exec(output)?.[1]
        ?.trim() ?? null
    );
  } catch {
    return null;
  }
}

function nyaWasDefault() {
  if (process.platform !== 'win32') return false;
  const base =
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https';
  const progId =
    regQuery(`${base}\\UserChoiceLatest`, 'ProgId') ??
    regQuery(`${base}\\UserChoice`, 'ProgId');
  return progId === 'NyaURL';
}

/**
 * Copies Nya's data on Terra's first start. Must run before the app is
 * ready, while nothing in Terra's folder is open yet. Returns null when
 * there was nothing to bring over.
 */
export function copyNyaData(): FromNya | null {
  // Nya's folder sits next to Terra's (normally both in %APPDATA%).
  const target = app.getPath('userData');
  const source = path.join(path.dirname(target), OLD_NAME);
  if (
    path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()
  ) {
    return null;
  }
  // Terra has run before (Chromium writes "Local State" on every start).
  const used = ['Local State', 'settings.json', 'session.json'].some((name) =>
    fs.existsSync(path.join(target, name)),
  );
  if (used || !fs.existsSync(path.join(source, 'Local State'))) return null;
  try {
    copyTree(source, target);
  } catch {
    return null;
  }
  return { wasDefault: nyaWasDefault() };
}

/**
 * Uninstalls the old Nya app once, on the installed Terra's first start,
 * whichever way Nya was installed (Setup.exe or the PowerShell line). Its own
 * uninstaller removes the shortcuts, the "Installed apps" entry and its
 * default browser registration. Nya's data folder is left alone.
 */
export function removeNyaApp() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const marker = path.join(app.getPath('userData'), 'nya-removed');
  if (fs.existsSync(marker)) return;
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, '');
  } catch {
    return;
  }
  const command = regQuery(UNINSTALL_KEY, 'UninstallString');
  // Only the two uninstallers Nya ever had.
  if (
    !command ||
    !/(Update\.exe"? --uninstall|-File "[^"]*uninstall\.ps1")\s*$/i.test(
      command,
    )
  ) {
    return;
  }
  // Through "cmd /c start" so it finishes even if Terra is closed meanwhile.
  spawn('cmd.exe', ['/d', '/s', '/c', `"start "" /min ${command}"`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: true,
  }).unref();
}
