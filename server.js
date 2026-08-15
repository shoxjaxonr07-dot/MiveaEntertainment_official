 /**
 * MIVEA Entertainment — reference API server (PostgreSQL edition)
 * Express + pg (node-postgres). Data now persists across restarts/redeploys —
 * this replaces the earlier SQLite version.
 *
 * Requires a DATABASE_URL environment variable (a Postgres connection string).
 */
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = process.env.PORT || 4000;
const RESEND_API_KEY = process.env.RESEND_API_KEY || null;
const EMAIL_FROM = process.env.EMAIL_FROM || 'MIVEA Entertainment <onboarding@resend.dev>';
const IMAGEKIT_PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY || null;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set — add your Postgres connection string as an environment variable.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  // Self-seed the demo staff account on every startup so the demo login
  // (admin@mivea.demo / mivea2026) always works, however the platform is configured.
  const email = 'admin@mivea.demo';
  const { rows } = await pool.query('SELECT id FROM staff WHERE email = $1', [email]);
  if (rows.length === 0) {
    const hash = bcrypt.hashSync('mivea2026', 10);
    await pool.query(
      'INSERT INTO staff (id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), 'Demo Admin', email, hash, 'administrator']
    );
    console.log('Demo staff account created automatically:', email);
  }
}

const app = express();
app.use(cors());
app.use(express.json());

// Wraps an async route handler so a rejected promise becomes a proper
// 500 response instead of crashing the process.
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

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
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html })
    });
    if (!res.ok) console.error('Resend error:', res.status, await res.text());
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

/* ---------------- RATE LIMITING ---------------- */
const rateLimitBuckets = new Map();
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const timestamps = (rateLimitBuckets.get(ip) || []).filter(t => now - t < windowMs);
    if (timestamps.length >= maxRequests) return res.status(429).json({ error: 'Too many requests — please try again later.' });
    timestamps.push(now);
    rateLimitBuckets.set(ip, timestamps);
    next();
  };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try { req.staff = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.staff.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

/* ================= PUBLIC ROUTES ================= */

app.get('/api/v1/upload-auth', (req, res) => {
  if (!IMAGEKIT_PRIVATE_KEY) return res.status(503).json({ error: 'Image upload is not configured on this server yet.' });
  const token = crypto.randomUUID();
  const expire = Math.floor(Date.now() / 1000) + 2400;
  const signature = crypto.createHmac('sha1', IMAGEKIT_PRIVATE_KEY).update(token + expire).digest('hex');
  res.json({ token, expire, signature });
});

app.post('/api/v1/applications', rateLimit(10, 60 * 60 * 1000), ah(async (req, res) => {
  const b = req.body || {};
  const required = ['fullName','dob','country','email','category','why','strengths','languages'];
  for (const f of required) {
    if (!b[f] || !String(b[f]).trim()) return res.status(400).json({ error: `Missing field: ${f}` });
  }
  if (!CATEGORY_KEYS.includes(b.category)) return res.status(400).json({ error: 'Invalid category' });
  if (!b.video) return res.status(400).json({ error: 'Audition video is required' });

  const id = genAppId();
  await pool.query(
    `INSERT INTO applications
      (id, full_name, stage_name, date_of_birth, country, city, email, phone, category,
       photo_url, video_url, video2_url, portfolio_url, why_mivea, strengths, experience, languages)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [id, b.fullName, b.stageName || null, b.dob, b.country, b.city || null, b.email, b.phone || null,
     b.category, b.photo || null, b.video, b.video2 || null, b.portfolio || null, b.why, b.strengths,
     b.experience || null, b.languages]
  );

  sendEmail(
    b.email,
    'MIVEA Entertainment — Application Received',
    `<p>Hi ${b.fullName},</p>
     <p>Thank you for auditioning for MIVEA Entertainment. Your application has been received.</p>
     <p><b>Your Application ID: ${id}</b></p>
     <p>Keep this ID safe — you'll need it along with your email to check your status.</p>`
  );

  res.status(201).json({ id });
}));

app.get('/api/v1/applications/status', ah(async (req, res) => {
  const { id, email } = req.query;
  if (!id || !email) return res.status(400).json({ error: 'id and email are required' });
  const { rows } = await pool.query(
    'SELECT id, status FROM applications WHERE id = $1 AND lower(email) = lower($2)',
    [id, email]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
}));

app.post('/api/v1/contact', rateLimit(10, 60 * 60 * 1000), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.email || !b.message) return res.status(400).json({ error: 'name, email, and message are required' });
  await pool.query(
    'INSERT INTO contact_messages (id, name, email, subject, message) VALUES ($1,$2,$3,$4,$5)',
    [uuidv4(), b.name, b.email, b.subject || null, b.message]
  );
  res.status(201).json({ ok: true });
}));

