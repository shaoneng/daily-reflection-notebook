import {
  addDateToIndex,
  appendTask,
  assertAuthorized,
  emptyMarkdown,
  error,
  getStore,
  json,
  noteKey,
  normalizeTaskStatus,
  readTasks,
  removeTaskAt,
  taskStatusLabels,
  updateTaskAt,
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
  return json({
    date,
    tasks: readTasks(markdown),
    statusLabels: taskStatusLabels(),
  });
}

export async function onRequestPost(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const body = await context.request.json().catch(() => null);
  if (!body || !validateDate(body.date)) return error("日期格式必须是 YYYY-MM-DD。");

  const store = getStore(context);
  const key = noteKey(body.date);
  const current = (await store.get(key)) || emptyMarkdown(body.date);
  let markdown;
  try {
    markdown = appendTask(current, {
      status: normalizeTaskStatus(body.status),
      content: body.content,
    });
  } catch (taskError) {
    return error(taskError.message || "新增下一步失败。");
  }

  await store.put(key, markdown);
  await addDateToIndex(store, body.date);
  return json({
    date: body.date,
    tasks: readTasks(markdown),
    markdown,
  });
}

export async function onRequestPatch(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const body = await context.request.json().catch(() => null);
  if (!body || !validateDate(body.date)) return error("日期格式必须是 YYYY-MM-DD。");

  const taskIndex = Number(body.taskIndex);
  if (!Number.isInteger(taskIndex) || taskIndex < 0) return error("下一步序号不正确。");

  const store = getStore(context);
  const key = noteKey(body.date);
  const current = await store.get(key);
  if (!current) return error("当天还没有记录。", 404);

  let markdown;
  try {
    markdown = updateTaskAt(current, taskIndex, {
      status: normalizeTaskStatus(body.status),
      content: body.content,
    });
  } catch (taskError) {
    return error(taskError.message || "更新下一步失败。", 404);
  }

  await store.put(key, markdown);
  await addDateToIndex(store, body.date);
  return json({
    date: body.date,
    tasks: readTasks(markdown),
    markdown,
  });
}

export async function onRequestDelete(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const body = await context.request.json().catch(() => null);
  if (!body || !validateDate(body.date)) return error("日期格式必须是 YYYY-MM-DD。");

  const taskIndex = Number(body.taskIndex);
  if (!Number.isInteger(taskIndex) || taskIndex < 0) return error("下一步序号不正确。");

  const store = getStore(context);
  const key = noteKey(body.date);
  const current = await store.get(key);
  if (!current) return error("当天还没有记录。", 404);

  let markdown;
  try {
    markdown = removeTaskAt(current, taskIndex);
  } catch (taskError) {
    return error(taskError.message || "删除下一步失败。", 404);
  }

  await store.put(key, markdown);
  await addDateToIndex(store, body.date);
  return json({
    date: body.date,
    tasks: readTasks(markdown),
    markdown,
  });
}
