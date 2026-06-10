/* dashboard.js — Marine Waste Tracker analytics dashboard */
'use strict';

(function () {

  var isAr = (typeof DASH_LOCALE !== 'undefined' && DASH_LOCALE === 'ar');

  var SEV_COLOR = {
    low:      '#00e5a0',
    medium:   '#ffd166',
    high:     '#ff6b35',
    critical: '#ff3d5a',
  };

  var CHART_DEFAULTS = {
    color:       '#d4eaf0',
    gridColor:   'rgba(0,180,210,0.1)',
    borderColor: 'rgba(0,180,210,0.18)',
    fontFamily:  "'DM Sans', sans-serif",
  };

  // Apply global Chart.js defaults
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color            = CHART_DEFAULTS.color;
    Chart.defaults.borderColor      = CHART_DEFAULTS.borderColor;
    Chart.defaults.font.family      = CHART_DEFAULTS.fontFamily;
    Chart.defaults.plugins.legend.labels.color = CHART_DEFAULTS.color;
  }

  function makeScale(showX, showY) {
    var scale = {};
    if (showX !== false) {
      scale.x = {
        grid: { color: CHART_DEFAULTS.gridColor },
        ticks: { color: '#6a9ab0', font: { size: 11 } },
      };
    }
    if (showY !== false) {
      scale.y = {
        grid: { color: CHART_DEFAULTS.gridColor },
        ticks: { color: '#6a9ab0', font: { size: 11 } },
        beginAtZero: true,
      };
    }
    return scale;
  }

  // ── Fetch and render everything ───────────────────────────────
  async function init() {
    try {
      var res  = await fetch('/api/stats');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();

      fillKPIs(data);
      renderCategoryChart(data);
      renderTrendChart(data);
      renderSeverityChart(data);
      renderEnvChart(data);
      fillHotspots(data.hotspots || []);
      fetchRecentObservations();
    } catch (e) {
      console.error('[MWT Dashboard] Failed to load stats:', e);
    }
  }

  // ── KPI cards ─────────────────────────────────────────────────
  function fillKPIs(d) {
    setText('kpi-total',    d.total ?? '—');
    setText('kpi-month',    d.this_month ?? '—');
    setText('kpi-hotspots', d.hotspots_count ?? '—');
    setText('kpi-pending',  d.pending ?? '—');

    var topLabel = isAr
      ? (d.top_category_label_ar || d.top_category_label)
      : d.top_category_label;
    if (topLabel) {
      setText('kpi-top-cat',  topLabel);
      setText('kpi-top-icon', d.top_category_emoji || '📦');
    }
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(val);
  }

  // ── Category bar chart ────────────────────────────────────────
  function renderCategoryChart(data) {
    var el = document.getElementById('chartCategory');
    if (!el) return;

    var cats    = data.by_category || {};
    var catMeta = (data.waste_categories) || {};
    var labels  = [];
    var values  = [];

    Object.entries(cats).sort(function (a, b) { return b[1] - a[1]; }).forEach(function (e) {
      var meta  = catMeta[e[0]] || {};
      var label = isAr ? (meta.label_ar || meta.label_en || e[0]) : (meta.label_en || e[0]);
      labels.push((meta.emoji || '') + ' ' + label);
      values.push(e[1]);
    });

    new Chart(el, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: isAr ? 'ملاحظات' : 'Observations',
          data: values,
          backgroundColor: 'rgba(0,200,232,0.25)',
          borderColor: '#00c8e8',
          borderWidth: 1,
          borderRadius: 3,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: makeScale(),
      },
    });
  }

  // ── Trend line chart (12 months) ──────────────────────────────
  function renderTrendChart(data) {
    var el = document.getElementById('chartTrend');
    if (!el) return;

    var by_month = data.by_month || {};
    // Generate last 12 month keys
    var keys = [];
    var now  = new Date();
    for (var i = 11; i >= 0; i--) {
      var d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var k  = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      keys.push(k);
    }

    var labels = keys.map(function (k) {
      var parts = k.split('-');
      var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
      return d.toLocaleDateString(isAr ? 'ar-DZ' : 'en-US', { month: 'short', year: '2-digit' });
    });
    var values = keys.map(function (k) { return by_month[k] || 0; });

    new Chart(el, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: isAr ? 'ملاحظات' : 'Observations',
          data: values,
          borderColor: '#00c8e8',
          backgroundColor: 'rgba(0,200,232,0.08)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#00c8e8',
          fill: true,
          tension: 0.35,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: makeScale(),
      },
    });
  }

  // ── Severity donut ────────────────────────────────────────────
  function renderSeverityChart(data) {
    var el = document.getElementById('chartSeverity');
    if (!el) return;

    var by_sev = data.by_severity || {};
    var order  = ['low', 'medium', 'high', 'critical'];
    var sevMeta = (data.severities) || {};

    var labels = order.map(function (k) {
      var m = sevMeta[k] || {};
      return isAr ? (m.label_ar || m.label_en || k) : (m.label_en || k);
    });
    var values = order.map(function (k) { return by_sev[k] || 0; });
    var colors = order.map(function (k) { return SEV_COLOR[k]; });

    new Chart(el, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors.map(function (c) { return c + '99'; }),
          borderColor: colors,
          borderWidth: 1.5,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { padding: 14, boxWidth: 12, font: { size: 11 } },
          },
        },
      },
    });
  }

  // ── Environment bar chart ─────────────────────────────────────
  function renderEnvChart(data) {
    var el = document.getElementById('chartEnv');
    if (!el) return;

    var by_env  = data.by_environment || {};
    var envMeta = data.environment_types || {};

    var entries = Object.entries(by_env).sort(function (a, b) { return b[1] - a[1]; });
    var labels  = entries.map(function (e) {
      var m     = envMeta[e[0]] || {};
      var label = isAr ? (m.label_ar || m.label_en || e[0]) : (m.label_en || e[0].replace(/_/g, ' '));
      return (m.emoji || '') + ' ' + label;
    });
    var values  = entries.map(function (e) { return e[1]; });

    new Chart(el, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: isAr ? 'ملاحظات' : 'Observations',
          data: values,
          backgroundColor: 'rgba(0,229,200,0.22)',
          borderColor: '#00e5c8',
          borderWidth: 1,
          borderRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: makeScale(),
      },
    });
  }

  // ── Hotspots table ────────────────────────────────────────────
  function fillHotspots(hotspots) {
    var tbody = document.getElementById('hotspotsBody');
    if (!tbody) return;

    if (!hotspots.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1.5rem;">' +
        (isAr ? 'لا توجد بيانات بعد' : 'No data yet') + '</td></tr>';
      return;
    }

    tbody.innerHTML = hotspots.slice(0, 10).map(function (h, i) {
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><code style="color:var(--cyan);font-size:0.82rem;">' + parseFloat(h.lat).toFixed(4) + '°</code></td>' +
        '<td><code style="color:var(--cyan);font-size:0.82rem;">' + parseFloat(h.lng).toFixed(4) + '°</code></td>' +
        '<td><strong>' + h.count + '</strong></td>' +
        '</tr>';
    }).join('');
  }

  // ── Recent observations table ─────────────────────────────────
  async function fetchRecentObservations() {
    try {
      var res  = await fetch('/api/observations?status=all&per_page=20&page=1');
      if (!res.ok) return;
      var data = await res.json();
      fillRecentTable(data.items || []);
    } catch (_) {}
  }

  function fillRecentTable(items) {
    var tbody = document.getElementById('recentBody');
    if (!tbody) return;

    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:1.5rem;">' +
        (isAr ? 'لا توجد ملاحظات بعد' : 'No observations yet') + '</td></tr>';
      return;
    }

    var SEV_COLOR_MAP = {
      low: '#00e5a0', medium: '#ffd166', high: '#ff6b35', critical: '#ff3d5a',
    };
    var STATUS_CLASS = {
      pending: 'status-pending', verified: 'status-verified',
      resolved: 'status-resolved', duplicate: 'status-duplicate',
    };

    tbody.innerHTML = items.map(function (o) {
      var date    = o.created_at ? new Date(o.created_at).toLocaleDateString(isAr ? 'ar-DZ' : 'en-US') : '—';
      var sevCol  = SEV_COLOR_MAP[o.severity] || '#6a9ab0';
      var catLabel = isAr ? (o.waste_category_label_ar || o.waste_category_label) : o.waste_category_label;
      var catStr  = (o.waste_category_emoji || '') + ' ' + (catLabel || o.waste_category || '—');
      var envLabel = isAr ? (o.environment_label_ar || o.environment_label) : o.environment_label;
      var envStr  = (o.environment_emoji || '') + ' ' + (envLabel || o.environment_type || '—');
      var obsStr  = (isAr ? (o.observer_type_label_ar || o.observer_type_label) : o.observer_type_label) || o.observer_type || '—';
      var sevLabel = isAr ? (o.severity_label_ar || o.severity_label) : o.severity_label;
      var stClass = STATUS_CLASS[o.status] || '';

      return '<tr>' +
        '<td><code style="color:var(--cyan);font-size:0.78rem;">' + esc(o.report_code) + '</code></td>' +
        '<td style="white-space:nowrap;">' + date + '</td>' +
        '<td>' + esc(catStr) + '</td>' +
        '<td><span class="sev-badge" style="background:' + sevCol + '1a;color:' + sevCol + ';border:1px solid ' + sevCol + '44;">' + esc(sevLabel || o.severity) + '</span></td>' +
        '<td>' + esc(envStr) + '</td>' +
        '<td>' + esc(obsStr) + '</td>' +
        '<td><span class="status-badge ' + stClass + '">' + esc(o.status) + '</span></td>' +
        '<td><a href="/map" class="btn-ghost btn-sm" style="white-space:nowrap;">' + (isAr ? 'الخريطة' : 'Map') + '</a></td>' +
        '</tr>';
    }).join('');
  }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  document.addEventListener('DOMContentLoaded', init);

})();
