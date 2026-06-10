"""
Marine Waste Tracker — Flask application
"""

import csv
import io
import os
import datetime
from collections import defaultdict, Counter
from functools import wraps

from flask import (Flask, render_template, request, session, redirect,
                   url_for, flash, jsonify, send_from_directory, abort, Response)
from werkzeug.utils import secure_filename
from flask_sqlalchemy import SQLAlchemy
from flask_babel import Babel, gettext as _
from flask_caching import Cache
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_wtf.csrf import CSRFProtect, generate_csrf
from PIL import Image

# ─── APP SETUP ───────────────────────────────────────────────────────────────

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-change-in-prod')
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('FLASK_ENV') == 'production'

app.config['BABEL_DEFAULT_LOCALE'] = 'ar'
app.config['BABEL_TRANSLATION_DIRECTORIES'] = 'translations'
app.config['LANGUAGES'] = ['ar', 'en']

def _locale_selector():
    if 'lang' in session:
        return session['lang']
    return request.accept_languages.best_match(app.config['LANGUAGES']) or 'ar'

babel = Babel(app, locale_selector=_locale_selector)

BASE_DIR     = os.path.abspath(os.path.dirname(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER']        = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH']   = 16 * 1024 * 1024  # 16 MB total upload ceiling

# Database — PostgreSQL via DATABASE_URL, or SQLite locally (same root path as before)
_db_url = os.environ.get('DATABASE_URL', '')
if _db_url:
    # Render supplies postgres:// but SQLAlchemy 1.4+ requires postgresql://
    if _db_url.startswith('postgres://'):
        _db_url = _db_url.replace('postgres://', 'postgresql://', 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = _db_url
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = (
        f"sqlite:///{os.path.join(BASE_DIR, 'reports.db')}"
    )

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['CACHE_TYPE']            = 'SimpleCache'
app.config['CACHE_DEFAULT_TIMEOUT'] = 300  # 5-min default

db    = SQLAlchemy(app)
cache = Cache(app)
csrf  = CSRFProtect(app)
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=[],
    storage_uri='memory://',
)

ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'changeme')

# ─── REFERENCE DATA ──────────────────────────────────────────────────────────
# Sourced from MSFD / OSPAR waste category framework

WASTE_CATEGORIES = {
    'artificial_polymers': {
        'label_en': 'Artificial polymers (plastics)',
        'label_ar': 'البوليمرات الاصطناعية (البلاستيك)',
        'emoji': '🧴',
    },
    'rubber': {
        'label_en': 'Rubber',
        'label_ar': 'المطاط',
        'emoji': '⚫',
    },
    'cloth_textile': {
        'label_en': 'Cloth / textile / fibers',
        'label_ar': 'القماش / المنسوجات / الألياف',
        'emoji': '🧵',
    },
    'processed_wood': {
        'label_en': 'Processed / worked wood',
        'label_ar': 'الخشب المعالج',
        'emoji': '🪵',
    },
    'paper_cardboard': {
        'label_en': 'Paper / cardboard',
        'label_ar': 'الورق / الكرتون',
        'emoji': '📄',
    },
    'metal': {
        'label_en': 'Metal',
        'label_ar': 'المعدن',
        'emoji': '🔩',
    },
    'glass_ceramics': {
        'label_en': 'Glass / ceramics',
        'label_ar': 'الزجاج / السيراميك',
        'emoji': '🏺',
    },
    'chemical_products': {
        'label_en': 'Chemical products (oil, fuel, paint)',
        'label_ar': 'المنتجات الكيميائية (زيت، وقود، طلاء)',
        'emoji': '🛢️',
    },
    'food_waste': {
        'label_en': 'Food waste',
        'label_ar': 'نفايات الطعام',
        'emoji': '🥡',
    },
    'fishing_gear': {
        'label_en': 'Fishing gear (nets, lines, traps)',
        'label_ar': 'معدات الصيد (شباك، خيوط، فخاخ)',
        'emoji': '🎣',
    },
    'medical_sanitary': {
        'label_en': 'Medical / sanitary waste',
        'label_ar': 'النفايات الطبية / الصحية',
        'emoji': '💊',
    },
    'undefined': {
        'label_en': 'Undefined / unclassified',
        'label_ar': 'غير محدد / غير مصنف',
        'emoji': '❓',
    },
}

