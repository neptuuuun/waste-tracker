// Step-by-step report form logic for Marine Waste Tracker

document.addEventListener('DOMContentLoaded', function () {
  const stepper = document.getElementById('stepper');
  let currentStep = 1;
  let formData = {
    pollutionType: '',
    severity: '',
    description: '',
    imageFile: null,
    latitude: '',
    longitude: ''
  };

  // Step navigation helpers
  function showStep(step) {
    [...stepper.querySelectorAll('.step')].forEach((el, idx) => {
      el.style.display = (idx + 1 === step) ? '' : 'none';
    });
    currentStep = step;
  }

  // Step 1: Pollution type selection
  stepper.querySelectorAll('.icon-option').forEach(btn => {
    btn.addEventListener('click', function () {
      stepper.querySelectorAll('.icon-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      formData.pollutionType = btn.dataset.value;
    });
  });
  document.getElementById('step1Next').onclick = function () {
    if (!formData.pollutionType) {
      alert('Please select what you saw.');
      return;
    }
    showStep(2);
  };

  // Step 2: Severity selection
  stepper.querySelectorAll('.severity-option').forEach(btn => {
    btn.addEventListener('click', function () {
      stepper.querySelectorAll('.severity-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      formData.severity = btn.dataset.value;
    });
  });
  document.getElementById('step2Next').onclick = function () {
    if (!formData.severity) {
      alert('Please select severity.');
      return;
    }
    showStep(3);
  };
  document.getElementById('step2Back').onclick = function () { showStep(1); };

  // Step 3: Extra details
  document.getElementById('step3Next').onclick = function () {
    formData.description = document.getElementById('stepDescription').value;
    showStep(4);
  };
  document.getElementById('step3Back').onclick = function () { showStep(2); };

  // Step 4: Image upload
  const imageInput = document.getElementById('stepImageInput');
  const previewDiv = document.getElementById('stepImagePreview');
  imageInput.addEventListener('change', function () {
    previewDiv.innerHTML = '';
    if (imageInput.files && imageInput.files[0]) {
      formData.imageFile = imageInput.files[0];
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = document.createElement('img');
        img.src = e.target.result;
        img.className = 'step-preview-img';
        previewDiv.appendChild(img);
      };
      reader.readAsDataURL(imageInput.files[0]);
    } else {
      formData.imageFile = null;
    }
  });
  document.getElementById('step4Next').onclick = function () { showStep(5); };
  document.getElementById('step4Back').onclick = function () { showStep(3); };

  // Step 5: Location (auto)
  function setLatLngFields(lat, lng) {
    document.getElementById('stepLatitude').value = lat;
    document.getElementById('stepLongitude').value = lng;
    formData.latitude = lat;
    formData.longitude = lng;
  }
  // Try to get location automatically
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(function (pos) {
      setLatLngFields(pos.coords.latitude, pos.coords.longitude);
    }, function () {
      // fallback: leave blank, user can fill via map
    });
  }
  document.getElementById('step5Back').onclick = function () { showStep(4); };
  document.getElementById('stepSubmit').onclick = function () {
    // Validate location
    if (!document.getElementById('stepLatitude').value || !document.getElementById('stepLongitude').value) {
      alert('Location is required (auto or select on map).');
      return;
    }
    // Submit via AJAX
    let data = new FormData();
    data.append('latitude', formData.latitude);
    data.append('longitude', formData.longitude);
    data.append('description', formData.description);
    data.append('pollutionType', formData.pollutionType);
    data.append('severity', formData.severity);
    if (formData.imageFile) data.append('images', formData.imageFile);
    fetch('/add_report', {
      method: 'POST',
      body: data
    })
      .then(r => r.json())
      .then(resp => {
        if (resp.message) {
          showStep(6);
        } else {
          alert(resp.error || 'Error submitting report.');
        }
      })
      .catch(() => alert('Submission failed.'));
  };

  // Initialize stepper
  showStep(1);
});
