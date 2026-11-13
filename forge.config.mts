import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { spawnSync } from 'node:child_process';

// Widevine VMP signing, which Netflix and some other services require. It
// runs automatically when castLabs' tool is installed and signed in
// (`pip install castlabs-evs`, then `python -m castlabs_evs.account signup`).
// Without it the build still works and plays most protected media.
function vmpSign(appDir: string) {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const check = spawnSync(python, ['-c', 'import castlabs_evs'], {
    stdio: 'ignore',
  });
  if (check.status !== 0) {
    console.warn('VMP signing skipped: castlabs-evs is not installed.');
    return;
  }
  // No input: if no castLabs account is signed in, fail instead of waiting
  // for someone to type one.
  const result = spawnSync(
    python,
    ['-m', 'castlabs_evs.vmp', 'sign-pkg', appDir],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (result.status !== 0) {
    console.warn(
      'VMP signing failed, the build is unsigned. Sign in with ' +
        '`python -m castlabs_evs.account signup` (or `reauth`) and build again.',
    );
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // App icon: assets/icon.ico on Windows (.icns on macOS if added later).
    icon: 'assets/icon',
    executableName: 'Terra',
    // Package castLabs Electron (with Widevine), not the stock one.
    download: {
      mirrorOptions: {
        mirror:
          'https://github.com/castlabs/electron-releases/releases/download/',
      },
    },
  },
  rebuildConfig: {},
  hooks: {
    // After packaging, so the signature covers the final Terra.exe.
    postPackage: async (_config, { outputPaths, platform }) => {
      if (platform !== 'win32' && platform !== 'darwin') return;
      for (const dir of outputPaths) vmpSign(dir);
    },
  },
  makers: [
    new MakerSquirrel({
      setupIcon: 'assets/icon.ico',
      // Shown in Windows "Installed apps"; must be a web address.
      iconUrl:
        'https://raw.githubusercontent.com/ttttima/Terra-Browser/main/assets/icon.ico',
    }),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
        {
          // Runs inside website tabs (dark mode forcer).
          entry: 'src/tab-preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
