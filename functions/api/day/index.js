import {
  addDateToIndex,
  appendEntry,
  assertAuthorized,
  emptyMarkdown,
  error,
  getStore,
  json,
  noteKey,
  validateDate,
} from "../../_shared.js";

export async function onRequestGet(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const url = new URL(context.request.url);
  const date = url.searchParams.get("date");
  if (!validateDate(date)) return error("日期格式必须是 YYYY-MM-DD。");

  const store = getStore(context);
  const markdown = await store.get(noteKey(date));
  return json({
    date,
    exists: Boolean(markdown),
    markdown: markdown || emptyMarkdown(date),
  });
}

export async function onRequestPost(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const body = await context.request.json().catch(() => null);
  if (!body || !validateDate(body.date)) return error("日期格式必须是 YYYY-MM-DD。");
  if (!/^\d{2}:\d{2}$/.test(String(body.time || ""))) return error("时间格式必须是 HH:MM。");
  if (!String(body.content || "").trim()) return error("记录内容不能为空。");

  const store = getStore(context);
  const key = noteKey(body.date);
  const current = (await store.get(key)) || emptyMarkdown(body.date);
  const markdown = appendEntry(current, {
    date: body.date,
    time: body.time,
    timezone: body.timezone || "local",
    content: body.content,
  });

  await store.put(key, markdown);
  await addDateToIndex(store, body.date);

  return json({
    date: body.date,
    markdown,
  });
}
