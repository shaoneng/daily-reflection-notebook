(function () {
  if (!document.querySelector("#taskTrend") || els.taskTrend) return;

  Object.assign(els, {
    taskTrend: document.querySelector("#taskTrend"),
    taskTrendRange: document.querySelector("#taskTrendRange"),
    taskTrendSummary: document.querySelector("#taskTrendSummary"),
    taskStaleList: document.querySelector("#taskStaleList"),
  });

  const originalRefreshTaskMeta = refreshTaskMeta;
  refreshTaskMeta = async function refreshTaskMetaWithStats() {
    await originalRefreshTaskMeta();
    refreshTaskStats();
  };

  const originalApplyTaskResponse = applyTaskResponse;
  applyTaskResponse = function applyTaskResponseWithStats(data) {
    originalApplyTaskResponse(data);
    refreshTaskStats();
  };

  refreshTaskStats();

  async function refreshTaskStats() {
    try {
      const data = await api(`/api/tasks/stats?date=${encodeURIComponent(state.selectedDate)}`);
      renderTaskStats(data);
    } catch (error) {
      renderTaskStatsError(error);
    }
  }

  function renderTaskStats(data) {
    const week = data.week || {};
    const month = data.month || {};
    const repeatedOpen = Array.isArray(data.repeatedOpen) ? data.repeatedOpen : [];
    els.taskTrendRange.textContent = `${data.range?.monthStart || "近 30 天"} 至 ${data.date || state.selectedDate}`;
    els.taskTrendSummary.innerHTML = [
      renderTaskMetric("近 7 天完成率", `${week.completionRate || 0}%`, `${week.done || 0}/${week.total || 0} 项完成`),
      renderTaskMetric("近 30 天未关闭", `${month.open || 0} 项`, `待验证 ${month.todo || 0}，明日继续 ${month.next || 0}`),
      renderTaskMetric("近 30 天已关闭", `${(month.done || 0) + (month.dropped || 0)} 项`, `完成 ${month.done || 0}，放弃 ${month.dropped || 0}`),
    ].join("");
    els.taskStaleList.innerHTML = repeatedOpen.length
      ? `
        <div class="task-subhead">
          <h4>反复延续</h4>
          <span class="task-count">${repeatedOpen.length} 项</span>
        </div>
        ${repeatedOpen.map(renderRepeatedTask).join("")}
      `
      : '<p class="task-trend-note">近 30 天没有反复延续的未完成任务。</p>';
  }

  function renderTaskMetric(label, value, detail) {
    return `
      <article class="task-metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <p>${escapeHtml(detail)}</p>
      </article>
    `;
  }

  function renderRepeatedTask(task) {
    const statusLabel = TASK_STATUS_LABELS[task.status] || "未关闭";
    const meta = `${task.firstDate} 起，出现 ${task.days} 天，已延续 ${task.ageDays} 天`;
    return `
      <article class="task-stale-item">
        <p>${inlineMarkdownToHtml(task.content)}</p>
        <span>${escapeHtml(statusLabel)}｜${escapeHtml(meta)}</span>
      </article>
    `;
  }

  function renderTaskStatsError(error) {
    els.taskTrendRange.textContent = "近 30 天";
    els.taskTrendSummary.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.taskStaleList.innerHTML = "";
  }
})();
