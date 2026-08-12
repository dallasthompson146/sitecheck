/* ------------------------------------------------------------------ *
 * SiteCheck backend
 * Express + a simple JSON-file database + bcrypt PIN hashing + JWT.
 * Run with:  npm install  &&  npm start   (then open http://localhost:3000)
 * ------------------------------------------------------------------ */
const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-going-live";
// On a host, set DATA_DIR to a permanent disk (e.g. /data) so reports & photos survive restarts.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, "data.json");
const BLOB_DIR = path.join(DATA_DIR, "blobs");
if (DATA_DIR !== __dirname && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BLOB_DIR)) fs.mkdirSync(BLOB_DIR, { recursive: true });
if (JWT_SECRET === "change-this-secret-before-going-live") console.warn("WARNING: JWT_SECRET is not set. Set it before real use — logins are not secure with the default.");

/* ---------------- image/file blobs ----------------
 * Uploaded photos, receipts and invoices used to live as base64 text inside data.json,
 * which loads entirely into memory. We now write each one to its own file on the data
 * disk and keep only a small reference in data.json, so memory stays small. */
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "application/pdf": "pdf" };
function isDataUri(s) { return typeof s === "string" && s.slice(0, 5) === "data:"; }
function saveBlob(dataUri) {
  if (!isDataUri(dataUri)) return null;
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUri);
  if (!m) return null;
  const mime = m[1], ext = EXT[mime] || "bin";
  const name = uid() + uid() + "." + ext;
  try { fs.writeFileSync(path.join(BLOB_DIR, name), Buffer.from(m[2], "base64")); } catch (e) { return null; }
  return name;
}
function deleteBlob(name) { if (name && /^[A-Za-z0-9._-]+$/.test(name)) { try { fs.unlinkSync(path.join(BLOB_DIR, name)); } catch (e) {} } }
// Recursively move any {url: "data:..."} (report/draft photos, nested anywhere) into blob files.
function blobifyDeep(node) {
  if (!node || typeof node !== "object") return 0;
  let n = 0;
  if (Array.isArray(node)) { node.forEach((x) => { n += blobifyDeep(x); }); return n; }
  if (isDataUri(node.url) || (typeof node.url === "string" && node.url.slice(0, 5) === "blob:")) { const b = toBlobName(node.url); if (b) { node.blob = b; delete node.url; n++; } }
  Object.keys(node).forEach((k) => { if (k !== "blob" && node[k] && typeof node[k] === "object") n += blobifyDeep(node[k]); });
  return n;
}
const MIME = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" };
// Accept either a raw data: URI (save it) or a "blob:NAME" marker left by the streaming pre-migration.
function toBlobName(v) { if (isDataUri(v)) return saveBlob(v); if (typeof v === "string" && v.slice(0, 5) === "blob:") return v.slice(5); return null; }

/* Low-memory pre-migration: rewrite data.json on disk, streaming it in 1MB chunks and
   pulling each embedded "data:...;base64,..." image into its own blob file, leaving a tiny
   "blob:NAME" marker in its place. Never holds the whole file (or more than one image) in
   memory, so it runs even on a small instance where a full JSON.parse would run out of RAM. */
function preMigrateBlobs(file, outPath) {
  if (!fs.existsSync(file)) return false;
  try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (e) {}
  const { StringDecoder } = require("string_decoder");
  const dec = new StringDecoder("utf8");
  const CHUNK = 1 << 20;
  const buf = Buffer.allocUnsafe(CHUNK);
  const fd = fs.openSync(file, "r");
  const out = fs.openSync(outPath, "w");
  let carry = "", changed = false, safety = 0;
  const w = (s) => { if (s) fs.writeSync(out, s); };
  try {
    while (true) {
      const n = fs.readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) break;
      carry += dec.write(buf.subarray(0, n));
      let idx;
      while ((idx = carry.indexOf('"data:')) !== -1) {
        const end = carry.indexOf('"', idx + 1);
        if (end === -1) break; // image not fully read yet — wait for more chunks
        const val = carry.slice(idx + 1, end);
        if (val.indexOf(";base64,") !== -1) {
          const b = saveBlob(val);
          if (b) { w(carry.slice(0, idx) + '"blob:' + b + '"'); changed = true; if (++safety % 200 === 0) global.gc && global.gc(); }
          else w(carry.slice(0, end + 1));
        } else { w(carry.slice(0, end + 1)); }
        carry = carry.slice(end + 1);
      }
      if (carry.indexOf('"data:') === -1 && carry.length > 6) { w(carry.slice(0, carry.length - 6)); carry = carry.slice(carry.length - 6); }
    }
    carry += dec.end(); w(carry);
  } finally { fs.closeSync(fd); fs.closeSync(out); }
  return changed;
}

/* Best-effort repair of a data.json that was truncated (e.g. a disk-full crash mid-write).
   Scans to the last complete element/structure and closes it, recovering everything up to
   the cut and losing at most the final partial record. Returns a parsed object or null. */
function salvageJson(file) {
  let s; try { s = fs.readFileSync(file, "utf8"); } catch (e) { return null; }
  let inStr = false, esc = false; const stack = []; let cut = -1, cutStack = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") { stack.pop(); cut = i; cutStack = stack.slice(); }
    else if (c === ",") { cut = i - 1; cutStack = stack.slice(); }
  }
  if (cut < 0 || !cutStack) return null;
  let out = s.slice(0, cut + 1);
  for (let k = cutStack.length - 1; k >= 0; k--) out += cutStack[k];
  try { return JSON.parse(out); } catch (e) { return null; }
}
function tryParseFile(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } }
function fsize(p) { try { return fs.statSync(p).size; } catch (e) { return -1; } }
function sampleHasBase64(p) { try { const fd = fs.openSync(p, "r"); const b = Buffer.allocUnsafe(65536); const n = fs.readSync(fd, b, 0, 65536, 0); fs.closeSync(fd); return b.toString("latin1", 0, n).indexOf(";base64,") !== -1; } catch (e) { return false; } }

/* ---------------- tiny JSON datastore ---------------- */
const uid = () => Math.random().toString(36).slice(2, 10);
let db;
function persist() { const tmp = DATA_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db, null, 2)); fs.renameSync(tmp, DATA_FILE); }

