var map;
document.addEventListener("DOMContentLoaded", function() {
    if (!map) {
        map = L.map('map').setView([36.75, 3.06], 6);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
    }
});


function loadReports() {
    fetch('/get_reports')
        .then(response => response.json())
        .then(data => {
            console.log("🔍 التقارير المستلمة:", data);  // طباعة التقارير المستلمة
            data.forEach(report => {
                var popupContent = `<b>الوصف:</b> ${report.description}`;
                if (report.images && report.images.length > 0) {
                    report.images.forEach(image => {
                        popupContent += `<br><img src="static/uploads/${image.image_path}" width="100" style="border-radius:10px;">`;
                    });
                }
                popupContent += `<br><button onclick="deleteReport(${report.id})" style="background-color: red; color: white; padding: 5px; border: none; border-radius: 5px; cursor: pointer;">🗑 حذف</button>`;

                L.marker([report.latitude, report.longitude])
                    .addTo(map)
                    .bindPopup(popupContent);
            });
        });
}


var userMarker = null;

var map;

document.addEventListener("DOMContentLoaded", function() {
    // التحقق مما إذا كانت الخريطة غير موجودة ثم إنشاؤها
    if (!map) {
        map = L.map('map').setView([36.75, 3.06], 6);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
    }

    // الآن يمكننا إضافة event listener للنقر على الخريطة
    map.on('click', function(e) {
        document.getElementById("latitude").value = e.latlng.lat;
        document.getElementById("longitude").value = e.latlng.lng;

        if (userMarker) {
            map.removeLayer(userMarker);
        }

        userMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(map)
            .bindPopup("📍 موقع الإبلاغ المحدد")
            .openPopup();
    });
});


function getLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function(position) {
            var lat = position.coords.latitude;
            var lng = position.coords.longitude;

            document.getElementById("latitude").value = lat;
            document.getElementById("longitude").value = lng;

            if (!map) { // إذا لم تكن الخريطة موجودة، قم بإنشائها
                map = L.map('map').setView([lat, lng], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; OpenStreetMap contributors'
                }).addTo(map);
            } else {
                map.setView([lat, lng], 13);
            }

            if (userMarker) {
                map.removeLayer(userMarker);
            }

            userMarker = L.marker([lat, lng]).addTo(map)
                .bindPopup("📍 موقعي الحالي")
                .openPopup();
        }, function(error) {
            alert("تعذر الحصول على الموقع: " + error.message);
        });
    } else {
        alert("المتصفح لا يدعم تحديد الموقع الجغرافي.");
    }
}

document.getElementById("reportForm").addEventListener("submit", function(event) {
    event.preventDefault();
    
    var formData = new FormData(this);
    var imageInput = document.getElementById("images");

    // التأكد من أن الصور موجودة
    if (imageInput.files.length > 0) {
        for (let i = 0; i < imageInput.files.length; i++) {
            formData.append("images", imageInput.files[i]); // يجب أن يكون الاسم مطابقًا لـ name في input
        }
    } else {
        console.warn("⚠️ لم يتم اختيار أي صورة!");
    }

    fetch('/add_report', { method: 'POST', body: formData })
    .then(response => response.json())
    .then(data => {
        console.log("✅ استجابة السيرفر:", data);
        alert(data.message);
        location.reload();
    })
    .catch(error => console.error("❌ خطأ أثناء الإرسال:", error));
});




// مصفوفة لتخزين الصور المحددة
let selectedFiles = [];

document.getElementById("images").addEventListener("change", function(event) {
    selectedFiles = Array.from(event.target.files); // تحويل FileList إلى مصفوفة
    updatePreview();
});

function updatePreview() {
    const container = document.getElementById("preview-container");
    container.innerHTML = ""; // مسح الصور السابقة

    selectedFiles.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const previewItem = document.createElement("div");
            previewItem.classList.add("preview-item");

            const img = document.createElement("img");
            img.src = e.target.result;
            img.classList.add("preview-image");
            img.addEventListener("click", function() {
                openPopup(this.src);
            });

            const removeBtn = document.createElement("button");
            removeBtn.classList.add("remove-image");
            removeBtn.textContent = "❌";
            removeBtn.onclick = function() { removeImage(index); };

            previewItem.appendChild(img);
            previewItem.appendChild(removeBtn);
            container.appendChild(previewItem);
        };
        reader.readAsDataURL(file);
    });

    container.style.display = selectedFiles.length > 0 ? "block" : "none";
}

function removeImage(index) {
    selectedFiles.splice(index, 1);
    updatePreview();
}

// دالة فتح نافذة تكبير الصورة
function openPopup(src) {
    var popupOverlay = document.getElementById("popupOverlay");
    var popupImage = document.getElementById("popupImage");

    popupImage.src = src;
    popupOverlay.style.display = "flex";  // تأكد من ظهور النافذة
}


// دالة إغلاق نافذة التكبير
function closePopup() {
    document.getElementById("popupOverlay").style.display = "none";
}


function deleteReport(reportId) {
    fetch(`/delete_report/${reportId}`, {
        method: "DELETE",
    })
    .then(response => response.json().then(data => ({ status: response.status, body: data })))
    .then(result => {
        if (result.status === 200) {
            alert("✅ تم حذف التقرير بنجاح!");
            location.reload();
        } else if (result.status === 403) {
            alert("⚠️ لا يمكنك حذف تقرير لم تقم بكتابته!");
        } else {
            alert("❌ خطأ: " + (result.body.error || "حدث خطأ أثناء حذف التقرير!"));
        }
    })
    .catch(error => {
        console.error("Error:", error);
        alert("⚠️ حدث خطأ أثناء الاتصال بالخادم!");
    });
}

document.addEventListener("DOMContentLoaded", function() {
    loadReports();
});
