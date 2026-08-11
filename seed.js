/**
 * MIVEA Entertainment — reference API server
 * Express + better-sqlite3. Minimal, readable, meant to be extended —
 * not a production deployment (see BACKEND-DESIGN.md for the real shape:
 * Postgres, S3 pre-signed uploads, a queued email worker, etc).
 *
 * Run:
 *   npm install
 *   npm run seed     # creates mivea.db and a demo staff account
 *   npm start         # http://localhost:4000
 */
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = process.env.PORT || 4000;
const DB_PATH = path.join(__dirname, 'mivea.db');
const RESEND_API_KEY = process.env.RESEND_API_KEY || null;
const EMAIL_FROM = process.env.EMAIL_FROM || 'MIVEA Entertainment <onboarding@resend.dev>';

const isNewDb = !fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const app = express();
app.use(cors());
app.use(express.json());

/* ---------------- helpers ---------------- */
const CATEGORY_KEYS = ['vocal','dance','rap','acting','allround','music'];
const STATUS_ORDER = ['SUBMITTED','UNDER_REVIEW','SHORTLISTED','ONLINE_AUDITION','FINAL_EVALUATION','ACCEPTED','NOT_SELECTED'];

function genAppId() {
  const n = Math.floor(10000 + Math.random() * 89999);
  return 'MV-2026-' + n;
}

/* ---------------- EMAIL (Resend) ---------------- */
async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.log(`[email skipped — no RESEND_API_KEY] would send "${subject}" to ${to}`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend error:', res.status, errText);
    }
  } catch (err) {
    console.error('Failed to send email:', err.message);
  }
}

const STATUS_EMAIL_TEXT = {
  UNDER_REVIEW: "Your application is now under review by our casting team.",
  SHORTLISTED: "Congratulations — you've been shortlisted!",
  ONLINE_AUDITION: "You've been invited to an online audition round.",
  FINAL_EVALUATION: "Your application has reached final evaluation.",
  ACCEPTED: "Congratulations — you've been accepted!",
  NOT_SELECTED: "Thank you for auditioning. We won't be moving forward with your application at this time."
};

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.staff = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.staff.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

/* ================= PUBLIC ROUTES ================= */

app.post('/api/v1/applications', (req, res) => {
  const b = req.body || {};
  const required = ['fullName','dob','country','email','category','why','strengths','languages'];
  for (const f of required) {
    if (!b[f] || !String(b[f]).trim()) return res.status(400).json({ error: `Missing field: ${f}` });
  }
  if (!CATEGORY_KEYS.includes(b.category)) return res.status(400).json({ error: 'Invalid category' });
  if (!b.video) return res.status(400).json({ error: 'Audition video is required' });

  const id = genAppId();
  db.prepare(`
    INSERT INTO applications
      (id, full_name, stage_name, date_of_birth, country, city, email, phone, category,
       photo_url, video_url, video2_url, portfolio_url, why_mivea, strengths, experience, languages)
    VALUES (@id, @fullName, @stageName, @dob, @country, @city, @email, @phone, @category,
            @photo, @video, @video2, @portfolio, @why, @strengths, @experience, @languages)
  `).run({
    id,
    fullName: b.fullName, stageName: b.stageName || null, dob: b.dob,
    country: b.country, city: b.city || null, email: b.email, phone: b.phone || null,
    category: b.category, photo: b.photo || null, video: b.video, video2: b.video2 || null,
    portfolio: b.portfolio || null, why: b.why, strengths: b.strengths,
    experience: b.experience || null, languages: b.languages
  });

  sendEmail(
    b.email,
    'MIVEA Entertainment — Application Received',
    `<p>Hi ${b.fullName},</p>
     <p>Thank you for auditioning for MIVEA Entertainment. Your application has been received.</p>
     <p><b>Your Application ID: ${id}</b></p>
     <p>Keep this ID safe — you'll need it along with your email to check your status.</p>`
  );

  res.status(201).json({ id });
});

app.get('/api/v1/applications/status', (req, res) => {
  const { id, email } = req.query;
  if (!id || !email) return res.status(400).json({ error: 'id and email are required' });
  const row = db.prepare('SELECT id, status FROM applications WHERE id = ? AND lower(email) = lower(?)').get(id, email);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/v1/contact', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.email || !b.message) return res.status(400).json({ error: 'name, email, and message are required' });
  db.prepare(`INSERT INTO contact_messages (id, name, email, subject, message) VALUES (?,?,?,?,?)`)
    .run(uuidv4(), b.name, b.email, b.subject || null, b.message);
  res.status(201).json({ ok: true });
});

