/* report_modal.js — 4-step report submission modal */
'use strict';

(function () {

  var TILE_URL  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  var TILE_ATTR = '&copy; OpenStreetMap contributors &copy; CARTO';

  var MAX_PHOTOS      = 3;
  var MAX_PHOTO_BYTES = 5 * 1024 * 1024;

  // ── State ─────────────────────────────────────────────────────
  var state = {
    lat: null,
    lng: null,
    environment_type: null,
    location_name: '',
    waste_category: null,
    waste_subcategory: '',
    quantity_estimate: null,
    severity: null,
    observer_type: null,
    description: '',
    weather_conditions: '',
    cleanup_possible: '',
    observer_name: '',
    observer_email: '',
    photos: [],
  };

  var modalMap    = null;
  var modalMarker = null;
  var currentStep = 1;

  // ── Step IDs ──────────────────────────────────────────────────
  var STEPS = ['mStep1', 'mStep2', 'mStep3', 'mStep4', 'mSuccess'];

  // ── Inline error helpers ──────────────────────────────────────
  function showError(id, msg) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
  }

  function clearError(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = '';
    el.style.display = 'none';
  }

  function clearAllErrors() {
    ['step1Error', 'step2Error', 'step3Error', 'step4Error'].forEach(clearError);
  }

  // ── Open / Close ──────────────────────────────────────────────
  function open(opts) {
    opts = opts || {};
    if (opts.lat != null && opts.lng != null) {
      state.lat = parseFloat(opts.lat);
      state.lng = parseFloat(opts.lng);
    }
    var overlay = document.getElementById('reportModal');
    if (!overlay) return;
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    showStep(1);
  }

  function close() {
    var overlay = document.getElementById('reportModal');
    if (overlay) overlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  function resetState() {
    state.lat = null;
    state.lng = null;
    state.environment_type = null;
    state.location_name    = '';
    state.waste_category   = null;
    state.waste_subcategory = '';
    state.quantity_estimate = null;
    state.severity          = null;
    state.observer_type     = null;
    state.description       = '';
    state.weather_conditions = '';
    state.cleanup_possible  = '';
    state.observer_name     = '';
    state.observer_email    = '';
    state.photos            = [];

    // Reset UI selections
    document.querySelectorAll('.env-btn, .cat-btn, .qty-btn, .sev-btn, .role-btn')
      .forEach(function (b) { b.classList.remove('selected'); });
    document.querySelectorAll('#wasteSubcat, #locationName, #description, #obsName, #obsEmail')
      .forEach(function (el) { el && (el.value = ''); });
    var weather = document.getElementById('weather');
    var cleanup = document.getElementById('cleanup');
    if (weather) weather.value = '';
    if (cleanup) cleanup.value = '';
    var preview = document.getElementById('photoPreview');
    if (preview) preview.innerHTML = '';
    var descCount = document.getElementById('descCount');
    if (descCount) descCount.textContent = '0/500';
    var coordDisplay = document.getElementById('coordDisplay');
    if (coordDisplay) {
      coordDisplay.textContent = isAr() ? 'انقر على الخريطة لتحديد الموقع' : 'Click map to set location';
      coordDisplay.classList.remove('has-coords');
    }
    clearAllErrors();
  }

  // ── Step navigation ───────────────────────────────────────────
  function showStep(n) {
    currentStep = n;
    clearAllErrors();

    // Show/hide step panels
    STEPS.forEach(function (id, i) {
      var el = document.getElementById(id);
      if (el) el.style.display = (i + 1 === n) ? '' : 'none';
    });

    // Update progress dots (only for steps 1-4)
    var stepsEl = document.getElementById('modalSteps');
    if (stepsEl) {
      stepsEl.style.display = n <= 4 ? '' : 'none';
      stepsEl.querySelectorAll('.step-dot').forEach(function (dot) {
        var s = parseInt(dot.dataset.step);
        dot.classList.toggle('active', s === n);
        dot.classList.toggle('done',   s < n);
      });
    }

    // Init/refresh modal map when step 1 is shown
    if (n === 1) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          initModalMap();
          refreshCoordDisplay();
        });
      });
    }

    // Scroll modal to top
    var box = document.querySelector('.modal-box');
    if (box) box.scrollTop = 0;
  }

  // ── Modal mini-map ────────────────────────────────────────────
  function initModalMap() {
    var container = document.getElementById('modalMap');
    if (!container) return;

    if (modalMap) {
      modalMap.invalidateSize();
      if (state.lat != null && state.lng != null) {
        modalMap.setView([state.lat, state.lng], 9);
        placeModalMarker(state.lat, state.lng);
      }
      return;
    }

    var center = (state.lat != null && state.lng != null)
      ? [state.lat, state.lng] : [36.75, 10];
    var zoom   = (state.lat != null && state.lng != null) ? 9 : 4;

    modalMap = L.map(container, {
      center: center,
      zoom: zoom,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTR,
      subdomains: 'abcd',
      maxZoom: 18,
    }).addTo(modalMap);

    modalMap.on('click', function (e) {
      setCoords(e.latlng.lat, e.latlng.lng);
    });

    if (state.lat != null && state.lng != null) {
      placeModalMarker(state.lat, state.lng);
    }
  }

  function placeModalMarker(lat, lng) {
    if (modalMarker) modalMap.removeLayer(modalMarker);
    modalMarker = L.circleMarker([lat, lng], {
      radius: 7,
      color: '#00c8e8',
      fillColor: '#00c8e8',
      fillOpacity: 0.85,
      weight: 2,
    }).addTo(modalMap);
  }

  function setCoords(lat, lng) {
    state.lat = lat;
    state.lng = lng;
    clearError('step1Error');
    refreshCoordDisplay();
    if (modalMap) placeModalMarker(lat, lng);
  }

  function refreshCoordDisplay() {
    var el = document.getElementById('coordDisplay');
    if (!el) return;
    if (state.lat != null && state.lng != null) {
      el.textContent = state.lat.toFixed(5) + ', ' + state.lng.toFixed(5);
      el.classList.add('has-coords');
    }
  }

  // ── GPS ───────────────────────────────────────────────────────
  function getGPS() {
    if (!navigator.geolocation) {
      showError('step1Error', isAr() ? 'المتصفح لا يدعم تحديد الموقع' : 'Geolocation not supported by this browser');
      return;
    }
    var btn = document.getElementById('btnGPS');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        setCoords(pos.coords.latitude, pos.coords.longitude);
        if (modalMap) {
          modalMap.setView([pos.coords.latitude, pos.coords.longitude], 13);
        }
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-location-crosshairs"></i> ' + (isAr() ? 'موقعي الحالي' : 'Use GPS'); }
      },
      function (err) {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-location-crosshairs"></i> ' + (isAr() ? 'موقعي الحالي' : 'Use GPS'); }
        var msg = isAr() ? 'تعذر تحديد الموقع' : 'Could not get location';
        if (err.code === 1) msg = isAr() ? 'تم رفض إذن الموقع' : 'Location permission denied';
        showError('step1Error', msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  // ── Step 1 validation ─────────────────────────────────────────
  function validateStep1() {
    if (state.lat == null || state.lng == null) {
      showError('step1Error', isAr() ? 'الرجاء تحديد الموقع على الخريطة أو استخدام GPS' : 'Please select a location on the map or use GPS');
      return false;
    }
    return true;
  }

  // ── Step 2 validation ─────────────────────────────────────────
  function validateStep2() {
    if (!state.waste_category) {
      showError('step2Error', isAr() ? 'الرجاء اختيار فئة النفايات' : 'Please select a waste category');
      return false;
    }
    if (!state.severity) {
      showError('step2Error', isAr() ? 'الرجاء تحديد درجة الخطورة' : 'Please select a severity level');
      return false;
    }
    return true;
  }

  // ── Photo handling ────────────────────────────────────────────
  function handlePhotos(input) {
    var files = Array.from(input.files);
    var preview = document.getElementById('photoPreview');

    files.forEach(function (file) {
      if (state.photos.length >= MAX_PHOTOS) {
        showError('step3Error', isAr() ? 'الحد الأقصى 3 صور' : 'Maximum 3 photos allowed');
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        showError('step3Error', (isAr() ? 'الصورة تتجاوز 5MB: ' : 'Photo exceeds 5 MB: ') + file.name);
        return;
      }
      if (!file.type.startsWith('image/')) {
        showError('step3Error', (isAr() ? 'نوع الملف غير مدعوم: ' : 'Unsupported file type: ') + file.name);
        return;
      }
      clearError('step3Error');
      state.photos.push(file);
      var idx = state.photos.length - 1;

      var wrap = document.createElement('div');
      wrap.className = 'photo-thumb-wrap';
      wrap.dataset.idx = idx;

      var img = document.createElement('img');
      img.className = 'photo-thumb';
      img.alt = '';
      var reader = new FileReader();
      reader.onload = function (e) { img.src = e.target.result; };
      reader.readAsDataURL(file);

      var rm = document.createElement('button');
      rm.className = 'photo-remove';
      rm.innerHTML = '✕';
      rm.type = 'button';
      rm.addEventListener('click', function () {
        var i = parseInt(wrap.dataset.idx);
        state.photos.splice(i, 1);
        wrap.remove();
        // Re-index remaining wraps
        var allWraps = preview.querySelectorAll('.photo-thumb-wrap');
        allWraps.forEach(function (w, j) { w.dataset.idx = j; });
      });

      wrap.appendChild(img);
      wrap.appendChild(rm);
      if (preview) preview.appendChild(wrap);
    });

    // Reset input so same file can be re-added after removal
    input.value = '';
  }

  // ── Review box (DOM-safe — no innerHTML of user content) ──────
  function buildReview() {
    var isAr_  = isAr();
    var cat    = (typeof MWT !== 'undefined' && MWT.wasteCategories[state.waste_category]) || {};
    var env    = (typeof MWT !== 'undefined' && state.environment_type && MWT.environmentTypes[state.environment_type]) || {};
    var sev    = (typeof MWT !== 'undefined' && MWT.severities[state.severity]) || {};
    var qty    = (typeof MWT !== 'undefined' && state.quantity_estimate && MWT.quantityEstimates[state.quantity_estimate]) || {};
    var obs    = (typeof MWT !== 'undefined' && state.observer_type && MWT.observerTypes[state.observer_type]) || {};

    var rows = [
      [isAr_ ? 'الإحداثيات'  : 'Coordinates',  state.lat != null ? state.lat.toFixed(5) + ', ' + state.lng.toFixed(5) : '—'],
      [isAr_ ? 'الموقع'      : 'Location',     state.location_name || '—'],
      [isAr_ ? 'البيئة'      : 'Environment',  (env.label_ar && isAr_) ? env.label_ar : (env.label_en || '—')],
      [isAr_ ? 'الفئة'       : 'Category',     (isAr_ ? cat.label_ar : cat.label_en) || '—'],
      [isAr_ ? 'الكمية'      : 'Quantity',     (isAr_ ? qty.label_ar : qty.label_en) || '—'],
      [isAr_ ? 'الخطورة'     : 'Severity',     (isAr_ ? sev.label_ar : sev.label_en) || '—'],
      [isAr_ ? 'الدور'       : 'Role',         (isAr_ ? obs.label_ar : obs.label_en) || '—'],
      [isAr_ ? 'الوصف'       : 'Description',  state.description || '—'],
      [isAr_ ? 'الصور'       : 'Photos',       String(state.photos.length)],
    ];

    // Build with DOM methods — avoids XSS from user-supplied values
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'review-row';
      var key = document.createElement('span');
      key.className = 'review-key';
      key.textContent = r[0];
      var val = document.createElement('span');
      val.className = 'review-val';
      val.textContent = r[1];
      row.appendChild(key);
      row.appendChild(val);
      frag.appendChild(row);
    });
    return frag;
  }

  // ── Submit ────────────────────────────────────────────────────
  async function submitReport() {
    var btn = document.getElementById('btnSubmit');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    clearError('step4Error');

    var fd = new FormData();
    fd.append('latitude',           state.lat);
    fd.append('longitude',          state.lng);
    fd.append('location_name',      state.location_name || '');
    fd.append('waste_category',     state.waste_category);
    fd.append('waste_subcategory',  state.waste_subcategory || '');
    fd.append('quantity_estimate',  state.quantity_estimate || '');
    fd.append('severity',           state.severity || 'medium');
    fd.append('observer_type',      state.observer_type || 'individual');
    fd.append('description',        state.description || '');
    fd.append('weather_conditions', state.weather_conditions || '');
    fd.append('cleanup_possible',   state.cleanup_possible || '');
    fd.append('observer_name',      state.observer_name || '');
    fd.append('observer_email',     state.observer_email || '');
    if (state.environment_type) fd.append('environment_type', state.environment_type);
    state.photos.forEach(function (f) { fd.append('photos', f); });

    var csrfToken = (typeof MWT !== 'undefined' && MWT.csrfToken) ? MWT.csrfToken : '';

    try {
      var res = await fetch('/api/observations', {
        method: 'POST',
        headers: { 'X-CSRFToken': csrfToken },
        body: fd,
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');

      var codeEl = document.getElementById('successCode');
      if (codeEl) codeEl.textContent = data.report_code || '';
      showStep(5);

      // Refresh main map
      if (typeof window.mapReload === 'function') window.mapReload();

    } catch (e) {
      showError('step4Error', e.message || (isAr() ? 'فشل الإرسال. حاول مرة أخرى.' : 'Submission failed. Please try again.'));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = isAr() ? 'إرسال التقرير' : 'Submit Report';
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────
  function isAr() {
    return typeof MWT !== 'undefined' && MWT.locale === 'ar';
  }

  function selectToggle(container, value, stateKey) {
    document.querySelectorAll('#' + container + ' [data-value]').forEach(function (btn) {
      btn.classList.toggle('selected', btn.dataset.value === value);
    });
    state[stateKey] = value;
  }

  // ── Wire up all events ────────────────────────────────────────
  function bindEvents() {
    // Close
    document.getElementById('modalClose')?.addEventListener('click', close);
    document.getElementById('reportModal')?.addEventListener('click', function (e) {
      if (e.target === e.currentTarget) close();
    });

    // Keyboard close
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var overlay = document.getElementById('reportModal');
        if (overlay && overlay.style.display !== 'none') close();
      }
    });

    // GPS
    document.getElementById('btnGPS')?.addEventListener('click', getGPS);

    // Environment buttons (step 1)
    document.getElementById('envGrid')?.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-value]');
      if (!btn) return;
      selectToggle('envGrid', btn.dataset.value, 'environment_type');
    });

    // Step 1 → 2
    document.getElementById('step1Next')?.addEventListener('click', function () {
      state.location_name = (document.getElementById('locationName')?.value || '').trim();
      if (!validateStep1()) return;
      showStep(2);
    });

    // Category grid (step 2)
    document.getElementById('categoryGrid')?.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-value]');
      if (!btn) return;
      selectToggle('categoryGrid', btn.dataset.value, 'waste_category');
      clearError('step2Error');
    });

    // Quantity grid (step 2)
    document.getElementById('qtyGrid')?.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-value]');
      if (!btn) return;
      selectToggle('qtyGrid', btn.dataset.value, 'quantity_estimate');
    });

    // Severity grid (step 2)
    document.getElementById('sevGrid')?.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-value]');
      if (!btn) return;
      selectToggle('sevGrid', btn.dataset.value, 'severity');
      clearError('step2Error');
    });

    // Step 2 nav
    document.getElementById('step2Back')?.addEventListener('click', function () { showStep(1); });
    document.getElementById('step2Next')?.addEventListener('click', function () {
      state.waste_subcategory = (document.getElementById('wasteSubcat')?.value || '').trim();
      if (!validateStep2()) return;
      showStep(3);
    });

    // Role grid (step 3)
    document.getElementById('roleGrid')?.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-value]');
      if (!btn) return;
      selectToggle('roleGrid', btn.dataset.value, 'observer_type');
    });

    // Description character count
    var descEl = document.getElementById('description');
    if (descEl) {
      descEl.addEventListener('input', function () {
        var cnt = document.getElementById('descCount');
        if (cnt) cnt.textContent = descEl.value.length + '/500';
      });
    }

    // Photo upload
    var photoInput = document.getElementById('photoInput');
    if (photoInput) {
      photoInput.addEventListener('change', function () {
        handlePhotos(photoInput);
      });
    }

    // Step 3 nav
    document.getElementById('step3Back')?.addEventListener('click', function () { showStep(2); });
    document.getElementById('step3Next')?.addEventListener('click', function () {
      state.description        = (document.getElementById('description')?.value || '').trim();
      state.weather_conditions = document.getElementById('weather')?.value || '';
      state.cleanup_possible   = document.getElementById('cleanup')?.value || '';
      state.observer_name      = (document.getElementById('obsName')?.value || '').trim();
      state.observer_email     = (document.getElementById('obsEmail')?.value || '').trim();
      var reviewBox = document.getElementById('reviewBox');
      if (reviewBox) {
        reviewBox.innerHTML = '';
        reviewBox.appendChild(buildReview());
      }
      showStep(4);
    });

    // Step 4 nav + submit
    document.getElementById('step4Back')?.addEventListener('click', function () { showStep(3); });
    document.getElementById('btnSubmit')?.addEventListener('click', submitReport);

    // Success actions
    document.getElementById('btnCopyCode')?.addEventListener('click', function () {
      var code = document.getElementById('successCode')?.textContent || '';
      if (code) {
        navigator.clipboard?.writeText(code).then(function () {
          var btn = document.getElementById('btnCopyCode');
          if (btn) {
            var orig = btn.innerHTML;
            btn.textContent = isAr() ? 'تم النسخ!' : 'Copied!';
            setTimeout(function () { btn.innerHTML = orig; }, 2000);
          }
        });
      }
    });

    document.getElementById('btnAnotherReport')?.addEventListener('click', function () {
      resetState();
      showStep(1);
    });
  }

  // ── Public API ────────────────────────────────────────────────
  window.reportModal = { open: open, close: close };

  document.addEventListener('DOMContentLoaded', bindEvents);

})();