function seed() {
  const D = 86400000;
  const hash = (p) => bcrypt.hashSync(String(p), 10);
  return {
    users: [
      { id: "u-super", role: "superadmin", username: "owner", name: "Owner", passwordHash: hash("owner123") },
      { id: "u-mgr", role: "admin", username: "manager", name: "Office Manager", passwordHash: hash("manager123") },
      { id: "u-marcus", role: "worker", username: "marcus", name: "Marcus Reyes", passwordHash: hash("marcus123"),
        assignments: [{ facilityId: "fac-north", checkInDay: "Tuesday" }, { facilityId: "fac-south", checkInDay: "Friday" }] },
      { id: "u-dana", role: "worker", username: "dana", name: "Dana Cole", passwordHash: hash("dana123"), assignments: [] },
    ],
    facilities: [
      { id: "fac-north", name: "Northgate Self Storage", address: "4120 Industrial Pkwy",
        config: { updatedAt: Date.now() - 3 * D, setupAt: Date.now() - 40 * D, climateControlled: true,
          weeklyTasks: [{ id: uid(), text: "Replace burnt-out lights in C building hallway" }, { id: uid(), text: "Test gate keypad entry codes" }],
          lockoutAdd: [{ id: uid(), unit: "B112" }, { id: uid(), unit: "B118" }], lockoutRemove: [{ id: uid(), unit: "A045" }], lockoutKeep: [{ id: uid(), unit: "A007" }],
          maintenance: [{ id: uid(), unit: "A045", note: "Door track sticking, won't roll up fully" }],
          vacated: [{ id: uid(), unit: "B118" }], vacant: [{ id: uid(), unit: "B112" }, { id: uid(), unit: "E501" }],
          units: [{ id: uid(), unit: "A007" }, { id: uid(), unit: "A045" }, { id: uid(), unit: "B112" }, { id: uid(), unit: "B118" }, { id: uid(), unit: "E501" }, { id: uid(), unit: "F602" }],
          auction: [{ id: uid(), unit: "F602" }] } },
      { id: "fac-south", name: "Southside Storage Depot", address: "88 Commerce Loop",
        config: { updatedAt: Date.now() - D, setupAt: Date.now() - 10 * D,
          weeklyTasks: [{ id: uid(), text: "Sweep loading dock and clear debris" }],
          lockoutAdd: [{ id: uid(), unit: "A210" }], lockoutRemove: [], lockoutKeep: [{ id: uid(), unit: "A101" }],
          maintenance: [], vacated: [{ id: uid(), unit: "A210" }], vacant: [{ id: uid(), unit: "A210" }], units: [{ id: uid(), unit: "A101" }, { id: uid(), unit: "A210" }], auction: [] } },
    ],
    submissions: [],
    drafts: [],
    reports: [],
    leads: [],
    payables: [],
    recurring: [],
    expenses: [],
    billback: {},
    invoices: [],
    invoiceSeq: 0,
    deposits: [],
    reviews: [],
    receipts: [],
  };
}

const MIG = DATA_FILE + ".migrating";
// NOTE: destructive cleanup of leftover files is intentionally DISABLED while we recover data.
// Do not delete .migrating / .tmp / .bak / .corrupt — one of them may hold the missing invoices/deposits.

// Read-only inventory of everything on the data disk, so we can see what's salvageable.
function scanCounts(p) {
  const M = { users: "passwordHash", facilities: "facilityPhotos", leads: '"kind"', invoices: "CR-", paidInvoices: '"paid"', deposits: "cubbyInput", checks: "checkNo", receipts: "fromPayableId", base64: ";base64," };
  const counts = {}, nextAllowed = {}; for (const k in M) { counts[k] = 0; nextAllowed[k] = 0; }
  const maxLen = Math.max.apply(null, Object.keys(M).map((k) => M[k].length));
  let overlap = "", globalStart = 0;
  try {
    const fd = fs.openSync(p, "r"), CH = 1 << 20, buf = Buffer.allocUnsafe(CH);
    while (true) {
      const n = fs.readSync(fd, buf, 0, CH, null); if (n <= 0) break;
      const combined = overlap + buf.toString("latin1", 0, n);
      for (const k in M) { const m = M[k]; let idx = 0; while ((idx = combined.indexOf(m, idx)) !== -1) { const g = globalStart + idx; if (g >= nextAllowed[k]) { counts[k]++; nextAllowed[k] = g + m.length; } idx += m.length; } }
      const nextOverlap = combined.slice(-(maxLen - 1));
      globalStart += combined.length - nextOverlap.length; overlap = nextOverlap;
    }
    fs.closeSync(fd);
  } catch (e) { return null; }
  return counts;
}
function diskInventory() {
  const files = [];
  try {
    fs.readdirSync(DATA_DIR).forEach((name) => {
      if (name.indexOf("data.json") !== 0) return; // only data.json and its variants
      const p = path.join(DATA_DIR, name);
      let st; try { st = fs.statSync(p); } catch (e) { return; }
      files.push({ name, bytes: st.size, modified: st.mtime, parses: !!tryParseFile(p), markers: scanCounts(p) });
    });
  } catch (e) {}
  let blobCount = 0; try { blobCount = fs.readdirSync(BLOB_DIR).length; } catch (e) {}
  return { files, blobCount };
}
const INVENTORY = diskInventory();
console.log("==== DATA DISK INVENTORY (read-only) ====");
INVENTORY.files.forEach((f) => { const m = f.markers || {}; console.log("  " + f.name + " — " + f.bytes + " bytes — parses:" + f.parses + " — users:" + m.users + " facilities:" + m.facilities + " leads:" + m.leads + " invoices(CR-):" + m.invoices + " paid:" + m.paidInvoices + " deposits:" + m.deposits + " checks:" + m.checks + " receipts:" + m.receipts + " images:" + m.base64); });
console.log("  blob files on disk: " + INVENTORY.blobCount);
console.log("=========================================");

if (!fs.existsSync(DATA_FILE)) {
  db = seed(); persist();
  console.log("Created data.json with demo accounts: owner/owner123 (super admin), manager/manager123 (admin), marcus/marcus123, dana/dana123 (workers).");
} else {
  console.log("Startup disk state — data.json: " + fsize(DATA_FILE) + " bytes; .bak: " + fsize(DATA_FILE + ".bak") + " bytes.");

  // If the live file is still large with embedded base64, stream it down into a temp file first,
  // verify that temp parses, then swap it in (keeping the original as .bak until we've loaded OK).
  if (fsize(DATA_FILE) > 8 * 1024 * 1024 && sampleHasBase64(DATA_FILE)) {
    try {
      const changed = preMigrateBlobs(DATA_FILE, MIG);
      if (changed && tryParseFile(MIG)) {
        try { fs.renameSync(DATA_FILE, DATA_FILE + ".bak"); } catch (e) {}
        fs.renameSync(MIG, DATA_FILE);
        console.log("Pre-migration complete: streamed embedded images into blob files.");
      } else { try { if (fs.existsSync(MIG)) fs.unlinkSync(MIG); } catch (e) {} }
    } catch (e) { console.warn("Pre-migration skipped: " + e.message); try { if (fs.existsSync(MIG)) fs.unlinkSync(MIG); } catch (e2) {} }
  }

  // Load with recovery fallbacks, in order of trust.
  let loaded = tryParseFile(DATA_FILE), source = "data.json";
  if (!loaded && fs.existsSync(DATA_FILE + ".bak")) { loaded = tryParseFile(DATA_FILE + ".bak"); if (loaded) source = "data.json.bak (backup)"; }
  if (!loaded) { loaded = salvageJson(DATA_FILE); if (loaded) source = "repaired data.json (recovered up to the truncation)"; }
  if (!loaded && fs.existsSync(DATA_FILE + ".bak")) { loaded = salvageJson(DATA_FILE + ".bak"); if (loaded) source = "repaired backup"; }

  if (!loaded) {
    const stamp = Date.now();
    try { fs.renameSync(DATA_FILE, DATA_FILE + ".corrupt." + stamp); } catch (e) {}
    console.error("!!! Could not read data.json or any backup. Preserved the unreadable file as data.json.corrupt." + stamp + " and started with a fresh database so the app can run. The old file is NOT deleted — recovery may still be possible.");
    db = seed(); persist();
  } else {
    db = loaded;
    console.log("Loaded database from: " + source + ".");
    if (!db.drafts) db.drafts = [];
    if (!db.reports) db.reports = [];
    if (!db.leads) db.leads = [];
    if (!db.payables) db.payables = [];
    if (!db.recurring) db.recurring = [];
    if (!db.expenses) db.expenses = [];
    if (!db.billback || Array.isArray(db.billback)) db.billback = {};
    if (!db.invoices) db.invoices = [];
    if (typeof db.invoiceSeq !== "number") db.invoiceSeq = 0;
    if (!db.deposits) db.deposits = [];
    if (!db.reviews) db.reviews = [];
    if (!db.receipts) db.receipts = [];
    if (!Array.isArray(db.facilities)) db.facilities = [];
    if (!Array.isArray(db.users) || !db.users.length) { const s = seed(); db.users = s.users; console.warn("No users found in recovered data — restored default logins."); }
    db.facilities.forEach((f) => { if (!f.config) f.config = {}; if (!f.config.setupAt) f.config.setupAt = f.config.updatedAt || Date.now(); if (!Array.isArray(f.config.units)) f.config.units = []; });

    // pull any remaining embedded images / markers into blob files
    let migrated = 0;
    db.facilities.forEach((f) => { (f.config.facilityPhotos || []).forEach((p) => { if (p) { const b = toBlobName(p.url); if (b) { p.blob = b; delete p.url; migrated++; } } }); });
    (db.receipts || []).forEach((r) => { if (r) { const b = toBlobName(r.file); if (b) { r.blob = b; delete r.file; migrated++; } } });
    (db.payables || []).forEach((p) => { if (p) { const b = toBlobName(p.invoice); if (b) { p.invoiceBlob = b; delete p.invoice; migrated++; } } });
    (db.submissions || []).forEach((s) => { migrated += blobifyDeep(s.data); });
    (db.reports || []).forEach((r) => { migrated += blobifyDeep(r); });
    (db.drafts || []).forEach((d) => { migrated += blobifyDeep(d.data); });

    // Write the clean, recovered file back (atomic). Persist if we recovered from an alternate or migrated anything.
    if (source !== "data.json" || migrated) { persist(); console.log("Saved a clean data.json" + (migrated ? " (moved " + migrated + " image reference(s) to blob files)" : "") + "."); }
    // NOTE: .bak deletion intentionally disabled during recovery — it may hold the missing invoices/deposits.
  }
}

