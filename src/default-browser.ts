// Registers Terra with Windows as a web browser so it appears in Settings >
// Apps > Default apps, and reports whether it is the default. Everything is
// written under HKEY_CURRENT_USER: no administrator rights needed.
//
// Windows doesn't let apps make themselves the default; the user confirms it
// in Settings, which openDefaultAppsSettings() opens on Terra's page.
import { app, shell } from 'electron';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NAME = 'Terra';
const PROG_ID = 'TerraURL';
const CLASSES_KEY = `HKEY_CURRENT_USER\\Software\\Classes\\${PROG_ID}`;
const FILE_PROG_ID = 'TerraFile';
const FILE_KEY = `HKEY_CURRENT_USER\\Software\\Classes\\${FILE_PROG_ID}`;
/** Files Terra can show, so it appears in "Open with" for them. */
export const FILE_EXTENSIONS = ['.pdf', '.htm', '.html', '.xhtml', '.svg'];
const CLIENT_PATH = `Software\\Clients\\StartMenuInternet\\${NAME}`;
const CLIENT_KEY = `HKEY_CURRENT_USER\\${CLIENT_PATH}`;
const REGISTERED_APPS = 'HKEY_CURRENT_USER\\Software\\RegisteredApplications';

export function defaultBrowserSupported() {
  return process.platform === 'win32' && app.isPackaged;
}

/**
 * The exe Windows should start. Squirrel installs keep each version in its
 * own app-x.y.z folder; the Terra.exe one level up always starts the newest.
 */
function launcherPath() {
  const exe = process.execPath;
  const dir = path.dirname(exe);
  if (/^app-\d/.test(path.basename(dir))) {
    const stub = path.join(path.dirname(dir), path.basename(exe));
    if (fs.existsSync(stub)) return stub;
  }
  return exe;
}

/** Writes (or refreshes) the registration. Safe to run on every start. */
export function registerAsBrowser(): Promise<void> {
  if (!defaultBrowserSupported()) return Promise.resolve();
  const exe = launcherPath();
  const str = (value: string) =>
    `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const icon = str(`${exe},0`);
  const reg = [
    'Windows Registry Editor Version 5.00',
    '',
    `[${CLASSES_KEY}]`,
    `@=${str(`${NAME} web page`)}`,
    '"URL Protocol"=""',
    `[${CLASSES_KEY}\\DefaultIcon]`,
    `@=${icon}`,
    `[${CLASSES_KEY}\\shell\\open\\command]`,
    `@=${str(`"${exe}" "%1"`)}`,
    '',
    `[${CLIENT_KEY}]`,
    `@=${str(NAME)}`,
    `[${CLIENT_KEY}\\DefaultIcon]`,
    `@=${icon}`,
    `[${CLIENT_KEY}\\shell\\open\\command]`,
    `@=${str(`"${exe}"`)}`,
    `[${CLIENT_KEY}\\Capabilities]`,
    `"ApplicationName"=${str(NAME)}`,
    `"ApplicationDescription"=${str('A clean, minimal web browser with vertical tabs')}`,
    `"ApplicationIcon"=${icon}`,
    `[${CLIENT_KEY}\\Capabilities\\StartMenu]`,
    `"StartMenuInternet"=${str(NAME)}`,
    `[${CLIENT_KEY}\\Capabilities\\URLAssociations]`,
    `"http"=${str(PROG_ID)}`,
    `"https"=${str(PROG_ID)}`,
    `[${CLIENT_KEY}\\Capabilities\\FileAssociations]`,
    ...FILE_EXTENSIONS.map((ext) => `"${ext}"=${str(FILE_PROG_ID)}`),
    '',
    `[${FILE_KEY}]`,
    `@=${str(`${NAME} document`)}`,
    `[${FILE_KEY}\\DefaultIcon]`,
    `@=${icon}`,
    `[${FILE_KEY}\\shell\\open\\command]`,
    `@=${str(`"${exe}" "%1"`)}`,
    ...FILE_EXTENSIONS.flatMap((ext) => [
      `[HKEY_CURRENT_USER\\Software\\Classes\\${ext}\\OpenWithProgids]`,
      `"${FILE_PROG_ID}"=hex(0):`,
    ]),
    '',
    `[${REGISTERED_APPS}]`,
    `"${NAME}"=${str(`${CLIENT_PATH}\\Capabilities`)}`,
    '',
  ].join('\r\n');

  const file = path.join(os.tmpdir(), `terra-register-${process.pid}.reg`);
  try {
    // .reg files are UTF-16 with a byte order mark.
    fs.writeFileSync(file, `﻿${reg}`, 'utf16le');
  } catch {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    execFile('reg', ['import', file], { windowsHide: true }, () => {
      fs.rm(file, { force: true }, () => {});
      resolve();
    });
  });
}

/**
 * Removes the registration, but only if it belongs to this copy of Terra
 * (another install may have registered itself since). Runs synchronously
 * because the uninstaller quits right after.
 */
export function unregisterAsBrowser() {
  if (process.platform !== 'win32') return;
  try {
    const command = execFileSync(
      'reg',
      ['query', `${CLASSES_KEY}\\shell\\open\\command`, '/ve'],
      { windowsHide: true, encoding: 'utf8' },
    );
    if (!command.toLowerCase().includes(launcherPath().toLowerCase())) return;
  } catch {
    return; // Not registered.
  }
  const run = (args: string[]) => {
    try {
      execFileSync('reg', args, { windowsHide: true, stdio: 'ignore' });
    } catch {
      // Already gone.
    }
  };
  run(['delete', CLASSES_KEY, '/f']);
  run(['delete', FILE_KEY, '/f']);
  for (const ext of FILE_EXTENSIONS) {
    run([
      'delete',
      `HKEY_CURRENT_USER\\Software\\Classes\\${ext}\\OpenWithProgids`,
      '/v',
      FILE_PROG_ID,
      '/f',
    ]);
  }
  run(['delete', CLIENT_KEY, '/f']);
  run(['delete', REGISTERED_APPS, '/v', NAME, '/f']);
}

/** Whether Windows currently opens web links with Terra. */
export function isDefaultBrowser(): Promise<boolean> {
  if (!defaultBrowserSupported()) return Promise.resolve(false);
  const base =
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https';
  const query = (key: string) =>
    new Promise<string>((resolve) => {
      execFile(
        'reg',
        ['query', `${base}\\${key}`, '/v', 'ProgId'],
        { windowsHide: true, encoding: 'utf8' },
        (error, stdout) => resolve(error ? '' : stdout),
      );
    });
  // Newer Windows 11 builds keep the choice in UserChoiceLatest.
  return Promise.all([query('UserChoiceLatest'), query('UserChoice')]).then(
    ([latest, classic]) => {
      const progId = (output: string) =>
        /ProgId\s+REG_SZ\s+(\S+)/i.exec(output)?.[1] ?? null;
      return (progId(latest) ?? progId(classic)) === PROG_ID;
    },
  );
}

/** Opens Windows Settings on Terra's default apps page. */
export async function openDefaultAppsSettings() {
  await registerAsBrowser();
  await shell
    .openExternal(`ms-settings:defaultapps?registeredAppUser=${NAME}`)
    .catch(() => shell.openExternal('ms-settings:defaultapps').catch(() => {}));
}
