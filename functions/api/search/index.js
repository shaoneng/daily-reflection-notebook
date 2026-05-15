import {
  assertAuthorized,
  getStore,
  json,
  makeSnippet,
  noteKey,
  readIndex,
} from "../../_shared.js";

export async function onRequestGet(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const url = new URL(context.request.url);
  const query = String(url.searchParams.get("q") || "").trim();
  if (!query) return json({ results: [] });

  const store = getStore(context);
  const index = await readIndex(store);
  const normalized = query.toLowerCase();
  const results = [];

  for (const date of index.dates) {
    const markdown = await store.get(noteKey(date));
    if (!markdown) continue;
    if (markdown.toLowerCase().includes(normalized)) {
      results.push({
        date,
        snippet: makeSnippet(markdown, query),
      });
    }
  }

  return json({ results });
}