/* ---------------- helpers ---------------- */
const publicUser = (u) => { const { passwordHash, ...rest } = u; return rest; };
const isAdminRole = (r) => r === "admin" || r === "superadmin";
const superadmins = () => db.users.filter((u) => u.role === "superadmin");

/* Strip data a given role shouldn't receive. Finance (insurance/taxes/utilities)
   is for super admins only; workers also don't get the admin-only sections. */
function sanitizeFacility(f, role) {
  const cfg = { ...f.config };
  if (role !== "superadmin") delete cfg.finance;
  if (role === "worker") { delete cfg.maintenanceTracking; delete cfg.inventory; delete cfg.contractors; }
  if (role !== "admin" && role !== "superadmin") delete cfg.adminNotes;
  return { ...f, config: cfg };
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const u = db.users.find((x) => x.id === payload.id);
    if (!u) throw new Error("gone");
    req.user = u;
    next();
  } catch (e) {
    res.status(401).json({ error: "Session expired — please sign in again." });
  }
}
function adminOrAbove(req, res, next) {
  if (!isAdminRole(req.user.role)) return res.status(403).json({ error: "Admins only." });
  next();
}
function staffOrAbove(req, res, next) {
  if (req.user.role === "worker") return res.status(403).json({ error: "Not allowed." });
  next();
}
function superAdmin(req, res, next) {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "Super admins only." });
  next();
}
function canEditFacility(req, res, next) {
  if (req.user.role === "worker") return res.status(403).json({ error: "Not allowed." });
  next();
}
function superadminOnly(req, res, next) {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "Super admins only." });
  next();
}
const usernameTaken = (username, exceptId) =>
  db.users.some((u) => u.username.toLowerCase() === String(username).toLowerCase() && u.id !== exceptId);

/* ---------------- app ---------------- */
const app = express();
app.set("trust proxy", 1);
app.get("/health", (req, res) => res.json({ ok: true }));

/* Read-only recovery diagnostic: shows what data files are on the disk and what each contains.
   Requires the owner token (?t=... or Authorization header). Changes nothing. */
app.get("/api/_diag", (req, res) => {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : (req.query.t || null);
  if (!token) return res.status(401).json({ error: "token required" });
  try { const pl = jwt.verify(token, JWT_SECRET); const u = db.users.find((x) => x.id === pl.id); if (!u || u.role !== "superadmin") return res.status(403).json({ error: "owner only" }); } catch (e) { return res.status(401).json({ error: "bad token" }); }
  res.json(diskInventory());
});

/* Serve an uploaded image/PDF blob. Token may come from the Authorization header
   or a ?t= query param, so it works as an <img src> or a link the browser opens. */
app.get("/api/blob/:name", (req, res) => {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : (req.query.t || null);
  if (!token) return res.status(401).end();
  try { jwt.verify(token, JWT_SECRET); } catch (e) { return res.status(401).end(); }
  const name = req.params.name;
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return res.status(400).end();
  const fp = path.join(BLOB_DIR, name);
  if (!fs.existsSync(fp)) return res.status(404).end();
  const ext = name.split(".").pop().toLowerCase();
  res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
  res.setHeader("Cache-Control", "private, max-age=31536000");
  fs.createReadStream(fp).pipe(res);
});

app.use(express.json({ limit: "30mb" })); // generous for base64 photos in submissions

/* ---- one-time financial recovery (owner only) ----
   /recover  : a simple page to export the current financial data to a file, or import a file back in.
   /api/_export : download invoices + deposits + expenses + bill-back as a JSON file.
   /api/_import : merge such a file into the current data WITHOUT touching anything else (adds only what's missing). */
function ownerFromReq(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : (req.query.t || null);
  if (!token) return null;
  try { const pl = jwt.verify(token, JWT_SECRET); const u = db.users.find((x) => x.id === pl.id); return u && u.role === "superadmin" ? u : null; } catch (e) { return null; }
}
app.get("/api/_export", (req, res) => {
  if (!ownerFromReq(req)) return res.status(403).json({ error: "owner only" });
  const payload = { exportedAt: Date.now(), invoices: db.invoices || [], invoiceSeq: db.invoiceSeq || 0, deposits: db.deposits || [], expenses: db.expenses || [], billback: db.billback || {} };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="sitecheck-financial-backup.json"');
  res.end(JSON.stringify(payload));
});
app.get("/api/_export_full", (req, res) => {
  if (!ownerFromReq(req)) return res.status(403).json({ error: "owner only" });
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="sitecheck-FULL-backup.json"');
  res.end(JSON.stringify(db));
});
app.post("/api/_import", (req, res) => {
  if (!ownerFromReq(req)) return res.status(403).json({ error: "owner only" });
  const b = req.body || {};
  const added = { invoices: 0, deposits: 0, expenses: 0, billback: 0 };
  const haveInv = new Set((db.invoices || []).map((x) => x.id));
  (b.invoices || []).forEach((x) => { if (x && x.id && !haveInv.has(x.id)) { db.invoices.push(x); haveInv.add(x.id); added.invoices++; } });
  if (typeof b.invoiceSeq === "number") db.invoiceSeq = Math.max(db.invoiceSeq || 0, b.invoiceSeq);
  const haveDep = new Set((db.deposits || []).map((x) => x.id));
  (b.deposits || []).forEach((x) => { if (x && x.id && !haveDep.has(x.id)) { db.deposits.push(x); haveDep.add(x.id); added.deposits++; } });
  const haveExp = new Set((db.expenses || []).map((x) => x.id));
  (b.expenses || []).forEach((x) => { if (x && x.id && !haveExp.has(x.id)) { db.expenses.push(x); haveExp.add(x.id); added.expenses++; } });
  if (b.billback) Object.keys(b.billback).forEach((fid) => { if (!db.billback[fid]) { db.billback[fid] = b.billback[fid]; added.billback++; } });
  persist();
  res.json({ ok: true, added });
});

