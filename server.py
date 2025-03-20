from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename
import os

app = Flask(__name__)
app.secret_key = "your_secret_key"  # ✅ ضروري لتفعيل الجلسات

# تحديد مكان تخزين الصور
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///reports.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)



# نموذج البيانات
class Report(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    description = db.Column(db.String(255), nullable=False)
    image = db.Column(db.String(255), nullable=True)  # مسار الصورة
    user_ip = db.Column(db.String(50), nullable=False)

# إنشاء قاعدة البيانات إذا لم تكن موجودة
with app.app_context():
    db.create_all()

# الصفحة الرئيسية
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/add_report', methods=['POST'])
def add_report():
    print("🔍 بيانات الطلب (Form):", request.form)  
    print("🔍 الملفات المرفوعة:", request.files)  

    latitude = request.form.get('latitude')
    longitude = request.form.get('longitude')
    description = request.form.get('description')
    image = request.files.get('image')

    if latitude is None or longitude is None or not description:
        print("⚠️ خطأ: جميع الحقول مطلوبة!")
        return jsonify({"error": "جميع الحقول مطلوبة"}), 400

    # معالجة الصورة إذا تم رفعها
    image_filename = None
    if image and image.filename != '':
        image_filename = secure_filename(image.filename)
        image.save(os.path.join("static/uploads", image_filename))  # احفظ الصورة في مجلد

    user_ip = request.remote_addr
    print("📍 عنوان IP المستخدم:", user_ip)

    try:
        new_report = Report(latitude=float(latitude), longitude=float(longitude), description=description, user_ip=user_ip, image=image_filename)
        db.session.add(new_report)
        db.session.commit()

        if 'my_reports' not in session:
            session['my_reports'] = []

        session['my_reports'].append(new_report.id)
        session.modified = True  

        return jsonify({"message": "تمت إضافة التقرير بنجاح"}), 201

    except Exception as e:
        print("❌ خطأ أثناء حفظ التقرير:", str(e))
        db.session.rollback()
        return jsonify({"error": "حدث خطأ أثناء حفظ التقرير"}), 500


# API لجلب جميع التقارير
@app.route('/get_reports', methods=['GET'])
def get_reports():
    reports = Report.query.all()
    return jsonify([{
        'id': r.id,
        'latitude': r.latitude,
        'longitude': r.longitude,
        'description': r.description,
        'image': r.image if r.image else None
    } for r in reports])



@app.route('/delete_report/<int:report_id>', methods=['DELETE'])
def delete_report(report_id):
    if 'my_reports' not in session or report_id not in session['my_reports']:
        return jsonify({"error": "⚠️ لا يمكنك حذف تقرير لم تقم بكتابته!"}), 403  # رفض الحذف

    report = Report.query.get(report_id)
    if not report:
        return jsonify({"error": "التقرير غير موجود"}), 404

    try:
        db.session.delete(report)
        db.session.commit()
        session['my_reports'].remove(report_id)  # حذف التقرير من الجلسة أيضًا
        session.modified = True
        return jsonify({"message": "✅ تم حذف التقرير بنجاح!"}), 200
    except Exception as e:
        return jsonify({"error": f"❌ حدث خطأ أثناء حذف التقرير: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True)
        