OBSERVER_TYPES = {
    'individual':   {'label_en': 'Individual citizen',  'label_ar': 'مواطن فردي'},
    'researcher':   {'label_en': 'Researcher',           'label_ar': 'باحث'},
    'ngo':          {'label_en': 'NGO volunteer',        'label_ar': 'متطوع في منظمة غير حكومية'},
    'port_officer': {'label_en': 'Port officer',         'label_ar': 'ضابط ميناء'},
    'fisherman':    {'label_en': 'Fisherman',            'label_ar': 'صياد'},
    'diver':        {'label_en': 'Diver',                'label_ar': 'غواص'},
}

ENVIRONMENT_TYPES = {
    'beach':         {'label_en': 'Beach',                 'label_ar': 'شاطئ',             'emoji': '🏖️'},
    'port':          {'label_en': 'Port / harbour',        'label_ar': 'ميناء',            'emoji': '🚢'},
    'open_water':    {'label_en': 'Open water',            'label_ar': 'المياه المفتوحة', 'emoji': '🌊'},
    'rivermouth':    {'label_en': 'River mouth / estuary', 'label_ar': 'مصب النهر',       'emoji': '🏞️'},
    'coastal_cliff': {'label_en': 'Coastal cliff / rock',  'label_ar': 'جرف ساحلي',       'emoji': '🗿'},
    'seabed':        {'label_en': 'Seabed / underwater',   'label_ar': 'قاع البحر',       'emoji': '🤿'},
}

QUANTITY_ESTIMATES = {
    'trace':      {'label_en': 'Trace (1–5 items)',                     'label_ar': 'أثر (1–5 عناصر)'},
    'low':        {'label_en': 'Low (6–20 items)',                      'label_ar': 'منخفض (6–20 عنصراً)'},
    'medium':     {'label_en': 'Medium (21–100 items)',                 'label_ar': 'متوسط (21–100 عنصر)'},
    'high':       {'label_en': 'High (101–500 items)',                  'label_ar': 'مرتفع (101–500 عنصر)'},
    'very_high':  {'label_en': 'Very high (500+ items)',               'label_ar': 'مرتفع جداً (أكثر من 500)'},
    'widespread': {'label_en': 'Widespread (large area, uncountable)', 'label_ar': 'منتشر (يغطي مساحة واسعة)'},
}

SEVERITIES = {
    'low':      {'label_en': 'Low',      'label_ar': 'منخفض',  'color': '#00e5a0'},
    'medium':   {'label_en': 'Medium',   'label_ar': 'متوسط',  'color': '#ffd166'},
    'high':     {'label_en': 'High',     'label_ar': 'مرتفع',  'color': '#ff6b35'},
    'critical': {'label_en': 'Critical', 'label_ar': 'حرج',    'color': '#ff3d5a'},
}

ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
MAX_PHOTOS     = 3
MAX_PHOTO_SIZE = 5 * 1024 * 1024  # 5 MB per file

# ─── MODELS ──────────────────────────────────────────────────────────────────

