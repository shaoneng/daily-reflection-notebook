import {
  assertAuthorized,
  getStore,
  json,
  noteKey,
  readIndex,
  stripReview,
} from "../../_shared.js";

export async function onRequestGet(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const url = new URL(context.request.url);
  const requestedYear = Number(url.searchParams.get("year"));
  const currentYear = new Date().getFullYear();
  const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100 ? requestedYear : currentYear;

  const store = getStore(context);
  const index = await readIndex(store);
  const years = new Set([currentYear, year]);
  const days = [];
  let totalEntries = 0;
  let maxCount = 0;

  for (const date of index.dates) {
    const dateYear = Number(date.slice(0, 4));
    if (dateYear) years.add(dateYear);
    if (dateYear !== year) continue;

    const markdown = await store.get(noteKey(date));
    const count = countEntries(markdown || "");
    if (!count) continue;

    days.push({ date, count });
    totalEntries += count;
    maxCount = Math.max(maxCount, count);
  }

  days.sort((a, b) => a.date.localeCompare(b.date));

  return json({
    year,
    years: [...years].sort((a, b) => b - a),
    days,
    maxCount,
    totalDays: days.length,
    totalEntries,
  });
}

function countEntries(markdown) {
  return stripReview(markdown)
    .split("\n")
    .filter((line) => /^##\s+/.test(line) && !line.startsWith("## AI 复盘"))
    .length;
}
