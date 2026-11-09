// Bulk Hiring Screening Calls - backend (Express + SQLite)
// Load .env (KEY=value lines) without needing the dotenv package
try {
  for (const l of require("fs").readFileSync(require("path").join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const gnani = require("./gnani");
const { parseAnswer } = require("./voice-parse");

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const MAX_ATTEMPTS = 3;

const db = new Database(process.env.DB_FILE || path.join(__dirname, "data.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS campaigns(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, role TEXT NOT NULL, location TEXT, shift TEXT,
  max_salary INTEGER NOT NULL, max_notice_days INTEGER NOT NULL DEFAULT 15,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS candidates(
  id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT, phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, answers TEXT, notes TEXT,
  score INTEGER, verdict TEXT, called_at TEXT,
  UNIQUE(campaign_id, phone));
`);

// ---------- scoring ----------
// answers: { looking: bool, shiftOk: bool, salary: number, noticeDays: number, experienceYears: number }
function evaluate(a, c) {
  if (!a.looking) return { score: 0, verdict: "not_fit", reason: "Not looking for a job" };
  if (!a.shiftOk) return { score: 10, verdict: "not_fit", reason: "Cannot do location or shift" };
  let score = 20 + 25;
  if (a.salary <= c.max_salary) score += 25;
  else if (a.salary <= c.max_salary * 1.15) score += 10;
  if (a.noticeDays <= c.max_notice_days) score += 15;
  else if (a.noticeDays <= c.max_notice_days * 2) score += 7;
  score += Math.min(Math.max(a.experienceYears, 0), 3) * 5;
  const verdict = score >= 75 ? "shortlist" : score >= 45 ? "maybe" : "not_fit";
  return { score, verdict };
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e); res.status(500).json({ error: "Something went wrong" });
});

function auth(req, res, next) {
  const t = (req.headers.authorization || "").replace("Bearer ", "");
  try { req.user = jwt.verify(t, SECRET); next(); }
  catch { res.status(401).json({ error: "Please log in again" }); }
}
const ownCampaign = (req, res) => {
  const c = db.prepare("SELECT * FROM campaigns WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!c) res.status(404).json({ error: "Campaign not found" });
  return c;
};
const token = (u) => jwt.sign({ id: u.id, name: u.name }, SECRET, { expiresIn: "7d" });

// ---------- auth ----------
app.post("/api/auth/register", wrap((req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ error: "Enter name, email and a password of 6+ characters" });
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email.toLowerCase()))
    return res.status(409).json({ error: "This email is already registered" });
  const r = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
    .run(name, email.toLowerCase(), bcrypt.hashSync(password, 10));
  const u = { id: r.lastInsertRowid, name };
  res.json({ token: token(u), name });
}));

app.post("/api/auth/login", wrap((req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE email=?").get((email || "").toLowerCase());
  if (!u || !bcrypt.compareSync(password || "", u.password_hash))
    return res.status(401).json({ error: "Email or password is wrong" });
  res.json({ token: token(u), name: u.name });
}));

// ---------- campaigns ----------
app.get("/api/campaigns", auth, wrap((req, res) => {
  const rows = db.prepare(`
    SELECT c.*, COUNT(k.id) total,
      SUM(k.status='done') done, SUM(k.verdict='shortlist') shortlisted
    FROM campaigns c LEFT JOIN candidates k ON k.campaign_id=c.id
    WHERE c.user_id=? GROUP BY c.id ORDER BY c.id DESC`).all(req.user.id);
  res.json(rows);
}));

app.post("/api/campaigns", auth, wrap((req, res) => {
  const b = req.body || {};
  if (!b.title || !b.role || !b.maxSalary) return res.status(400).json({ error: "Title, role and maximum salary are required" });
  const r = db.prepare(`INSERT INTO campaigns(user_id,title,role,location,shift,max_salary,max_notice_days)
    VALUES(?,?,?,?,?,?,?)`).run(req.user.id, b.title, b.role, b.location || "", b.shift || "",
    Number(b.maxSalary), Number(b.maxNoticeDays) || 15);
  res.json({ id: r.lastInsertRowid });
}));

app.get("/api/campaigns/:id", auth, wrap((req, res) => {
  const c = ownCampaign(req, res); if (!c) return;
  const s = db.prepare(`SELECT COUNT(*) total, SUM(status='pending') pending, SUM(status='no_answer') noAnswer,
    SUM(status='done') done, SUM(verdict='shortlist') shortlist, SUM(verdict='maybe') maybe,
    SUM(verdict='not_fit') notFit FROM candidates WHERE campaign_id=?`).get(c.id);
  res.json({ campaign: c, stats: s });
}));

app.delete("/api/campaigns/:id", auth, wrap((req, res) => {
  const c = ownCampaign(req, res); if (!c) return;
  db.prepare("DELETE FROM campaigns WHERE id=?").run(c.id);
  res.json({ ok: true });
}));

// ---------- candidates ----------
// Body: { csv: "name,phone\nRamesh,9876543210\n..." } header row is optional
app.post("/api/campaigns/:id/candidates", auth, wrap((req, res) => {
  const c = ownCampaign(req, res); if (!c) return;
  const lines = String(req.body.csv || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ins = db.prepare("INSERT OR IGNORE INTO candidates(campaign_id,name,phone) VALUES(?,?,?)");
  let added = 0, skipped = 0;
  db.transaction(() => {
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
      let name = parts[0], phone = parts[1];
      if (parts.length === 1) { phone = parts[0]; name = ""; }
      const digits = (phone || "").replace(/\D/g, "").slice(-10);
      if (digits.length !== 10) { skipped++; continue; }
      ins.run(c.id, name, digits).changes ? added++ : skipped++;
    }
  })();
  res.json({ added, skipped });
}));

// Next candidate to call: pending first, then retries under the attempt limit
app.get("/api/campaigns/:id/next", auth, wrap((req, res) => {
  const c = ownCampaign(req, res); if (!c) return;
  const k = db.prepare(`SELECT id,name,phone,attempts FROM candidates
    WHERE campaign_id=? AND status IN ('pending','no_answer') AND attempts<?
    ORDER BY attempts ASC, id ASC LIMIT 1`).get(c.id, MAX_ATTEMPTS);
  res.json({ candidate: k || null });
}));

// Save the outcome of one call
app.post("/api/candidates/:id/result", auth, wrap((req, res) => {
  const k = db.prepare(`SELECT k.*, c.max_salary, c.max_notice_days FROM candidates k
    JOIN campaigns c ON c.id=k.campaign_id WHERE k.id=? AND c.user_id=?`).get(req.params.id, req.user.id);
  if (!k) return res.status(404).json({ error: "Candidate not found" });
  const { outcome, answers, notes } = req.body || {};
  if (outcome === "no_answer") {
    db.prepare(`UPDATE candidates SET attempts=attempts+1, status=?, verdict=?, notes=?, called_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run("no_answer", k.attempts + 1 >= MAX_ATTEMPTS ? "no_answer" : null, notes || null, k.id);
    return res.json({ ok: true });
  }
  const a = {
    looking: !!answers?.looking, shiftOk: !!answers?.shiftOk,
    salary: Number(answers?.salary) || 0, noticeDays: Number(answers?.noticeDays) || 0,
    experienceYears: Number(answers?.experienceYears) || 0,
  };
  const r = evaluate(a, k);
  db.prepare(`UPDATE candidates SET attempts=attempts+1, status='done', answers=?, notes=?, score=?, verdict=?,
    called_at=CURRENT_TIMESTAMP WHERE id=?`).run(JSON.stringify(a), notes || null, r.score, r.verdict, k.id);
  res.json({ ok: true, ...r });
}));

// ---------- voice screening (Gnani Prisma speech-to-text, Timbre text-to-speech) ----------
const gnaniFail = (res, e) => {
  if (!(e instanceof gnani.GnaniError)) throw e;
  res.status(e.status === 429 ? 429 : e.status === 503 ? 503 : 502).json({ error: e.message });
};

app.get("/api/voice/status", auth, (req, res) => res.json({ enabled: !!process.env.GNANI_API_KEY, languages: gnani.LANGS }));

// Speak a question aloud. Body: { text, lang }. Returns audio/wav.
app.post("/api/voice/speak", auth, wrap(async (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 400);
  if (!text) return res.status(400).json({ error: "Nothing to say" });
  try {
    const wav = await gnani.synthesize(text, req.body?.lang);
    res.setHeader("Content-Type", "audio/wav");
    res.send(wav);
  } catch (e) { gnaniFail(res, e); }
}));