/* Full merge: fold an entire backup file into the current data. Adds any record (by id) that is
   missing from every collection, never deletes, never duplicates. Saves the current data first. */
app.post("/api/_import_full", (req, res) => {
  if (!ownerFromReq(req)) return res.status(403).json({ error: "owner only" });
  const b = req.body || {};
  if (!Array.isArray(b.users) || !Array.isArray(b.facilities)) return res.status(400).json({ error: "That does not look like a full backup file (missing users/facilities)." });
  try { fs.copyFileSync(DATA_FILE, DATA_FILE + ".pre-restore." + Date.now()); } catch (e) {}
  const added = {};
  const mergeById = (key) => {
    if (!Array.isArray(b[key])) return;
    if (!Array.isArray(db[key])) db[key] = [];
    const have = new Set(db[key].map((x) => x && x.id));
    let c = 0;
    b[key].forEach((x) => { if (x && x.id && !have.has(x.id)) { db[key].push(x); have.add(x.id); c++; } });
    added[key] = c;
  };
  ["users", "facilities", "leads", "submissions", "drafts", "reports", "payables", "expenses", "deposits", "reviews", "receipts", "invoices"].forEach(mergeById);
  if (typeof b.invoiceSeq === "number") db.invoiceSeq = Math.max(db.invoiceSeq || 0, b.invoiceSeq);
  if (b.billback) { let c = 0; Object.keys(b.billback).forEach((fid) => { if (!db.billback[fid]) { db.billback[fid] = b.billback[fid]; c++; } }); added.billback = c; }
  persist();
  res.json({ ok: true, added });
});
app.get("/recover", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>SiteCheck recovery</title>'
    + '<style>body{font-family:system-ui,Arial,sans-serif;max-width:640px;margin:30px auto;padding:0 16px;color:#1f2933}h2{margin-top:28px}button{font-size:16px;padding:10px 16px;border-radius:8px;border:1px solid #16505b;background:#16505b;color:#fff;cursor:pointer}button.sec{background:#fff;color:#16505b}.box{border:1px solid #dfe3e8;border-radius:10px;padding:16px;margin-top:10px}#log{white-space:pre-wrap;background:#f6f8fa;border-radius:8px;padding:12px;margin-top:12px;font-size:14px}.warn{color:#b23b2e}</style>'
    + '<h1>SiteCheck data recovery</h1><p>You must already be logged in to the app in this browser for this page to work.</p>'
    + '<div class="box"><h2>Step A \u2014 Export (save a copy)</h2><p>Downloads the invoices, deposits, expenses and bill-back that are in the app <b>right now</b> as a file on your computer.</p><button onclick="doExport()">Download financial backup</button> <button class="sec" onclick="doFull()">Download FULL backup (everything)</button></div>'
    + '<div class="box"><h2>Step B \u2014 Import (merge a copy back in)</h2><p class="warn">Only use this after you have a backup file to restore from. It adds any invoices/deposits/expenses that are missing and never deletes or duplicates.</p><input type="file" id="f" accept="application/json"><br><br><button class="sec" onclick="doImport()">Merge financial data only</button> <button onclick="doImportFull()">Merge EVERYTHING from a FULL backup</button></div>'
    + '<div id="log"></div>'
    + '<script>'
    + 'var t=null;try{t=localStorage.getItem("sc_token");}catch(e){}'
    + 'function log(m){document.getElementById("log").textContent+=m+"\\n";}'
    + 'if(!t){log("Not logged in. Open the app, sign in as the owner, then come back to this page.");}'
    + 'function doExport(){if(!t){log("Please log in first.");return;}log("Exporting...");fetch("/api/_export",{headers:{Authorization:"Bearer "+t}}).then(function(r){if(!r.ok)throw new Error("export failed ("+r.status+")");return r.blob();}).then(function(b){var u=URL.createObjectURL(b);var a=document.createElement("a");a.href=u;a.download="sitecheck-financial-backup.json";a.click();log("Downloaded sitecheck-financial-backup.json. Keep it safe.");}).catch(function(e){log("Error: "+e.message);});}'
    + 'function doFull(){if(!t){log("Please log in first.");return;}log("Exporting full backup...");fetch("/api/_export_full",{headers:{Authorization:"Bearer "+t}}).then(function(r){if(!r.ok)throw new Error("export failed ("+r.status+")");return r.blob();}).then(function(b){var u=URL.createObjectURL(b);var a=document.createElement("a");a.href=u;a.download="sitecheck-FULL-backup.json";a.click();log("Downloaded sitecheck-FULL-backup.json (complete copy). Keep it safe.");}).catch(function(e){log("Error: "+e.message);});}'
    + 'function doImport(){if(!t){log("Please log in first.");return;}var f=document.getElementById("f").files[0];if(!f){log("Pick a backup file first.");return;}var rd=new FileReader();rd.onload=function(){var data;try{data=JSON.parse(rd.result);}catch(e){log("That file is not valid. "+e.message);return;}log("Importing...");fetch("/api/_import",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+t},body:JSON.stringify(data)}).then(function(r){return r.json();}).then(function(j){if(j.error){log("Error: "+j.error);return;}log("Done. Added "+j.added.invoices+" invoices, "+j.added.deposits+" deposits, "+j.added.expenses+" expenses, "+j.added.billback+" bill-back configs. Reload the app to see them.");}).catch(function(e){log("Error: "+e.message);});};rd.readAsText(f);}'
    + 'function doImportFull(){if(!t){log("Please log in first.");return;}var f=document.getElementById("f").files[0];if(!f){log("Pick a FULL backup file first.");return;}if(!confirm("Merge EVERYTHING from this full backup into the current data? It adds anything missing and deletes nothing. Your current data is saved first.")){return;}var rd=new FileReader();rd.onload=function(){var data;try{data=JSON.parse(rd.result);}catch(e){log("That file is not valid. "+e.message);return;}log("Merging full backup...");fetch("/api/_import_full",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+t},body:JSON.stringify(data)}).then(function(r){return r.json();}).then(function(j){if(j.error){log("Error: "+j.error);return;}var a=j.added;log("Done. Added — "+Object.keys(a).map(function(k){return a[k]+" "+k;}).join(", ")+". Reload the app to see everything.");}).catch(function(e){log("Error: "+e.message);});};rd.readAsText(f);}'
    + '</script>');
});


