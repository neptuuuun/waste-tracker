from flask import Flask, render_template, request, jsonify, session, send_from_directory
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
    user_ip = db.Column(db.String(50), nullable=False)
    images = db.relationship('ReportImage', backref='report', lazy=True)  # Ensure this is correct

class ReportImage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    report_id = db.Column(db.Integer, db.ForeignKey('report.id'), nullable=False)
    image_path = db.Column(db.String(255), nullable=False) # علاقة one-to-many

# إنشاء قاعدة البيانات إذا لم تكن موجودة
with app.app_context():
    db.create_all()

# الصفحة الرئيسية
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/add_report', methods=['POST'])
def add_report():
    latitude = request.form.get('latitude')
    longitude = request.form.get('longitude')
    description = request.form.get('description')
    images = request.files.getlist('images')  # الحصول على قائمة بالصور

    if not latitude or not longitude or not description:
        return jsonify({"error": "جميع الحقول مطلوبة"}), 400

    user_ip = request.remote_addr

    try:
        # إنشاء تقرير جديد
        new_report = Report(latitude=float(latitude), longitude=float(longitude), description=description, user_ip=user_ip)
        db.session.add(new_report)
        db.session.commit()  # حفظ التقرير أولًا

        # استقبال الصور المتعددة
        image_filenames = set()
        
        for image in images:
            if image.filename and image.filename not in image_filenames:
                image_filename = secure_filename(image.filename)
                image_path = os.path.join(app.config['UPLOAD_FOLDER'], image_filename)
                
                # التحقق مما إذا كانت الصورة قد تم رفعها بالفعل
                if not os.path.exists(image_path):
                    image.save(image_path)

                new_image = ReportImage(report_id=new_report.id, image_path=image_filename)
                db.session.add(new_image)
                image_filenames.add(image_filename)

        db.session.commit()  # حفظ الصور بعد إضافتها

        # إضافة التقرير إلى الجلسة
        if 'my_reports' not in session:
            session['my_reports'] = []
        session['my_reports'].append(new_report.id)
        session.modified = True

        return jsonify({"message": "تمت إضافة التقرير بنجاح"}), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"حدث خطأ أثناء حفظ التقرير: {str(e)}"}), 500


@app.route('/static/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


# API لجلب جميع التقارير
@app.route('/get_reports', methods=['GET'])
def get_reports():
    reports = Report.query.all()
    return jsonify([{
        'id': r.id,
        'latitude': r.latitude,
        'longitude': r.longitude,
        'description': r.description,
        'images': [{'image_path': img.image_path} for img in set(r.images)]  # إرجاع قائمة بالصور
    } for r in reports])



@app.route('/delete_report/<int:report_id>', methods=['DELETE'])
def delete_report(report_id):
    if 'my_reports' not in session or report_id not in session['my_reports']:
        return jsonify({"error": "⚠️ لا يمكنك حذف تقرير لم تقم بكتابته!"}), 403  

    report = Report.query.get(report_id)
    if not report:
        return jsonify({"error": "التقرير غير موجود"}), 404

    try:
        # حذف الصور المرتبطة بالتقرير
        for image in report.images:
            image_path = os.path.join(app.config['UPLOAD_FOLDER'], image.image_path)
            if os.path.exists(image_path):
                os.remove(image_path)  # حذف الصورة من المجلد

            db.session.delete(image)  # حذف الصورة من قاعدة البيانات

        db.session.delete(report)
        db.session.commit()

        session['my_reports'].remove(report_id)  
        session.modified = True

        return jsonify({"message": "✅ تم حذف التقرير بنجاح!"}), 200
    except Exception as e:
        return jsonify({"error": f"❌ حدث خطأ أثناء حذف التقرير: {str(e)}"}), 500


with app.app_context():
    db.create_all()

if __name__ == '__main__':
    app.run(debug=True)
        