app.get('/api/v1/artists', ah(async (req, res) => {
  const type = req.query.type;
  let sql = 'SELECT * FROM artists WHERE published = true';
  const params = [];
  if (type) { params.push(type); sql += ` AND type = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await pool.query(sql, params);
  res.json(rows);
}));

app.get('/api/v1/news', ah(async (req, res) => {
  const tag = req.query.tag;
  let sql = 'SELECT * FROM news WHERE published = true';
  const params = [];
  if (tag) { params.push(tag); sql += ` AND tag = $${params.length}`; }
  sql += ' ORDER BY published_at DESC';
  const { rows } = await pool.query(sql, params);
  res.json(rows);
}));

/* ================= AUTH ================= */

app.post('/api/v1/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM staff WHERE email = $1', [email]);
  const staff = rows[0];
  if (!staff || !bcrypt.compareSync(password || '', staff.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  const token = jwt.sign({ id: staff.id, name: staff.name, role: staff.role }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, staff: { id: staff.id, name: staff.name, role: staff.role, email: staff.email } });
}));

/* ================= STAFF ROUTES ================= */

app.get('/api/v1/applications', requireAuth, ah(async (req, res) => {
  const { status, category, q } = req.query;
  let sql = 'SELECT * FROM applications WHERE 1=1';
  const params = [];
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  if (category) { params.push(category); sql += ` AND category = $${params.length}`; }
  if (q) { params.push(`%${q}%`); sql += ` AND (full_name ILIKE $${params.length} OR id ILIKE $${params.length})`; }
  sql += ' ORDER BY submitted_at DESC';
  const { rows } = await pool.query(sql, params);
  res.json(rows);
}));

app.get('/api/v1/applications/:id', requireAuth, ah(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
}));

app.patch('/api/v1/applications/:id', requireAuth, ah(async (req, res) => {
  const { status, staffNote } = req.body || {};
  if (status && !STATUS_ORDER.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const { rows: existingRows } = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });

  await pool.query(
    `UPDATE applications SET status = COALESCE($1, status), staff_note = COALESCE($2, staff_note), updated_at = now() WHERE id = $3`,
    [status || null, staffNote ?? null, req.params.id]
  );
  const { rows: updatedRows } = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
  const updatedRow = updatedRows[0];

  if (status && status !== existing.status && STATUS_EMAIL_TEXT[status]) {
    sendEmail(updatedRow.email, `MIVEA Entertainment — Application Update (${updatedRow.id})`,
      `<p>Hi ${updatedRow.full_name},</p><p>${STATUS_EMAIL_TEXT[status]}</p>`);
  }
  res.json(updatedRow);
}));

app.get('/api/v1/artists/all', requireAuth, ah(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM artists ORDER BY created_at DESC');
  res.json(rows);
}));

app.post('/api/v1/artists', requireAuth, ah(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.type) return res.status(400).json({ error: 'name and type are required' });
  const id = uuidv4();
  await pool.query(
    'INSERT INTO artists (id, type, name, members, debut_date, position, bio) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, b.type, b.name, b.members || null, b.debut || null, b.position || null, b.bio || null]
  );
  const { rows } = await pool.query('SELECT * FROM artists WHERE id = $1', [id]);
  res.status(201).json(rows[0]);
}));

app.patch('/api/v1/artists/:id', requireAuth, ah(async (req, res) => {
  const b = req.body || {};
  const { rows: existingRows } = await pool.query('SELECT * FROM artists WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  await pool.query(
    `UPDATE artists SET type=$1, name=$2, members=$3, debut_date=$4, position=$5, bio=$6, updated_at=now() WHERE id=$7`,
    [b.type ?? existing.type, b.name ?? existing.name, b.members ?? existing.members,
     b.debut ?? existing.debut_date, b.position ?? existing.position, b.bio ?? existing.bio, req.params.id]
  );
  const { rows } = await pool.query('SELECT * FROM artists WHERE id = $1', [req.params.id]);
  res.json(rows[0]);
}));

app.delete('/api/v1/artists/:id', requireAuth, ah(async (req, res) => {
  await pool.query('DELETE FROM artists WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

app.post('/api/v1/news', requireAuth, ah(async (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.tag) return res.status(400).json({ error: 'title and tag are required' });
  const id = uuidv4();
  await pool.query(
    'INSERT INTO news (id, tag, title, description, published_at) VALUES ($1,$2,$3,$4,$5)',
    [id, b.tag, b.title, b.desc || '', b.date || new Date().toISOString()]
  );
  const { rows } = await pool.query('SELECT * FROM news WHERE id = $1', [id]);
  res.status(201).json(rows[0]);
}));

app.patch('/api/v1/news/:id', requireAuth, ah(async (req, res) => {
  const b = req.body || {};
  const { rows: existingRows } = await pool.query('SELECT * FROM news WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  await pool.query(
    'UPDATE news SET tag=$1, title=$2, description=$3, published_at=$4 WHERE id=$5',
    [b.tag ?? existing.tag, b.title ?? existing.title, b.desc ?? existing.description,
     b.date ?? existing.published_at, req.params.id]
  );
  const { rows } = await pool.query('SELECT * FROM news WHERE id = $1', [req.params.id]);
  res.json(rows[0]);
}));

app.delete('/api/v1/news/:id', requireAuth, ah(async (req, res) => {
  await pool.query('DELETE FROM news WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

app.get('/api/v1/contact-messages', requireAuth, ah(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM contact_messages ORDER BY created_at DESC');
  res.json(rows);
}));

app.patch('/api/v1/contact-messages/:id', requireAuth, ah(async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT * FROM contact_messages WHERE id = $1', [req.params.id]);
  if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });
  await pool.query('UPDATE contact_messages SET read = true WHERE id = $1', [req.params.id]);
  const { rows } = await pool.query('SELECT * FROM contact_messages WHERE id = $1', [req.params.id]);
  res.json(rows[0]);
}));

app.get('/api/v1/staff', requireAuth, requireRole('administrator'), ah(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, email, role, created_at FROM staff');
  res.json(rows);
}));

app.post('/api/v1/staff', requireAuth, requireRole('administrator'), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.email || !b.password || !b.role) {
    return res.status(400).json({ error: 'name, email, password, and role are required' });
  }
  if (!['administrator', 'reviewer', 'editor'].includes(b.role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const { rows: existingRows } = await pool.query('SELECT id FROM staff WHERE email = $1', [b.email]);
  if (existingRows[0]) return res.status(409).json({ error: 'A staff account with this email already exists' });
  const id = uuidv4();
  const hash = bcrypt.hashSync(b.password, 10);
  await pool.query('INSERT INTO staff (id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)',
    [id, b.name, b.email, hash, b.role]);
  res.status(201).json({ id, name: b.name, email: b.email, role: b.role });
}));

// Fallback error handler for anything the wrapper above catches.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MIVEA reference API listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