/* auth */
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const u = db.users.find((x) => x.username.toLowerCase() === String(username || "").toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ""), u.passwordHash))
    return res.status(401).json({ error: "Wrong username or password." });
  const token = jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: publicUser(u) });
});
app.get("/api/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));

/* facilities — scoped by role, sensitive sections stripped */
app.get("/api/facilities", auth, (req, res) => {
  if (isAdminRole(req.user.role)) return res.json(db.facilities.map((f) => sanitizeFacility(f, req.user.role)));
  if (req.user.role === "employee") return res.json(db.facilities.map((f) => sanitizeFacility(f, "employee")));
  const a = req.user.assignments || [];
  const scoped = db.facilities
    .filter((f) => a.some((x) => x.facilityId === f.id))
    .map((f) => ({ ...sanitizeFacility(f, "worker"), checkInDay: (a.find((x) => x.facilityId === f.id) || {}).checkInDay }));
  res.json(scoped);
});
app.post("/api/facilities", auth, adminOrAbove, (req, res) => {
  const f = { id: uid(), name: req.body.name || "New facility", address: req.body.address || "",
    config: { updatedAt: Date.now(), setupAt: Date.now(), weeklyTasks: [], lockoutAdd: [], lockoutRemove: [], lockoutKeep: [], maintenance: [], vacated: [], vacant: [], units: [], auction: [] } };
  db.facilities.push(f); persist(); res.json(sanitizeFacility(f, req.user.role));
});
app.put("/api/facilities/:id", auth, canEditFacility, (req, res) => {
  const f = db.facilities.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "Facility not found." });
  if (typeof req.body.name === "string") f.name = req.body.name;
  if (typeof req.body.address === "string") f.address = req.body.address;
  if (req.body.config) {
    let incoming = req.body.config;
    if (Array.isArray(incoming.facilityPhotos)) {
      incoming = { ...incoming, facilityPhotos: incoming.facilityPhotos.map((p) => { if (p && isDataUri(p.url)) { const b = saveBlob(p.url); if (b) return { id: p.id || uid(), blob: b }; } return p; }) };
      // delete blob files for photos removed in this save
      const keep = new Set(incoming.facilityPhotos.map((p) => p && p.blob).filter(Boolean));
      (f.config.facilityPhotos || []).forEach((p) => { if (p && p.blob && !keep.has(p.blob)) deleteBlob(p.blob); });
    }
    // only super admins may change the finance section; preserve it for everyone else
    if (req.user.role !== "superadmin") incoming = { ...incoming, finance: f.config.finance };
    f.config = { ...f.config, ...incoming };
  }
  if (req.body.submit === true) f.config.updatedAt = Date.now(); // date techs see only moves on explicit submit
  persist(); res.json(sanitizeFacility(f, req.user.role));
});
app.delete("/api/facilities/:id", auth, adminOrAbove, (req, res) => {
  db.facilities = db.facilities.filter((x) => x.id !== req.params.id);
  db.users.forEach((u) => { if (u.assignments) u.assignments = u.assignments.filter((a) => a.facilityId !== req.params.id); });
  persist(); res.json({ ok: true });
});

/* users — admin or above; super-admin accounts protected */
app.get("/api/users", auth, adminOrAbove, (req, res) => res.json(db.users.map(publicUser)));
app.post("/api/users", auth, adminOrAbove, (req, res) => {
  const { role, name, username, password, assignments } = req.body || {};
  if (!username) return res.status(400).json({ error: "Username is required." });
  if (usernameTaken(username)) return res.status(409).json({ error: "That username is already taken." });
  let newRole = role === "admin" ? "admin" : role === "superadmin" ? "superadmin" : role === "employee" ? "employee" : "worker";
  if (newRole === "superadmin" && req.user.role !== "superadmin")
    return res.status(403).json({ error: "Only a super admin can create a super admin." });
  const u = { id: uid(), role: newRole, name: name || "New person",
    username, passwordHash: bcrypt.hashSync(String(password || "changeme"), 10) };
  if (u.role === "worker") u.assignments = Array.isArray(assignments) ? assignments : [];
  db.users.push(u); persist(); res.json(publicUser(u));
});
app.put("/api/users/:id", auth, adminOrAbove, (req, res) => {
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: "User not found." });
  if (u.role === "superadmin" && req.user.role !== "superadmin")
    return res.status(403).json({ error: "Only a super admin can edit a super admin." });
  const { name, username, password, role, assignments } = req.body || {};
  if (typeof username === "string" && username) {
    if (usernameTaken(username, u.id)) return res.status(409).json({ error: "That username is already taken." });
    u.username = username;
  }
  if (typeof name === "string") u.name = name;
  if (typeof password === "string" && password.length) u.passwordHash = bcrypt.hashSync(password, 10);
  if (typeof role === "string" && role && role !== u.role) {
    if ((role === "superadmin" || u.role === "superadmin") && req.user.role !== "superadmin")
      return res.status(403).json({ error: "Only a super admin can grant or change super-admin access." });
    if (u.role === "superadmin" && role !== "superadmin" && superadmins().length <= 1)
      return res.status(400).json({ error: "There must be at least one super admin." });
    u.role = role === "admin" ? "admin" : role === "superadmin" ? "superadmin" : role === "employee" ? "employee" : "worker";
    if (u.role !== "worker") delete u.assignments;
    else if (!u.assignments) u.assignments = [];
  }
  if (u.role === "worker" && Array.isArray(assignments)) u.assignments = assignments;
  persist(); res.json(publicUser(u));
});
app.delete("/api/users/:id", auth, adminOrAbove, (req, res) => {
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: "User not found." });
  if (u.id === req.user.id) return res.status(400).json({ error: "You can't remove the account you're signed in with." });
  if (u.role === "superadmin" && req.user.role !== "superadmin") return res.status(403).json({ error: "Only a super admin can remove a super admin." });
  if (u.role === "superadmin" && superadmins().length <= 1) return res.status(400).json({ error: "You can't remove the only super admin." });
  db.users = db.users.filter((x) => x.id !== u.id);
  persist(); res.json({ ok: true });
});

/* submissions */
app.get("/api/facilities/:id/submissions", auth, adminOrAbove, (req, res) => {
  res.json(db.submissions.filter((s) => s.facilityId === req.params.id).sort((a, b) => b.submittedAt - a.submittedAt));
});
app.post("/api/submissions", auth, (req, res) => {
  const { facilityId, data } = req.body || {};
  const f = db.facilities.find((x) => x.id === facilityId);
  if (!f) return res.status(404).json({ error: "Facility not found." });
  if (req.user.role === "worker" && !(req.user.assignments || []).some((a) => a.facilityId === facilityId))
    return res.status(403).json({ error: "You're not assigned to this facility." });
  const record = { id: uid(), facilityId, workerName: req.user.name, submittedAt: Date.now(), data: data || {} };
  blobifyDeep(record.data);
  db.submissions.push(record); persist();
  res.json({ ok: true, id: record.id });
});
app.post("/api/submissions/:id/review", auth, adminOrAbove, (req, res) => {
  const s = db.submissions.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Report not found." });
  s.reviewed = true; s.reviewedAt = Date.now(); s.reviewedBy = req.user.name;
  persist(); res.json({ ok: true, reviewedAt: s.reviewedAt, reviewedBy: s.reviewedBy });
});

/* drafts — a worker's in-progress report, saved so they can step away and resume */
app.get("/api/drafts", auth, (req, res) => res.json(db.drafts.filter((d) => d.userId === req.user.id).map((d) => ({ facilityId: d.facilityId, savedAt: d.savedAt, step: d.step }))));
app.get("/api/drafts/:facilityId", auth, (req, res) => { const d = db.drafts.find((x) => x.userId === req.user.id && x.facilityId === req.params.facilityId); res.json(d ? { data: d.data, step: d.step, savedAt: d.savedAt } : null); });
app.put("/api/drafts/:facilityId", auth, (req, res) => {
  let d = db.drafts.find((x) => x.userId === req.user.id && x.facilityId === req.params.facilityId);
  if (!d) { d = { userId: req.user.id, facilityId: req.params.facilityId }; db.drafts.push(d); }
  d.data = req.body.data || {}; blobifyDeep(d.data); d.step = req.body.step || 0; d.savedAt = Date.now();
  persist(); res.json({ ok: true, savedAt: d.savedAt });
});
app.delete("/api/drafts/:facilityId", auth, (req, res) => { db.drafts = db.drafts.filter((x) => !(x.userId === req.user.id && x.facilityId === req.params.facilityId)); persist(); res.json({ ok: true }); });

