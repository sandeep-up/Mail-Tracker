web: gunicorn --worker-class gevent --workers 4 --bind 0.0.0.0:$PORT server:app    # Start the web application
worker: python worker.py                                                  # Launch background task processor
