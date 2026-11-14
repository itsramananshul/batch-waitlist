// Batch waitlist: serves the page and saves sign-ups to SQLite.
// Optional: emails you on each sign-up and sends the person a confirmation.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import nodemailer from "nodemailer";

const {
  PORT = "3000",
  DATA_DIR = "/data",
  SMTP_HOST, SMTP_PORT = "587", SMTP_USER, SMTP_PASS,
  MAIL_FROM,          // e.g. "Batch <hello@batchcampus.com>"
  NOTIFY_TO,          // where new-sign-up alerts go
  ADMIN_TOKEN,        // enables GET /api/waitlist.csv?token=...
} = process.env;

const PUBLIC = path.join(import.meta.dirname, "public");

// ---------- storage ----------
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "waitlist.db"));
db.exec(`CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip TEXT, user_agent TEXT, referrer TEXT
)`);
const insert = db.prepare("INSERT OR IGNORE INTO signups (email, ip, user_agent, referrer) VALUES (?, ?, ?, ?)");
const count = db.prepare("SELECT COUNT(*) AS n FROM signups");
const all = db.prepare("SELECT email, created_at FROM signups ORDER BY id");

// ---------- mail ----------
const mailer = SMTP_HOST && MAIL_FROM
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;
if (!mailer) console.warn("SMTP not configured: sign-ups are saved, but no emails are sent.");

async function sendEmails(email, total) {
  if (!mailer) return;
  const jobs = [
    mailer.sendMail({
      from: MAIL_FROM,
      to: email,
      subject: "You're on the Batch waitlist",
      text:
`Thanks for joining the Batch waitlist.

Batch is the verified network for US college students and alumni. We'll email you when Batch opens at your campus.

Every batch ends. Yours doesn't have to.
- The Batch team`,
    }),
  ];
  if (NOTIFY_TO) {
    jobs.push(mailer.sendMail({
      from: MAIL_FROM,
      to: NOTIFY_TO,
      subject: `New Batch waitlist sign-up (#${total})`,
      text: `${email} joined the Batch waitlist.\nTotal sign-ups: ${total}`,
    }));
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === "rejected") console.error("mail error:", r.reason?.message);
}

// ---------- helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hits = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
}
setInterval(() => hits.clear(), 10 * 60_000).unref();

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > limit) { reject(new Error("too large")); req.destroy(); } });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const ip = (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();

  if (req.method === "POST" && url.pathname === "/api/waitlist") {
    if (rateLimited(ip)) return json(res, 429, { error: "Too many tries. Please wait a minute." });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Bad request." }); }
    if (body.company) return json(res, 200, { ok: true }); // honeypot: bots fill hidden field
    const email = String(body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return json(res, 400, { error: "That email doesn’t look right." });

    const { changes } = insert.run(email, ip, String(req.headers["user-agent"] || "").slice(0, 300), String(req.headers.referer || "").slice(0, 300));
    if (changes === 0) return json(res, 200, { ok: true, already: true });
    const total = count.get().n;
    console.log(`signup #${total}`);
    sendEmails(email, total); // don't make the visitor wait for SMTP
    return json(res, 201, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/waitlist.csv") {
    if (!ADMIN_TOKEN || url.searchParams.get("token") !== ADMIN_TOKEN) return json(res, 404, { error: "Not found." });
    const rows = all.all().map(r => `${r.email},${r.created_at}`).join("\n");
    res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=batch-waitlist.csv", "Cache-Control": "no-store" });
    return res.end("email,created_at_utc\n" + rows + "\n");
  }

  if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { ok: true });

  if (req.method === "GET" || req.method === "HEAD") {
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return json(res, 404, { error: "Not found." });
    try {
      const buf = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      return res.end(req.method === "HEAD" ? undefined : buf);
    } catch {
      const buf = await readFile(path.join(PUBLIC, "index.html"));
      res.writeHead(404, { "Content-Type": TYPES[".html"] });
      return res.end(buf);
    }
  }

  json(res, 405, { error: "Method not allowed." });
});

server.listen(Number(PORT), () => console.log(`Batch waitlist on :${PORT}`));
