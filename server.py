import os
from datetime import datetime, timezone, timedelta
from io import BytesIO

from flask import Flask, request, jsonify, render_template
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from PIL import Image
import logging
import humanize

# --- Application Setup ---
app = Flask(__name__, template_folder='templates')

# Enable CORS for all routes
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.FileHandler('server.log'), logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# Flask config
app.config.update({
    'SQLALCHEMY_DATABASE_URI': os.getenv('DATABASE_URL', f'sqlite:///{os.path.join(os.path.dirname(__file__), "mail_tracker.db")}'),
    'SQLALCHEMY_TRACK_MODIFICATIONS': False,
    'TEMPLATES_AUTO_RELOAD': True,
    'TIMEZONE': os.getenv('TIMEZONE', 'UTC'),
    'MAX_CONTENT_LENGTH': 1 * 1024 * 1024  # 1 MB limit
})

# Ensure instance folder exists
os.makedirs(app.instance_path, exist_ok=True)

db = SQLAlchemy(app)

# --- Database Model ---
class TrackedMail(db.Model):
    __tablename__ = 'tracked_mails'
    id = db.Column(db.String(200), primary_key=True)
    user_email = db.Column(db.String(200), nullable=False)
    subject = db.Column(db.String(200))
    content = db.Column(db.Text)
    sent_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    opened_at = db.Column(db.DateTime)
    tracking_url = db.Column(db.String(500))
    user_agent = db.Column(db.String(500))
    ip_address = db.Column(db.String(50))
    status = db.Column(db.String(20), default='sent')

    def to_dict(self):
        return {
            'id': self.id,
            'user_email': self.user_email,
            'subject': self.subject,
            'content': self.content,
            'sent_at': self.sent_at.isoformat() if self.sent_at else None,
            'opened_at': self.opened_at.isoformat() if self.opened_at else None,
            'status': 'read' if self.opened_at else 'unread',
            'tracking_url': self.tracking_url,
            'user_agent': self.user_agent,
            'ip_address': self.ip_address
        }

# --- Helpers ---
def current_utc_time():
    return datetime.now(timezone.utc)

def detect_bot(ua):
    bots = ['googleimageproxy', 'bot', 'crawler', 'spider', 'facebookexternalhit', 'slackbot']
    return any(b in ua.lower() for b in bots)

# Automatically create tables before first request
@app.before_request
def initialize_db():
    if not getattr(app, 'db_initialized', False):
        with app.app_context():
            db.create_all()
        app.db_initialized = True

# Jinja2 filter for "time ago"
@app.template_filter('time_ago')
def time_ago_filter(dt):
    if not dt:
        return 'N/A'
    now = current_utc_time()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return humanize.naturaltime(now - dt)

# --- Routes ---
@app.route('/')
@app.route('/dashboard')
def dashboard():
    emails = TrackedMail.query.order_by(TrackedMail.sent_at.desc()).all()
    return render_template('dashboard.html', mails=emails, stats=compute_stats())

@app.route('/store', methods=['POST'])
def store_email():
    try:
        if not request.is_json:
            return jsonify({'error': 'JSON payload required'}), 400
        data = request.get_json()
        # Validate
        required = ['subject', 'to', 'content', 'id', 'trackingUrl']
        missing = [k for k in required if k not in data]
        if missing:
            return jsonify({'error': f'Missing {missing}'}), 400
        if '@' not in data['to']:
            return jsonify({'error': 'Invalid recipient email'}), 400
        # Truncate content
        content = data['content']
        if len(content) > 10000:
            content = content[:10000] + '...'

        # Update or create
        entry = TrackedMail.query.get(data['id'])
        if entry:
            logger.info(f"Updating email {data['id']}")
            entry.user_email = data['to']
            entry.subject = data['subject']
            entry.content = content
            entry.tracking_url = data['trackingUrl']
            entry.sent_at = current_utc_time()
            if not entry.opened_at:
                entry.status = 'sent'
            db.session.commit()
            return jsonify({'message': 'Updated', 'id': entry.id}), 200

        new_mail = TrackedMail(
            id=data['id'],
            user_email=data['to'],
            subject=data['subject'],
            content=content,
            tracking_url=data['trackingUrl'],
            sent_at=current_utc_time(),
            status='sent'
        )
        db.session.add(new_mail)
        db.session.commit()
        return jsonify({'message': 'Stored', 'id': new_mail.id}), 200

    except Exception as ex:
        logger.error(f"Store error: {ex}")
        db.session.rollback()
        return jsonify({'error': 'Storage failed'}), 500

