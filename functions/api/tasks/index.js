import {
  addDateToIndex,
  appendTask,
  assertAuthorized,
  acceptTaskSuggestion,
  emptyMarkdown,
  extractOpenTasks,
  error,
  getStore,
  json,
  mergeCarriedTasks,
  noteKey,
  normalizeTaskStatus,
  readIndex,
  readTaskSuggestions,
  readTasks,
  removeTaskAt,
  removeTaskSuggestionAt,
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
  const carryover = await readCarryoverTasks(store, date, markdown);
  return json({
    date,
    tasks: readTasks(markdown),
    suggestions: readTaskSuggestions(markdown),
    carryover,
    statusLabels: taskStatusLabels(),
  });
}

export async function onRequestStats(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const url = new URL(context.request.url);
  const date = url.searchParams.get("date");
  if (!validateDate(date)) return error("日期格式必须是 YYYY-MM-DD。");

  const store = getStore(context);
  const index = await readIndex(store);
  const start30 = shiftDate(date, -29);
  const start7 = shiftDate(date, -6);
  const dates = index.dates
    .filter((candidate) => candidate >= start30 && candidate <= date)
    .sort((a, b) => a.localeCompare(b));

  const days = [];
  const taskHistory = new Map();
  const totals30 = makeEmptyStatusCounts();
  const totals7 = makeEmptyStatusCounts();

  for (const candidate of dates) {
    const markdown = (await store.get(noteKey(candidate))) || emptyMarkdown(candidate);
    const tasks = readTasks(markdown);
    const counts = countTasksByStatus(tasks);
    addStatusCounts(totals30, counts);
    if (candidate >= start7) addStatusCounts(totals7, counts);

    for (const task of tasks) {
      const key = normalizeTaskKey(task.content);
      if (!key) continue;
      const item = taskHistory.get(key) || {
        content: task.content,
        firstDate: candidate,
        lastDate: candidate,
        dates: [],
        latestStatus: task.status,
        source: task.source || task.carriedFrom || "",
      };
      item.lastDate = candidate;
      item.latestStatus = task.status;
      if (task.source || task.carriedFrom) item.source = task.source || task.carriedFrom;
      item.dates.push(candidate);
      taskHistory.set(key, item);
    }

    days.push({
      date: candidate,
      ...counts,
      total: tasks.length,
    });
  }

  const repeatedOpen = [...taskHistory.values()]
    .filter((task) => (task.latestStatus === "todo" || task.latestStatus === "next") && task.dates.length >= 2)
    .map((task) => ({
      content: task.content,
      firstDate: task.firstDate,
      lastDate: task.lastDate,
      days: task.dates.length,
      ageDays: dayDistance(task.firstDate, date) + 1,
      status: task.latestStatus,
      source: task.source,
    }))
    .sort((a, b) => b.ageDays - a.ageDays || b.days - a.days)
    .slice(0, 5);

  return json({
    date,
    range: {
      weekStart: start7,
      monthStart: start30,
    },
    week: summarizeStatusCounts(totals7),
    month: summarizeStatusCounts(totals30),
    days,
    repeatedOpen,
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
      ...(body.status ? { status: normalizeTaskStatus(body.status) } : {}),
      content: body.content,
      result: body.result,
      reason: body.reason,
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

export async function onRequestSuggestion(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const body = await context.request.json().catch(() => null);
  if (!body || !validateDate(body.date)) return error("日期格式必须是 YYYY-MM-DD。");

  const suggestionIndex = Number(body.suggestionIndex);
  if (!Number.isInteger(suggestionIndex) || suggestionIndex < 0) return error("AI 建议序号不正确。");

  const action = String(body.action || "");
  if (action !== "accept" && action !== "ignore") return error("AI 建议操作不正确。");

  const store = getStore(context);
  const key = noteKey(body.date);
  const current = await store.get(key);
  if (!current) return error("当天还没有记录。", 404);

  let markdown;
  try {
    markdown = action === "accept"
      ? acceptTaskSuggestion(current, suggestionIndex, body.content)
      : removeTaskSuggestionAt(current, suggestionIndex);
  } catch (suggestionError) {
    return error(suggestionError.message || "处理 AI 建议失败。", 404);
  }

  await store.put(key, markdown);
  await addDateToIndex(store, body.date);
  return json({
    date: body.date,
    tasks: readTasks(markdown),
    suggestions: readTaskSuggestions(markdown),
    markdown,
  });
}

export async function onRequestCarryover(context) {
  const authError = assertAuthorized(context);
  if (authError) return authError;

  const body = await context.request.json().catch(() => null);
  if (!body || !validateDate(body.date) || !validateDate(body.fromDate)) {
    return error("日期格式必须是 YYYY-MM-DD。");
  }

  const store = getStore(context);
  const source = await store.get(noteKey(body.fromDate));
  if (!source) return error("没有找到要带入的历史任务。", 404);

  const sourceTasks = extractOpenTasks(source);
  const selectedIndexes = Array.isArray(body.taskIndexes)
    ? body.taskIndexes.map(Number).filter((index) => Number.isInteger(index) && index >= 0)
    : sourceTasks.map((task) => task.index);
  const selectedTasks = sourceTasks.filter((task) => selectedIndexes.includes(task.index));
  if (!selectedTasks.length) return error("没有可带入的未完成任务。");

  const key = noteKey(body.date);
  const current = (await store.get(key)) || emptyMarkdown(body.date);
  const markdown = mergeCarriedTasks(current, selectedTasks, body.fromDate);

  await store.put(key, markdown);
  await addDateToIndex(store, body.date);
  return json({
    date: body.date,
    tasks: readTasks(markdown),
    carryover: await readCarryoverTasks(store, body.date, markdown),
    markdown,
  });
}

async function readCarryoverTasks(store, date, currentMarkdown = "") {
  const index = await readIndex(store);
  const previousDate = index.dates.find((candidate) => candidate < date);
  if (!previousDate) return null;

  const markdown = await store.get(noteKey(previousDate));
  const currentKeys = new Set(readTasks(currentMarkdown).map((task) => normalizeTaskKey(task.content)));
  const tasks = extractOpenTasks(markdown || "").filter((task) => !currentKeys.has(normalizeTaskKey(task.content)));
  if (!tasks.length) return null;

  return {
    fromDate: previousDate,
    tasks,
  };
}

function normalizeTaskKey(content) {
  return String(content || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function makeEmptyStatusCounts() {
  return { todo: 0, next: 0, done: 0, dropped: 0 };
}

function countTasksByStatus(tasks) {
  const counts = makeEmptyStatusCounts();
  for (const task of tasks) {
    counts[normalizeTaskStatus(task.status)] += 1;
  }
  return counts;
}

function addStatusCounts(target, counts) {
  for (const status of Object.keys(target)) target[status] += counts[status] || 0;
}

function summarizeStatusCounts(counts) {
  const open = counts.todo + counts.next;
  const total = open + counts.done + counts.dropped;
  return {
    ...counts,
    open,
    total,
    completionRate: total ? Math.round((counts.done / total) * 100) : 0,
  };
}

function shiftDate(date, offset) {
  const parsed = parseDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return formatDate(parsed);
}

function dayDistance(fromDate, toDate) {
  return Math.max(0, Math.round((parseDate(toDate) - parseDate(fromDate)) / 86400000));
}

function parseDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
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
