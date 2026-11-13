// Address bar suggestions. Built from open tabs, bookmarks and history on
// this computer. Only if the user turns on "Search suggestions" is the typed
// text also sent to their search engine.
import { net } from 'electron';
import type { SearchEngine } from './shared';
import { remoteSuggestUrl } from './suggest-local';

export {
  localSuggestions,
  type SuggestContext,
  type SuggestResult,
} from './suggest-local';

/** Search suggestions from the engine (OpenSearch JSON: [query, [terms]]). */
export async function remoteSuggestions(
  query: string,
  engine: SearchEngine,
): Promise<string[]> {
  const text = query.trim();
  if (!text) return [];
  try {
    const response = await Promise.race([
      net.fetch(remoteSuggestUrl(engine, text), {
        credentials: 'omit',
      } as RequestInit),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    if (!response || !response.ok) return [];
    const data = (await response.json()) as unknown;
    const terms = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
    return terms.filter((t): t is string => typeof t === 'string').slice(0, 4);
  } catch {
    return [];
  }
}