@app.route('/track')
def track_open():
    try:
        mail_id = request.args.get('id')
        if not mail_id:
            return '', 400
        ua = request.headers.get('User-Agent', '')
        ip = request.remote_addr or 'Unknown'

        if detect_bot(ua):
            logger.info(f"Ignored bot pixel for {mail_id}")
            return '', 204

        entry = TrackedMail.query.get(mail_id)
        now = current_utc_time()
        if entry and not entry.opened_at:
            entry.opened_at = now
            entry.user_agent = ua
            entry.ip_address = ip
            entry.status = 'read'
            db.session.commit()
            logger.info(f"Marked read: {mail_id}")
        elif not entry:
            logger.warning(f"Early track for {mail_id}")
            TrackedMail(
                id=mail_id,
                user_email='unknown@example.com',
                subject='Unknown',
                content='Tracked before store',
                tracking_url=request.url,
                sent_at=now,
                opened_at=now,
                user_agent=ua,
                ip_address=ip,
                status='read'
            )
            db.session.commit()

        # Return 1x1 transparent PNG
        img = Image.new('RGBA', (1,1), (0,0,0,0))
        bio = BytesIO()
        img.save(bio, 'PNG')
        bio.seek(0)
        return bio.getvalue(), 200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-cache, no-store',
            'Pragma': 'no-cache',
            'Expires': '0'
        }

    except Exception as ex:
        logger.exception(f"Track error: {ex}")
        db.session.rollback()
        return '', 500

@app.route('/api/mails')
def api_list():
    try:
        all_mails = TrackedMail.query.order_by(TrackedMail.sent_at.desc()).all()
        return jsonify([m.to_dict() for m in all_mails])
    except Exception as ex:
        logger.error(f"API list error: {ex}")
        return jsonify({'error': 'Could not fetch'}), 500

@app.route('/api/mails/<mail_id>')
def api_get(mail_id):
    try:
        mail = TrackedMail.query.get(mail_id)
        if not mail:
            return jsonify({'error': 'Not found'}), 404
        return jsonify(mail.to_dict())
    except Exception as ex:
        logger.error(f"API get error: {ex}")
        return jsonify({'error': 'Fetch error'}), 500

@app.route('/health')
def health_check():
    return jsonify({'status': 'ok'}), 200

@app.route('/debug')
def debug_info():
    total = TrackedMail.query.count()
    recent = TrackedMail.query.order_by(TrackedMail.sent_at.desc()).limit(5).all()
    return jsonify({'total': total, 'recent': [m.to_dict() for m in recent]})

@app.errorhandler(404)
def handle_404(e):
    return jsonify({'error': 'Route not found'}), 404

@app.errorhandler(500)
def handle_500(e):
    return jsonify({'error': 'Server error'}), 500

# Compute stats for dashboard
def compute_stats():
    total = TrackedMail.query.count()
    read = TrackedMail.query.filter(TrackedMail.opened_at.isnot(None)).count()
    unread = total - read
    avg_open = 'N/A'
    if read:
        avg_secs = db.session.query(
            db.func.avg(
                db.func.strftime('%s', TrackedMail.opened_at) -
                db.func.strftime('%s', TrackedMail.sent_at)
            )
        ).filter(TrackedMail.opened_at.isnot(None)).scalar()
        if avg_secs:
            avg_open = humanize.naturaldelta(timedelta(seconds=avg_secs))
    return {
        'total_emails': total,
        'read_emails': read,
        'unread_emails': unread,
        'read_percentage': round((read/total)*100, 1) if total else 0,
        'unread_percentage': round((unread/total)*100, 1) if total else 0,
        'avg_open_time': avg_open
    }

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(host='0.0.0.0', port=5000, debug=True)