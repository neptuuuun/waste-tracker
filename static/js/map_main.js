/* map_main.js — Marine Waste Tracker interactive map */
'use strict';

(function () {

  const SEV_COLOR = {
    low:      '#00e5a0',
    medium:   '#ffd166',
    high:     '#ff6b35',
    critical: '#ff3d5a',
  };

  const TILE_URL  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>';

  let mainMap        = null;
  let clusterGroup   = null;
  let heatLayer      = null;
  let heatVisible    = false;

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    mainMap = L.map('map', {
      center: [36.75, 10],
      zoom: 5,
      maxZoom: 18,
      minZoom: 2,
      zoomControl: true,
    });

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTR,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(mainMap);

    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 55,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      chunkedLoading: true,
    });
    mainMap.addLayer(clusterGroup);

    // Map click → open report modal with pre-filled coords
    mainMap.on('click', function (e) {
      if (window.reportModal) {
        window.reportModal.open({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

    bindFilters();
    loadObservations();
    loadStats();

    window.mainMap = mainMap;
  }

  // ── Load & render observations ────────────────────────────────
  async function loadObservations() {
    const params = buildFilterParams();
    try {
      const res = await fetch('/api/observations?status=all&per_page=500&' + params);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      renderMarkers(data.items || []);
      updateCountDisplay(data.total || 0);
    } catch (e) {
      console.error('[MWT] Failed to load observations:', e);
    }
  }

  function renderMarkers(observations) {
    clusterGroup.clearLayers();

    observations.forEach(function (o) {
      if (o.latitude == null || o.longitude == null) return;

      var color = SEV_COLOR[o.severity] || '#6a9ab0';
      var icon = L.divIcon({
        className: '',
        html:
          '<div style="' +
            'width:13px;height:13px;border-radius:50%;' +
            'background:' + color + ';' +
            'border:2px solid rgba(5,13,18,0.75);' +
            'box-shadow:0 0 5px ' + color + '99;' +
          '"></div>',
        iconSize: [13, 13],
        iconAnchor: [6, 6],
        popupAnchor: [0, -8],
      });

      var marker = L.marker([o.latitude, o.longitude], { icon: icon });
      marker.bindPopup(function () { return buildPopup(o); }, {
        maxWidth: 290,
        minWidth: 200,
        className: 'mwt-popup',
      });
      clusterGroup.addLayer(marker);
    });
  }

  // ── Popup HTML ────────────────────────────────────────────────
  function buildPopup(o) {
    var isAr     = (typeof MWT !== 'undefined' && MWT.locale === 'ar');
    var sevColor = SEV_COLOR[o.severity] || '#6a9ab0';
    var date     = o.created_at ? new Date(o.created_at).toLocaleDateString() : '—';

    var catLabel = isAr && typeof MWT !== 'undefined' && MWT.wasteCategories[o.waste_category]
      ? MWT.wasteCategories[o.waste_category].label_ar
      : o.waste_category_label || o.waste_category;

    var sevLabel = isAr && typeof MWT !== 'undefined' && MWT.severities[o.severity]
      ? MWT.severities[o.severity].label_ar
      : o.severity_label || o.severity;

    var envLabel = isAr && o.environment_type && typeof MWT !== 'undefined' && MWT.environmentTypes[o.environment_type]
      ? MWT.environmentTypes[o.environment_type].label_ar
      : o.environment_label || '';

    var obsLabel = isAr && o.observer_type && typeof MWT !== 'undefined' && MWT.observerTypes[o.observer_type]
      ? MWT.observerTypes[o.observer_type].label_ar
      : o.observer_type_label || '';

    var html = '<div class="obs-popup">';
    html += '<div class="obs-popup-code">' + esc(o.report_code) + '</div>';
    html += '<div class="obs-popup-cat">' + esc(o.waste_category_emoji) + ' ' + esc(catLabel) + '</div>';
    html += '<div class="obs-popup-sev" style="background:' + sevColor + '1a;color:' + sevColor + ';border:1px solid ' + sevColor + '44;">' + esc(sevLabel) + '</div>';
    html += '<div class="obs-popup-meta">';
    html += '📅 ' + date;
    if (envLabel) html += '<br>' + esc(o.environment_emoji || '') + ' ' + esc(envLabel);
    if (obsLabel) html += '<br>👤 ' + esc(obsLabel);
    if (o.location_name) html += '<br>📍 ' + esc(o.location_name);
    html += '</div>';

    if (o.description) {
      html += '<div class="obs-popup-desc">' + esc(o.description) + '</div>';
    }
    if (o.images && o.images.length > 0) {
      html += '<img class="obs-popup-img" src="/static/uploads/' + esc(o.images[0].image_path) + '" alt="" loading="lazy">';
    }
    html += '</div>';
    return html;
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Stats counters (index page) ───────────────────────────────
  async function loadStats() {
    try {
      var res = await fetch('/api/stats');
      if (!res.ok) return;
      var d = await res.json();
      setText('stat-total',    d.total ?? '—');
      setText('stat-month',    d.this_month ?? '—');
      setText('stat-hotspots', d.hotspots_count ?? '—');
    } catch (_) {}
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function updateCountDisplay(total) {
    var el = document.getElementById('mapObsCount');
    if (!el) return;
    var isAr = typeof MWT !== 'undefined' && MWT.locale === 'ar';
    el.textContent = isAr ? total + ' ملاحظة' : total + ' observation' + (total === 1 ? '' : 's');
  }

  // ── Heatmap ───────────────────────────────────────────────────
  async function toggleHeatmap() {
    var btn = document.getElementById('btnHeatmap');
    if (heatVisible && heatLayer) {
      mainMap.removeLayer(heatLayer);
      heatVisible = false;
      if (btn) btn.classList.remove('active');
      return;
    }
    try {
      var res = await fetch('/api/heatmap');
      var pts = await res.json();
      if (heatLayer) mainMap.removeLayer(heatLayer);
      heatLayer = L.heatLayer(pts, {
        radius: 28,
        blur: 18,
        maxZoom: 13,
        max: 1.0,
        gradient: { 0.25: '#00e5a0', 0.55: '#ffd166', 0.8: '#ff6b35', 1.0: '#ff3d5a' },
      }).addTo(mainMap);
      heatVisible = true;
      if (btn) btn.classList.add('active');
    } catch (e) {
      console.error('[MWT] Heatmap failed:', e);
    }
  }

  // ── Filters ───────────────────────────────────────────────────
  function buildFilterParams() {
    var parts = [];
    var ids = ['filterCategory', 'filterSeverity', 'filterEnvType', 'filterFrom', 'filterTo'];
    var keys = ['category', 'severity', 'env_type', 'from', 'to'];
    ids.forEach(function (id, i) {
      var el = document.getElementById(id);
      if (el && el.value) parts.push(keys[i] + '=' + encodeURIComponent(el.value));
    });
    return parts.join('&');
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function bindFilters() {
    var debouncedLoad = debounce(loadObservations, 350);
    ['filterCategory', 'filterSeverity', 'filterEnvType', 'filterFrom', 'filterTo'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', debouncedLoad);
    });

    var heatBtn = document.getElementById('btnHeatmap');
    if (heatBtn) heatBtn.addEventListener('click', toggleHeatmap);

    var resetBtn = document.getElementById('btnResetFilters');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        ['filterCategory', 'filterSeverity', 'filterEnvType'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.value = '';
        });
        ['filterFrom', 'filterTo'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.value = '';
        });
        loadObservations();
      });
    }
  }

  // Expose so report_modal.js can refresh the map after a submission
  window.mapReload = loadObservations;

  document.addEventListener('DOMContentLoaded', init);

})();
