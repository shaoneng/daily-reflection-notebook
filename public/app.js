const state = {
  selectedDate: toLocalDate(new Date()),
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  password: localStorage.getItem("dailyNotebookPassword") || "",
};

const els = {
  todayLabel: document.querySelector("#todayLabel"),
  syncStatus: document.querySelector("#syncStatus"),
  datePicker: document.querySelector("#datePicker"),
  selectedDateLabel: document.querySelector("#selectedDateLabel"),
  calendarMonthLabel: document.querySelector("#calendarMonthLabel"),
  calendarGrid: document.querySelector("#calendarGrid"),
  prevMonthButton: document.querySelector("#prevMonthButton"),
  nextMonthButton: document.querySelector("#nextMonthButton"),
  saveEntryButtons: document.querySelectorAll(".save-entry-button"),
  timelineList: document.querySelector("#timelineList"),
  entryCount: document.querySelector("#entryCount"),
  lastSavedAt: document.querySelector("#lastSavedAt"),
  markdownView: document.querySelector("#markdownView"),
  noteTitle: document.querySelector("#noteTitle"),
  exportLink: document.querySelector("#exportLink"),
  reviewButton: document.querySelector("#reviewButton"),
  reviewOutput: document.querySelector("#reviewOutput"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  passwordInput: document.querySelector("#passwordInput"),
  savePasswordButton: document.querySelector("#savePasswordButton"),
};

init();

function init() {
  els.datePicker.value = state.selectedDate;
  els.todayLabel.textContent = formatFullDate(new Date());
  els.passwordInput.value = state.password;
  bindEvents();
  renderCalendar();
  refreshDay();
}

function bindEvents() {
  els.saveEntryButtons.forEach((button) => {
    button.addEventListener("click", () => saveEntryFromCard(button.closest(".entry-card")));
  });
  els.reviewButton.addEventListener("click", runReview);
  document.querySelectorAll(".entry-input").forEach((textarea) => {
    textarea.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") saveEntryFromCard(textarea.closest(".entry-card"));
    });
  });
  els.exportLink.addEventListener("click", exportMarkdown);
  els.datePicker.addEventListener("change", () => {
    selectDate(els.datePicker.value || toLocalDate(new Date()));
  });
  els.calendarGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-calendar-date]");
    if (!button) return;
    selectDate(button.dataset.calendarDate);
  });
  els.prevMonthButton.addEventListener("click", () => {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  els.nextMonthButton.addEventListener("click", () => {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  els.timelineList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-entry-index]");
    if (!button) return;
    deleteEntry(Number(button.dataset.entryIndex));
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
  els.datePicker.value = date;
  const selected = parseDate(date);
  state.calendarMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
  renderCalendar();
  refreshDay();
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
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runReview() {
  setBusy(true);
  setStatus("复盘中");
  els.reviewOutput.innerHTML = "<p>正在复盘今日记录...</p>";
  try {
    const data = await api("/api/review", {
      method: "POST",
      body: JSON.stringify({
        date: state.selectedDate,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      }),
    });
    renderReview(data.review);
    renderDay(data.markdown);
    setStatus("复盘完成");
  } catch (error) {
    showReviewError(error);
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

function renderCalendar() {
  const year = state.calendarMonth.getFullYear();
  const month = state.calendarMonth.getMonth();
  const today = toLocalDate(new Date());
  els.calendarMonthLabel.textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(state.calendarMonth);

  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const value = toLocalDate(date);
    const isCurrentMonth = date.getMonth() === month;
    return `
      <button class="calendar-day${value === state.selectedDate ? " selected" : ""}${value === today ? " today" : ""}${isCurrentMonth ? "" : " muted"}" type="button" data-calendar-date="${value}">
        ${date.getDate()}
      </button>
    `;
  });
  els.calendarGrid.innerHTML = days.join("");
}

function renderDay(markdown) {
  const entries = parseEntries(markdown);
  const review = parseLatestReview(markdown);
  els.markdownView.textContent = markdown;
  els.entryCount.textContent = `${entries.length} 条记录`;
  els.lastSavedAt.textContent = entries.length ? `最近 ${entries.at(-1).time}` : "还没有开始";
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
  const tags = extractTags(entry.content);
  return `
    <article class="timeline-item">
      <time class="timeline-time">${escapeHtml(entry.time)}</time>
      <div class="timeline-content">
        <p>${escapeHtml(entry.content)}</p>
        ${tags.length ? `<div class="inline-tags">${tags.map((tag) => `<span class="inline-tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
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
  els.reviewOutput.innerHTML = "<p>还没有生成复盘。</p>";
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

function extractTags(content) {
  return Array.from(new Set(content.match(/#[^\s#，。,.；;！!？?、）)（(]+/g) || []));
}

function setBusy(isBusy) {
  els.saveEntryButtons.forEach((button) => {
    button.disabled = isBusy;
  });
  els.reviewButton.disabled = isBusy;
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
