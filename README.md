<p align="center">
  <img src="assets/icon.png" width="96" alt="Nya logo" />
</p>

<h1 align="center">Nya</h1>

<p align="center">
  A clean, minimal web browser with vertical tabs.
</p>

<p align="center">
  <a href="https://github.com/ttttima/Browser/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/ttttima/Browser?include_prereleases&label=release&color=8b5cf6" /></a>
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-0078d4" />
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-22c55e" /></a>
</p>

<p align="center">
  <img src="docs/screenshot.png" width="860" alt="Nya with vertical tabs on the left and a centered search bar" />
</p>

## Install

**Recommended:** open **PowerShell** and paste this line:

```powershell
irm https://raw.githubusercontent.com/ttttima/Browser/main/install.ps1 | iex
```

It downloads the newest Nya, installs it just for you (no administrator
rights), adds Start menu and desktop shortcuts, and starts it.

**Or download it** from the [Releases](https://github.com/ttttima/Browser/releases)
page:

- `Nya-x.y.z-Setup.exe`: installer
- `Nya-x.y.z-portable.zip`: no install, unzip and run `Nya.exe`

Nya isn't code-signed yet, so Windows may say _"Windows protected your PC"_
for downloaded files. Click **More info → Run anyway**. The PowerShell line
above doesn't trigger this.

## Update

Nya doesn't update by itself yet. Update the same way you installed it:

- **PowerShell line:** paste the same line again. It closes Nya, puts the
  newest version in place and starts it.

  ```powershell
  irm https://raw.githubusercontent.com/ttttima/Browser/main/install.ps1 | iex
  ```

- **Setup.exe:** download the newest `Nya-x.y.z-Setup.exe` from
  [Releases](https://github.com/ttttima/Browser/releases) and run it. It
  replaces the old version.
- **Portable zip:** download the newest zip, close Nya and unzip it over the
  old folder.

Your settings, history and downloads list are kept: they live in
`%APPDATA%\Nya`, not in the app folder.

## Features

- **Vertical tabs** in a sidebar, with a compact icons-only mode and
  scrolling through tabs with the mouse wheel
- **Clean new tab page**: just a search bar, nothing else
- **Quiet address bar**: shows only the site name until you click it
- **History and Downloads** pages: search, reopen and remove visits; pause,
  resume, open and retry downloads
- **Color modes**: dark, light and OLED (pure black), with any accent color
- **Force dark mode**: makes every website dark, without flashing
- **Protected video and music** (DRM) through Google's Widevine, which
  downloads by itself on first launch
- **Smooth dividers**: soft gradients between areas instead of hard lines
- **Your own shortcuts**: bind any action to a key or mouse button, and add
  shortcuts that open your favorite sites
- **Private by default**: websites can't use your camera, microphone,
  location or notifications
- **No admin rights**: installs and runs just for your user

<p align="center">
  <img src="docs/settings.png" width="860" alt="Nya settings: color mode, accent color and layout options" />
</p>

## Uninstall

Open Windows **Settings → Apps → Installed apps**, find **Nya** and choose
**Uninstall**. Your settings and history stay in `%APPDATA%\Nya`; delete that
folder too if you want them gone.

## Build from source

You need [Node.js](https://nodejs.org).

```bash
npm install
npm start          # run in development
npm run make       # build the installer and zip into out/make
```

Nya uses [castLabs Electron](https://github.com/castlabs/electron-releases),
which adds Widevine. Netflix and a few other services also need the app to be
VMP-signed. The build does that automatically when castLabs' free signing
tool is set up:

```bash
pip install castlabs-evs
python -m castlabs_evs.account signup
```

## License

[MIT](LICENSE)
