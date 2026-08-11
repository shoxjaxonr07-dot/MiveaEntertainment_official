-- SQLite version of the schema described in BACKEND-DESIGN.md.
-- (SQLite lacks native UUID/JSONB/TIMESTAMPTZ types, so those columns
-- are stored as TEXT here. Swap this file for the Postgres version in
-- the design doc when moving to production.)

CREATE TABLE IF NOT EXISTS staff (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('administrator','reviewer','editor')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id            TEXT PRIMARY KEY,
  full_name     TEXT NOT NULL,
  stage_name    TEXT,
  date_of_birth TEXT NOT NULL,
  country       TEXT NOT NULL,
  city          TEXT,
  email         TEXT NOT NULL,
  phone         TEXT,
  category      TEXT NOT NULL CHECK (category IN ('vocal','dance','rap','acting','allround','music')),
  photo_url     TEXT,
  video_url     TEXT,
  video2_url    TEXT,
  portfolio_url TEXT,
  why_mivea     TEXT NOT NULL,
  strengths     TEXT NOT NULL,
  experience    TEXT,
  languages     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'SUBMITTED'
                CHECK (status IN ('SUBMITTED','UNDER_REVIEW','SHORTLISTED',
                                   'ONLINE_AUDITION','FINAL_EVALUATION','ACCEPTED','NOT_SELECTED')),
  staff_note    TEXT,
  submitted_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_applications_status   ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_category ON applications(category);

CREATE TABLE IF NOT EXISTS artists (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('Groups','Solo Artists','Trainees')),
  name         TEXT NOT NULL,
  members      TEXT,
  debut_date   TEXT,
  position     TEXT,
  bio          TEXT,
  photo_url    TEXT,
  discography  TEXT DEFAULT '[]',
  music_videos TEXT DEFAULT '[]',
  published    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news (
  id            TEXT PRIMARY KEY,
  tag           TEXT NOT NULL CHECK (tag IN ('Mivea News','Audition','Artists','Announcement')),
  title         TEXT NOT NULL,
  cover_url     TEXT,
  description   TEXT NOT NULL,
  body          TEXT,
  published     INTEGER NOT NULL DEFAULT 1,
  published_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  subject     TEXT,
  message     TEXT NOT NULL,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,
  owner_type    TEXT NOT NULL CHECK (owner_type IN ('application','artist','news')),
  owner_id      TEXT NOT NULL,
  field         TEXT NOT NULL,
  storage_key   TEXT NOT NULL,
  original_name TEXT,
  mime_type     TEXT,
  size_bytes    INTEGER,
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
