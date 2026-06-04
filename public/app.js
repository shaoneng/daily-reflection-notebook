const state = {
  selectedDate: toLocalDate(new Date()),
  activityYear: new Date().getFullYear(),
  password: localStorage.getItem("dailyNotebookPassword") || "",
  reviewMode: localStorage.getItem("dailyNotebookReviewMode") || "learning",
};

const TASK_STATUS_LABELS = {
  todo: "今日待验证",
  next: "明日继续",
  done: "已完成",
  dropped: "已放弃",
};

const els = {
  todayLabel: document.querySelector("#todayLabel"),
  syncStatus: document.querySelector("#syncStatus"),
  selectedDateLabel: document.querySelector("#selectedDateLabel"),
  activityYearLabel: document.querySelector("#activityYearLabel"),
  activityGrid: document.querySelector("#activityGrid"),
  activitySummary: document.querySelector("#activitySummary"),
  prevYearButton: document.querySelector("#prevYearButton"),
  nextYearButton: document.querySelector("#nextYearButton"),
  saveEntryButtons: document.querySelectorAll(".save-entry-button"),
  timelineList: document.querySelector("#timelineList"),
  entryCount: document.querySelector("#entryCount"),
  lastSavedAt: document.querySelector("#lastSavedAt"),
  markdownView: document.querySelector("#markdownView"),
  noteTitle: document.querySelector("#noteTitle"),
  exportLink: document.querySelector("#exportLink"),
  reviewTitle: document.querySelector("#reviewTitle"),
  reviewButton: document.querySelector("#reviewButton"),
  reviewButtonText: document.querySelector("#reviewButtonText"),
  reviewModeButtons: document.querySelectorAll("[data-review-mode]"),
  reviewOutput: document.querySelector("#reviewOutput"),
  taskCount: document.querySelector("#taskCount"),
  taskForm: document.querySelector("#taskForm"),
  taskStatusInput: document.querySelector("#taskStatusInput"),
  taskContentInput: document.querySelector("#taskContentInput"),
  taskList: document.querySelector("#taskList"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  passwordInput: document.querySelector("#passwordInput"),
  savePasswordButton: document.querySelector("#savePasswordButton"),
};

init();

function init() {
  els.todayLabel.textContent = formatFullDate(new Date());
  els.passwordInput.value = state.password;
  syncReviewMode();
  bindEvents();
  refreshDay();
  refreshActivity();
}

function bindEvents() {
  els.saveEntryButtons.forEach((button) => {
    button.addEventListener("click", () => saveEntryFromCard(button.closest(".entry-card")));
  });
  els.reviewButton.addEventListener("click", runReview);
  els.reviewModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewMode = button.dataset.reviewMode || "learning";
      localStorage.setItem("dailyNotebookReviewMode", state.reviewMode);
      syncReviewMode();
    });
  });
  document.querySelectorAll(".entry-input").forEach((textarea) => {
    textarea.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") saveEntryFromCard(textarea.closest(".entry-card"));
    });
  });
  els.exportLink.addEventListener("click", exportMarkdown);
  els.prevYearButton.addEventListener("click", () => {
    navigateActivityMonth(-1);
  });
  els.nextYearButton.addEventListener("click", () => {
    navigateActivityMonth(1);
  });
  els.activityGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-activity-date]");
    if (!button || button.disabled) return;
    selectDate(button.dataset.activityDate);
  });
  els.timelineList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-entry-index]");
    if (!button) return;
    deleteEntry(Number(button.dataset.entryIndex));
  });
  els.taskForm.addEventListener("submit", createTask);
  els.taskList.addEventListener("change", (event) => {
    const select = event.target.closest("[data-task-status]");
    if (!select) return;
    updateTaskStatus(Number(select.dataset.taskStatus), select.value);
  });
  els.taskList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-task]");
    if (!button) return;
    deleteTask(Number(button.dataset.deleteTask));
  });
  els.settingsButton.addEventListener("click", () => {
    els.passwordInput.value = state.password;
    els.settingsDialog.showModal();
  });
  els.savePasswordButton.addEventListener("click", () => {
    state.password = els.passwordInput.value.trim();
    localStorage.setItem("dailyNotebookPassword", state.password);
    setStatus("口令已保存");
  });
}

function selectDate(date) {
  state.selectedDate = date;
  const selected = parseDate(date);
  state.activityYear = selected.getFullYear();
  refreshDay();
  refreshActivity();
}