class Observation(db.Model):
    """Primary scientific observation table — MSFD-aligned schema."""
    __tablename__ = 'observations'

    id         = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow,
                           onupdate=datetime.datetime.utcnow)

    # Location
    latitude      = db.Column(db.Float,       nullable=False)
    longitude     = db.Column(db.Float,       nullable=False)
    location_name = db.Column(db.String(255), nullable=True)

    # Observer
    observer_name  = db.Column(db.String(100), nullable=True)
    observer_email = db.Column(db.String(255), nullable=True)
    observer_type  = db.Column(db.String(20),  nullable=False, default='individual')

    # Waste classification (MSFD categories)
    waste_category    = db.Column(db.String(50),  nullable=False)
    waste_subcategory = db.Column(db.String(100), nullable=True)

    # Quantity
    quantity_estimate = db.Column(db.String(20), nullable=True)
    quantity_unit     = db.Column(db.String(20), nullable=True, default='pieces')

    # Assessment
    severity           = db.Column(db.String(20), nullable=False, default='medium')
    environment_type   = db.Column(db.String(30), nullable=True)
    description        = db.Column(db.Text,        nullable=True)
    weather_conditions = db.Column(db.String(20), nullable=True)
    cleanup_possible   = db.Column(db.String(20), nullable=True)  # yes / no / already_cleaned

    # Moderation
    verified = db.Column(db.Boolean, nullable=False, default=False)
    status   = db.Column(db.String(20), nullable=False, default='pending')

    # Metadata
    source     = db.Column(db.String(20),  nullable=False, default='web')
    session_id = db.Column(db.String(100), nullable=True)
    user_ip    = db.Column(db.String(50),  nullable=True)

    images = db.relationship('ObservationImage', backref='observation', lazy=True,
                             cascade='all, delete-orphan')

    def report_code(self):
        year = self.created_at.year if self.created_at else datetime.datetime.utcnow().year
        return f"MWT-{year}-{self.id:04d}"

    def to_dict(self):
        cat = WASTE_CATEGORIES.get(self.waste_category, {})
        env = ENVIRONMENT_TYPES.get(self.environment_type or '', {})
        sev = SEVERITIES.get(self.severity, {})
        obs = OBSERVER_TYPES.get(self.observer_type, {})
        qty = QUANTITY_ESTIMATES.get(self.quantity_estimate or '', {})
        return {
            'id':                    self.id,
            'report_code':           self.report_code(),
            'created_at':            self.created_at.isoformat() if self.created_at else None,
            'latitude':              self.latitude,
            'longitude':             self.longitude,
            'location_name':         self.location_name,
            'observer_type':         self.observer_type,
            'observer_type_label':   obs.get('label_en', self.observer_type),
            'observer_type_label_ar':obs.get('label_ar', self.observer_type),
            'waste_category':        self.waste_category,
            'waste_category_label':  cat.get('label_en', self.waste_category),
            'waste_category_label_ar':cat.get('label_ar', self.waste_category),
            'waste_category_emoji':  cat.get('emoji', ''),
            'waste_subcategory':     self.waste_subcategory,
            'quantity_estimate':     self.quantity_estimate,
            'quantity_label':        qty.get('label_en', self.quantity_estimate or ''),
            'quantity_label_ar':     qty.get('label_ar', self.quantity_estimate or ''),
            'quantity_unit':         self.quantity_unit,
            'severity':              self.severity,
            'severity_label':        sev.get('label_en', self.severity),
            'severity_label_ar':     sev.get('label_ar', self.severity),
            'severity_color':        sev.get('color', '#6a9ab0'),
            'environment_type':      self.environment_type,
            'environment_label':     env.get('label_en', self.environment_type or ''),
            'environment_label_ar':  env.get('label_ar', self.environment_type or ''),
            'environment_emoji':     env.get('emoji', ''),
            'description':           self.description,
            'weather_conditions':    self.weather_conditions,
            'cleanup_possible':      self.cleanup_possible,
            'verified':              self.verified,
            'status':                self.status,
            'source':                self.source,
            'images':                [{'image_path': img.image_path} for img in self.images],
        }


class ObservationImage(db.Model):
    __tablename__ = 'observation_images'

    id             = db.Column(db.Integer, primary_key=True)
    observation_id = db.Column(db.Integer, db.ForeignKey('observations.id'), nullable=False)
    image_path     = db.Column(db.String(255), nullable=False)
    created_at     = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)


# ─── LEGACY MODELS (preserved — do not drop) ─────────────────────────────────

class Report(db.Model):
    """Legacy model. Kept for backward compatibility with existing data."""
    __tablename__ = 'report'

    id             = db.Column(db.Integer, primary_key=True)
    latitude       = db.Column(db.Float,       nullable=False)
    longitude      = db.Column(db.Float,       nullable=False)
    description    = db.Column(db.String(255), nullable=False)
    user_ip        = db.Column(db.String(50),  nullable=False)
    severity       = db.Column(db.String(20),  nullable=False, default='medium')
    pollution_type = db.Column(db.String(50),  nullable=True)
    timestamp      = db.Column(db.DateTime,    nullable=False, default=datetime.datetime.utcnow)
    status         = db.Column(db.String(20),  nullable=False, default='pending')
    images         = db.relationship('ReportImage', backref='report', lazy=True)


class ReportImage(db.Model):
    """Legacy model. Kept for backward compatibility."""
    __tablename__ = 'report_image'

    id         = db.Column(db.Integer, primary_key=True)
    report_id  = db.Column(db.Integer, db.ForeignKey('report.id'), nullable=False)
    image_path = db.Column(db.String(255), nullable=False)


# ─── DATABASE INIT (safe — never drops or truncates) ─────────────────────────

