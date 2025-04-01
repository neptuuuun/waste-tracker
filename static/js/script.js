// pollution-reporter.js - Environmental Pollution Reporting Application

/**
 * Application Configuration
 */
class Config {
    static MAP = {
      defaultView: {
        lat: 36.75,
        lng: 3.06,
        zoom: 6
      },
      tileLayer: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors'
      },
      maxZoom: 18,
      minZoom: 3
    };
  
    static API = {
      endpoints: {
        reports: '/get_reports',
        addReport: '/add_report',
        deleteReport: (id) => `/delete_report/${id}`
      }
    };
  
    static UI = {
      loadingDuration: 1000,
      maxImageSize: 5 * 1024 * 1024, // 5MB
      allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif']
    };
  }
  
  /**
   * Application State Manager
   */
  class StateManager {
    constructor() {
      this.map = null;
      this.userMarker = null;
      this.selectedFiles = [];
      this.markers = new Map();
      this.isLoading = false;
    }
  
    setLoading(isLoading) {
      this.isLoading = isLoading;
      return this.isLoading;
    }
  
    addMarker(id, marker) {
      this.markers.set(id, marker);
    }
  
    clearMarkers() {
      this.markers.clear();
    }
  
    getMarker(id) {
      return this.markers.get(id);
    }
  
    setUserMarker(marker) {
      this.userMarker = marker;
    }
  
    setMap(map) {
      this.map = map;
    }
  
    updateSelectedFiles(files) {
      this.selectedFiles = files;
    }
  
    removeFileAtIndex(index) {
      this.selectedFiles.splice(index, 1);
    }
  }
  
  /**
   * Utility Helper Class
   */
  class Utils {
    constructor(stateManager) {
      this.state = stateManager;
    }
  
    showLoading() {
      this.state.setLoading(true);
      document.getElementById('loading-indicator').style.display = 'flex';
    }
  
    hideLoading() {
      this.state.setLoading(false);
      document.getElementById('loading-indicator').style.display = 'none';
    }
  
    showAlert(title, text, icon = 'info') {
      return Swal.fire({
        title,
        text,
        icon,
        confirmButtonText: 'حسناً',
        confirmButtonColor: '#0096c7'
      });
    }
  
    validateImage(file) {
      if (!Config.UI.allowedImageTypes.includes(file.type)) {
        throw new Error('نوع الملف غير مدعوم. يرجى اختيار صورة (JPG, PNG, GIF)');
      }
      if (file.size > Config.UI.maxImageSize) {
        throw new Error('حجم الصورة كبير جداً. الحد الأقصى هو 5 ميجابايت');
      }
      return true;
    }
  
    formatFileSize(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
  
    escapeHtml(unsafe) {
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
  
    /**
     * Debounce function to limit execution rate
     */
    debounce(func, wait) {
      let timeout;
      return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }
  }
  
  /**
   * Map Manager Class
   */
  class MapManager {
    constructor(stateManager, utils) {
      this.state = stateManager;
      this.utils = utils;
      this.handleMapClickBound = this.handleMapClick.bind(this);
    }
  
    initializeMap(lat = Config.MAP.defaultView.lat, lng = Config.MAP.defaultView.lng, zoom = Config.MAP.defaultView.zoom) {
      if (!this.state.map) {
        const map = L.map('map', {
          maxZoom: Config.MAP.maxZoom,
          minZoom: Config.MAP.minZoom
        }).setView([lat, lng], zoom);
  
        L.tileLayer(Config.MAP.tileLayer.url, {
          attribution: Config.MAP.tileLayer.attribution
        }).addTo(map);
  
        map.on('click', this.handleMapClickBound);
        this.state.setMap(map);
      }
      return this.state.map;
    }
  
    handleMapClick(e) {
      const { lat, lng } = e.latlng;
      this.updateMarkerPosition(lat, lng, "📍 موقع الإبلاغ المحدد");
    }
  
    updateMarkerPosition(lat, lng, popupText) {
      document.getElementById("latitude").value = lat.toFixed(6);
      document.getElementById("longitude").value = lng.toFixed(6);
  
      if (this.state.userMarker) {
        this.state.map.removeLayer(this.state.userMarker);
      }
  
      const userMarker = L.marker([lat, lng]).addTo(this.state.map)
        .bindPopup(popupText)
        .openPopup();
  
      this.state.setUserMarker(userMarker);
      this.state.map.setView([lat, lng], this.state.map.getZoom());
    }
  
    resetMapView() {
      if (this.state.map) {
        this.state.map.setView(
          [Config.MAP.defaultView.lat, Config.MAP.defaultView.lng],
          Config.MAP.defaultView.zoom
        );
      }
    }
  }
  
  /**
   * Report Manager Class
   */
  class ReportManager {
    constructor(stateManager, utils) {
      this.state = stateManager;
      this.utils = utils;
    }
  
    async loadReports() {
      try {
        this.utils.showLoading();
        const response = await fetch(Config.API.endpoints.reports);
        if (!response.ok) throw new Error('Failed to fetch reports');
        
        const data = await response.json();
        console.log("🔍 Reports received:", data);
  
        // Clear existing markers
        this.state.markers.forEach(marker => this.state.map.removeLayer(marker));
        this.state.clearMarkers();
  
        data.forEach(report => {
          if (!report.latitude || !report.longitude) {
            console.warn(`Invalid coordinates for report ${report.id}`);
            return;
          }
  
          const marker = L.marker([report.latitude, report.longitude])
            .addTo(this.state.map)
            .bindPopup(this.createReportPopup(report));
          
          this.state.addMarker(report.id, marker);
        });
      } catch (error) {
        console.error("Error loading reports:", error);
        this.utils.showAlert('خطأ', 'فشل في تحميل التقارير. يرجى المحاولة مرة أخرى', 'error');
      } finally {
        this.utils.hideLoading();
      }
    }
  
    createReportPopup(report) {
      let popupContent = `<div class="report-popup">
        <div class="report-description"><b>الوصف:</b> ${this.utils.escapeHtml(report.description)}</div>
        <div class="report-type"><b>نوع التلوث:</b> ${this.utils.escapeHtml(report.pollutionType || 'غير محدد')}</div>`;
      
      if (report.images && report.images.length > 0) {
        popupContent += '<div class="report-images">';
        report.images.forEach(image => {
          popupContent += `<img src="static/uploads/${encodeURIComponent(image.image_path)}" 
            width="100" style="border-radius:10px; cursor: pointer;" 
            onclick="app.imageManager.openPopup('static/uploads/${encodeURIComponent(image.image_path)}')">`;
        });
        popupContent += '</div>';
      }
      
      popupContent += `<button onclick="app.reportManager.deleteReport(${report.id})" 
        class="delete-report-btn">🗑 حذف</button></div>`;
      
      return popupContent;
    }
  
    async deleteReport(reportId) {
      try {
        const result = await this.utils.showAlert(
          'هل أنت متأكد؟',
          "لا يمكن التراجع عن هذا الإجراء!",
          'warning',
        );
  
        if (result.isConfirmed) {
          this.utils.showLoading();
          const response = await fetch(Config.API.endpoints.deleteReport(reportId), {
            method: "DELETE",
          });
  
          const data = await response.json();
          
          if (response.ok) {
            this.utils.showAlert('تم الحذف!', 'تم حذف التقرير بنجاح', 'success');
            location.reload();
          } else {
            throw new Error(data.error || 'Failed to delete report');
          }
        }
      } catch (error) {
        console.error("Error deleting report:", error);
        this.utils.showAlert('خطأ', 'فشل في حذف التقرير. يرجى المحاولة مرة أخرى', 'error');
      } finally {
        this.utils.hideLoading();
      }
    }
  }
  
  /**
   * Image Manager Class
   */
  class ImageManager {
    constructor(stateManager, utils) {
      this.state = stateManager;
      this.utils = utils;
    }
  
    handleImageSelect(event) {
      const files = Array.from(event.target.files);
      this.state.updateSelectedFiles(files);
      this.updatePreview();
    }
  
    updatePreview() {
      const container = document.getElementById("preview-container");
      container.innerHTML = "";
  
      this.state.selectedFiles.forEach((file, index) => {
        try {
          this.utils.validateImage(file);
          const reader = new FileReader();
          reader.onload = (e) => {
            const previewItem = document.createElement("div");
            previewItem.classList.add("preview-item");
  
            const img = document.createElement("img");
            img.src = e.target.result;
            img.classList.add("preview-image");
            img.addEventListener("click", () => this.openPopup(e.target.result));
  
            const removeBtn = document.createElement("button");
            removeBtn.classList.add("remove-image");
            removeBtn.innerHTML = '<i class="fas fa-times"></i>';
            removeBtn.addEventListener('click', () => this.removeImage(index));
  
            previewItem.appendChild(img);
            previewItem.appendChild(removeBtn);
            container.appendChild(previewItem);
          };
          reader.readAsDataURL(file);
        } catch (error) {
          this.utils.showAlert('خطأ', error.message, 'error');
        }
      });
  
      container.style.display = this.state.selectedFiles.length > 0 ? "grid" : "none";
    }
  
    removeImage(index) {
      this.state.removeFileAtIndex(index);
      this.updatePreview();
    }
  
    openPopup(src) {
      const popupOverlay = document.getElementById("popupOverlay");
      const popupImage = document.getElementById("popupImage");
      popupImage.src = src;
      popupOverlay.style.display = "flex";
    }
  
    closePopup() {
      document.getElementById("popupOverlay").style.display = "none";
    }
  }
  
  /**
   * Form Manager Class
   */
  class FormManager {
    constructor(stateManager, utils) {
      this.state = stateManager;
      this.utils = utils;
    }
  
    async handleSubmit(event) {
      event.preventDefault();
      
      const form = event.target;
      const description = form.querySelector('[name="description"]').value.trim();
      const latitude = form.querySelector('[name="latitude"]').value;
      const longitude = form.querySelector('[name="longitude"]').value;
      
      if (!description) {
        this.utils.showAlert('خطأ', 'الرجاء إدخال وصف للتقرير', 'error');
        return;
      }
      
      if (!latitude || !longitude) {
        this.utils.showAlert('خطأ', 'الرجاء تحديد الموقع على الخريطة', 'error');
        return;
      }
  
      try {
        this.utils.showLoading();
        const formData = new FormData(form);
        
        const response = await fetch(Config.API.endpoints.addReport, {
          method: 'POST',
          body: formData
        });
  
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.message || 'Failed to submit report');
        }
  
        this.utils.showAlert('نجاح', 'تم إرسال التقرير بنجاح', 'success');
        location.reload();
      } catch (error) {
        console.error("Error submitting report:", error);
        this.utils.showAlert('خطأ', 'فشل في إرسال التقرير. يرجى المحاولة مرة أخرى', 'error');
      } finally {
        this.utils.hideLoading();
      }
    }
  }
  
  /**
   * Geolocation Manager Class
   */
  class GeolocationManager {
    constructor(stateManager, utils, mapManager) {
      this.state = stateManager;
      this.utils = utils;
      this.mapManager = mapManager;
    }
  
    getLocation() {
      if (!navigator.geolocation) {
        this.utils.showAlert('خطأ', 'المتصفح لا يدعم تحديد الموقع الجغرافي', 'error');
        return;
      }

      const locationButton = document.querySelector('[data-action="get-location"]');
      if (locationButton) {
        locationButton.disabled = true;
        locationButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري تحديد الموقع...';
      }

      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          position => {
            const { latitude: lat, longitude: lng } = position.coords;
            this.mapManager.updateMarkerPosition(lat, lng, "📍 موقعي الحالي");
            resolve(position);
          },
          error => {
            let errorMessage = "تعذر الحصول على الموقع: ";
            switch(error.code) {
              case error.PERMISSION_DENIED:
                errorMessage += "تم رفض الإذن للوصول إلى الموقع.";
                break;
              case error.POSITION_UNAVAILABLE:
                errorMessage += "معلومات الموقع غير متوفرة.";
                break;
              case error.TIMEOUT:
                errorMessage += "انتهت مهلة طلب الموقع.";
                break;
              default:
                errorMessage += error.message;
            }
            this.utils.showAlert('خطأ', errorMessage, 'error');
            reject(error);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          }
        );
      })
      .finally(() => {
        if (locationButton) {
          locationButton.disabled = false;
          locationButton.innerHTML = '<i class="fas fa-location-dot"></i> تحديد موقعي';
        }
      });
    }
  }
  
  /**
   * Application Main Class
   */
  class PollutionReporterApp {
    constructor() {
      this.state = new StateManager();
      this.utils = new Utils(this.state);
      this.mapManager = new MapManager(this.state, this.utils);
      this.reportManager = new ReportManager(this.state, this.utils);
      this.imageManager = new ImageManager(this.state, this.utils);
      this.formManager = new FormManager(this.state, this.utils);
      this.geoManager = new GeolocationManager(this.state, this.utils, this.mapManager);
      
      this.init();
    }
  
    init() {
      // Initialize map when DOM is loaded
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.setupEventListeners());
      } else {
        this.setupEventListeners();
      }
    }
  
    setupEventListeners() {
      // Initialize map and load reports
      this.mapManager.initializeMap();
      this.reportManager.loadReports();
  
      // Set up event delegation for the entire app
      document.addEventListener('click', this.handleDocumentClick.bind(this));
      
      // Form submission
      const reportForm = document.getElementById("reportForm");
      if (reportForm) {
        reportForm.addEventListener("submit", (e) => this.formManager.handleSubmit(e));
      }
  
      // Image handling
      const imagesInput = document.getElementById("images");
      if (imagesInput) {
        imagesInput.addEventListener("change", (e) => this.imageManager.handleImageSelect(e));
      }
  
      // Popup handling
      const popupOverlay = document.getElementById("popupOverlay");
      if (popupOverlay) {
        popupOverlay.addEventListener("click", (e) => {
          if (e.target === popupOverlay) {
            this.imageManager.closePopup();
          }
        });
      }
    }
  
    handleDocumentClick(event) {
      // Use event delegation to handle clicks throughout the app
      const target = event.target;
      
      // Handle location button click
      if (target.closest('[data-action="get-location"]')) {
        event.preventDefault();
        this.geoManager.getLocation();
      }
      
      // Add other global click handlers here as needed
    }
  }
  
  // Initialize the application
  const app = new PollutionReporterApp();
  
  // Expose app to global scope for popup functions
  window.app = app;
  
  // Expose map functions to global scope
  window.mapFunctions = {
    getLocation: app.geoManager.getLocation.bind(app.geoManager),
    resetMapView: app.mapManager.resetMapView.bind(app.mapManager)
  };

  // Add this line to expose closePopup function
  window.closePopup = () => app.imageManager.closePopup();

