import os
from datetime import datetime, timezone

from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
import logging

app = Flask(__name__, template_folder='templates')
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app.config.update({
    'SQLALCHEMY_DATABASE_URI': os.getenv(
        'DATABASE_URL',
        f"sqlite:///{os.path.join(os.path.dirname(__file__), 'mail_tracker.db')}"
    ),
    'SQLALCHEMY_TRACK_MODIFICATIONS': False,
})

# ensure instance folder
os.makedirs(app.instance_path, exist_ok=True)

db = SQLAlchemy(app)

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

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(host='0.0.0.0', port=5000)
