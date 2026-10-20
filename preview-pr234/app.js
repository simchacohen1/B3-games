(() => {
  "use strict";

  const STORAGE_KEY = "workTimerDataV1";
  const THEME_KEY = "workTimerTheme";
  const $ = (id) => document.getElementById(id);

  const elements = {
    timerDisplay: $("timerDisplay"),
    liveEarnings: $("liveEarnings"),
    statusPill: $("statusPill"),
    startBtn: $("startBtn"),
    pauseBtn: $("pauseBtn"),
    stopBtn: $("stopBtn"),
    currentClientInput: $("currentClientInput"),
    rateInput: $("rateInput"),
    rateLabel: $("rateLabel"),
    todayTime: $("todayTime"),
    todayPay: $("todayPay"),
    weekTime: $("weekTime"),
    weekPay: $("weekPay"),
    monthTime: $("monthTime"),
    monthPay: $("monthPay"),
    sessionBody: $("sessionBody"),
    emptyState: $("emptyState"),
    addManualBtn: $("addManualBtn"),
    exportBtn: $("exportBtn"),
    exportPdfBtn: $("exportPdfBtn"),
    backupBtn: $("backupBtn"),
    restoreInput: $("restoreInput"),
    themeBtn: $("themeBtn"),
    dialog: $("sessionDialog"),
    form: $("sessionForm"),
    dialogTitle: $("dialogTitle"),
    closeDialogBtn: $("closeDialogBtn"),
    cancelDialogBtn: $("cancelDialogBtn"),
    sessionIdInput: $("sessionIdInput"),
    clientInput: $("clientInput"),
    dateInput: $("dateInput"),
    startTimeInput: $("startTimeInput"),
    stopTimeInput: $("stopTimeInput"),
    notesInput: $("notesInput"),
    formError: $("formError"),
    exportDialog: $("exportDialog"),
    exportForm: $("exportForm"),
    closeExportDialogBtn: $("closeExportDialogBtn"),
    cancelExportBtn: $("cancelExportBtn"),
    exportFromInput: $("exportFromInput"),
    exportToInput: $("exportToInput"),
    exportClientInput: $("exportClientInput"),
    exportPreview: $("exportPreview"),
    exportError: $("exportError"),
    confirmCsvBtn: $("confirmCsvBtn"),
    confirmPdfBtn: $("confirmPdfBtn")
  };

  const defaultState = {
    rate: 50,
    currentClient: "",
    sessions: [],
    active: null
  };

  let state = loadState();
  let ticker = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return {
        ...defaultState,
        ...saved,
        sessions: Array.isArray(saved?.sessions) ? saved.sessions : []
      };
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  function formatMoney(ms, rate = state.rate) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format((ms / 3600000) * rate);
  }

  function formatDate(timestamp) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(new Date(timestamp));
  }

  function formatTime(timestamp) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(timestamp));
  }

  function activeElapsed(now = Date.now()) {
    if (!state.active) return 0;
    const currentSegment = state.active.status === "running"
      ? now - state.active.segmentStartedAt
      : 0;
    return state.active.elapsedBeforeSegment + currentSegment;
  }

  function startTimer() {
    const client = elements.currentClientInput.value.trim();
    if (!state.active && !client) {
      alert("Please enter a client name before starting the timer.");
      elements.currentClientInput.focus();
      return;
    }
    state.currentClient = client;
    if (!state.active) {
      state.active = {
        startedAt: Date.now(),
        segmentStartedAt: Date.now(),
        elapsedBeforeSegment: 0,
        status: "running",
        client
      };
    } else if (state.active.status === "paused") {
      state.active.segmentStartedAt = Date.now();
      state.active.status = "running";
    }
    saveState();
    render();
  }

  function pauseTimer() {
    if (!state.active || state.active.status !== "running") return;
    state.active.elapsedBeforeSegment = activeElapsed();
    state.active.segmentStartedAt = null;
    state.active.status = "paused";
    saveState();
    render();
  }

  function stopTimer() {
    if (!state.active) return;
    const elapsed = activeElapsed();
    if (elapsed < 1000 && !confirm("This session is under one second. Save it anyway?")) return;

    const end = Date.now();
    const start = end - elapsed;
    state.sessions.push({
      id: uid(),
      start,
      end,
      client: state.active.client || state.currentClient || "Unspecified",
      notes: "",
      rate: state.rate
    });
    state.active = null;
    saveState();
    render();
  }

  function sessionDuration(session) {
    return Math.max(0, session.end - session.start);
  }

  function startOfDay(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function startOfWeek(date = new Date()) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = copy.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    copy.setDate(copy.getDate() + diff);
    return copy.getTime();
  }

  function startOfMonth(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  }

  function totalSince(timestamp) {
    return state.sessions
      .filter((session) => session.start >= timestamp)
      .reduce((total, session) => total + sessionDuration(session), 0);
  }

  function renderTimer() {
    const elapsed = activeElapsed();
    elements.timerDisplay.textContent = formatDuration(elapsed);
    elements.liveEarnings.textContent = formatMoney(elapsed);

    const status = state.active?.status ?? "stopped";
    const labels = {
      running: "WORKING",
      paused: "PAUSED",
      stopped: "NOT RUNNING"
    };

    elements.statusPill.className = `status-pill ${status}`;
    elements.statusPill.textContent = labels[status];

    elements.startBtn.disabled = status === "running";
    elements.startBtn.textContent = status === "paused" ? "▶ Resume" : "▶ Start";
    elements.pauseBtn.disabled = status !== "running";
    elements.stopBtn.disabled = status === "stopped";

    if (status === "running" && !ticker) {
      ticker = setInterval(() => {
        renderTimer();
        renderSummaries();
      }, 500);
    } else if (status !== "running" && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function renderSummaries() {
    const active = state.active ? activeElapsed() : 0;
    const now = new Date();
    const today = totalSince(startOfDay(now)) + active;
    const week = totalSince(startOfWeek(now)) + active;
    const month = totalSince(startOfMonth(now)) + active;

    elements.todayTime.textContent = formatDuration(today);
    elements.todayPay.textContent = formatMoney(today);
    elements.weekTime.textContent = formatDuration(week);
    elements.weekPay.textContent = formatMoney(week);
    elements.monthTime.textContent = formatDuration(month);
    elements.monthPay.textContent = formatMoney(month);
  }

  function renderSessions() {
    const sessions = [...state.sessions].sort((a, b) => b.start - a.start);
    elements.sessionBody.innerHTML = "";
    elements.emptyState.hidden = sessions.length > 0;

    for (const session of sessions) {
      const duration = sessionDuration(session);
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(session.client || "Unspecified")}</td>
        <td>${formatDate(session.start)}</td>
        <td>${formatTime(session.start)}</td>
        <td>${formatTime(session.end)}</td>
        <td>${formatDuration(duration)}</td>
        <td>${formatMoney(duration, session.rate ?? state.rate)}</td>
        <td class="notes-cell" title="${escapeHtml(session.notes || "")}">${escapeHtml(session.notes || "—")}</td>
        <td>
          <div class="row-actions">
            <button class="mini-btn" data-edit="${session.id}" type="button">Edit</button>
            <button class="mini-btn delete" data-delete="${session.id}" type="button">Delete</button>
          </div>
        </td>
      `;
      elements.sessionBody.appendChild(row);
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function render() {
    elements.rateInput.value = Number(state.rate).toFixed(2);
    elements.currentClientInput.value = state.active?.client ?? state.currentClient ?? "";
    elements.currentClientInput.disabled = Boolean(state.active);
    elements.rateLabel.textContent = Number(state.rate).toFixed(2);
    renderTimer();
    renderSummaries();
    renderSessions();
  }

  function openSessionDialog(session = null) {
    elements.formError.textContent = "";
    elements.sessionIdInput.value = session?.id ?? "";
    elements.clientInput.value = session?.client ?? state.currentClient ?? "";
    elements.dialogTitle.textContent = session ? "Edit work session" : "Add work session";

    const now = new Date();
    const start = session ? new Date(session.start) : new Date(now.getTime() - 3600000);
    const end = session ? new Date(session.end) : now;

    elements.dateInput.value = toDateInput(start);
    elements.startTimeInput.value = toTimeInput(start);
    elements.stopTimeInput.value = toTimeInput(end);
    elements.notesInput.value = session?.notes ?? "";
    elements.dialog.showModal();
  }

  function toDateInput(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function toTimeInput(date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function combineDateAndTime(dateValue, timeValue) {
    return new Date(`${dateValue}T${timeValue}`).getTime();
  }

  function saveSessionFromForm(event) {
    event.preventDefault();
    const start = combineDateAndTime(elements.dateInput.value, elements.startTimeInput.value);
    let end = combineDateAndTime(elements.dateInput.value, elements.stopTimeInput.value);

    if (end <= start) {
      elements.formError.textContent = "Stop time must be later than start time.";
      return;
    }

    const id = elements.sessionIdInput.value;
    const record = {
      id: id || uid(),
      client: elements.clientInput.value.trim(),
      start,
      end,
      notes: elements.notesInput.value.trim(),
      rate: id
        ? (state.sessions.find((s) => s.id === id)?.rate ?? state.rate)
        : state.rate
    };

    if (id) {
      const index = state.sessions.findIndex((session) => session.id === id);
      if (index >= 0) state.sessions[index] = record;
    } else {
      state.sessions.push(record);
    }

    saveState();
    elements.dialog.close();
    render();
  }

  function getExportRange() {
    const fromValue = elements.exportFromInput.value;
    const toValue = elements.exportToInput.value;
    const client = elements.exportClientInput.value;

    if (!fromValue || !toValue) {
      return { error: "Choose both a From date and a To date." };
    }

    const from = new Date(`${fromValue}T00:00:00`).getTime();
    const toExclusive = new Date(`${toValue}T00:00:00`).getTime() + 86400000;

    if (toExclusive <= from) {
      return { error: "The To date must be the same as or later than the From date." };
    }

    const sessions = [...state.sessions]
      .filter((session) => session.start >= from && session.start < toExclusive)
      .filter((session) => !client || (session.client || "Unspecified") === client)
      .sort((a, b) => a.start - b.start);

    return { from, toExclusive, fromValue, toValue, client, sessions };
  }

  function populateExportClients() {
    const selected = elements.exportClientInput.value;
    const clients = [...new Set(
      state.sessions.map((session) => session.client || "Unspecified")
    )].sort((a, b) => a.localeCompare(b));

    elements.exportClientInput.innerHTML =
      '<option value="">All clients</option>' +
      clients.map((client) =>
        `<option value="${escapeHtml(client)}">${escapeHtml(client)}</option>`
      ).join("");

    if (clients.includes(selected)) elements.exportClientInput.value = selected;
  }

  function openExportDialog(preferredType = "pdf") {
    if (!state.sessions.length) {
      alert("There are no saved sessions to export yet.");
      return;
    }

    populateExportClients();

    const sorted = [...state.sessions].sort((a, b) => a.start - b.start);
    elements.exportFromInput.value = toDateInput(new Date(sorted[0].start));
    elements.exportToInput.value = toDateInput(new Date(sorted[sorted.length - 1].start));
    elements.exportError.textContent = "";
    elements.confirmPdfBtn.dataset.preferred = preferredType;
    updateExportPreview();
    elements.exportDialog.showModal();
  }

  function updateExportPreview() {
    const result = getExportRange();
    if (result.error) {
      elements.exportError.textContent = result.error;
      elements.exportPreview.innerHTML = "";
      return;
    }

    elements.exportError.textContent = "";
    const totalMs = result.sessions.reduce(
      (sum, session) => sum + sessionDuration(session), 0
    );
    const totalAmount = result.sessions.reduce((sum, session) => {
      return sum + (sessionDuration(session) / 3600000) *
        (session.rate ?? state.rate);
    }, 0);

    elements.exportPreview.innerHTML = `
      <div class="preview-card"><span>Total time</span><strong>${formatDuration(totalMs)}</strong></div>
      <div class="preview-card"><span>Total due</span><strong>$${totalAmount.toFixed(2)}</strong></div>
    `;
  }

  function selectedSessionsOrAlert() {
    const result = getExportRange();
    if (result.error) {
      elements.exportError.textContent = result.error;
      return null;
    }
    if (!result.sessions.length) {
      elements.exportError.textContent = "No sessions match those dates and client.";
      return null;
    }
    elements.exportError.textContent = "";
    return result;
  }

  function groupedExportRows(sessions) {
    const grouped = new Map();

    for (const session of sessions) {
      const dateKey = toDateInput(new Date(session.start));
      const client = session.client || "Unspecified";
      const key = `${client}|||${dateKey}`;
      const duration = sessionDuration(session);
      const amount = (duration / 3600000) * (session.rate ?? state.rate);

      if (!grouped.has(key)) {
        grouped.set(key, {
          client,
          dateKey,
          timestamp: new Date(`${dateKey}T12:00:00`).getTime(),
          duration: 0,
          amount: 0
        });
      }

      const row = grouped.get(key);
      row.duration += duration;
      row.amount += amount;
    }

    return [...grouped.values()].sort((a, b) => {
      if (a.client !== b.client) return a.client.localeCompare(b.client);
      return a.timestamp - b.timestamp;
    });
  }

  function exportCsv() {
    const result = selectedSessionsOrAlert();
    if (!result) return;

    const groupedRows = groupedExportRows(result.sessions);
    const rows = [["Client", "Date", "Hours", "Amount"]];

    for (const row of groupedRows) {
      rows.push([
        row.client,
        formatDate(row.timestamp),
        formatDuration(row.duration),
        row.amount.toFixed(2)
      ]);
    }

    const totalMs = groupedRows.reduce((sum, row) => sum + row.duration, 0);
    const totalAmount = groupedRows.reduce((sum, row) => sum + row.amount, 0);
    rows.push([]);
    rows.push(["", "TOTAL", formatDuration(totalMs), totalAmount.toFixed(2)]);

    const csv = rows.map((row) =>
      row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")
    ).join("\n");

    const clientPart = result.client
      ? `-${result.client.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`
      : "";
    downloadBlob(
      csv,
      `work-summary${clientPart}-${result.fromValue}-to-${result.toValue}.csv`,
      "text/csv;charset=utf-8"
    );
    elements.exportDialog.close();
  }

  function exportPdf() {
    const result = selectedSessionsOrAlert();
    if (!result) return;

    const groupedRows = groupedExportRows(result.sessions);
    const totalMs = groupedRows.reduce((sum, row) => sum + row.duration, 0);
    const totalAmount = groupedRows.reduce((sum, row) => sum + row.amount, 0);
    const clients = [...new Set(groupedRows.map((row) => row.client))];
    const periodStart = formatDate(new Date(`${result.fromValue}T12:00:00`).getTime());
    const periodEnd = formatDate(new Date(`${result.toValue}T12:00:00`).getTime());
    const reportTitle = clients.length === 1 ? `Time Report - ${clients[0]}` : "Client Time Report";

    const rows = groupedRows.map((row) => {
      return `<tr>
        <td>${escapeHtml(row.client)}</td>
        <td>${formatDate(row.timestamp)}</td>
        <td>${formatDuration(row.duration)}</td>
        <td>$${row.amount.toFixed(2)}</td>
      </tr>`;
    }).join("");

    const report = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(reportTitle)}</title>
      <style>
        @page { size: Letter; margin: 0.65in; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, sans-serif; color: #172033; font-size: 11px; }
        header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2563eb; padding-bottom: 16px; margin-bottom: 22px; }
        h1 { margin: 0 0 5px; font-size: 25px; }
        .muted { color: #64748b; }
        .badge { padding: 8px 11px; border-radius: 8px; background: #eff6ff; color: #1d4ed8; font-weight: bold; }
        .summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 0 0 22px; }
        .card { padding: 15px; border: 1px solid #dbe3ef; border-radius: 10px; background: #f8fafc; }
        .card span { display: block; color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; }
        .card strong { display: block; margin-top: 5px; font-size: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th { padding: 10px 8px; background: #172033; color: white; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
        td { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; }
        tr:nth-child(even) td { background: #f8fafc; }
        th:nth-child(3), th:nth-child(4), td:nth-child(3), td:nth-child(4) { text-align: right; }
        tfoot td { font-weight: bold; border-top: 2px solid #172033; background: white !important; }
        footer { margin-top: 18px; padding-top: 10px; border-top: 1px solid #cbd5e1; color: #64748b; text-align: center; }
        .print-note { margin: 0 0 14px; padding: 10px; border-radius: 8px; background: #fff7ed; color: #9a3412; font-size: 11px; }
        @media print { .print-note { display: none; } }
      </style></head><body>
      <p class="print-note"><strong>To save the PDF:</strong> choose “Save as PDF” in the print window.</p>
      <header><div><h1>${escapeHtml(reportTitle)}</h1><div class="muted">${periodStart} - ${periodEnd}</div></div><div class="badge">Generated ${formatDate(Date.now())}</div></header>
      <section class="summary">
        <div class="card"><span>Total hours</span><strong>${formatDuration(totalMs)}</strong></div>
        <div class="card"><span>Total due</span><strong>$${totalAmount.toFixed(2)}</strong></div>
      </section>
      <table>
        <thead><tr><th>Client</th><th>Date</th><th>Hours</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td>${formatDuration(totalMs)}</td><td>$${totalAmount.toFixed(2)}</td></tr></tfoot>
      </table>
      <footer>Work Timer - Client Time Report</footer>
      <script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));<\/script>
      </body></html>`;

    const popup = window.open("", "_blank");
    if (!popup) {
      alert("Please allow pop-ups for this page, then try Export PDF again.");
      return;
    }
    popup.document.open();
    popup.document.write(report);
    popup.document.close();
    elements.exportDialog.close();
  }

  function backupData() {
    const payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      app: "Work Timer",
      version: 1,
      data: state
    }, null, 2);
    downloadBlob(payload, `work-timer-backup-${toDateInput(new Date())}.json`, "application/json");
  }

  function restoreData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const restored = parsed.data ?? parsed;
        if (!Array.isArray(restored.sessions)) throw new Error("Invalid backup");
        if (!confirm("Replace the current timer data with this backup?")) return;
        state = {
          ...defaultState,
          ...restored,
          sessions: restored.sessions
        };
        saveState();
        render();
        alert("Backup restored.");
      } catch {
        alert("That file is not a valid Work Timer backup.");
      } finally {
        elements.restoreInput.value = "";
      }
    };
    reader.readAsText(file);
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  elements.startBtn.addEventListener("click", startTimer);
  elements.pauseBtn.addEventListener("click", pauseTimer);
  elements.stopBtn.addEventListener("click", stopTimer);

  elements.currentClientInput.addEventListener("input", () => {
    if (!state.active) {
      state.currentClient = elements.currentClientInput.value;
      saveState();
    }
  });

  elements.rateInput.addEventListener("change", () => {
    const rate = Number(elements.rateInput.value);
    if (!Number.isFinite(rate) || rate < 0) {
      elements.rateInput.value = state.rate.toFixed(2);
      return;
    }
    state.rate = rate;
    saveState();
    render();
  });

  elements.addManualBtn.addEventListener("click", () => openSessionDialog());
  elements.closeDialogBtn.addEventListener("click", () => elements.dialog.close());
  elements.cancelDialogBtn.addEventListener("click", () => elements.dialog.close());
  elements.form.addEventListener("submit", saveSessionFromForm);
  elements.exportBtn.addEventListener("click", () => openExportDialog("csv"));
  elements.exportPdfBtn.addEventListener("click", () => openExportDialog("pdf"));
  elements.closeExportDialogBtn.addEventListener("click", () => elements.exportDialog.close());
  elements.cancelExportBtn.addEventListener("click", () => elements.exportDialog.close());
  elements.confirmCsvBtn.addEventListener("click", exportCsv);
  elements.confirmPdfBtn.addEventListener("click", exportPdf);
  elements.exportFromInput.addEventListener("change", updateExportPreview);
  elements.exportToInput.addEventListener("change", updateExportPreview);
  elements.exportClientInput.addEventListener("change", updateExportPreview);
  elements.backupBtn.addEventListener("click", backupData);

  elements.restoreInput.addEventListener("change", () => {
    const file = elements.restoreInput.files?.[0];
    if (file) restoreData(file);
  });

  elements.sessionBody.addEventListener("click", (event) => {
    const editId = event.target.dataset.edit;
    const deleteId = event.target.dataset.delete;

    if (editId) {
      const session = state.sessions.find((item) => item.id === editId);
      if (session) openSessionDialog(session);
    }

    if (deleteId) {
      const session = state.sessions.find((item) => item.id === deleteId);
      if (session && confirm("Delete this work session?")) {
        state.sessions = state.sessions.filter((item) => item.id !== deleteId);
        saveState();
        render();
      }
    }
  });

  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "dark") document.body.classList.add("dark");

  elements.themeBtn.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem(THEME_KEY, document.body.classList.contains("dark") ? "dark" : "light");
  });

  window.addEventListener("storage", () => {
    state = loadState();
    render();
  });

  render();
})();
