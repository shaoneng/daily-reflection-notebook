import {
  assertAuthorized,
  extractTags,
  getStore,
  json,
  noteKey,
  readIndex,
} from "../../_shared.js";

export async function onRequestGet(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const store = getStore(context);
  const index = await readIndex(store);
  const tagSet = new Set();

  for (const date of index.dates) {
    const markdown = await store.get(noteKey(date));
    extractTags(markdown || "").forEach((tag) => tagSet.add(tag));
  }

  return json({
    tags: [...tagSet].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
  });
}
