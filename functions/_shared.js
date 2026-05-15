const INDEX_KEY = "notes:index";
const REVIEW_MARKER = "\n\n---\n\n## AI 复盘";

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function text(data, status = 200, headers = {}) {
  return new Response(data, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

export function assertAuthorized(context) {
  const password = context.env.APP_PASSWORD;
  if (!password) return null;

  const authorization = context.request.headers.get("authorization") || "";
  if (authorization === `Bearer ${password}`) return null;
  return error("需要先在设置里输入访问口令。", 401);
}

export function getStore(context) {
  if (!context.env.NOTES_KV) {
    throw new Error("缺少 NOTES_KV 绑定。请在 Cloudflare Pages 里绑定 KV namespace。");
  }
  return context.env.NOTES_KV;
}

export function noteKey(date) {
  return `note:${date}`;
}

export function validateDate(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export function emptyMarkdown(date) {
  return `# ${date}\n\n`;
}

export function stripReview(markdown) {
  const index = markdown.indexOf(REVIEW_MARKER);
  if (index === -1) return markdown;
  return markdown.slice(0, index).trimEnd() + "\n\n";
}

export function appendEntry(markdown, entry) {
  const base = stripReview(markdown || emptyMarkdown(entry.date));
  const safeContent = String(entry.content || "").trim();
  const timezone = String(entry.timezone || "local");
  const time = String(entry.time || "");
  const block = `## ${time}（${timezone}）\n\n${safeContent}\n\n`;
  return `${base.trimEnd()}\n\n${block}`;
}

export function appendReview(markdown, review, generatedAt) {
  const base = stripReview(markdown);
  return `${base.trimEnd()}${REVIEW_MARKER}（${generatedAt}）\n\n${String(review).trim()}\n`;
}

export async function readIndex(store) {
  const raw = await store.get(INDEX_KEY);
  if (!raw) return { dates: [] };
  try {
    const parsed = JSON.parse(raw);
    return { dates: Array.isArray(parsed.dates) ? parsed.dates : [] };
  } catch {
    return { dates: [] };
  }
}

export async function addDateToIndex(store, date) {
  const index = await readIndex(store);
  if (!index.dates.includes(date)) {
    index.dates.push(date);
    index.dates.sort().reverse();
    await store.put(INDEX_KEY, JSON.stringify(index));
  }
}

export function extractTags(markdown) {
  const tags = new Set();
  const matches = String(markdown).matchAll(/(^|[\s([{，。；：])#([\p{L}\p{N}_-]{1,32})/gu);
  for (const match of matches) tags.add(match[2]);
  return [...tags].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function makeSnippet(markdown, query) {
  const compact = String(markdown).replace(/\s+/g, " ").trim();
  const normalized = query.toLowerCase();
  const index = compact.toLowerCase().indexOf(normalized);
  if (index === -1) return compact.slice(0, 140);
  const start = Math.max(0, index - 42);
  const end = Math.min(compact.length, index + normalized.length + 90);
  return `${start > 0 ? "..." : ""}${compact.slice(start, end)}${end < compact.length ? "..." : ""}`;
}
