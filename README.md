# Mail Tracker (Work in Progress) 

## Project Idea

This project is aimed at building a **Mail Read Tracking System** similar to Mailtrack, but with:
- A focus on **Firefox Extension**
- A **custom Flask backend**
- Minimalistic privacy-respecting design

### Core Goals:
- Embed tracking pixel in emails
- Track when the recipient opens an email
- Show read/unread status with timestamps
- Build a dashboard to view tracking info

---

## Tech Stack (Planned)

- **Frontend**: Firefox Extension (Manifest v2 or v3)
- **Backend**: Python Flask
- **Database**: SQLite (for simplicity)
- **Browser**: Firefox only (for now)

---

## Motivation

Many existing email tracking services are either paid, Chrome-only, or not customizable. I want to build a **lightweight, open-source version** tailored for Firefox users and personal use.

---

## Current Progress

- [x] Basic Flask backend setup
- [ ] Tracking pixel route
- [ ] Email metadata logging
- [ ] Firefox extension starter code
- [ ] Dashboard UI for logs

---

## To Do Next

- Implement pixel logic and database connection
- Build the first version of the extension popup
- Setup routing and API endpoints

---

## How to Run (So Far)

1. Clone the repository
2. Navigate to the backend folder
3. Install Flask:

   ```bash
   pip install flask