def _ensure_legacy_report_columns():
    """Reconcile older `report` tables with the current model.

    Older databases were created before `severity`, `pollution_type`, and
    `status` were added to the legacy Report model, so SELECTs against those
    columns crash with 'no such column'. This adds only the MISSING columns —
    it never drops or rewrites data. Idempotent; safe on SQLite + PostgreSQL.
    """
    try:
        from sqlalchemy import inspect as _sa_inspect, text as _sa_text
        inspector = _sa_inspect(db.engine)
        if 'report' not in inspector.get_table_names():
            return
        existing = {c['name'] for c in inspector.get_columns('report')}
        wanted = {
            'severity':       "VARCHAR(20) DEFAULT 'medium'",
            'pollution_type': "VARCHAR(50)",
            'status':         "VARCHAR(20) DEFAULT 'pending'",
        }
        missing = {c: ddl for c, ddl in wanted.items() if c not in existing}
        if missing:
            with db.engine.begin() as conn:
                for col, ddl in missing.items():
                    conn.execute(_sa_text(f'ALTER TABLE report ADD COLUMN {col} {ddl}'))
            print(f"Legacy `report` table reconciled — added columns: {list(missing)}")
    except Exception as e:
        # Never block startup over the legacy table.
        print(f"Legacy column reconciliation skipped: {e}")


with app.app_context():
    db.create_all()
    _ensure_legacy_report_columns()
    print("Database tables verified/created — no data dropped.")


# ─── CONTEXT PROCESSOR ───────────────────────────────────────────────────────

@app.context_processor
def inject_globals():
    from flask_babel import get_locale as _babel_get_locale

    def get_locale():
        """Return the active locale as a plain string (e.g. 'ar' or 'en').

        Flask-Babel's get_locale() returns a babel.core.Locale object, and
        Locale('ar') == 'ar' is always False because Locale.__eq__ only
        compares with other Locale instances.  Wrapping it here means every
        {% if get_locale() == 'ar' %} in every template works correctly.
        """
        loc = _babel_get_locale()
        return str(loc) if loc else 'ar'

    return dict(
        get_locale=get_locale,
        waste_categories=WASTE_CATEGORIES,
        environment_types=ENVIRONMENT_TYPES,
        observer_types=OBSERVER_TYPES,
        severities=SEVERITIES,
        quantity_estimates=QUANTITY_ESTIMATES,
    )


# ─── LANGUAGE ROUTE ──────────────────────────────────────────────────────────

@app.route('/set_language/<lang_code>')
def set_language(lang_code):
    if lang_code not in app.config['LANGUAGES']:
        lang_code = 'ar'
    session['lang'] = lang_code
    session.modified = True   # force cookie write even if session was already loaded
    next_url = request.args.get('next') or url_for('index')
    # Safety: only redirect to relative paths
    if not next_url.startswith('/'):
        next_url = url_for('index')
    return redirect(next_url)


# ─── PAGE ROUTES ─────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/contact')
def contact():
    return render_template('contact.html')

@app.route('/privacy')
def privacy():
    return render_template('privacy.html')

@app.route('/map')
def map_page():
    return render_template('map.html')

@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html')

@app.route('/data')
def data_page():
    return render_template('data.html')

@app.route('/login')
def login():
    return render_template('login.html')

@app.route('/signup')
def signup():
    return render_template('signup.html')