// Listen to one answer. Body: raw WAV (max 30 s). Query: ?q=looking|shiftOk|salary|noticeDays|experienceYears&lang=hi-IN
app.post("/api/voice/answer", auth, express.raw({ type: ["audio/wav", "audio/x-wav", "application/octet-stream"], limit: "6mb" }), wrap(async (req, res) => {
  const lang = gnani.LANGS.includes(req.query.lang) ? req.query.lang : "hi-IN";
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: "No audio received" });
  try {
    const transcript = await gnani.transcribe(req.body, lang);
    res.json({ transcript, ...parseAnswer(String(req.query.q || ""), transcript) });
  } catch (e) { gnaniFail(res, e); }
}));

// ---------- report ----------
function reportRows(id) {
  return db.prepare(`SELECT name,phone,status,attempts,score,verdict,answers,notes FROM candidates
    WHERE campaign_id=? AND status<>'pending'
    ORDER BY CASE verdict WHEN 'shortlist' THEN 0 WHEN 'maybe' THEN 1 WHEN 'not_fit' THEN 2 ELSE 3 END, score DESC`)
    .all(id).map((r) => ({ ...r, answers: r.answers ? JSON.parse(r.answers) : null }));
}
app.get("/api/campaigns/:id/report", auth, wrap((req, res) => {
  const c = ownCampaign(req, res); if (!c) return;
  res.json(reportRows(c.id));
}));
app.get("/api/campaigns/:id/report.csv", auth, wrap((req, res) => {
  const c = ownCampaign(req, res); if (!c) return;
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = "Name,Phone,Result,Score,Still looking,Shift OK,Expected salary,Notice days,Experience years,Attempts,Notes";
  const rows = reportRows(c.id).map((r) => {
    const a = r.answers || {};
    return [r.name, r.phone, r.verdict || r.status, r.score, a.looking ? "Yes" : a.looking === false ? "No" : "",
      a.shiftOk ? "Yes" : a.shiftOk === false ? "No" : "", a.salary, a.noticeDays, a.experienceYears, r.attempts, r.notes].map(q).join(",");
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="shortlist-${c.id}.csv"`);
  res.send([head, ...rows].join("\n"));
}));

app.listen(PORT, () => console.log(`Screening calls running on http://localhost:${PORT}`));
