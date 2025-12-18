// ==UserScript==
// @name         Pomodoro Tracker DEEP WORK ULTIMATE v6.4.3
// @namespace    https://pomodoro-tracker.com/
// @version      6.4.3
// @description  Espelho v6.4: contagem oficial via bloco "Feito" + refresh 20s + PDF/gráficos
// @match        https://pomodoro-tracker.com/user/*
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @require      https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js
// ==/UserScript==

(function () {
  'use strict';

  /* ================= CONFIGURAÇÃO ================= */
  const DAILY_GOAL = 9;
  const POMO_MINUTES = 45;

  // Mantido (v6.4)
  const STORAGE_KEY = 'deepwork_stats_v6_4';

  // ✅ Refresh do espelho (pedido seu)
  const AUTO_REFRESH_MS = 20000;

  const DISTRACTION_SITES = [
    'facebook.com','instagram.com','twitter.com','x.com','youtube.com','tiktok.com','reddit.com'
  ];

  /* ================= UTIL ================= */
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtHMS = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${pad2(m)}:${pad2(s)}`;
  };
  const today = () => new Date().toISOString().slice(0, 10);

  function loadStats() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { days: {}, cycles: {} };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.days) parsed.days = {};
      if (!parsed.cycles) parsed.cycles = {};
      return parsed;
    } catch {
      return { days: {}, cycles: {} };
    }
  }
  function saveStats(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }
  function ensureDay(s, dateStr) {
    if (!s.days[dateStr]) {
      s.days[dateStr] = { pomodoros: 0, focusSec: 0, pauseSec: 0, pauses: 0 };
    }
    if (!s.cycles[dateStr]) {
      s.cycles[dateStr] = []; // lista de ciclos do dia (para gráfico diário)
    }
  }
  function lastNDays(n) {
    const out = [];
    const d = new Date();
    for (let i = 0; i < n; i++) {
      const dd = new Date(d);
      dd.setDate(d.getDate() - i);
      out.push(dd.toISOString().slice(0, 10));
    }
    return out.reverse();
  }

  let stats = loadStats();
  ensureDay(stats, today());
  saveStats(stats);

  /* ================= NOTIFICAÇÃO ================= */
  function notify(title, body) {
    if (Notification.permission === 'default') Notification.requestPermission();
    if (Notification.permission === 'granted') new Notification(title, { body });
  }

  /* ================= DEEP WORK (mantido) ================= */
  const enableDeepWork = () => sessionStorage.setItem('deep_work_active', '1');
  const disableDeepWork = () => sessionStorage.removeItem('deep_work_active');
  const isDeepWorkActive = () => sessionStorage.getItem('deep_work_active') === '1';

  /* ================= BLOQUEIO GLOBAL (mantido) ================= */
  if (isDeepWorkActive()) {
    const host = location.hostname.replace('www.', '');
    if (DISTRACTION_SITES.some(site => host.includes(site))) {
      document.documentElement.innerHTML = `
        <body style="margin:0">
          <div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0f0f;color:#fff;font-family:system-ui;text-align:center">
            <div>
              <h1>🧠 DEEP WORK ATIVO</h1>
              <p>Distrações bloqueadas durante o Pomodoro.</p>
            </div>
          </div>
        </body>`;
      throw new Error('Deep Work Block');
    }
  }

  /* ============================================================
     ✅ FEITO (FONTE DA VERDADE) — SELETOR ROBUSTO
     Acha o elemento cujo texto é "Feito" e pega o número .u-size-xxl
  ============================================================ */
  function getDoneFromFeitoBlock(docRoot = document) {
    // 1) caminho mais confiável: achar o label "Feito"
    const labels = Array.from(docRoot.querySelectorAll('.c-user-info_block .u-right'));
    for (const label of labels) {
      const t = (label.textContent || '').trim().toLowerCase();
      if (t === 'feito') {
        const block = label.closest('.c-user-info_block');
        if (!block) continue;
        const nEl = block.querySelector('.u-size-xxl');
        if (!nEl) continue;
        const n = parseInt((nEl.textContent || '').trim(), 10);
        if (Number.isFinite(n)) return n;
      }
    }

    // 2) fallback: procurar bloco que contenha "Feito" (caso o label não seja u-right)
    const blocks = Array.from(docRoot.querySelectorAll('.c-user-info_block'));
    for (const b of blocks) {
      const txt = (b.textContent || '').toLowerCase();
      if (txt.includes('feito')) {
        const nEl = b.querySelector('.u-size-xxl');
        if (!nEl) continue;
        const n = parseInt((nEl.textContent || '').trim(), 10);
        if (Number.isFinite(n)) return n;
      }
    }

    return null;
  }

  function getDoneToday() {
    const feito = getDoneFromFeitoBlock(document);
    if (feito !== null) return feito;
    const s = loadStats();
    ensureDay(s, today());
    return s.days[today()].pomodoros || 0;
  }

  // Guarda o último "Feito" para detectar incremento (sem depender de 00:00)
  const LAST_FEITO_KEY = 'dw_lastFeito_v643';
  function getLastFeito() {
    const v = sessionStorage.getItem(LAST_FEITO_KEY);
    if (v == null) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  function setLastFeito(n) {
    sessionStorage.setItem(LAST_FEITO_KEY, String(n));
  }

  /* ================= UI: PAINEL + GRÁFICOS + PDF (v6.4 preservado) ================= */
  const root = document.createElement('div');
  root.id = 'deepwork-root';
  root.style = `
    position:fixed;
    bottom:18px;
    right:18px;
    z-index:999999;
    width:420px;
    max-width:90vw;
    background:#111;
    color:#fff;
    border:3px solid #333;
    border-radius:16px;
    font-family:system-ui;
    box-shadow:0 14px 34px rgba(0,0,0,.55);
    overflow:hidden;
  `;

  root.innerHTML = `
    <div style="padding:16px 18px;border-bottom:1px solid #222;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div>
        <div style="font-weight:800;font-size:18px;line-height:1">🧠 Deep Work</div>
        <div id="dw-sub" style="opacity:.8;font-size:12px;margin-top:4px">Meta: ${DAILY_GOAL} × ${POMO_MINUTES}min</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button id="dw-pdf" style="cursor:pointer;border:1px solid #444;background:#1a1a1a;color:#fff;padding:8px 10px;border-radius:10px;font-weight:650">Exportar PDF</button>
        <button id="dw-min" title="Minimizar" style="cursor:pointer;border:1px solid #444;background:#1a1a1a;color:#fff;width:38px;height:34px;border-radius:10px;font-weight:900">–</button>
      </div>
    </div>

    <div id="dw-body" style="padding:14px 18px">
      <div id="dw-metrics" style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font-size:14px">
        <div>🎯 Hoje: <b id="dw-done">0</b> / <b>${DAILY_GOAL}</b></div>
        <div>📊 Foco real: <b id="dw-focuspct">100%</b></div>
        <div>⏸ Pausa no ciclo: <b id="dw-pausemin">0 min</b></div>
        <div>🔁 Pausas no ciclo: <b id="dw-pausecount">0</b></div>
        <div style="grid-column:1/3;opacity:.85;margin-top:6px">Status: <b id="dw-status">—</b></div>
      </div>

      <div style="margin-top:14px;border-top:1px solid #222;padding-top:12px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button class="dw-tab" data-tab="day" style="cursor:pointer;border:1px solid #444;background:#222;color:#fff;padding:7px 10px;border-radius:10px;font-weight:650">📅 Diário</button>
          <button class="dw-tab" data-tab="week" style="cursor:pointer;border:1px solid #444;background:#1a1a1a;color:#fff;padding:7px 10px;border-radius:10px;font-weight:650">🗓️ Semanal</button>
          <button class="dw-tab" data-tab="month" style="cursor:pointer;border:1px solid #444;background:#1a1a1a;color:#fff;padding:7px 10px;border-radius:10px;font-weight:650">📆 Mensal</button>
        </div>

        <div id="dw-charts">
          <div class="dw-panel" data-panel="day">
            <div style="opacity:.85;font-size:12px;margin-bottom:6px">Ciclos de hoje (Foco % por Pomodoro)</div>
            <canvas id="dw-chart-day" height="140"></canvas>
          </div>
          <div class="dw-panel" data-panel="week" style="display:none">
            <div style="opacity:.85;font-size:12px;margin-bottom:6px">Últimos 7 dias (Pomodoros e Foco %)</div>
            <canvas id="dw-chart-week" height="140"></canvas>
          </div>
          <div class="dw-panel" data-panel="month" style="display:none">
            <div style="opacity:.85;font-size:12px;margin-bottom:6px">Últimos 30 dias (Pomodoros e Foco %)</div>
            <canvas id="dw-chart-month" height="140"></canvas>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  // Minimizar
  const btnMin = root.querySelector('#dw-min');
  const body = root.querySelector('#dw-body');
  let minimized = false;
  btnMin.addEventListener('click', () => {
    minimized = !minimized;
    body.style.display = minimized ? 'none' : 'block';
    btnMin.textContent = minimized ? '+' : '–';
  });

  // Tabs
  const tabButtons = Array.from(root.querySelectorAll('.dw-tab'));
  const panels = Array.from(root.querySelectorAll('.dw-panel'));
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tab;
      tabButtons.forEach(b => b.style.background = (b.dataset.tab === t) ? '#222' : '#1a1a1a');
      panels.forEach(p => p.style.display = (p.dataset.panel === t) ? 'block' : 'none');
      renderCharts();
    });
  });

  // Referências métricas
  const elDone = root.querySelector('#dw-done');
  const elFocusPct = root.querySelector('#dw-focuspct');
  const elPauseMin = root.querySelector('#dw-pausemin');
  const elPauseCount = root.querySelector('#dw-pausecount');
  const elStatus = root.querySelector('#dw-status');

  /* ================= ESTADO IDLE ================= */
  function renderIdlePanel(doneToday) {
    elDone.textContent = String(doneToday);
    elFocusPct.textContent = '—';
    elPauseMin.textContent = '—';
    elPauseCount.textContent = '—';
    elStatus.textContent = 'Aguardando início';
  }

  /* ================= CHARTS ================= */
  let chartDay = null, chartWeek = null, chartMonth = null;

  function getDailySeries() {
    stats = loadStats();
    ensureDay(stats, today());
    const cycles = stats.cycles[today()] || [];
    const labels = cycles.map((_, i) => `#${i + 1}`);
    const focusPct = cycles.map(c => c.totalSec > 0 ? Math.round((c.focusSec / c.totalSec) * 100) : 100);
    return { labels, focusPct };
  }

  function getRangeSeries(daysCount) {
    stats = loadStats();
    const dates = lastNDays(daysCount);
    dates.forEach(d => ensureDay(stats, d));
    const labels = dates.map(d => d.slice(5));
    const pomos = dates.map(d => stats.days[d]?.pomodoros || 0);
    const focusPct = dates.map(d => {
      const day = stats.days[d];
      const total = (day?.focusSec || 0) + (day?.pauseSec || 0);
      return total > 0 ? Math.round(((day.focusSec || 0) / total) * 100) : 100;
    });
    return { labels, pomos, focusPct };
  }

  function renderCharts() {
    const d = getDailySeries();
    const ctxD = root.querySelector('#dw-chart-day');
    if (chartDay) chartDay.destroy();
    chartDay = new Chart(ctxD, {
      type: 'bar',
      data: {
        labels: d.labels.length ? d.labels : ['—'],
        datasets: [{
          label: 'Foco %',
          data: d.labels.length ? d.focusPct : [0],
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { min: 0, max: 100 } }
      }
    });

    const w = getRangeSeries(7);
    const ctxW = root.querySelector('#dw-chart-week');
    if (chartWeek) chartWeek.destroy();
    chartWeek = new Chart(ctxW, {
      type: 'line',
      data: {
        labels: w.labels,
        datasets: [
          { label: 'Pomodoros', data: w.pomos, yAxisID: 'y' },
          { label: 'Foco %', data: w.focusPct, yAxisID: 'y1' },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
          y1: { beginAtZero: true, min: 0, max: 100, position: 'right' }
        }
      }
    });

    const m = getRangeSeries(30);
    const ctxM = root.querySelector('#dw-chart-month');
    if (chartMonth) chartMonth.destroy();
    chartMonth = new Chart(ctxM, {
      type: 'line',
      data: {
        labels: m.labels,
        datasets: [
          { label: 'Pomodoros', data: m.pomos, yAxisID: 'y' },
          { label: 'Foco %', data: m.focusPct, yAxisID: 'y1' },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
          y1: { beginAtZero: true, min: 0, max: 100, position: 'right' }
        }
      }
    });
  }

  setTimeout(renderCharts, 800);

  /* ================= EXPORTAR PDF ================= */
  const btnPDF = root.querySelector('#dw-pdf');
  btnPDF.addEventListener('click', async () => {
    try {
      btnPDF.textContent = 'Gerando...';
      btnPDF.disabled = true;

      renderCharts();

      const jsPDF = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : null;
      if (!jsPDF) {
        alert('jsPDF não carregou. Recarregue a página e tente de novo.');
        return;
      }

      const canvas = await html2canvas(root, { scale: 2, backgroundColor: '#111' });
      const imgData = canvas.toDataURL('image/png');

      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      const imgW = pageW - 20;
      const imgH = (canvas.height * imgW) / canvas.width;

      pdf.setFontSize(14);
      pdf.text('Relatório Deep Work (Pomodoro Tracker)', 10, 12);
      pdf.setFontSize(10);
      pdf.text(`Data do relatório: ${today()} | Meta: ${DAILY_GOAL} × ${POMO_MINUTES}min`, 10, 18);

      const startY = 24;
      const maxH = pageH - startY - 10;
      const finalH = Math.min(imgH, maxH);

      pdf.addImage(imgData, 'PNG', 10, startY, imgW, finalH);
      pdf.save(`deepwork_relatorio_${today()}.pdf`);
    } catch (e) {
      alert('Não consegui gerar o PDF. Se o navegador impedir o download, permita downloads automáticos.');
      console.error(e);
    } finally {
      btnPDF.textContent = 'Exportar PDF';
      btnPDF.disabled = false;
    }
  });

  /* ================= MÉTRICAS DO CICLO ================= */
  let cycleFocusSeconds = 0;
  let cyclePauseSeconds = 0;
  let pauseCount = 0;

  let pauseStreakSeconds = 0;
  let lastTick = Date.now();
  let wasPaused = false;

  let lastTime = '';
  let hasSeenRunningTime = false;
  let goalReachedNotified = false;

  function resetCycleMetrics() {
    cycleFocusSeconds = 0;
    cyclePauseSeconds = 0;
    pauseCount = 0;
    pauseStreakSeconds = 0;
    wasPaused = false;
    lastTick = Date.now();
  }

  function updatePanel(done, focusPercent, pauseSec, pauses, status) {
    elDone.textContent = String(done);
    elFocusPct.textContent = `${focusPercent}%`;
    elPauseMin.textContent = `${Math.round(pauseSec / 60)} min`;
    elPauseCount.textContent = String(pauses);
    elStatus.textContent = status;
  }

  function onPomodoroFinished(dateStr, focusSec, pauseSec, pauses) {
    stats = loadStats();
    ensureDay(stats, dateStr);

    // soma no agregado do dia
    stats.days[dateStr].pomodoros += 1;
    stats.days[dateStr].focusSec += focusSec;
    stats.days[dateStr].pauseSec += pauseSec;
    stats.days[dateStr].pauses += pauses;

    // guarda ciclo (para gráfico diário)
    const totalSec = focusSec + pauseSec;
    stats.cycles[dateStr].push({ focusSec, pauseSec, pauses, totalSec });

    saveStats(stats);
    renderCharts();
  }

  /* ================= TIMER ================= */
  function updateTimer() {
    const digits = document.querySelector('.c-user-timer_digits');
    const desc = document.querySelector('.c-user-timer_description');
    if (!digits || !desc) return;

    const time = digits.textContent.trim();
    const descText = (desc.textContent || '').toLowerCase();
    const mode = desc.dataset?.mode || 'pomodoro';

    const isPaused = descText.includes('pausado');
    const isBreak = mode !== 'pomodoro';

    // lê o "Feito" SEMPRE (fonte da verdade)
    const feitoNow = getDoneFromFeitoBlock(document);

    // inicializa lastFeito assim que conseguir ler
    if (feitoNow !== null && getLastFeito() === null) {
      setLastFeito(feitoNow);
    }

    const now = Date.now();
    const deltaSeconds = Math.max(0, Math.floor((now - lastTick) / 1000));
    lastTick = now;

    // Primeira leitura
    if (lastTime === '') {
      lastTime = time;
      resetCycleMetrics();
      ensureDay(loadStats(), today());

      // Atualiza painel já no primeiro frame
      const doneInit = (feitoNow !== null) ? feitoNow : getDoneToday();
      renderIdlePanel(doneInit);
      return;
    }

    // doneToday vem do "Feito" (se disponível), senão fallback
    const doneToday = (feitoNow !== null) ? feitoNow : getDoneToday();

    // ✅ IDLE
    const isIdle = time === '00:00' && !hasSeenRunningTime && !isPaused;
    if (isIdle) {
      renderIdlePanel(doneToday);
      document.title = `Aguardando início • ${doneToday}/${DAILY_GOAL}`;
      lastTime = time;
      return;
    }

    // Contabiliza pausa / foco (métricas locais)
    if (isPaused) {
      cyclePauseSeconds += deltaSeconds;
      pauseStreakSeconds += deltaSeconds;

      if (!wasPaused) {
        pauseCount += 1;
        wasPaused = true;
      }
    } else {
      if (wasPaused) {
        wasPaused = false;
        pauseStreakSeconds = 0;
      }

      if (!isBreak && time !== '00:00') {
        cycleFocusSeconds += deltaSeconds;
        hasSeenRunningTime = true;
        enableDeepWork();
      }
      if (isBreak) disableDeepWork();
    }

    const totalCycle = cycleFocusSeconds + cyclePauseSeconds;
    const focusPercent = totalCycle > 0 ? Math.round((cycleFocusSeconds / totalCycle) * 100) : 100;

    let status = isPaused ? 'PAUSADO' : (isBreak ? 'PAUSA' : 'FOCO');
    if (doneToday >= DAILY_GOAL) status = 'META CONCLUÍDA';

    updatePanel(doneToday, focusPercent, cyclePauseSeconds, pauseCount, status);

    // Título
    if (isPaused) {
      document.title = `Pausa ${fmtHMS(pauseStreakSeconds)} | ${time} • ${doneToday}/${DAILY_GOAL}`;
    } else {
      document.title = `${time} • ${doneToday}/${DAILY_GOAL} • Foco ${focusPercent}%`;
    }

    // ✅ CONCLUSÃO PELO "FEITO" (AUMENTOU = POMODORO FEITO)
    if (feitoNow !== null) {
      const lastFeito = getLastFeito();
      if (lastFeito !== null && feitoNow > lastFeito) {
        const diff = feitoNow - lastFeito;

        for (let i = 0; i < diff; i++) {
          // registra o ciclo que foi medido (se existir)
          onPomodoroFinished(today(), cycleFocusSeconds, cyclePauseSeconds, pauseCount);

          notify('🍅 Pomodoro concluído', `Confirmado pelo Feito. Foco: ${focusPercent}% | Pausas: ${pauseCount}`);

          resetCycleMetrics();
          hasSeenRunningTime = false;
          disableDeepWork();
        }

        // sincroniza stats do dia com o feito
        const s = loadStats();
        ensureDay(s, today());
        s.days[today()].pomodoros = feitoNow;
        saveStats(s);

        setLastFeito(feitoNow);

        if (feitoNow >= DAILY_GOAL && !goalReachedNotified) {
          goalReachedNotified = true;
          notify('🎯 Meta diária concluída!', `${DAILY_GOAL} Pomodoros de ${POMO_MINUTES} min realizados.`);
        }
      }
    }

    lastTime = time;
  }

  const observer = new MutationObserver(updateTimer);

  const waitTimer = setInterval(() => {
    const target = document.querySelector('.c-user-timer_digits');
    if (target) {
      clearInterval(waitTimer);
      observer.observe(target, { childList: true, characterData: true, subtree: true });
      updateTimer();
    }
  }, 300);

  /* ================= AUTO-REFRESH (pedido seu) ================= */
  setInterval(() => {
    try { location.reload(); } catch (_) {}
  }, AUTO_REFRESH_MS);

})();
