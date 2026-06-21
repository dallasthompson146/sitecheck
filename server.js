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
if (DATA_DIR !== __dirname && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (JWT_SECRET === "change-this-secret-before-going-live") console.warn("WARNING: JWT_SECRET is not set. Set it before real use — logins are not secure with the default.");

/* ---------------- tiny JSON datastore ---------------- */
const uid = () => Math.random().toString(36).slice(2, 10);
let db;
function persist() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

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
  };
}

if (fs.existsSync(DATA_FILE)) {
  db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
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
  db.facilities.forEach((f) => { if (!f.config) f.config = {}; if (!f.config.setupAt) f.config.setupAt = f.config.updatedAt || Date.now(); if (!Array.isArray(f.config.units)) f.config.units = []; });
} else {
  db = seed(); persist();
  console.log("Created data.json with demo accounts: owner/owner123 (super admin), manager/manager123 (admin), marcus/marcus123, dana/dana123 (workers).");
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
app.use(express.json({ limit: "30mb" })); // generous for base64 photos in submissions

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
  d.data = req.body.data || {}; d.step = req.body.step || 0; d.savedAt = Date.now();
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
function buildFollowups(lead) {
  if (lead.status !== "warm") return [];
  const now = lead.createdAt, fus = [{ id: uid(), step: "initial4h", dueAt: now + 4 * HOUR, completed: false }];
  const mi = moveInMs(lead);
  if (mi) {
    const skipWin = now + 28 * HOUR; // first-two follow-ups cover ~the next day
    if (mi - DAY > now && mi - DAY > skipWin) fus.push({ id: uid(), step: "preMoveIn", dueAt: mi - DAY, completed: false });
    if (mi > now && mi > skipWin) fus.push({ id: uid(), step: "moveInDay", dueAt: mi, completed: false });
    if (mi + DAY > now) fus.push({ id: uid(), step: "postMoveIn", dueAt: mi + DAY, completed: false });
    if (mi + 14 * DAY > now) fus.push({ id: uid(), step: "twoWeek", dueAt: mi + 14 * DAY, completed: false });
  } else {
    // no move-in date: fixed cadence from when the lead was taken
    fus.push({ id: uid(), step: "day1", dueAt: now + DAY, completed: false });
    fus.push({ id: uid(), step: "week1", dueAt: now + 7 * DAY, completed: false });
    fus.push({ id: uid(), step: "week2", dueAt: now + 14 * DAY, completed: false });
    fus.push({ id: uid(), step: "month1", dueAt: now + 30 * DAY, completed: false });
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
    inCubby: !!b.inCubby, spareFoot: !!b.spareFoot, informedDiscounts: !!b.informedDiscounts,
    name: b.name || "", nameUnknown: !!b.nameUnknown,
    estMoveIn: b.estMoveIn || "", moveInUnknown: !!b.moveInUnknown,
    facilityId: b.facilityId || "", phone: b.phone || "", phone2: b.phone2 || "", email: b.email || "",
    status: ["warm", "rented", "cold"].includes(b.status) ? b.status : "warm",
    notes: b.notes || "", moveInUnit: b.moveInUnit || "", createdAt: Date.now(), createdBy: req.user.name, followups: [],
  };
  if (lead.status === "rented") { lead.movedInAt = Date.now(); lead.movedInBy = req.user.name; }
  lead.followups = buildFollowups(lead);
  db.leads.push(lead); persist(); res.json(leadOut(lead));
});
app.put("/api/leads/:id", auth, staffOrAbove, (req, res) => {
  const l = db.leads.find((x) => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: "Lead not found." });
  ["name", "estMoveIn", "facilityId", "phone", "phone2", "email", "notes", "moveInUnit"].forEach((k) => { if (typeof req.body[k] === "string") l[k] = req.body[k]; });
  ["inCubby", "spareFoot", "informedDiscounts", "nameUnknown", "moveInUnknown"].forEach((k) => { if (typeof req.body[k] === "boolean") l[k] = req.body[k]; });
  if (["warm", "rented", "cold"].includes(req.body.status)) { l.status = req.body.status; if (l.status === "rented" && !l.movedInAt) { l.movedInAt = Date.now(); l.movedInBy = req.user.name; } }
  persist(); res.json(leadOut(l));
});
app.delete("/api/leads/:id", auth, staffOrAbove, (req, res) => { db.leads = db.leads.filter((x) => x.id !== req.params.id); persist(); res.json({ ok: true }); });

/* ---------------- payables / invoices ---------------- */
/* Admins can submit a new payable; only super admins can view/approve/manage. */
app.get("/api/payables", auth, superAdmin, (req, res) => res.json(db.payables.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
app.post("/api/payables", auth, adminOrAbove, (req, res) => {
  const b = req.body || {};
  const p = { id: uid(), createdAt: Date.now(), createdBy: req.user.name,
    facilityId: b.facilityId || "", who: b.who === "Sub contractor" ? "Sub contractor" : "On-site maintenance",
    contractorName: b.contractorName || "", description: b.description || "", amount: b.amount || "",
    cycleDate: b.cycleDate || "", mailingAddress: b.mailingAddress || "", invoice: b.invoice || null, invoiceName: b.invoiceName || "",
    status: "pending", billedBack: false };
  db.payables.push(p); persist(); res.json(p);
});
app.put("/api/payables/:id", auth, superAdmin, (req, res) => {
  const p = db.payables.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Not found." });
  ["facilityId", "who", "contractorName", "description", "amount", "cycleDate", "mailingAddress", "invoiceName"].forEach((k) => { if (typeof req.body[k] === "string") p[k] = req.body[k]; });
  if (typeof req.body.invoice === "string" || req.body.invoice === null) p.invoice = req.body.invoice;
  if (["pending", "approved", "rejected"].includes(req.body.status)) { p.status = req.body.status; p.decidedAt = Date.now(); p.decidedBy = req.user.name; }
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
    mgmtRate: b.mgmtRate || "", softwareRate: b.softwareRate || "", onsiteFee: b.onsiteFee || "",
    otherFees: Array.isArray(b.otherFees) ? b.otherFees : [],
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
    lineItems: Array.isArray(b.lineItems) ? b.lineItems : [], total: b.total || 0, status: "open" };
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
    type: e.type === "MO" ? "MO" : "CK", amount: e.amount || "",
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