function navigateActivityMonth(offset) {
  const selected = parseDate(state.selectedDate);
  const targetMonthStart = new Date(selected.getFullYear(), selected.getMonth() + offset, 1);
  const targetMonthLastDay = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0).getDate();
  const targetDay = Math.min(selected.getDate(), targetMonthLastDay);
  selectDate(toLocalDate(new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth(), targetDay)));
}

async function exportMarkdown(event) {
  event.preventDefault();
  try {
    const headers = {};
    if (state.password) headers.authorization = `Bearer ${state.password}`;
    const response = await fetch(`/api/export?date=${encodeURIComponent(state.selectedDate)}`, { headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "导出失败。");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.selectedDate}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showError(error);
  }
}

async function refreshDay() {
  setStatus("同步中");
  els.noteTitle.textContent = state.selectedDate;
  els.selectedDateLabel.textContent = formatShortDate(parseDate(state.selectedDate));
  els.exportLink.href = `/api/export?date=${encodeURIComponent(state.selectedDate)}`;
  try {
    const data = await api(`/api/day?date=${encodeURIComponent(state.selectedDate)}`);
    renderDay(data.markdown || emptyMarkdown(state.selectedDate));
    setStatus(data.exists ? "已同步" : "新日期");
  } catch (error) {
    showError(error);
  }
}

async function saveEntryFromCard(card) {
  const textarea = card?.querySelector(".entry-input");
  const content = textarea?.value.trim() || "";
  if (!content) {
    setStatus("先写一条");
    textarea?.focus();
    return;
  }

  setBusy(true);
  setStatus("保存中");
  try {
    const now = new Date();
    const payload = {
      date: state.selectedDate,
      time: toLocalTime(now),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      content,
    };
    const data = await api("/api/day", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    renderDay(data.markdown);
    textarea.value = "";
    setStatus(`已保存 ${payload.time}`);
    refreshActivity();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function deleteEntry(entryIndex) {
  if (!Number.isInteger(entryIndex)) return;
  const confirmed = window.confirm("确定删除这条记录吗？");
  if (!confirmed) return;

  setBusy(true);
  setStatus("删除中");
  try {
    const data = await api("/api/day", {
      method: "DELETE",
      body: JSON.stringify({
        date: state.selectedDate,
        entryIndex,
      }),
    });
    renderDay(data.markdown);
    setStatus("已删除");
    refreshActivity();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runReview() {
  setBusy(true);
  const isLearningMode = state.reviewMode === "learning";
  setStatus(isLearningMode ? "学习复盘中" : "复盘中");
  els.reviewOutput.innerHTML = `<p>正在生成${isLearningMode ? "学习复盘" : "日常复盘"}...</p>`;
  try {
    const data = await api("/api/review", {
      method: "POST",
      body: JSON.stringify({
        date: state.selectedDate,
        mode: state.reviewMode,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      }),
    });
    renderReview(data.review);
    renderDay(data.markdown);
    setStatus(isLearningMode ? "学习复盘完成" : "复盘完成");
  } catch (error) {
    showReviewError(error);
  } finally {
    setBusy(false);
  }
}

async function createTask(event) {
  event.preventDefault();
  const content = els.taskContentInput.value.trim();
  if (!content) {
    setStatus("先写下一步");
    els.taskContentInput.focus();
    return;
  }

  setBusy(true);
  setStatus("添加中");
  try {
    const data = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        date: state.selectedDate,
        status: els.taskStatusInput.value,
        content,
      }),
    });
    renderDay(data.markdown);
    els.taskContentInput.value = "";
    setStatus("已添加下一步");
  } catch (error) {
    showTaskError(error);
  } finally {
    setBusy(false);
  }
}

async function updateTaskStatus(taskIndex, status) {
  if (!Number.isInteger(taskIndex)) return;

  setBusy(true);
  setStatus("更新中");
  try {
    const data = await api("/api/tasks", {
      method: "PATCH",
      body: JSON.stringify({
        date: state.selectedDate,
        taskIndex,
        status,
      }),
    });
    renderDay(data.markdown);
    setStatus("下一步已更新");
  } catch (error) {
    showTaskError(error);
    refreshDay();
  } finally {
    setBusy(false);
  }
}

async function deleteTask(taskIndex) {
  if (!Number.isInteger(taskIndex)) return;
  const confirmed = window.confirm("确定删除这个下一步吗？");
  if (!confirmed) return;

  setBusy(true);
  setStatus("删除中");
  try {
    const data = await api("/api/tasks", {
      method: "DELETE",
      body: JSON.stringify({
        date: state.selectedDate,
        taskIndex,
      }),
    });
    renderDay(data.markdown);
    setStatus("下一步已删除");
  } catch (error) {
    showTaskError(error);
  } finally {
    setBusy(false);
  }
}

async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {}),
  };
  if (state.password) headers.authorization = `Bearer ${state.password}`;
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || "请求失败" };
  }
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