@app.route('/static/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


# ─── API — OBSERVATIONS (new) ────────────────────────────────────────────────

def _validate_photo(file):
    """Return (ok: bool, error_msg: str). Validates content-type AND actual image bytes."""
    content_type = file.content_type or ''
    if content_type not in ALLOWED_IMAGE_TYPES:
        return False, f"File type '{content_type}' is not allowed. Use JPEG, PNG, GIF, or WebP."
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > MAX_PHOTO_SIZE:
        return False, f"File exceeds 5 MB limit ({size // (1024*1024)} MB)."
    # Verify the bytes are actually a valid image (defeats spoofed content-type headers)
    try:
        img = Image.open(file)
        img.verify()
    except Exception:
        return False, 'File does not appear to be a valid image.'
    finally:
        file.seek(0)
    return True, ''


@app.route('/api/observations', methods=['GET'])
def api_get_observations():
    try:
        category = request.args.get('category')
        severity = request.args.get('severity')
        env_type = request.args.get('env_type')
        from_dt  = request.args.get('from')
        to_dt    = request.args.get('to')
        status   = request.args.get('status', 'verified')
        page     = max(1, int(request.args.get('page', 1)))
        per_page = min(500, max(1, int(request.args.get('per_page', 100))))

        q = Observation.query
        if status != 'all':
            q = q.filter_by(status=status)
        if category:
            q = q.filter_by(waste_category=category)
        if severity:
            q = q.filter_by(severity=severity)
        if env_type:
            q = q.filter_by(environment_type=env_type)
        if from_dt:
            q = q.filter(Observation.created_at >= datetime.datetime.fromisoformat(from_dt))
        if to_dt:
            q = q.filter(Observation.created_at <= datetime.datetime.fromisoformat(to_dt))

        total  = q.count()
        items  = q.order_by(Observation.created_at.desc())\
                  .offset((page - 1) * per_page).limit(per_page).all()

        return jsonify({
            'total':    total,
            'page':     page,
            'per_page': per_page,
            'pages':    (total + per_page - 1) // per_page,
            'items':    [o.to_dict() for o in items],
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/observations/<int:obs_id>', methods=['GET'])
def api_get_observation(obs_id):
    o = Observation.query.get_or_404(obs_id)
    return jsonify(o.to_dict())


@app.route('/api/observations', methods=['POST'])
@limiter.limit('10 per hour')
def api_post_observation():
    try:
        data = request.form

        # Required field validation
        lat = data.get('latitude', '').strip()
        lng = data.get('longitude', '').strip()
        cat = data.get('waste_category', '').strip()

        if not lat or not lng:
            return jsonify({'error': 'latitude and longitude are required'}), 400
        try:
            lat_f, lng_f = float(lat), float(lng)
        except ValueError:
            return jsonify({'error': 'latitude and longitude must be numbers'}), 400
        if not (-90 <= lat_f <= 90) or not (-180 <= lng_f <= 180):
            return jsonify({'error': 'coordinates out of valid range'}), 400
        if cat not in WASTE_CATEGORIES:
            return jsonify({'error': f"Invalid waste_category. Valid values: {list(WASTE_CATEGORIES)}"}), 400

        sev = data.get('severity', 'medium')
        if sev not in SEVERITIES:
            sev = 'medium'

        obs = Observation(
            latitude          = lat_f,
            longitude         = lng_f,
            location_name     = (data.get('location_name') or '')[:255] or None,
            observer_name     = (data.get('observer_name') or '')[:100] or None,
            observer_email    = (data.get('observer_email') or '')[:255] or None,
            observer_type     = data.get('observer_type', 'individual')
                                if data.get('observer_type') in OBSERVER_TYPES else 'individual',
            waste_category    = cat,
            waste_subcategory = (data.get('waste_subcategory') or '')[:100] or None,
            quantity_estimate = data.get('quantity_estimate')
                                if data.get('quantity_estimate') in QUANTITY_ESTIMATES else None,
            quantity_unit     = data.get('quantity_unit', 'pieces'),
            severity          = sev,
            environment_type  = data.get('environment_type')
                                if data.get('environment_type') in ENVIRONMENT_TYPES else None,
            description       = (data.get('description') or '')[:500] or None,
            weather_conditions= data.get('weather_conditions')
                                if data.get('weather_conditions') in ('calm', 'windy', 'rainy') else None,
            cleanup_possible  = data.get('cleanup_possible')
                                if data.get('cleanup_possible') in ('yes', 'no', 'already_cleaned') else None,
            source            = 'web',
            session_id        = session.get('session_id'),
            user_ip           = request.remote_addr,
            status            = 'pending',
        )
        db.session.add(obs)
        db.session.flush()  # get obs.id before commit

        # Photo upload (up to MAX_PHOTOS)
        photos = request.files.getlist('photos')[:MAX_PHOTOS]
        saved  = 0
        for photo in photos:
            if not photo or not photo.filename:
                continue
            ok, err = _validate_photo(photo)
            if not ok:
                db.session.rollback()
                return jsonify({'error': err}), 400
            filename = secure_filename(
                f"obs_{obs.id}_{saved}_{photo.filename}"
            )
            photo.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            db.session.add(ObservationImage(observation_id=obs.id, image_path=filename))
            saved += 1

        db.session.commit()
        cache.delete('api_stats')  # invalidate cached stats

        # Track in session so the reporter can reference their submission
        session.setdefault('my_observations', [])
        session['my_observations'].append(obs.id)
        session.modified = True

        return jsonify({
            'message':     'Observation submitted successfully.',
            'id':          obs.id,
            'report_code': obs.report_code(),
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ─── API — STATS (cached 5 min) ──────────────────────────────────────────────

@app.route('/api/stats', methods=['GET'])
@cache.cached(timeout=300, key_prefix='api_stats')
def api_stats():
    try:
        total        = Observation.query.count()
        this_month   = Observation.query.filter(
            Observation.created_at >= datetime.datetime.utcnow().replace(day=1, hour=0, minute=0, second=0)
        ).count()
        pending      = Observation.query.filter_by(status='pending').count()

        by_category  = dict(
            db.session.query(Observation.waste_category, db.func.count(Observation.id))
              .group_by(Observation.waste_category).all()
        )
        by_severity  = dict(
            db.session.query(Observation.severity, db.func.count(Observation.id))
              .group_by(Observation.severity).all()
        )
        by_env       = dict(
            db.session.query(Observation.environment_type, db.func.count(Observation.id))
              .filter(Observation.environment_type.isnot(None))
              .group_by(Observation.environment_type).all()
        )

        # Last 12 months — Python-side aggregation (works on SQLite + PostgreSQL)
        twelve_months_ago = datetime.datetime.utcnow() - datetime.timedelta(days=365)
        obs_dates = (
            db.session.query(Observation.created_at)
            .filter(Observation.created_at >= twelve_months_ago)
            .all()
        )
        _month_counts = defaultdict(int)
        for (dt,) in obs_dates:
            if dt:
                _month_counts[f"{dt.year}-{dt.month:02d}"] += 1
        by_month = dict(_month_counts)

        # Top 10 hotspot grid cells (0.5° resolution) — Python-side
        all_coords = (
            db.session.query(Observation.latitude, Observation.longitude)
            .filter(Observation.latitude.isnot(None))
            .limit(5000)
            .all()
        )
        _cell_counts = Counter()
        for lat, lng in all_coords:
            cell = (round(float(lat) * 2) / 2, round(float(lng) * 2) / 2)
            _cell_counts[cell] += 1
        hotspots = [
            {'lat': lat, 'lng': lng, 'count': cnt}
            for (lat, lng), cnt in _cell_counts.most_common(10)
        ]

        # Most reported category
        top_category = max(by_category, key=by_category.get) if by_category else None
        top_cat_data = WASTE_CATEGORIES.get(top_category, {}) if top_category else {}

        return jsonify({
            'total':                 total,
            'this_month':            this_month,
            'pending':               pending,
            'hotspots_count':        len(hotspots),
            'top_category':          top_category,
            'top_category_label':    top_cat_data.get('label_en', ''),
            'top_category_label_ar': top_cat_data.get('label_ar', ''),
            'top_category_emoji':    top_cat_data.get('emoji', ''),
            'by_category':           by_category,
            'by_severity':           by_severity,
            'by_environment':        by_env,
            'by_month':              by_month,
            'hotspots':              hotspots,
            'waste_categories':      {k: {'label_en': v['label_en'], 'label_ar': v['label_ar'], 'emoji': v['emoji']}
                                      for k, v in WASTE_CATEGORIES.items()},
            'environment_types':     {k: {'label_en': v['label_en'], 'label_ar': v['label_ar'], 'emoji': v['emoji']}
                                      for k, v in ENVIRONMENT_TYPES.items()},
            'severities':            {k: {'label_en': v['label_en'], 'label_ar': v['label_ar'], 'color': v['color']}
                                      for k, v in SEVERITIES.items()},
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── API — HEATMAP ───────────────────────────────────────────────────────────

@app.route('/api/heatmap', methods=['GET'])
@cache.cached(timeout=300, key_prefix='api_heatmap')
def api_heatmap():
    severity_weight = {'low': 0.25, 'medium': 0.5, 'high': 0.75, 'critical': 1.0}
    rows = (
        db.session.query(Observation.latitude, Observation.longitude, Observation.severity)
          .filter(Observation.status == 'verified')
          .limit(5000)
          .all()
    )
    return jsonify([
        [float(lat), float(lng), severity_weight.get(sev, 0.5)]
        for lat, lng, sev in rows
        if lat is not None and lng is not None
    ])


# ─── API — CSV EXPORT ────────────────────────────────────────────────────────

@app.route('/api/export/csv', methods=['GET'])
def api_export_csv():
    category = request.args.get('category')
    severity = request.args.get('severity')
    from_dt  = request.args.get('from')
    to_dt    = request.args.get('to')

    q = Observation.query
    if category:
        q = q.filter_by(waste_category=category)
    if severity:
        q = q.filter_by(severity=severity)
    if from_dt:
        q = q.filter(Observation.created_at >= datetime.datetime.fromisoformat(from_dt))
    if to_dt:
        q = q.filter(Observation.created_at <= datetime.datetime.fromisoformat(to_dt))

    rows = q.order_by(Observation.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        'report_code', 'created_at', 'latitude', 'longitude', 'location_name',
        'observer_type', 'waste_category', 'waste_subcategory',
        'quantity_estimate', 'quantity_unit', 'severity', 'environment_type',
        'description', 'weather_conditions', 'cleanup_possible',
        'verified', 'status', 'source',
    ])
    for o in rows:
        writer.writerow([
            o.report_code(), o.created_at.isoformat() if o.created_at else '',
            o.latitude, o.longitude, o.location_name or '',
            o.observer_type, o.waste_category, o.waste_subcategory or '',
            o.quantity_estimate or '', o.quantity_unit or '',
            o.severity, o.environment_type or '',
            (o.description or '').replace('\n', ' '),
            o.weather_conditions or '', o.cleanup_possible or '',
            o.verified, o.status, o.source,
        ])

    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment; filename=marine_waste_observations.csv'},
    )


# ─── ADMIN ───────────────────────────────────────────────────────────────────

def _admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('admin_authed'):
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)
    return decorated


@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    error = None
    if request.method == 'POST':
        if request.form.get('password') == ADMIN_PASSWORD:
            session['admin_authed'] = True
            return redirect(url_for('admin_panel'))
        error = 'Incorrect password.'
    return render_template('admin_login.html', error=error)


@app.route('/admin/logout')
def admin_logout():
    session.pop('admin_authed', None)
    return redirect(url_for('admin_login'))


@app.route('/admin')
@_admin_required
def admin_panel():
    status_filter = request.args.get('status', 'pending')
    obs = (
        Observation.query
        .filter_by(status=status_filter)
        .order_by(Observation.created_at.desc())
        .all()
    )
    counts = {
        s: Observation.query.filter_by(status=s).count()
        for s in ('pending', 'verified', 'resolved', 'duplicate')
    }
    return render_template('admin_panel.html', observations=obs,
                           status_filter=status_filter, counts=counts)


@app.route('/admin/verify/<int:obs_id>', methods=['POST'])
@_admin_required
def admin_verify(obs_id):
    o = Observation.query.get_or_404(obs_id)
    o.status   = 'verified'
    o.verified = True
    o.updated_at = datetime.datetime.utcnow()
    db.session.commit()
    cache.delete('api_stats')
    flash(f'تم توثيق البلاغ {o.report_code()} وأصبح ظاهراً على الخريطة.', 'success')
    return redirect(request.referrer or url_for('admin_panel'))


@app.route('/admin/reject/<int:obs_id>', methods=['POST'])
@_admin_required
def admin_reject(obs_id):
    o = Observation.query.get_or_404(obs_id)
    o.status   = 'duplicate'
    o.updated_at = datetime.datetime.utcnow()
    db.session.commit()
    cache.delete('api_stats')
    flash(f'تم رفض البلاغ {o.report_code()} وتصنيفه كمكرر.', 'info')
    return redirect(request.referrer or url_for('admin_panel'))


@app.route('/admin/resolve/<int:obs_id>', methods=['POST'])
@_admin_required
def admin_resolve(obs_id):
    o = Observation.query.get_or_404(obs_id)
    o.status   = 'resolved'
    o.updated_at = datetime.datetime.utcnow()
    db.session.commit()
    cache.delete('api_stats')
    flash(f'تم تصنيف البلاغ {o.report_code()} كمحلول.', 'success')
    return redirect(request.referrer or url_for('admin_panel'))


# ─── ERROR HANDLERS ──────────────────────────────────────────────────────────

@app.errorhandler(429)
def too_many_requests(e):
    return jsonify({'error': 'Rate limit exceeded. Please wait before submitting again.'}), 429


# ─── LEGACY ROUTES (kept for backward compatibility) ─────────────────────────

@app.route('/add_report', methods=['POST'])
@csrf.exempt
def add_report():
    try:
        latitude       = request.form.get('latitude')
        longitude      = request.form.get('longitude')
        description    = request.form.get('description')
        severity       = request.form.get('severity', 'medium')
        pollution_type = request.form.get('pollutionType')
        images         = request.files.getlist('images')

        if not all([latitude, longitude, description]):
            return jsonify({'error': _('All fields are required')}), 400

        new_report = Report(
            latitude       = float(latitude),
            longitude      = float(longitude),
            description    = description,
            user_ip        = request.remote_addr,
            severity       = severity,
            pollution_type = pollution_type or 'other',
            status         = 'pending',
        )
        db.session.add(new_report)
        db.session.commit()

        seen = set()
        for image in images:
            if image.filename and image.filename not in seen:
                filename = secure_filename(image.filename)
                path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                if not os.path.exists(path):
                    image.save(path)
                db.session.add(ReportImage(report_id=new_report.id, image_path=filename))
                seen.add(image.filename)
        db.session.commit()

        session.setdefault('my_reports', [])
        session['my_reports'].append(new_report.id)
        session.modified = True

        return jsonify({'message': _('Report added successfully')}), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@app.route('/get_reports', methods=['GET'])
def get_reports():
    try:
        pollution_type = request.args.get('pollution_type')
        severity       = request.args.get('severity')
        days           = request.args.get('days')

        q = Report.query.filter_by(status='approved')
        if pollution_type:
            q = q.filter_by(pollution_type=pollution_type)
        if severity:
            q = q.filter_by(severity=severity)
        if days:
            cutoff = datetime.datetime.now() - datetime.timedelta(days=int(days))
            q = q.filter(Report.timestamp >= cutoff)

        my_reports = set(session.get('my_reports', []))
        return jsonify([{
            'id':            r.id,
            'latitude':      r.latitude,
            'longitude':     r.longitude,
            'description':   r.description,
            'severity':      r.severity,
            'pollution_type':r.pollution_type,
            'timestamp':     r.timestamp.isoformat() if r.timestamp else None,
            'images':        [{'image_path': img.image_path} for img in r.images],
            'can_delete':    r.id in my_reports,
        } for r in q.all()])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/statistics', methods=['GET'])
def get_statistics():
    total   = Report.query.count()
    by_type = dict(db.session.query(Report.pollution_type, db.func.count(Report.id))
                              .group_by(Report.pollution_type).all())
    by_sev  = dict(db.session.query(Report.severity, db.func.count(Report.id))
                              .group_by(Report.severity).all())
    since30 = datetime.datetime.now() - datetime.timedelta(days=30)
    daily   = {str(d): c for d, c in
               db.session.query(db.func.date(Report.timestamp), db.func.count(Report.id))
                         .filter(Report.timestamp >= since30)
                         .group_by(db.func.date(Report.timestamp)).all()}
    return jsonify({
        'total_reports':         total,
        'pollution_types':       by_type,
        'severity_distribution': by_sev,
        'daily_reports':         daily,
    })


@app.route('/delete_report/<int:report_id>', methods=['DELETE'])
@csrf.exempt
def delete_report(report_id):
    if report_id not in session.get('my_reports', []):
        return jsonify({'error': _('You cannot delete a report you did not submit!')}), 403

    report = Report.query.get(report_id)
    if not report:
        return jsonify({'error': _('Report not found')}), 404

    try:
        for img in report.images:
            path = os.path.join(app.config['UPLOAD_FOLDER'], img.image_path)
            if os.path.exists(path):
                os.remove(path)
            db.session.delete(img)
        db.session.delete(report)
        db.session.commit()
        session['my_reports'].remove(report_id)
        session.modified = True
        return jsonify({'message': _('Report deleted successfully!')}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# Legacy admin routes (kept — new admin is at /admin)
# NOTE: @_admin_required added — these routes were previously unauthenticated,
# allowing anyone to approve/reject legacy reports. Now gated behind admin login.
@app.route('/admin/reports')
@_admin_required
def admin_reports():
    pending = Report.query.filter_by(status='pending')\
                          .order_by(Report.timestamp.desc()).all()
    return render_template('admin_reports.html', reports=pending)


@app.route('/admin/reports/approve/<int:report_id>', methods=['POST'])
@_admin_required
def approve_report(report_id):
    r = Report.query.get_or_404(report_id)
    r.status = 'approved'
    db.session.commit()
    flash('تمت الموافقة على البلاغ وأصبح ظاهراً على الخريطة.', 'success')
    return redirect(url_for('admin_reports'))


@app.route('/admin/reports/reject/<int:report_id>', methods=['POST'])
@_admin_required
def reject_report(report_id):
    r = Report.query.get_or_404(report_id)
    r.status = 'rejected'
    db.session.commit()
    flash('تم رفض البلاغ.', 'info')
    return redirect(url_for('admin_reports'))


# ─── OBSERVATION PERMALINK ───────────────────────────────────────────────────

@app.route('/report/<code>')
def report_detail(code):
    """Public read-only permalink for a single observation, e.g. /report/MWT-2025-0001."""
    parts = code.upper().split('-')
    if len(parts) != 3 or parts[0] != 'MWT':
        abort(404)
    try:
        obs_id = int(parts[2])
    except ValueError:
        abort(404)
    o = Observation.query.get_or_404(obs_id)
    if o.report_code().upper() != code.upper():
        abort(404)
    return render_template('report_detail.html', observation=o)


# ─── ENTRY POINT ─────────────────────────────────────────────────────────────

if __name__ == '__main__':
    app.run(debug=True)
