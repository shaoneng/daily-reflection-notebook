import {
  assertAuthorized,
  emptyMarkdown,
  error,
  getStore,
  noteKey,
  text,
  validateDate,
} from "../../_shared.js";

export async function onRequestGet(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const url = new URL(context.request.url);
  const date = url.searchParams.get("date");
  if (!validateDate(date)) return error("日期格式必须是 YYYY-MM-DD。");

  const store = getStore(context);
  const markdown = (await store.get(noteKey(date))) || emptyMarkdown(date);
  return text(markdown, 200, {
    "content-disposition": `attachment; filename="${date}.md"`,
  });
}