async function refreshActivity() {
  els.activityYearLabel.textContent = `${state.activityYear} 年`;
  try {
    const data = await api(`/api/activity?year=${encodeURIComponent(state.activityYear)}`);
    renderActivity(data);
  } catch (error) {
    els.activitySummary.textContent = error.message;
  }
}

function renderActivity(data) {
  const year = data.year || state.activityYear;
  state.activityYear = year;
  els.activityYearLabel.textContent = `${year} 年`;
  els.activitySummary.textContent = data.totalEntries
    ? `${data.totalDays} 天有记录，共 ${data.totalEntries} 条`
    : "这一年还没有记录";

  const countByDate = new Map((data.days || []).map((day) => [day.date, day.count]));
  const today = toLocalDate(new Date());
  const selected = parseDate(state.selectedDate);
  const month = selected.getFullYear() === year ? selected.getMonth() : 0;

  els.activityGrid.innerHTML = renderActivityMonth(year, month, countByDate, today);
}

function renderActivityMonth(year, month, countByDate, today) {
  const monthDate = new Date(year, month, 1);
  const monthName = new Intl.DateTimeFormat("zh-CN", { month: "long" }).format(monthDate);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = (monthDate.getDay() + 6) % 7;
  const cells = [
    ...Array.from({ length: leadingBlanks }, () => '<span class="month-blank"></span>'),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const date = new Date(year, month, index + 1);
      const value = toLocalDate(date);
      const count = countByDate.get(value) || 0;
      const level = activityLevel(count);
      return `
        <button class="activity-day${value === state.selectedDate ? " selected" : ""}${value === today ? " today" : ""}" type="button" data-level="${level}" data-activity-date="${value}" aria-label="${value}，${count} 条记录" title="${value}：${count} 条记录">
          ${index + 1}
        </button>
      `;
    }),
  ];

  return `
    <section class="month-activity" aria-label="${year} 年 ${monthName}">
      <h3>${monthName}</h3>
      <div class="month-weekdays" aria-hidden="true">
        <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
      </div>
      <div class="month-grid">${cells.join("")}</div>
    </section>
  `;
}

function activityLevel(count) {
  if (!count) return 0;
  return Math.min(Math.ceil(count / 10), 20);
}

function renderDay(markdown) {
  const entries = parseEntries(markdown);
  const review = parseLatestReview(markdown);
  const tasks = parseTasks(markdown);
  els.markdownView.textContent = markdown;
  els.entryCount.textContent = `${entries.length} 条记录`;
  els.lastSavedAt.textContent = entries.length ? `最近 ${entries.at(-1).time}` : "还没有开始";
  renderTasks(tasks);
  els.timelineList.innerHTML = entries.length
    ? entries.map(renderTimelineItem).join("")
    : '<div class="empty-state">这一天还没有记录。先在上面的输入框写一条。</div>';
  if (review) {
    renderReview(review);
  } else {
    resetReviewOutput();
  }
}

function renderTimelineItem(entry) {
  return `
    <article class="timeline-item">
      <time class="timeline-time">${escapeHtml(entry.time)}</time>
      <div class="timeline-content">
        <p>${escapeHtml(entry.content)}</p>
      </div>
      <button class="delete-entry-button" type="button" data-entry-index="${entry.index}" aria-label="删除 ${escapeAttr(entry.time)} 的记录" title="删除这条记录">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button>
    </article>
  `;
}

function parseEntries(markdown) {
  const lines = markdown.split("\n");
  const entries = [];
  let current = null;
  let entryIndex = 0;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (current) entries.push(normalizeEntry(current));
      if (heading[1].startsWith("AI 复盘")) {
        current = null;
        break;
      }
      if (heading[1].startsWith("下一步追踪")) {
        current = null;
        continue;
      }
      current = { heading: heading[1], index: entryIndex, lines: [] };
      entryIndex += 1;
      continue;
    }
    if (!current || line.trim() === "---") continue;
    current.lines.push(line);
  }

  if (current) entries.push(normalizeEntry(current));
  return entries.filter((entry) => entry.content);
}

