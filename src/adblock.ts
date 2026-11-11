// Ad and tracker blocking by domain. The blocklist (the public StevenBlack
// hosts list of ad and tracking domains) is downloaded once a week and kept
// in the user data folder; what you browse never leaves the computer.
//
// Only requests made by a page are blocked (images, scripts, frames...),
// never the page you open yourself, and never on sites you allowed.
import { app, net, type Session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const LIST_URL =
  'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts';
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

// Used until the full list has been downloaded the first time.
const STARTER = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'adservice.google.com',
  'adnxs.com',
  'adsrvr.org',
  'amazon-adsystem.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'scorecardresearch.com',
  'quantserve.com',
  'moatads.com',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'casalemedia.com',
  'hotjar.com',
  'mixpanel.com',
  'segment.io',
  'facebook.net',
  'ads-twitter.com',
  'bat.bing.com',
  'adform.net',
  'smartadserver.com',
  'yieldmo.com',
  'teads.tv',
];

let blocked = new Set<string>(STARTER);
const listFile = () => path.join(app.getPath('userData'), 'adblock-hosts.txt');

function parseHosts(text: string): Set<string> {
  const domains = new Set<string>();
  for (const line of text.split('\n')) {
    const match = /^\s*(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s#]+)/.exec(line);
    if (!match) continue;
    const domain = match[1].toLowerCase();
    if (domain !== 'localhost' && domain.includes('.')) domains.add(domain);
  }
  return domains;
}

async function refreshList() {
  try {
    const response = await net.fetch(LIST_URL);
    if (!response.ok) return;
    const text = await response.text();
    const domains = parseHosts(text);
    // A real list has tens of thousands of entries; ignore broken downloads.
    if (domains.size < 1000) return;
    blocked = domains;
    fs.writeFileSync(listFile(), text);
  } catch {
    // Offline: keep using what we have and try again next start.
  }
}

/** Loads the saved list, and downloads a fresh one if it's old or missing. */
export function initAdblock() {
  let age = Infinity;
  try {
    const stat = fs.statSync(listFile());
    age = Date.now() - stat.mtimeMs;
    const domains = parseHosts(fs.readFileSync(listFile(), 'utf-8'));
    if (domains.size >= 1000) blocked = domains;
  } catch {
    // Not downloaded yet.
  }
  if (age > REFRESH_MS) void refreshList();
}

/** Is this host, or a domain it belongs to, on the list? */
function isListed(host: string) {
  let domain = host.toLowerCase();
  while (domain.includes('.')) {
    if (blocked.has(domain)) return true;
    domain = domain.slice(domain.indexOf('.') + 1);
  }
  return false;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/**
 * Blocks listed requests in a session. `enabledFor` gets the address of the
 * page making the request and says whether blocking is on there.
 */
export function attachAdblock(
  session: Session,
  enabledFor: (pageUrl: string) => boolean,
) {
  session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      if (details.resourceType === 'mainFrame') return callback({});
      const pageUrl = details.webContents?.getURL() ?? details.referrer ?? '';
      if (!enabledFor(pageUrl)) return callback({});
      const host = hostOf(details.url);
      const pageHost = hostOf(pageUrl);
      // Visiting a listed site on purpose: let it load its own parts.
      if (!host || (pageHost && isListed(pageHost))) return callback({});
      callback({ cancel: isListed(host) });
    },
  );
}
