-- PostgreSQL schema (persistent — replaces the SQLite version).

CREATE TABLE IF NOT EXISTS staff (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('administrator','reviewer','editor')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
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
  lang          TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','uz')),
  status        TEXT NOT NULL DEFAULT 'SUBMITTED'
                CHECK (status IN ('SUBMITTED','UNDER_REVIEW','SHORTLISTED',
                                   'ONLINE_AUDITION','FINAL_EVALUATION','ACCEPTED','NOT_SELECTED')),
  staff_note    TEXT,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
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
  published    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS news (
  id            TEXT PRIMARY KEY,
  tag           TEXT NOT NULL CHECK (tag IN ('Mivea News','Audition','Artists','Announcement')),
  title         TEXT NOT NULL,
  cover_url     TEXT,
  description   TEXT NOT NULL,
  body          TEXT,
  published     BOOLEAN NOT NULL DEFAULT true,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  subject     TEXT,
  message     TEXT NOT NULL,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

