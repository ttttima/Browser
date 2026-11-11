// What each website may do (camera, notifications...), its zoom, and
// exceptions for the ad blocker and password saving. Saved locally as
// sites.json, keyed by origin ("https://example.com").
import { isText, readJson, saveSoon } from './library';
import type { PermissionDecision, SiteInfo } from './shared';

interface Site {
  permissions: Record<string, PermissionDecision>;
  zoom: number;
  allowAds: boolean;
  neverSavePasswords: boolean;
}

let sites: Record<string, Site> = {};
let onChange = () => {};

const emptySite = (): Site => ({
  permissions: {},
  zoom: 0,
  allowAds: false,
  neverSavePasswords: false,
});

/** Drop sites that no longer have anything special about them. */
function changed(origin: string) {
  const site = sites[origin];
  if (
    site &&
    Object.keys(site.permissions).length === 0 &&
    site.zoom === 0 &&
    !site.allowAds &&
    !site.neverSavePasswords
  ) {
    delete sites[origin];
  }
  saveSoon('sites.json', () => sites);
  onChange();
}

export function initSites(notify: () => void) {
  onChange = notify;
  const saved = readJson('sites.json');
  sites = {};
  if (!saved || typeof saved !== 'object') return;
  for (const [origin, value] of Object.entries(
    saved as Record<string, unknown>,
  )) {
    if (!isText(origin, 512) || !value || typeof value !== 'object') continue;
    const raw = value as Partial<Site>;
    const permissions: Record<string, PermissionDecision> = {};
    for (const [name, decision] of Object.entries(raw.permissions ?? {})) {
      if (isText(name, 64) && (decision === 'allow' || decision === 'block')) {
        permissions[name] = decision;
      }
    }
    sites[origin] = {
      permissions,
      zoom:
        typeof raw.zoom === 'number' ? Math.max(-5, Math.min(5, raw.zoom)) : 0,
      allowAds: raw.allowAds === true,
      neverSavePasswords: raw.neverSavePasswords === true,
    };
  }
}

/** "https://example.com" for a page address, or "" when it has no origin. */
export function originOf(url: string): string {
  try {
    const { protocol, origin } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? origin : '';
  } catch {
    return '';
  }
}

const site = (origin: string) => (sites[origin] ??= emptySite());

export const getPermission = (origin: string, name: string) =>
  sites[origin]?.permissions[name];

export function setPermission(
  origin: string,
  name: string,
  decision: PermissionDecision,
) {
  if (!origin) return;
  site(origin).permissions[name] = decision;
  changed(origin);
}

export const getZoom = (origin: string) => sites[origin]?.zoom ?? 0;

export function setZoom(origin: string, zoom: number) {
  if (!origin) return;
  site(origin).zoom = Math.max(-5, Math.min(5, zoom));
  changed(origin);
}

export const adsAllowed = (origin: string) => sites[origin]?.allowAds === true;

export function setAdsAllowed(origin: string, allow: boolean) {
  if (!origin) return;
  site(origin).allowAds = allow;
  changed(origin);
}

export const passwordsNeverSaved = (origin: string) =>
  sites[origin]?.neverSavePasswords === true;

export function setNeverSavePasswords(origin: string, never: boolean) {
  if (!origin) return;
  site(origin).neverSavePasswords = never;
  changed(origin);
}

export function getSites(): SiteInfo[] {
  return Object.entries(sites)
    .map(([origin, s]) => ({ origin, ...s }))
    .sort((a, b) => a.origin.localeCompare(b.origin));
}

/** Forget everything about one site (or one of its permissions). */
export function resetSite(origin: string, permission?: string) {
  if (!sites[origin]) return;
  if (permission) delete sites[origin].permissions[permission];
  else delete sites[origin];
  changed(origin);
}