/* report requests — admin sends a report to be filled out; the facility's techs fill it in */
app.get("/api/reports", auth, adminOrAbove, (req, res) => res.json(db.reports.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
app.post("/api/reports", auth, adminOrAbove, (req, res) => {
  const f = db.facilities.find((x) => x.id === req.body.facilityId);
  if (!f) return res.status(400).json({ error: "Pick a facility." });
  const type = req.body.type === "audit" ? "audit" : "standard";
  const r = { id: uid(), facilityId: f.id, note: req.body.note || "", type: type, status: "outstanding", createdAt: Date.now(), createdBy: req.user.name };
  db.reports.push(r);
  f.config.updatedAt = Date.now(); // the "form updated" date techs see reflects the latest report sent
  if (type === "audit") f.config.lastAuditAt = Date.now(); // sending the audit clears the "due" prompt for this month
  persist(); res.json(r);
});
app.post("/api/facilities/:id/audit-done", auth, adminOrAbove, (req, res) => {
  const f = db.facilities.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "Facility not found." });
  f.config.lastAuditAt = Date.now(); persist(); res.json({ ok: true, lastAuditAt: f.config.lastAuditAt });
});
app.put("/api/reports/:id", auth, adminOrAbove, (req, res) => {
  const r = db.reports.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found." });
  if (typeof req.body.note === "string") r.note = req.body.note;
  if (req.body.facilityId && db.facilities.some((f) => f.id === req.body.facilityId)) r.facilityId = req.body.facilityId;
  persist(); res.json(r);
});
app.delete("/api/reports/:id", auth, adminOrAbove, (req, res) => { db.reports = db.reports.filter((x) => x.id !== req.params.id); persist(); res.json({ ok: true }); });
app.post("/api/reports/:id/review", auth, adminOrAbove, (req, res) => {
  const r = db.reports.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found." });
  r.reviewed = true; r.reviewedAt = Date.now(); r.reviewedBy = req.user.name;
  persist(); res.json({ ok: true, reviewedAt: r.reviewedAt, reviewedBy: r.reviewedBy });
});
/* worker: outstanding reports for the facilities I'm assigned to */
app.get("/api/reports/mine", auth, (req, res) => {
  const mine = (req.user.assignments || []).map((a) => a.facilityId);
  res.json(db.reports.filter((r) => r.status === "outstanding" && mine.includes(r.facilityId)).map((r) => {
    const f = db.facilities.find((x) => x.id === r.facilityId);
    return { id: r.id, facilityId: r.facilityId, facilityName: f ? f.name : "Facility", note: r.note, type: r.type || "standard", createdAt: r.createdAt };
  }));
});
app.post("/api/reports/:id/submit", auth, (req, res) => {
  const r = db.reports.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found." });
  const assigned = (req.user.assignments || []).some((a) => a.facilityId === r.facilityId);
  if (req.user.role === "worker" && !assigned) return res.status(403).json({ error: "This report isn't assigned to you." });
  r.status = "completed"; r.data = req.body.data || {}; r.submittedAt = Date.now(); r.workerName = req.user.name;
  if (r.type === "audit") { const f = db.facilities.find((x) => x.id === r.facilityId); if (f) f.config.lastAuditAt = Date.now(); }
  persist(); res.json({ ok: true });
});

/* ---------------- lead tracking ---------------- */
const HOUR = 3600000, DAY = 86400000;
const FU_LABEL = { initial4h: "First follow-up (4 hours after lead)", after1day: "Follow-up (1 day later)", day1: "Follow-up (1 day later)", week1: "Follow-up (1 week later)", week2: "Follow-up (2 weeks later)", month1: "Follow-up (1 month later)", preMoveIn: "Day before move-in", moveInDay: "Move-in day", postMoveIn: "Day after move-in", twoWeek: "Two weeks after move-in" };
function moveInMs(lead) { return !lead.moveInUnknown && lead.estMoveIn ? Date.parse(lead.estMoveIn + "T12:00:00") : null; }
const STEP_FOR = { h4: "initial4h", d1: "after1day", w1: "week1", m1: "month1", preMoveIn: "preMoveIn", moveInDay: "moveInDay" };
function fuTargetMs(key, lead, base) {
  const mi = moveInMs(lead);
  if (key === "h4") return base + 4 * HOUR;
  if (key === "d1") return base + DAY;
  if (key === "w1") return base + 7 * DAY;
  if (key === "m1") return base + 30 * DAY;
  if (key === "preMoveIn") return mi ? mi - DAY : null;
  if (key === "moveInDay") return mi ? mi : null;
  return null;
}
function buildFollowups(lead) {
  if (lead.status !== "warm") return [];
  const now = lead.createdAt;
  const mi = moveInMs(lead);
  let fus = [];
  const skip4h = lead.kind === "reservation" && lead.gotAhold; // reached customer on a reservation: drop the 4-hour check
  if (!skip4h) fus.push({ id: uid(), step: "initial4h", dueAt: now + 4 * HOUR, completed: false });
  if (mi) {
    fus.push({ id: uid(), step: "after1day", dueAt: now + 4 * HOUR + DAY, completed: false }); // 1 day after the first follow-up
    const skipWin = now + 28 * HOUR;
    if (mi - DAY > now && mi - DAY > skipWin) fus.push({ id: uid(), step: "preMoveIn", dueAt: mi - DAY, completed: false });
    if (mi > now && mi > skipWin) fus.push({ id: uid(), step: "moveInDay", dueAt: mi, completed: false });
    if (mi + DAY > now) fus.push({ id: uid(), step: "postMoveIn", dueAt: mi + DAY, completed: false });
    if (mi + 14 * DAY > now) fus.push({ id: uid(), step: "twoWeek", dueAt: mi + 14 * DAY, completed: false });
  } else {
    fus.push({ id: uid(), step: "day1", dueAt: now + DAY, completed: false });
    fus.push({ id: uid(), step: "week1", dueAt: now + 7 * DAY, completed: false });
    fus.push({ id: uid(), step: "week2", dueAt: now + 14 * DAY, completed: false });
    fus.push({ id: uid(), step: "month1", dueAt: now + 30 * DAY, completed: false });
  }
  if (lead.confirmedMoveIn && mi) { // customer confirmed they'll pay on move-in day: next touch is move-in day
    fus = fus.filter((x) => ["moveInDay", "postMoveIn", "twoWeek"].includes(x.step));
    if (!fus.some((x) => x.step === "moveInDay") && mi > now) fus.push({ id: uid(), step: "moveInDay", dueAt: mi, completed: false });
  } else if (lead.firstFollowup) { // employee chose a later starting point: drop earlier follow-ups, keep the rest
    const t = fuTargetMs(lead.firstFollowup, lead, now);
    if (t) {
      fus = fus.filter((x) => x.dueAt >= t);
      const step = STEP_FOR[lead.firstFollowup];
      if (step && !fus.some((x) => x.step === step)) fus.push({ id: uid(), step, dueAt: t, completed: false });
    }
  }
  return fus;
}
function applyFollowup(lead, fu, form, userName) {
  fu.completed = true; fu.completedAt = Date.now(); fu.form = form || {};
  if (form && form.notInterested) {
    lead.status = "cold";
    lead.followups.forEach((x) => { if (!x.completed) x.cancelled = true; });
  } else if (form && form.movedIn) {
    lead.status = "rented";
    if (form.moveInUnit) lead.moveInUnit = form.moveInUnit;
    if (form.custName && lead.nameUnknown) { lead.name = form.custName; lead.nameUnknown = false; }
    if (!lead.movedInAt) { lead.movedInAt = Date.now(); lead.movedInBy = userName || lead.createdBy || ""; }
    lead.followups.forEach((x) => { if (!x.completed && (x.step === "initial4h" || x.step === "after1day" || x.step === "preMoveIn" || x.step === "moveInDay")) x.cancelled = true; });
  } else if (form && form.nextFollowup) {
    const t = fuTargetMs(form.nextFollowup, lead, Date.now());
    if (t) {
      lead.followups.forEach((x) => { if (!x.completed && x.dueAt < t) x.cancelled = true; });
      const step = STEP_FOR[form.nextFollowup];
      if (step && !lead.followups.some((x) => x.step === step && !x.completed && !x.cancelled)) lead.followups.push({ id: uid(), step, dueAt: t, completed: false });
    }
  } else if (form && form.confirmedMoveIn && moveInMs(lead)) {
    const mi = moveInMs(lead);
    lead.followups.forEach((x) => { if (!x.completed && !["moveInDay", "postMoveIn", "twoWeek"].includes(x.step)) x.cancelled = true; });
    if (!lead.followups.some((x) => x.step === "moveInDay" && !x.cancelled) && mi > Date.now()) lead.followups.push({ id: uid(), step: "moveInDay", dueAt: mi, completed: false });
  } else if (fu.step === "initial4h" && lead.status === "warm" && moveInMs(lead)) {
    if (!lead.followups.some((x) => x.step === "after1day")) lead.followups.push({ id: uid(), step: "after1day", dueAt: fu.completedAt + DAY, completed: false });
  }
  const remaining = lead.followups.filter((x) => !x.completed && !x.cancelled);
  if (!remaining.length && lead.status !== "rented") lead.status = "cold";
}
const leadOut = (l) => ({ ...l, followups: (l.followups || []).map((f) => ({ ...f, label: FU_LABEL[f.step] || "Follow-up" })) });