app.get('/api/v1/artists', (req, res) => {
  const type = req.query.type;
  let rows = db.prepare('SELECT * FROM artists WHERE published = 1 ORDER BY created_at DESC').all();
  if (type) rows = rows.filter(r => r.type === type);
  res.json(rows);
});

app.get('/api/v1/news', (req, res) => {
  const tag = req.query.tag;
  let rows = db.prepare('SELECT * FROM news WHERE published = 1 ORDER BY published_at DESC').all();
  if (tag) rows = rows.filter(r => r.tag === tag);
  res.json(rows);
});

/* ================= AUTH ================= */

app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const staff = db.prepare('SELECT * FROM staff WHERE email = ?').get(email);
  if (!staff || !bcrypt.compareSync(password || '', staff.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  const token = jwt.sign({ id: staff.id, name: staff.name, role: staff.role }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, staff: { id: staff.id, name: staff.name, role: staff.role, email: staff.email } });
});

/* ================= STAFF ROUTES ================= */

app.get('/api/v1/applications', requireAuth, (req, res) => {
  const { status, category, q } = req.query;
  let sql = 'SELECT * FROM applications WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (q) { sql += ' AND (full_name LIKE ? OR id LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY submitted_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/v1/applications/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.patch('/api/v1/applications/:id', requireAuth, (req, res) => {
  const { status, staffNote } = req.body || {};
  if (status && !STATUS_ORDER.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE applications SET status = COALESCE(?, status), staff_note = COALESCE(?, staff_note), updated_at = datetime('now') WHERE id = ?`)
    .run(status || null, staffNote ?? null, req.params.id);

  const updatedRow = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);

  if (status && status !== existing.status && STATUS_EMAIL_TEXT[status]) {
    sendEmail(
      updatedRow.email,
      `MIVEA Entertainment — Application Update (${updatedRow.id})`,
      `<p>Hi ${updatedRow.full_name},</p><p>${STATUS_EMAIL_TEXT[status]}</p>`
    );
  }

  res.json(updatedRow);
});

app.get('/api/v1/artists/all', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM artists ORDER BY created_at DESC').all());
});

app.post('/api/v1/artists', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.type) return res.status(400).json({ error: 'name and type are required' });
  const id = uuidv4();
  db.prepare(`INSERT INTO artists (id, type, name, members, debut_date, position, bio) VALUES (?,?,?,?,?,?,?)`)
    .run(id, b.type, b.name, b.members || null, b.debut || null, b.position || null, b.bio || null);
  res.status(201).json(db.prepare('SELECT * FROM artists WHERE id = ?').get(id));
});

app.patch('/api/v1/artists/:id', requireAuth, (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM artists WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE artists SET type=?, name=?, members=?, debut_date=?, position=?, bio=?, updated_at=datetime('now') WHERE id=?`)
    .run(b.type ?? existing.type, b.name ?? existing.name, b.members ?? existing.members,
         b.debut ?? existing.debut_date, b.position ?? existing.position, b.bio ?? existing.bio, req.params.id);
  res.json(db.prepare('SELECT * FROM artists WHERE id = ?').get(req.params.id));
});

app.delete('/api/v1/artists/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM artists WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

app.post('/api/v1/news', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.tag) return res.status(400).json({ error: 'title and tag are required' });
  const id = uuidv4();
  db.prepare(`INSERT INTO news (id, tag, title, description, published_at) VALUES (?,?,?,?,?)`)
    .run(id, b.tag, b.title, b.desc || '', b.date || new Date().toISOString());
  res.status(201).json(db.prepare('SELECT * FROM news WHERE id = ?').get(id));
});

app.patch('/api/v1/news/:id', requireAuth, (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE news SET tag=?, title=?, description=?, published_at=? WHERE id=?`)
    .run(b.tag ?? existing.tag, b.title ?? existing.title, b.desc ?? existing.description,
         b.date ?? existing.published_at, req.params.id);
  res.json(db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id));
});

app.delete('/api/v1/news/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM news WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

app.get('/api/v1/staff', requireAuth, requireRole('administrator'), (req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, created_at FROM staff').all());
});

app.get('/api/v1/contact-messages', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC').all());
});

app.listen(PORT, () => {
  console.log(`MIVEA reference API listening on http://localhost:${PORT}`);
  if (isNewDb) console.log('New database created — run "npm run seed" to add a demo staff login.');
});
