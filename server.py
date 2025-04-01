from flask import Flask, render_template, request, jsonify, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename
import os
import datetime

app = Flask(__name__)
app.secret_key = "your_secret_key"  # ✅ ضروري لتفعيل الجلسات

# تحديد مكان تخزين الصور والملفات
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Delete old database if it exists
db_path = os.path.join(BASE_DIR, 'reports.db')
if os.path.exists(db_path):
    try:
        os.remove(db_path)
        print(f"Old database deleted successfully: {db_path}")
    except Exception as e:
        print(f"Error deleting old database: {e}")

app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
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
    severity = db.Column(db.String(20), nullable=False, default='medium')  # new
    pollution_type = db.Column(db.String(50), nullable=True)  # new
    timestamp = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)  # new

class ReportImage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    report_id = db.Column(db.Integer, db.ForeignKey('report.id'), nullable=False)
    image_path = db.Column(db.String(255), nullable=False) # علاقة one-to-many

# Create the database
with app.app_context():
    db.create_all()
    print("Database created successfully with new schema")

# الصفحة الرئيسية
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/add_report', methods=['POST'])
def add_report():
    try:
        latitude = request.form.get('latitude')
        longitude = request.form.get('longitude')
        description = request.form.get('description')
        severity = request.form.get('severity', 'medium')
        pollution_type = request.form.get('pollutionType')
        images = request.files.getlist('images')

        if not all([latitude, longitude, description]):
            return jsonify({"error": "جميع الحقول مطلوبة"}), 400

        user_ip = request.remote_addr

        # إنشاء تقرير جديد
        new_report = Report(
            latitude=float(latitude),
            longitude=float(longitude),
            description=description,
            user_ip=user_ip,
            severity=severity,
            pollution_type=pollution_type or 'other'  # Default to 'other' if not provided
        )
        db.session.add(new_report)
        db.session.commit()

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

        db.session.commit()

        # إضافة التقرير إلى الجلسة
        if 'my_reports' not in session:
            session['my_reports'] = []
        session['my_reports'].append(new_report.id)
        session.modified = True

        return jsonify({"message": "تمت إضافة التقرير بنجاح"}), 201

    except Exception as e:
        print(f"Error in add_report: {str(e)}")
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@app.route('/static/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


# API لجلب جميع التقارير
@app.route('/get_reports', methods=['GET'])
def get_reports():
    try:
        # Get filter parameters
        pollution_type = request.args.get('pollution_type')
        severity = request.args.get('severity')
        days = request.args.get('days')

        query = Report.query

        if pollution_type:
            query = query.filter_by(pollution_type=pollution_type)
        if severity:
            query = query.filter_by(severity=severity)
        if days:
            cutoff_date = datetime.datetime.now() - datetime.timedelta(days=int(days))
            query = query.filter(Report.timestamp >= cutoff_date)

        reports = query.all()
        return jsonify([{
            'id': r.id,
            'latitude': r.latitude,
            'longitude': r.longitude,
            'description': r.description,
            'severity': r.severity,
            'pollution_type': r.pollution_type,
            'timestamp': r.timestamp.isoformat() if r.timestamp else None,
            'images': [{'image_path': img.image_path} for img in set(r.images)]
        } for r in reports])
    except Exception as e:
        print(f"Error in get_reports: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/statistics', methods=['GET'])
def get_statistics():
    total_reports = Report.query.count()
    
    # Pollution type distribution
    pollution_types = db.session.query(
        Report.pollution_type,
        db.func.count(Report.id)
    ).group_by(Report.pollution_type).all()
    
    # Severity distribution
    severity_counts = db.session.query(
        Report.severity,
        db.func.count(Report.id)
    ).group_by(Report.severity).all()
    
    # Reports over time (last 30 days)
    thirty_days_ago = datetime.datetime.now() - datetime.timedelta(days=30)
    daily_reports = db.session.query(
        db.func.date(Report.timestamp),
        db.func.count(Report.id)
    ).filter(Report.timestamp >= thirty_days_ago)\
     .group_by(db.func.date(Report.timestamp)).all()

    return jsonify({
        'total_reports': total_reports,
        'pollution_types': dict(pollution_types),
        'severity_distribution': dict(severity_counts),
        'daily_reports': {str(date): count for date, count in daily_reports}
    })

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


if __name__ == '__main__':
    app.run(debug=True)