app.get("/api/leads", auth, staffOrAbove, (req, res) => res.json(db.leads.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(leadOut)));
app.post("/api/leads", auth, staffOrAbove, (req, res) => {
  const b = req.body || {};
  const lead = {
    id: uid(), kind: b.kind === "reservation" ? "reservation" : "lead",
    inCubby: !!b.inCubby, spareFoot: !!b.spareFoot, informedDiscounts: !!b.informedDiscounts, gotAhold: !!b.gotAhold, confirmedMoveIn: !!b.confirmedMoveIn,
    name: b.name || "", nameUnknown: !!b.nameUnknown,
    estMoveIn: b.estMoveIn || "", moveInUnknown: !!b.moveInUnknown,
    facilityId: b.facilityId || "", phone: b.phone || "", phone2: b.phone2 || "", email: b.email || "",
    status: ["warm", "rented", "cold"].includes(b.status) ? b.status : "warm",
    notes: b.notes || "", moveInUnit: b.moveInUnit || "", unitSize: b.unitSize || "", sizeUnknown: !!b.sizeUnknown, firstFollowup: b.firstFollowup || "", firstFollowupReason: b.firstFollowupReason || "", createdAt: Date.now(), createdBy: req.user.name, followups: [],
  };
  if (lead.status === "rented") { lead.movedInAt = Date.now(); lead.movedInBy = req.user.name; }
  lead.followups = buildFollowups(lead);
  db.leads.push(lead); persist(); res.json(leadOut(lead));
});
app.put("/api/leads/:id", auth, staffOrAbove, (req, res) => {
  const l = db.leads.find((x) => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: "Lead not found." });
  ["name", "estMoveIn", "facilityId", "phone", "phone2", "email", "notes", "moveInUnit", "unitSize"].forEach((k) => { if (typeof req.body[k] === "string") l[k] = req.body[k]; });
  ["inCubby", "spareFoot", "informedDiscounts", "nameUnknown", "moveInUnknown", "sizeUnknown", "gotAhold", "confirmedMoveIn"].forEach((k) => { if (typeof req.body[k] === "boolean") l[k] = req.body[k]; });
  if (["warm", "rented", "cold"].includes(req.body.status)) { l.status = req.body.status; if (l.status === "rented" && !l.movedInAt) { l.movedInAt = Date.now(); l.movedInBy = req.user.name; } }
  persist(); res.json(leadOut(l));
});
app.delete("/api/leads/:id", auth, staffOrAbove, (req, res) => { db.leads = db.leads.filter((x) => x.id !== req.params.id); persist(); res.json({ ok: true }); });

/* ---------------- payables / invoices ---------------- */
/* Admins can submit a new payable; only super admins can view/approve/manage. */
app.get("/api/payables", auth, superAdmin, (req, res) => res.json(db.payables.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
app.post("/api/payables", auth, adminOrAbove, (req, res) => {
  const b = req.body || {};
  const invoiceBlob = isDataUri(b.invoice) ? saveBlob(b.invoice) : null;
  const p = { id: uid(), createdAt: Date.now(), createdBy: req.user.name,
    facilityId: b.facilityId || "", who: b.who === "Sub contractor" ? "Sub contractor" : "On-site maintenance",
    contractorName: b.contractorName || "", description: b.description || "", amount: b.amount || "",
    cycleDate: b.cycleDate || "", mailingAddress: b.mailingAddress || "", invoiceBlob: invoiceBlob, invoiceName: b.invoiceName || "",
    status: "pending", billedBack: false };
  db.payables.push(p); persist(); res.json(p);
});
app.put("/api/payables/:id", auth, superAdmin, (req, res) => {
  const p = db.payables.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Not found." });
  ["facilityId", "who", "contractorName", "description", "amount", "cycleDate", "mailingAddress", "invoiceName"].forEach((k) => { if (typeof req.body[k] === "string") p[k] = req.body[k]; });
  if (isDataUri(req.body.invoice)) { if (p.invoiceBlob) deleteBlob(p.invoiceBlob); p.invoiceBlob = saveBlob(req.body.invoice); }
  else if (req.body.invoice === null) { if (p.invoiceBlob) deleteBlob(p.invoiceBlob); p.invoiceBlob = null; }
  if (["pending", "approved", "rejected"].includes(req.body.status)) { p.status = req.body.status; p.decidedAt = Date.now(); p.decidedBy = req.user.name;
    if (p.status === "approved" && p.invoiceBlob && !p.receiptId) { const rc = { id: uid(), createdAt: Date.now(), name: p.invoiceName || ("Invoice — " + (p.contractorName || "payable")), blob: p.invoiceBlob, facilityId: p.facilityId || "", source: "", fromPayableId: p.id }; db.receipts.push(rc); p.receiptId = rc.id; }
  }
  if (typeof req.body.billedBack === "boolean") { p.billedBack = req.body.billedBack; if (p.billedBack) p.billedBackAt = Date.now(); }
  persist(); res.json(p);
});
app.delete("/api/payables/:id", auth, superAdmin, (req, res) => { db.payables = db.payables.filter((x) => x.id !== req.params.id); persist(); res.json({ ok: true }); });

app.get("/api/recurring", auth, superAdmin, (req, res) => res.json(db.recurring.slice()));
app.post("/api/recurring", auth, superAdmin, (req, res) => {
  const b = req.body || {};
  const r = { id: uid(), facilityId: b.facilityId || "", name: b.name || "", amount: b.amount || "", occurrence: b.occurrence || "", lastPaidDate: b.lastPaidDate || "" };
  db.recurring.push(r); persist(); res.json(r);
});
app.put("/api/recurring/:id", auth, superAdmin, (req, res) => {
  const r = db.recurring.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: "Not found." });
  ["facilityId", "name", "amount", "occurrence", "lastPaidDate"].forEach((k) => { if (typeof req.body[k] === "string") r[k] = req.body[k]; });
  persist(); res.json(r);
});
app.delete("/api/recurring/:id", auth, superAdmin, (req, res) => { db.recurring = db.recurring.filter((x) => x.id !== req.params.id); persist(); res.json({ ok: true }); });

