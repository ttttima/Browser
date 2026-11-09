<p align="center"><img src="assets/icon.png" width="96" alt="Nya logo" /></p>

<h1 align="center">Nya</h1>

Nya is a clean, minimal desktop web browser with vertical tabs, built with Electron.

![Screenshot of Nya: vertical tabs on the left and a centered search bar](docs/screenshot.png)

## Features

- **Vertical tabs** in a sidebar, with a compact icons-only mode
- **Clean new tab page**: just a search bar, nothing else
- **Quiet address bar**: shows only the site name until you click it
- **Color modes**: dark, light and OLED (pure black), plus any accent color
- **Force dark mode**: makes every website dark, without flashing
- **Smooth dividers**: soft gradients between areas instead of hard lines
- **Your own shortcuts**: bind any action to a key or mouse button, and add
  custom shortcuts that open your favorite sites
- **Scroll through tabs** with the mouse wheel over the sidebar
- **Privacy by default**: websites can't use your camera, microphone,
  location or notifications

## Run it yourself

You need [Node.js](https://nodejs.org) installed.

```bash
npm install
npm start
```

To build an installer: `npm run make` (the result is in `out/make`).