function parseTasks(markdown) {
  const reviewIndex = markdown.indexOf("## AI 复盘");
  const base = reviewIndex === -1 ? markdown : markdown.slice(0, reviewIndex);
  const taskIndex = base.indexOf("## 下一步追踪");
  if (taskIndex === -1) return [];
  const lines = base.slice(taskIndex).split("\n");
  const tasks = [];

  for (const line of lines) {
    const match = line.match(/^-\s+\[([a-z]+)\]\s+(.+)$/);
    if (!match) continue;
    const status = TASK_STATUS_LABELS[match[1]] ? match[1] : "todo";
    const content = match[2].trim();
    if (!content) continue;
    tasks.push({
      index: tasks.length,
      status,
      content,
    });
  }

  return tasks;
}

function renderTasks(tasks) {
  els.taskCount.textContent = `${tasks.length} 项`;
  els.taskList.innerHTML = tasks.length
    ? tasks.map(renderTaskItem).join("")
    : '<div class="empty-state">复盘后会自动沉淀下一步，也可以手动添加。</div>';
}

function renderTaskItem(task) {
  const options = Object.entries(TASK_STATUS_LABELS)
    .map(([value, label]) => `<option value="${value}"${value === task.status ? " selected" : ""}>${label}</option>`)
    .join("");
  return `
    <article class="task-item" data-task-state="${escapeAttr(task.status)}">
      <select data-task-status="${task.index}" aria-label="更新下一步状态">
        ${options}
      </select>
      <p>${escapeHtml(task.content)}</p>
      <button class="delete-entry-button" type="button" data-delete-task="${task.index}" aria-label="删除下一步" title="删除这个下一步">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button>
    </article>
  `;
}

function normalizeEntry(entry) {
  const content = entry.lines.join("\n").trim();
  return {
    index: entry.index,
    time: formatEntryTime(entry.heading),
    content,
  };
}

function formatEntryTime(heading) {
  const match = heading.match(/\d{2}:\d{2}/);
  return match ? match[0] : heading;
}

function parseLatestReview(markdown) {
  const reviewIndex = markdown.lastIndexOf("## AI 复盘");
  if (reviewIndex === -1) return "";
  return markdown.slice(reviewIndex).replace(/^## AI 复盘[^\n]*\n?/, "").trim();
}

function renderReview(markdown) {
  els.reviewOutput.innerHTML = markdownToHtml(markdown);
}

function resetReviewOutput() {
  els.reviewOutput.innerHTML = `<p>还没有生成${state.reviewMode === "learning" ? "学习复盘" : "复盘"}。</p>`;
}

function syncReviewMode() {
  const isLearningMode = state.reviewMode !== "daily";
  state.reviewMode = isLearningMode ? "learning" : "daily";
  els.reviewTitle.textContent = isLearningMode ? "AI 学习复盘" : "AI 日常复盘";
  els.reviewButtonText.textContent = isLearningMode ? "生成学习复盘" : "生成日常复盘";
  els.reviewModeButtons.forEach((button) => {
    const isActive = button.dataset.reviewMode === state.reviewMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function markdownToHtml(markdown) {
  const lines = markdown.split("\n");
  let html = "";
  let inList = false;

  for (const line of lines) {
    if (line.startsWith("### ")) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<h4>${escapeHtml(line.slice(4))}</h4>`;
    } else if (line.startsWith("- ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${escapeHtml(line.slice(2))}</li>`;
    } else if (line.trim()) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }

  if (inList) html += "</ul>";
  return html || "<p>还没有生成复盘。</p>";
}

function setBusy(isBusy) {
  els.saveEntryButtons.forEach((button) => {
    button.disabled = isBusy;
  });
  els.reviewButton.disabled = isBusy;
  els.taskForm.querySelectorAll("button,input,select").forEach((control) => {
    control.disabled = isBusy;
  });
  els.taskList.querySelectorAll("button,select").forEach((control) => {
    control.disabled = isBusy;
  });
  els.timelineList.querySelectorAll("[data-entry-index]").forEach((button) => {
    button.disabled = isBusy;
  });
}

function setStatus(message) {
  els.syncStatus.textContent = message;
}

function showError(error) {
  console.error(error);
  setStatus("出错");
  els.timelineList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  els.markdownView.textContent = error.message;
}

function showReviewError(error) {
  console.error(error);
  setStatus("出错");
  els.reviewOutput.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
}

function showTaskError(error) {
  console.error(error);
  setStatus("出错");
  els.taskList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
}

function emptyMarkdown(date) {
  return `# ${date}\n\n`;
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatFullDate(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function toLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalTime(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