/* manual expenses (facility-tied or general) */
app.get("/api/expenses", auth, superAdmin, (req, res) => res.json(db.expenses.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
app.post("/api/expenses", auth, superAdmin, (req, res) => {
  const b = req.body || {};
  const e = { id: uid(), createdAt: Date.now(), createdBy: req.user.name,
    facilityId: b.facilityId || "", amount: b.amount || "",
    source: b.source === "Other" ? "Other" : "American Express", sourceOther: b.sourceOther || "",
    description: b.description || "", datePaid: b.datePaid || "", billedBack: false };
  db.expenses.push(e); persist(); res.json(e);
});
app.put("/api/expenses/:id", auth, superAdmin, (req, res) => {
  const e = db.expenses.find((x) => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: "Not found." });
  ["facilityId", "amount", "source", "sourceOther", "description", "datePaid"].forEach((k) => { if (typeof req.body[k] === "string") e[k] = req.body[k]; });
  if (typeof req.body.billedBack === "boolean") { e.billedBack = req.body.billedBack; if (e.billedBack) e.billedBackAt = Date.now(); }
  persist(); res.json(e);
});
app.delete("/api/expenses/:id", auth, superAdmin, (req, res) => { db.expenses = db.expenses.filter((x) => x.id !== req.params.id); persist(); res.json({ ok: true }); });

/* per-facility management-fee / software bill-back configuration */
app.get("/api/billback", auth, superAdmin, (req, res) => res.json(db.billback || {}));
app.put("/api/billback/:fid", auth, superAdmin, (req, res) => {
  const b = req.body || {};
  db.billback[req.params.fid] = {
    units: b.units || "", mgmtRate: b.mgmtRate || "", softwareRate: b.softwareRate || "", onsiteFee: b.onsiteFee || "",
    otherFees: Array.isArray(b.otherFees) ? b.otherFees : [],
    entityName: b.entityName || "", entityAddress: b.entityAddress || "",
  };
  persist(); res.json(db.billback[req.params.fid]);
});

/* invoices (bill-back) */
app.get("/api/invoices", auth, superAdmin, (req, res) => res.json(db.invoices.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
app.post("/api/invoices", auth, superAdmin, (req, res) => {
  const b = req.body || {};
  db.invoiceSeq = (db.invoiceSeq || 0) + 1;
  const number = "CR-" + String(db.invoiceSeq).padStart(5, "0");
  const inv = { id: uid(), number: number, createdAt: Date.now(), createdBy: req.user.name,
    facilityId: b.facilityId || "", months: Array.isArray(b.months) ? b.months : [],
    lineItems: Array.isArray(b.lineItems) ? b.lineItems : [], total: b.total || 0, status: "open",
    entityName: b.entityName || "Copper River LLC", entityAddress: b.entityAddress || "P.O. Box 568, Augusta, KS 67010" };
  db.invoices.push(inv);
  (b.expenseIds || []).forEach((id) => { const e = db.expenses.find((x) => x.id === id); if (e) { e.billedBack = true; e.billedBackAt = Date.now(); e.invoiceNumber = number; } });
  (b.payableIds || []).forEach((id) => { const p = db.payables.find((x) => x.id === id); if (p) { p.billedBack = true; p.billedBackAt = Date.now(); p.invoiceNumber = number; } });
  persist(); res.json(inv);
});
app.put("/api/invoices/:id", auth, superAdmin, (req, res) => {
  const inv = db.invoices.find((x) => x.id === req.params.id);
  if (!inv) return res.status(404).json({ error: "Not found." });
  if (["open", "paid"].includes(req.body.status)) { inv.status = req.body.status; inv.paidAt = req.body.status === "paid" ? Date.now() : null; }
  persist(); res.json(inv);
});
app.delete("/api/invoices/:id", auth, superAdmin, (req, res) => { db.invoices = db.invoices.filter((x) => x.id !== req.params.id); persist(); res.json({ ok: true }); });

/* check tracking / deposits (admins and super admins) */
app.get("/api/deposits", auth, adminOrAbove, (req, res) => res.json(db.deposits.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
app.post("/api/deposits", auth, adminOrAbove, (req, res) => {
  const b = req.body || {};
  const entries = (Array.isArray(b.entries) ? b.entries : []).map((e) => ({
    id: uid(), facilityId: e.facilityId || "", forWhat: e.forWhat || "", customer: e.customer || "",
    type: e.type === "MO" ? "MO" : "CK", checkNo: e.checkNo || "", amount: e.amount || "",
  }));
  const dep = { id: uid(), createdAt: Date.now(), createdBy: req.user.name, entries: entries,
    totalAddsUp: !!b.totalAddsUp, cubbyInput: !!b.cubbyInput, settled: false };
  db.deposits.push(dep); persist(); res.json(dep);
});
app.put("/api/deposits/:id", auth, adminOrAbove, (req, res) => {
  const dep = db.deposits.find((x) => x.id === req.params.id);
  if (!dep) return res.status(404).json({ error: "Not found." });
  if (typeof req.body.settled === "boolean") { dep.settled = req.body.settled; dep.settledAt = req.body.settled ? Date.now() : null; }
  persist(); res.json(dep);
});
app.delete("/api/deposits/:id", auth, adminOrAbove, (req, res) => { db.deposits = db.deposits.filter((x) => x.id !== req.params.id); persist(); res.json({ ok: true }); });

/* google reviews (staff can log; feeds the move-in tracker) */
app.get("/api/reviews", auth, staffOrAbove, (req, res) => res.json(db.reviews.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
app.post("/api/reviews", auth, staffOrAbove, (req, res) => {
  const b = req.body || {};
  const rv = { id: uid(), createdAt: Date.now(), createdBy: req.user.name, customer: b.customer || "", facilityId: b.facilityId || "", employee: b.employee || "" };
  db.reviews.push(rv); persist(); res.json(rv);
});
app.delete("/api/reviews/:id", auth, staffOrAbove, (req, res) => { db.reviews = db.reviews.filter((x) => x.id !== req.params.id); persist(); res.json({ ok: true }); });

/* receipts / invoices bucket (super admins) */
app.get("/api/receipts", auth, superAdmin, (req, res) => res.json(db.receipts.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
app.post("/api/receipts", auth, superAdmin, (req, res) => {
  const b = req.body || {};
  const blob = isDataUri(b.file) ? saveBlob(b.file) : null;
  const rc = { id: uid(), createdAt: Date.now(), createdBy: req.user.name, name: b.name || "Receipt", blob: blob, facilityId: b.facilityId || "", source: b.source || "" };
  db.receipts.push(rc); persist(); res.json(rc);
});
app.delete("/api/receipts/:id", auth, superAdmin, (req, res) => { const r = db.receipts.find((x) => x.id === req.params.id); if (r && r.blob && !db.payables.some((p) => p.invoiceBlob === r.blob)) deleteBlob(r.blob); db.receipts = db.receipts.filter((x) => x.id !== req.params.id); persist(); res.json({ ok: true }); });
app.post("/api/leads/:id/followup/:fuId", auth, staffOrAbove, (req, res) => {
  const l = db.leads.find((x) => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: "Lead not found." });
  const fu = (l.followups || []).find((x) => x.id === req.params.fuId);
  if (!fu) return res.status(404).json({ error: "Follow-up not found." });
  applyFollowup(l, fu, req.body || {}, req.user.name);
  persist(); res.json(leadOut(l));
});

/* static UI */
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`SiteCheck running at http://localhost:${PORT}`));
