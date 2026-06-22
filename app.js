/* SiteCheck frontend — talks to the backend API. No build step. */
(function () {
  var app = document.getElementById("app");
  var topright = document.getElementById("topright");
  var TOKEN_KEY = "sc_token";
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var today = DAYS[new Date().getDay()];
  function stepsFor(f, type) {
    var s = [["Tasks", "clipboard-list"], ["Lockout", "lock"], ["Maintenance", "tool"], ["Vacated", "door"],
      ["Vacant", "key"]];
    if (type === "audit") s.push(["Occupied", "lock-check"]);
    s.push(["Auction", "gavel"], ["Grounds", "plant-2"]);
    if (f && f.config && f.config.climateControlled) s.push(["Climate", "temperature"]);
    s.push(["Review", "check"]);
    return s;
  }

  function occupiedUnits(cfg) { var vac = {}; (cfg.vacant || []).forEach(function (v) { vac[String(v.unit).trim()] = 1; }); return (cfg.units || []).filter(function (u) { return !vac[String(u.unit).trim()]; }); }

  var S = {
    auth: null, lu: "", lp: "", lerr: "",
    facilities: [], users: [], subs: [],
    tab: "facilities", editId: null, teamId: null, adminId: null, subsFid: null, subOpen: null, subStep: 0, secFac: null, openItem: null,
    fid: null, step: 0, resp: null, done: false, busy: false, tried: false, drafts: {}, savedAt: 0,
    reports: [], myReports: [], report: null, newReportFac: "", newReportNote: "",
    userId: null, leads: [], leadTab: "todo", leadOpen: null, leadAdd: false, leadDraft: {}, fuOpen: null, fuDraft: {},
    payables: [], recurring: [], paySub: "pending", payDraft: {}, recDraft: {},
    expenses: [], billback: {}, expDraft: {}, expAdd: false,
    invoices: [], invDraft: {},
    deposits: [], depDraft: { entries: [] }, depSub: "new", depStage: "entry", depOpen: null,
    reviews: [], reviewDraft: {}, reviewAdd: false, receipts: [],
    maintSub: "report", mtDraft: {}, infoMode: false, photoView: null,
  };
  var saveTimer = null, saveFn = null;

  /* ---------- helpers ---------- */
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function esc(s) { return (s == null ? "" : "" + s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function I(n) { return '<i class="ti ti-' + n + '"></i>'; }
  function fday(t) { return new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
  function fdt(t) { return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function token() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  function toast(msg) {
    var d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 3200);
  }

  function api(method, path, body) {
    var opts = { method: method, headers: {} };
    var t = token(); if (t) opts.headers.Authorization = "Bearer " + t;
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { if (r.status === 401) { setToken(null); S.auth = null; }
          throw new Error(j.error || ("Request failed (" + r.status + ")")); }
        return j;
      });
    });
  }

  function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; var f = saveFn; saveFn = null; if (f) f(); } }
  function saveSoon(fn) { saveFn = fn; if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(function () { saveTimer = null; var f = saveFn; saveFn = null; if (f) f(); }, 700); }

  function compress(file) {
    return new Promise(function (resolve) {
      var img = new Image(), rd = new FileReader();
      rd.onload = function (e) { img.src = e.target.result; };
      img.onload = function () {
        var max = 1800, w = img.width, h = img.height;
        if (w > h && w > max) { h = h * max / w; w = max; } else if (h > max) { w = w * max / h; h = max; }
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        var ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, 0, 0, w, h);
        resolve({ id: uid(), kind: "image", url: c.toDataURL("image/jpeg", 0.85) });
      };
      img.onerror = function () { resolve(null); };
      rd.readAsDataURL(file);
    });
  }

  /* ---------- data loading ---------- */
  function loadForRole() {
    if (S.auth.role === "admin" || S.auth.role === "superadmin") {
      var calls = [api("GET", "/api/facilities"), api("GET", "/api/users"), api("GET", "/api/reports"), api("GET", "/api/leads"), api("GET", "/api/deposits"), api("GET", "/api/reviews")];
      if (S.auth.role === "superadmin") calls.push(api("GET", "/api/payables"), api("GET", "/api/recurring"), api("GET", "/api/expenses"), api("GET", "/api/billback"), api("GET", "/api/invoices"), api("GET", "/api/receipts"));
      return Promise.all(calls).then(function (r) { S.facilities = r[0]; S.users = r[1]; S.reports = r[2]; S.leads = r[3]; S.deposits = r[4]; S.reviews = r[5]; if (r[6]) S.payables = r[6]; if (r[7]) S.recurring = r[7]; if (r[8]) S.expenses = r[8]; if (r[9]) S.billback = r[9]; if (r[10]) S.invoices = r[10]; if (r[11]) S.receipts = r[11]; });
    }
    if (S.auth.role === "employee") {
      return Promise.all([api("GET", "/api/facilities"), api("GET", "/api/leads"), api("GET", "/api/reviews")])
        .then(function (r) { S.facilities = r[0]; S.leads = r[1]; S.reviews = r[2]; });
    }
    return Promise.all([api("GET", "/api/facilities"), api("GET", "/api/reports/mine"), api("GET", "/api/drafts")])
      .then(function (r) { S.facilities = r[0]; S.myReports = r[1]; S.drafts = {}; (r[2] || []).forEach(function (d) { S.drafts[d.facilityId] = d; }); });
  }
  function reloadReports() { return api("GET", "/api/reports").then(function (r) { S.reports = r; }); }
  function reloadLeads() { return api("GET", "/api/leads").then(function (r) { S.leads = r; }); }
  function reloadPayables() { return api("GET", "/api/payables").then(function (r) { S.payables = r; }); }
  function reloadRecurring() { return api("GET", "/api/recurring").then(function (r) { S.recurring = r; }); }
  function reloadExpenses() { return api("GET", "/api/expenses").then(function (r) { S.expenses = r; }); }
  function reloadBillback() { return api("GET", "/api/billback").then(function (r) { S.billback = r; }); }
  function reloadInvoices() { return api("GET", "/api/invoices").then(function (r) { S.invoices = r; }); }
  function reloadDeposits() { return api("GET", "/api/deposits").then(function (r) { S.deposits = r; }); }
  function reloadReviews() { return api("GET", "/api/reviews").then(function (r) { S.reviews = r; }); }
  function reloadReceipts() { return api("GET", "/api/receipts").then(function (r) { S.receipts = r; }); }
  function reloadMine() { return api("GET", "/api/reports/mine").then(function (r) { S.myReports = r; }); }
  function boot() {
    if (!token()) { render(); return; }
    api("GET", "/api/me").then(function (r) { S.auth = r.user; return loadForRole(); })
      .then(render).catch(function () { S.auth = null; render(); });
  }

  /* ---------- views ---------- */
  function login() {
    return '<div class="login"><div class="login-head"><img src="data:image/png;base64,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" alt="" style="width:58px;height:58px;object-fit:contain"><h3>Storage Depot</h3><p class="hint" style="text-align:center;margin:0">Sign in to your portal</p></div>'
      + '<div class="card"><div class="label">Username</div><input id="lu" value="' + esc(S.lu) + '" autocomplete="off">'
      + '<div class="label">Password</div><input id="lp" type="password" value="' + esc(S.lp) + '" autocomplete="off">'
      + (S.lerr ? '<div class="errbar">' + I("alert-triangle") + " " + esc(S.lerr) + "</div>" : "")
      + '<button class="btn btn-dark" data-a="login" style="width:100%;margin-top:12px;justify-content:center">' + (S.busy ? '<span class="spin"></span> ' : "") + "Log in</button></div></div>";
  }

  function listEditor(arr, key, fields, addLabel) {
    return arr.map(function (it) {
      return '<div class="litem">' + fields.map(function (fl) {
        return fl.area
          ? '<textarea rows="2" style="flex:1" data-li="' + key + "." + it.id + "." + fl.k + '" placeholder="' + fl.ph + '">' + esc(it[fl.k] || "") + "</textarea>"
          : '<input ' + (fl.unit ? 'class="mono" style="max-width:120px"' : 'style="flex:1"') + ' data-li="' + key + "." + it.id + "." + fl.k + '" placeholder="' + fl.ph + '" value="' + esc(it[fl.k] || "") + '">';
      }).join("") + '<button class="icon-btn danger" data-a="ldel" data-k="' + key + '" data-id="' + it.id + '">' + I("trash") + "</button></div>";
    }).join("") + '<button class="addline" data-a="ladd" data-k="' + key + '">' + I("plus") + " " + addLabel + "</button>";
  }
  function grp(title, ico, inner) { return '<div class="card"><div class="row" style="font-weight:600;margin-bottom:10px">' + I(ico) + " " + title + "</div>" + inner + "</div>"; }
  function facilityEditor(f) {
    var view = S.facView || "sitecheck"; if (view === "info") view = "sitecheck";
    var nav = '<div class="tabs">' + [["sitecheck", "Site check"], ["audit", "Monthly audit"], ["reports", "Reports"]].map(function (t) { return '<button class="' + (view === t[0] ? "on" : "") + '" data-a="facview" data-k="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</div>";
    var body = view === "audit" ? facAudit(f) : view === "reports" ? facReports(f) : facSiteCheck(f);
    return '<button class="btn" data-a="backedit" style="margin-bottom:10px">' + I("arrow-left") + ' All facilities</button><h3 style="margin:0 0 2px">' + esc(f.name) + '</h3><div class="muted" style="margin-bottom:10px">' + esc(f.address || "No address yet") + "</div>" + nav + body;
  }
  function facPhotos(f, editable) {
    var photos = gA(f, "facilityPhotos");
    var thumbs = photos.map(function (p, i) { return '<span style="position:relative;display:inline-block;margin:4px 4px 0 0"><img src="' + esc(p.url) + '" data-a="facphotoview" data-fid="' + f.id + '" data-k="' + i + '" style="height:84px;border-radius:8px;border:1px solid var(--line);cursor:pointer;object-fit:cover">' + (editable ? '<button class="icon-btn danger" data-a="facphotodel" data-id="' + (p.id || ("idx" + i)) + '" data-k="' + i + '" style="position:absolute;top:-6px;right:-6px;padding:2px">' + I("x") + "</button>" : "") + "</span>"; }).join("");
    if (!editable && !photos.length) return "";
    return '<div class="card"><div class="dh">Facility photos</div><p class="hint" style="margin:4px 0 0">Tap a photo to view it full screen.</p><div class="row" style="flex-wrap:wrap;margin-top:6px">' + (thumbs || '<span class="muted" style="font-size:13px">No photos yet.</span>') + "</div>" + (editable ? '<label class="addph" style="display:inline-flex;margin-top:8px">' + I("plus") + 'Add photo<input type="file" accept="image/*" multiple style="display:none" data-facphoto></label>' : "") + "</div>";
  }
  function photoLightbox() {
    if (!S.photoView) return "";
    var f = S.facilities.find(function (x) { return x.id === S.photoView.fid; }); if (!f) return "";
    var photos = gA(f, "facilityPhotos"); if (!photos.length) return "";
    var i = Math.max(0, Math.min(S.photoView.idx || 0, photos.length - 1));
    var p = photos[i];
    return '<div class="lightbox" data-a="photoclose"><button class="lb-close" data-a="photoclose">' + I("x") + "</button>"
      + (photos.length > 1 ? '<button class="lb-nav lb-prev" data-a="photonav" data-d="-1">' + I("chevron-left") + "</button>" : "")
      + '<img src="' + esc(p.url) + '" class="lb-img" data-a="photonoop">'
      + (photos.length > 1 ? '<button class="lb-nav lb-next" data-a="photonav" data-d="1">' + I("chevron-right") + "</button>" : "")
      + '<div class="lb-count">' + (i + 1) + " / " + photos.length + "</div></div>";
  }
  function facInfo(f) {
    var c = f.config, ed = S.facEdit;
    var notes = Array.isArray(c.adminNotes) ? c.adminNotes : [];
    var notesCard = '<div class="card"><div class="row" style="justify-content:space-between"><div style="font-weight:600">' + I("notes") + ' Internal notes</div><button class="btn btn-dark sm" data-a="noteadd">' + I("plus") + ' Add note</button></div><p class="hint" style="margin:6px 0 0">Reminders for next time \u2014 only admins see these.</p>' + (notes.length ? '<div class="stack" style="margin-top:8px">' + notes.map(function (n) { return '<div class="litem"><textarea rows="2" style="flex:1" data-note="' + n.id + '">' + esc(n.text || "") + '</textarea><button class="icon-btn danger" data-a="notedel" data-id="' + n.id + '">' + I("trash") + "</button></div>"; }).join("") + "</div>" : '<div class="muted" style="font-size:13px;margin-top:8px">No notes yet.</div>') + "</div>";
    if (!ed) {
      var ro = function (label, val) { return '<div class="kv"><span style="color:#E0913C;font-weight:600">' + label + '</span><span style="color:var(--ink)">' + (val ? esc(val) : "\u2014") + "</span></div>"; };
      var yn = function (b) { return b ? "Yes" : "No"; };
      var listTxt = function (key, fld) { var a = gA(f, key); return a.length ? a.map(function (x) { return x[fld] || ""; }).filter(Boolean).join(", ") : "\u2014"; };
      var access = gA(f, "accessNotes"), biz = gA(f, "nearbyBiz");
      return '<div class="between" style="margin-top:12px"><h4 style="margin:0">Facility information</h4><button class="btn btn-dark sm" data-a="facedit">' + I("edit") + ' Edit</button></div><p class="hint" style="margin:4px 0 10px">Tap Edit to change anything \u2014 fields aren\u2019t editable by accident.</p>'
        + '<div class="card"><div class="dh">Contact</div>' + ro("Name", f.name) + ro("Address", f.address) + ro("Phone", c.phone) + ro("Email", c.email) + ro("Website", c.website) + ro("Secondary", c.secondary) + ro("Facebook", c.facebook) + ro("Instagram", c.instagram) + "</div>"
        + '<div class="card"><div class="dh">Access information</div>' + (access.length ? access.map(function (a) { return '<div class="dline"><b>' + esc(a.subject || "(no subject)") + "</b>" + (a.description ? '<div class="da">' + esc(a.description) + "</div>" : "") + "</div>"; }).join("") : '<div class="dline muted">None</div>') + "</div>"
        + '<div class="card"><div class="dh">Characteristics</div>' + ro("Facility color", c.facilityColor) + ro("Door color", c.doorColor) + ro("Outdoor boat &amp; RV storage", yn(c.outdoorRV)) + "</div>"
        + '<div class="card"><div class="dh">Geographic</div>' + ro("County", c.county) + ro("Nearby towns", listTxt("nearbyTowns", "name")) + ro("Nearby facilities we own", listTxt("nearbyOwned", "name")) + ro("Nearby roads", listTxt("nearbyRoads", "name")) + '<div class="da" style="font-weight:600;margin-top:6px">Nearby businesses</div>' + (biz.length ? biz.map(function (b) { return '<div class="dline">' + esc(b.name || "") + (b.description ? " \u2014 " + esc(b.description) : "") + "</div>"; }).join("") : '<div class="dline muted">None</div>') + "</div>"
        + '<div class="card"><div class="dh">Previous information</div>' + ro("Previous facility name", c.prevName) + ro("Previous owner", c.prevOwner) + ro("Previous owner phone", c.prevOwnerPhone) + ro("Non-storage activities", yn(c.nonStorage)) + (c.nonStorage && c.nonStorageDesc ? '<div class="da">' + esc(c.nonStorageDesc) + "</div>" : "") + "</div>"
        + facPhotos(f, false)
        + notesCard;
    }
    return '<div class="between" style="margin-top:12px"><h4 style="margin:0">Edit information</h4><button class="btn btn-ok sm" data-a="facdone">' + I("check") + ' Done</button></div><div class="stack" style="margin-top:8px">'
      + '<div class="card"><div class="dh">Contact</div><div class="label">Facility name</div><input data-fac="name" value="' + esc(f.name) + '"><div class="label">Address</div><input data-fac="address" value="' + esc(f.address || "") + '">' + tf(f, "Phone number", "phone") + tf(f, "Email", "email") + tf(f, "Website", "website") + tf(f, "Secondary", "secondary", "Secondary number / contact") + tf(f, "Facebook", "facebook") + tf(f, "Instagram", "instagram") + "</div>"
      + grp("Access information", "key", '<p class="hint" style="margin:0 0 8px">Add one or more notes, each with a subject and description.</p>' + listEditor(gA(f, "accessNotes"), "accessNotes", [{ k: "subject", ph: "Subject" }, { k: "description", ph: "Description", area: 1 }], "Add access note"))
      + '<div class="card"><div class="dh">Characteristics</div>' + tf(f, "Facility color", "facilityColor") + tf(f, "Door color", "doorColor") + togF(f, "Has outdoor boat &amp; RV storage", "outdoorRV") + "</div>"
      + '<div class="card"><div class="dh">Geographic</div>' + tf(f, "County", "county") + '<div class="label">Nearby towns</div>' + listEditor(gA(f, "nearbyTowns"), "nearbyTowns", [{ k: "name", ph: "Town" }], "Add town") + '<div class="label" style="margin-top:8px">Nearby facilities we own</div>' + listEditor(gA(f, "nearbyOwned"), "nearbyOwned", [{ k: "name", ph: "Facility name" }], "Add facility") + '<div class="label" style="margin-top:8px">Nearby roads</div>' + listEditor(gA(f, "nearbyRoads"), "nearbyRoads", [{ k: "name", ph: "Road" }], "Add road") + '<div class="label" style="margin-top:8px">Nearby businesses</div>' + listEditor(gA(f, "nearbyBiz"), "nearbyBiz", [{ k: "name", ph: "Business" }, { k: "description", ph: "What is it?", area: 1 }], "Add business") + "</div>"
      + '<div class="card"><div class="dh">Previous information</div>' + tf(f, "Previous storage facility name", "prevName") + tf(f, "Previous owner name", "prevOwner") + tf(f, "Previous owner phone", "prevOwnerPhone") + togF(f, "Had non-storage activities", "nonStorage") + (getPath(c, "nonStorage") ? taF(f, "Describe the non-storage activities", "nonStorageDesc") : "") + "</div>"
      + facPhotos(f, true) + notesCard + '<button class="btn btn-ok" data-a="facdone" style="width:100%;justify-content:center">' + I("check") + " Done editing</button></div>";
  }
  function setupSections(f) {
    return '<div class="card"><button class="check full' + (f.config.climateControlled ? " on" : "") + '" data-a="cctoggle"><span class="bx">' + (f.config.climateControlled ? I("check") : "") + '</span><span>This building is climate controlled<span class="muted" style="display:block;font-size:12px;font-weight:400">Adds the climate checks to this facility\'s check-in.</span></span></button></div>'
      + grp("Weekly tasks", "clipboard-list", listEditor(f.config.weeklyTasks, "weeklyTasks", [{ k: "text", ph: "Describe the task…", area: 1 }], "Add task"))
      + grp("Lockout — add a lock", "lock", listEditor(f.config.lockoutAdd, "lockoutAdd", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"))
      + grp("Lockout — remove a lock", "lock", listEditor(f.config.lockoutRemove, "lockoutRemove", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"))
      + grp("Lockout — leave in place", "lock", listEditor(f.config.lockoutKeep, "lockoutKeep", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"))
      + grp("Units needing maintenance", "tool", listEditor(f.config.maintenance, "maintenance", [{ k: "unit", ph: "Unit #", unit: 1 }, { k: "note", ph: "What needs doing…", area: 1 }], "Add unit"))
      + grp("Recently vacated units", "door", listEditor(f.config.vacated, "vacated", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"))
      + grp("Vacant units (no lock)", "key", listEditor(f.config.vacant, "vacant", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"))
      + grp("Units ready for auction", "gavel", listEditor(f.config.auction, "auction", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"));
  }
  function facSiteCheck(f) {
    return '<div class="stack" style="margin-top:12px">'
      + '<div class="card" style="border-color:var(--hazard-d)"><div style="font-weight:600">' + I("send") + ' Send a site check</div><p class="hint" style="margin:6px 0 10px">Sends the weekly check-in below to this facility\u2019s techs.</p><div class="label">Note for the tech (optional)</div><input data-newnote value="' + esc(S.newReportNote || "") + '" placeholder="e.g. Check the new fence this week"><button class="btn btn-dark" data-a="sendreport" style="width:100%;justify-content:center;margin-top:10px">' + I("send") + " Send site check</button></div>"
      + setupSections(f) + "</div>";
  }
  function facAudit(f) {
    var c = f.config, now = Date.now(), MONTH = 30 * 86400000;
    var anchor = c.lastAuditAt || c.setupAt || 0, due = anchor && now >= anchor + MONTH;
    var when = c.lastAuditAt ? "Last audit handled " + fday(c.lastAuditAt) : "Set up " + fday(c.setupAt || now);
    return '<div class="stack" style="margin-top:12px">'
      + '<div class="card" style="border-color:' + (due ? "var(--hazard-d)" : "var(--line)") + '"><div style="font-weight:700">' + I("clipboard-check") + " Monthly audit" + (due ? ' \u2014 <span style="color:var(--hazard-d)">due now</span>' : "") + '</div><p class="hint" style="margin:6px 0 0">Same setup as the site check below, plus: every vacant unit gets full checks and a photo, every occupied unit is confirmed to have a customer lock, and 10 facility photos are required. ' + esc(when) + ".</p>"
      + '<div class="label" style="margin-top:10px">Note for the tech (optional)</div><input data-newnote value="' + esc(S.newReportNote || "") + '" placeholder="e.g. Pay extra attention to D building"><button class="btn btn-dark" data-a="sendaudit" data-id="' + f.id + '" style="width:100%;justify-content:center;margin-top:10px">' + I("send") + " Send monthly audit</button>" + (due ? '<button class="btn" data-a="auditdone" data-id="' + f.id + '" style="width:100%;justify-content:center;margin-top:8px">Disregard for this month</button>' : "") + "</div>"
      + grp("Master unit list (audit only)", "list-numbers", '<p class="hint" style="margin:0 0 8px">List every unit at this facility. On an audit, anything here not in the Vacant list is treated as occupied and the tech confirms a customer lock is on it.</p>' + listEditor(gA(f, "units"), "units", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"))
      + setupSections(f) + "</div>";
  }
  function facReports(f) {
    if (S.subOpen) { var ro2 = S.reports.find(function (x) { return x.id === S.subOpen.id; }); if (ro2) return reportReview(ro2); S.subOpen = null; }
    var out = S.reports.filter(function (r) { return r.status === "outstanding" && r.facilityId === f.id; });
    var comp = S.reports.filter(function (r) { return r.status === "completed" && r.facilityId === f.id; });
    var typeBadge = function (r) { return r.type === "audit" ? '<span class="pill" style="background:#1A1D21;color:#fff">Audit</span>' : '<span class="pill" style="background:#FBEAE1;color:var(--hazard-d)">Site check</span>'; };
    var outCard = out.map(function (r) { return '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start">' + typeBadge(r) + '<span class="muted" style="font-size:12px">Sent ' + fdt(r.createdAt) + '</span></div><div class="label">Note for the tech</div><textarea rows="2" data-rnote="' + r.id + '" placeholder="(no note)">' + esc(r.note || "") + '</textarea><button class="btn sm danger" data-a="delreport" data-id="' + r.id + '" style="margin-top:8px">' + I("trash") + " Delete</button></div>"; }).join("");
    var compRow = function (r) { return '<div class="frow"><button class="fbody" data-a="openrep" data-id="' + r.id + '" style="display:flex;align-items:center;gap:10px;background:none;border:none;text-align:left;flex:1;cursor:pointer"><span class="fi">' + I("file") + '</span><span><span class="fname">' + (r.type === "audit" ? "Audit" : "Site check") + " \u00b7 " + esc(r.workerName || "Tech") + '</span><span class="faddr">' + fdt(r.submittedAt) + "</span></span></button>" + (r.reviewed ? '<span class="pill" style="background:#E1F0E9;color:var(--ok)">' + I("check") + " Reviewed</span>" : '<span class="pill" style="background:#FBEAE1;color:var(--hazard-d)">Needs review</span>') + '<button class="icon-btn danger" data-a="delreport" data-id="' + r.id + '">' + I("trash") + "</button></div>"; };
    return '<div style="margin-top:12px"><div class="dh">Outstanding (' + out.length + ")</div>" + (out.length ? '<div class="stack" style="margin-top:6px">' + outCard + "</div>" : '<div class="empty">Nothing waiting on techs.</div>')
      + '<div class="dh" style="margin-top:16px">Completed (' + comp.length + ")</div>" + (comp.length ? '<div class="list" style="margin-top:6px">' + comp.map(compRow).join("") + "</div>" : '<div class="empty">No completed reports.</div>') + "</div>";
  }
  function userEditor(w) {
    var isYou = w.id === S.auth.id, iAmSuper = S.auth.role === "superadmin";
    var lastSuper = w.role === "superadmin" && S.users.filter(function (u) { return u.role === "superadmin"; }).length <= 1;
    var lockReason = isYou ? "You can't remove the account you're signed in with." : lastSuper ? "There must be at least one super admin." : (w.role === "superadmin" && !iAmSuper) ? "Only a super admin can remove a super admin." : "";
    var roleSel = '<div class="label">Role</div><select data-usr="role"' + ((w.role === "superadmin" && !iAmSuper) ? " disabled" : "") + ">"
      + '<option value="worker"' + (w.role === "worker" ? " selected" : "") + ">On-site tech (fills out reports)</option>"
      + '<option value="employee"' + (w.role === "employee" ? " selected" : "") + ">Office employee (leads, maintenance, inventory, contractors)</option>"
      + '<option value="admin"' + (w.role === "admin" ? " selected" : "") + ">Admin (everything except Insurance / Taxes)</option>"
      + '<option value="superadmin"' + (w.role === "superadmin" ? " selected" : "") + (iAmSuper ? "" : " disabled") + ">Super admin (full access)</option>"
      + "</select>" + (!iAmSuper ? '<div class="muted" style="font-size:12px;margin-top:4px">Only a super admin can grant super-admin access.</div>' : "");
    var assignBlock = w.role === "worker" ? '<div class="card"><div class="row" style="font-weight:600;margin-bottom:6px">' + I("building-warehouse") + ' Facility access &amp; check-in day</div><p class="hint">Toggle which sites this person can open, and pick the weekday they go.</p>'
      + S.facilities.map(function (f) { var a = (w.assignments || []).find(function (x) { return x.facilityId === f.id; }); var on = !!a; return '<div class="assign"><button class="check' + (on ? " on" : "") + '" data-a="assign" data-id="' + f.id + '"><span class="bx">' + (on ? I("check") : "") + '</span></button><span style="flex:1;font-weight:600">' + esc(f.name) + "</span>" + (on ? '<select data-day="' + f.id + '">' + DAYS.map(function (dd) { return "<option" + (a.checkInDay === dd ? " selected" : "") + ">" + dd + "</option>"; }).join("") + "</select>" : '<span class="muted" style="font-size:13px">No access</span>') + "</div>"; }).join("") + "</div>" : "";
    return '<button class="btn" data-a="backuser" style="margin-bottom:12px">' + I("arrow-left") + ' All logins</button><div class="stack">'
      + '<div class="card"><div class="between"><div class="label" style="margin:0">Login</div>' + (isYou ? '<span class="pill you">' + I("user") + " You</span>" : "") + '</div><div class="label">Name</div><input data-usr="name" value="' + esc(w.name) + '"><div class="two-col" style="margin-top:2px"><div><div class="label">Username</div><input data-usr="username" value="' + esc(w.username) + '"></div><div><div class="label">Password</div><input data-usr="password" placeholder="Set new password (blank = keep)"></div></div>' + roleSel + "</div>"
      + assignBlock
      + '<button class="btn btn-danger" data-a="deluser" data-id="' + w.id + '"' + (lockReason ? " disabled" : "") + ">" + I("trash") + " Remove this login</button>" + (lockReason ? '<div class="note">' + lockReason + "</div>" : "") + '<div class="saved">' + I("check") + ' Changes save automatically.</div></div>';
  }
  function workerEditor(w) {
    return '<button class="btn" data-a="backteam" style="margin-bottom:12px">' + I("arrow-left") + ' All staff</button><div class="stack">'
      + '<div class="card"><div class="label">Name</div><input data-usr="name" value="' + esc(w.name) + '"><div class="two-col" style="margin-top:2px"><div><div class="label">Username</div><input data-usr="username" value="' + esc(w.username) + '"></div><div><div class="label">Password</div><input data-usr="password" placeholder="Set new password (blank = keep)"></div></div></div>'
      + '<div class="card"><div class="row" style="font-weight:600;margin-bottom:6px">' + I("building-warehouse") + ' Facility access &amp; check-in day</div><p class="hint">Toggle which sites this person can open, and pick the weekday they go.</p>'
      + S.facilities.map(function (f) {
        var a = (w.assignments || []).find(function (x) { return x.facilityId === f.id; }); var on = !!a;
        return '<div class="assign"><button class="check' + (on ? " on" : "") + '" data-a="assign" data-id="' + f.id + '"><span class="bx">' + (on ? I("check") : "") + '</span></button><span style="flex:1;font-weight:600">' + esc(f.name) + "</span>"
          + (on ? '<select data-day="' + f.id + '">' + DAYS.map(function (d) { return "<option" + (a.checkInDay === d ? " selected" : "") + ">" + d + "</option>"; }).join("") + "</select>" : '<span class="muted" style="font-size:13px">No access</span>') + "</div>";
      }).join("") + "</div>"
      + '<button class="btn btn-danger" data-a="deluser" data-id="' + w.id + '">' + I("trash") + ' Remove this login</button><div class="saved">' + I("check") + ' Changes save automatically.</div></div>';
  }
  function adminEditor(w) {
    var isYou = w.id === S.auth.id;
    var iAmSuper = S.auth.role === "superadmin";
    var lastSuper = w.role === "superadmin" && S.users.filter(function (u) { return u.role === "superadmin"; }).length <= 1;
    var lockReason = isYou ? "You can't remove the account you're signed in with." : lastSuper ? "There must be at least one super admin." : (w.role === "superadmin" && !iAmSuper) ? "Only a super admin can remove a super admin." : "";
    var roleSel = '<div class="label">Role</div><select data-usr="role"' + ((w.role === "superadmin" && !iAmSuper) ? " disabled" : "") + '>'
      + '<option value="admin"' + (w.role === "admin" ? " selected" : "") + '>Admin (everything except Insurance / Taxes)</option>'
      + '<option value="superadmin"' + (w.role === "superadmin" ? " selected" : "") + (iAmSuper ? "" : " disabled") + '>Super admin (full access)</option>'
      + "</select>" + (!iAmSuper ? '<div class="muted" style="font-size:12px;margin-top:4px">Only a super admin can grant super-admin access.</div>' : "");
    return '<button class="btn" data-a="backadmin" style="margin-bottom:12px">' + I("arrow-left") + ' All admins</button><div class="stack">'
      + '<div class="card"><div class="between"><div class="label" style="margin:0">' + (w.role === "superadmin" ? "Super admin account" : "Admin account") + '</div>' + (isYou ? '<span class="pill you">' + I("user") + " You</span>" : "") + "</div>"
      + '<div class="label">Name</div><input data-usr="name" value="' + esc(w.name) + '"><div class="two-col" style="margin-top:2px"><div><div class="label">Username</div><input data-usr="username" value="' + esc(w.username) + '"></div><div><div class="label">Password</div><input data-usr="password" placeholder="Set new password (blank = keep)"></div></div>' + roleSel + "</div>"
      + '<button class="btn btn-danger" data-a="deluser" data-id="' + w.id + '"' + (lockReason ? " disabled" : "") + ">" + I("trash") + " Remove this admin</button>"
      + (lockReason ? '<div class="note">' + lockReason + "</div>" : "") + '<div class="saved">' + I("check") + ' Changes save automatically.</div></div>';
  }

  /* ---------- config-bound field helpers (for the per-facility sections) ---------- */
  function gf(f, p) { var v = getPath(f.config, p); return v == null ? "" : v; }
  function tf(f, label, p, ph) { return '<div class="label">' + label + '</div><input data-cfg="' + p + '" value="' + esc(gf(f, p)) + '" placeholder="' + (ph || "") + '">'; }
  function taF(f, label, p, ph) { return '<div class="label">' + label + '</div><textarea rows="2" data-cfg="' + p + '" placeholder="' + (ph || "") + '">' + esc(gf(f, p)) + "</textarea>"; }
  function selF(f, label, p, opts) { var cur = getPath(f.config, p); return '<div class="label">' + label + '</div><select data-cfg="' + p + '"><option value="">—</option>' + opts.map(function (o) { return '<option value="' + esc(o) + '"' + (cur === o ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select>"; }
  function togF(f, label, p) { var on = !!getPath(f.config, p); return '<button class="check full' + (on ? " on" : "") + '" data-a="cfgtoggle" data-p="' + p + '"><span class="bx">' + (on ? I("check") : "") + "</span>" + label + "</button>"; }
  function gA(f, p) { var v = getPath(f.config, p); return Array.isArray(v) ? v : []; }
  function ci(ap, id, fld, val, ph) { return '<input style="width:100%" data-cli="' + ap + "|" + id + "|" + fld + '" value="' + esc(val || "") + '" placeholder="' + (ph || "") + '">'; }
  function cta(ap, id, fld, val, ph) { return '<textarea rows="2" data-cli="' + ap + "|" + id + "|" + fld + '" placeholder="' + (ph || "") + '">' + esc(val || "") + "</textarea>"; }
  function lbl(t) { return '<div class="label">' + t + "</div>"; }
  function col2(a, b) { return '<div class="two-col"><div>' + a + "</div><div>" + b + "</div></div>"; }
  function addBtn(p, label) { return '<button class="btn btn-dark sm" data-a="cfgadd" data-p="' + p + '">' + I("plus") + " " + label + "</button>"; }
  function delBtn(p, id) { return '<button class="icon-btn danger" data-a="cfgdel" data-p="' + p + '" data-id="' + id + '">' + I("trash") + "</button>"; }
  function cliToggle(label, p, id, fld, on) { return '<button class="check full' + (on ? " on" : "") + '" data-a="clitoggle" data-p="' + p + '" data-id="' + id + '" data-f="' + fld + '"><span class="bx">' + (on ? I("check") : "") + "</span>" + label + "</button>"; }
  function cardHead(label, p, id) { return '<div class="row" style="justify-content:space-between"><span class="muted" style="font-size:12px;font-weight:600">' + label + "</span>" + delBtn(p, id) + "</div>"; }

  /* ---------- collapse / expand helpers ---------- */
  function headPlain(label) { return '<div class="muted" style="font-size:12px;font-weight:600;margin-bottom:2px">' + label + "</div>"; }
  function editWrap(inner, delP, delId) {
    return '<div class="card" style="border-color:var(--hazard-d)">' + inner
      + '<div class="row" style="gap:8px;margin-top:12px">'
      + '<button class="btn btn-dark sm" data-a="saveitem">' + I("check") + " Save</button>"
      + (delP ? '<button class="icon-btn danger" data-a="cfgdel" data-p="' + delP + '" data-id="' + delId + '">' + I("trash") + "</button>" : "")
      + "</div></div>";
  }
  function sumCard(openKey, title, meta) {
    return '<div class="card sumrow" data-a="openitem" data-key="' + esc(openKey) + '"><div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px"><div style="flex:1;min-width:0">'
      + '<div style="font-weight:600">' + (title || '<span class="muted">Untitled — tap to edit</span>') + "</div>"
      + (meta ? '<div style="margin-top:3px;font-size:13px;color:var(--muted)">' + meta + "</div>" : "")
      + '</div><span class="muted" style="font-size:12px;white-space:nowrap">' + I("edit") + " Edit</span></div></div>";
  }
  function statusMeta(s) {
    var m = s === "completed" ? ["Completed", "#1F6F54", "#E1F0E9"] : s === "in_progress" ? ["In progress", "#C24806", "#FBEAE1"] : ["Needs action", "#C0392B", "#F7E4E1"];
    return '<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.3px;padding:2px 8px;border-radius:20px;background:' + m[2] + ";color:" + m[1] + '">' + m[0] + "</span>";
  }
  function statusButtons(x) {
    var opt = function (v, t, c) { var on = (x.status || "needs_action") === v; return '<button class="btn sm" style="' + (on ? "background:" + c + ";color:#fff;border-color:" + c : "") + '" data-a="setstatus" data-id="' + x.id + '" data-v="' + v + '">' + t + "</button>"; };
    return '<div class="row" style="gap:6px;flex-wrap:wrap">' + opt("needs_action", "Needs action", "#C0392B") + opt("in_progress", "In progress", "#C24806") + opt("completed", "Completed", "#1F6F54") + "</div>";
  }
  function metaBits(arr) { return arr.filter(Boolean).join(' <span style="opacity:.5">·</span> '); }
  function ciD(ap, id, fld, val) { return '<input type="date" style="width:100%" data-cli="' + ap + "|" + id + "|" + fld + '" value="' + esc(val || "") + '">'; }
  function tfD(f, label, p) { return lbl(label) + '<input type="date" data-cfg="' + p + '" value="' + esc(gf(f, p)) + '">'; }
  function parseAmt(s) { var n = parseFloat(String(s == null ? "" : s).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : null; }
  function fmtMoney(n) { return "$" + Math.round(n).toLocaleString(); }
  function showAmt(s) { if (!s && s !== 0) return ""; var str = "" + s; return str.charAt(0) === "$" ? str : "$" + str; }
  function fmtDate(iso) { if (!iso) return ""; var d = new Date(iso + "T00:00:00"); if (isNaN(d.getTime())) return esc(iso); return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  function isoOf(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function nextMonthlyDate(day) { day = parseInt(day, 10); if (!day || day < 1 || day > 31) return null; var now = new Date(); var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); var d = new Date(now.getFullYear(), now.getMonth(), day); if (d < today) d = new Date(now.getFullYear(), now.getMonth() + 1, day); return d; }

  /* ---------- Section 1: Maintenance tracking ---------- */
  function maintenanceSection(f) {
    var items = gA(f, "maintenanceTracking");
    var row = function (x) {
      var key = "maintenanceTracking#" + x.id;
      var reportLine = x.reportedBy ? lbl("Reported by") + '<div class="da" style="margin-bottom:6px">' + esc(x.reportedBy) + (x.reportedAt ? " on " + fdt(x.reportedAt) : "") + "</div>" : "";
      if (S.openItem === key) return editWrap(headPlain(x.reportedBy ? "REPORTED PROBLEM" : "MAINTENANCE ITEM") + reportLine
        + lbl("Header") + ci("maintenanceTracking", x.id, "header", x.header, "Short title")
        + lbl("Description") + cta("maintenanceTracking", x.id, "description", x.description, "What needs to be done")
        + lbl("Affected unit(s)") + ci("maintenanceTracking", x.id, "units", x.units, "e.g. A101, A102 (blank if none)")
        + lbl("Follow-up notes") + cta("maintenanceTracking", x.id, "followNotes", x.followNotes, "Updates over time")
        + lbl("Status") + statusButtons(x), "maintenanceTracking", x.id);
      return sumCard(key, (x.reportedBy && !x.header ? '<span style="color:var(--alert)">' + I("alert-triangle") + " Reported problem</span>" : esc(x.header)), metaBits([x.description ? esc(x.description) : "", x.units ? "Units: " + esc(x.units) : "", x.reportedBy ? "Reported by " + esc(x.reportedBy) : ""]) + (x.description || x.units || x.reportedBy ? "<br>" : "") + statusMeta(x.status));
    };
    var open = items.filter(function (x) { return x.status !== "completed"; });
    var done = items.filter(function (x) { return x.status === "completed"; });
    var reported = items.filter(function (x) { return x.reportedBy && x.status !== "completed"; });
    var attn = reported.length ? ('<div class="card" style="border-color:var(--alert);background:#F7E4E1;margin-bottom:12px"><div style="font-weight:700;color:var(--alert)">' + I("alert-triangle") + " " + reported.length + " reported problem" + (reported.length === 1 ? "" : "s") + ' need attention</div><p class="hint" style="margin:5px 0 0">Newly reported items are listed under Open below.</p></div>') : "";
    return '<h3>Maintenance tracking — ' + esc(f.name) + '</h3>' + attn + '<div class="between"><p class="hint">Tap an item to edit; Save collapses it.</p><span class="row" style="gap:6px">' + addBtn("maintenanceTracking", "Add item") + '<button class="btn sm" style="border-color:var(--alert);color:var(--alert)" data-a="reportproblem">' + I("flag") + " Report a problem</button></span></div>"
      + '<div class="dh">Open (' + open.length + ")</div>" + (open.length ? '<div class="stack" style="margin-top:6px">' + open.map(row).join("") + "</div>" : '<div class="empty">Nothing outstanding.</div>')
      + '<div class="dh" style="margin-top:16px">Completed (' + done.length + ")</div>" + (done.length ? '<div class="stack" style="margin-top:6px">' + done.map(row).join("") + "</div>" : '<div class="empty">None completed yet.</div>');
  }

  /* ---------- Section 2: Inventory ---------- */
  var INV_TYPES = ["Broom", "Grinder", "Grinder discs", "Weed killer", "Block poison", "Safety glasses", "Sprayer", "Mouse traps", "Door springs", "Latches", "Other"];
  function inventorySection(f) {
    var locks = gA(f, "inventory.locks"), items = gA(f, "inventory.items"), reorder = gA(f, "inventory.reorder");
    var active = items.filter(function (x) { return !x.discontinued; }), disc = items.filter(function (x) { return x.discontinued; });
    var reorderRow = function (x) {
      var key = "inventory.reorder#" + x.id;
      if (S.openItem === key) return editWrap(headPlain("REORDER ITEM")
        + lbl("Item name") + ci("inventory.reorder", x.id, "name", x.name, "e.g. Latches, Door springs, Garage door")
        + lbl("Where to buy (URL)") + ci("inventory.reorder", x.id, "url", x.url, "https://…")
        + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener" class="muted" style="font-size:12px;display:inline-block;margin:4px 0">' + I("external-link") + " Open link</a>" : "")
        + lbl("Cost") + ci("inventory.reorder", x.id, "cost", x.cost, "$")
        + lbl("Notes") + cta("inventory.reorder", x.id, "notes", x.notes, "Specs, size, supplier…"), "inventory.reorder", x.id);
      return sumCard(key, esc(x.name) || '<span class="muted">New item — tap to edit</span>', metaBits([x.cost ? "Cost: " + esc(showAmt(x.cost)) : "", x.url ? "Has reorder link" : ""]));
    };
    var lockRow = function (l) {
      var key = "inventory.locks#" + l.id;
      if (S.openItem === key) return editWrap(headPlain("LOCK") + lbl("Lock number") + ci("inventory.locks", l.id, "number", l.number, "e.g. 0481") + lbl("Code") + ci("inventory.locks", l.id, "code", l.code, "e.g. 7-7-7"), "inventory.locks", l.id);
      return sumCard(key, "Lock " + (esc(l.number) || "—"), l.code ? "Code: " + esc(l.code) : "");
    };
    var itemRow = function (x) {
      var key = "inventory.items#" + x.id;
      var name = x.type === "Other" ? (x.customType || "Other") : x.type;
      if (S.openItem === key) return editWrap(headPlain(x.discontinued ? "DISCONTINUED ITEM" : "EQUIPMENT / SUPPLY")
        + lbl("Item name") + '<select data-cli="inventory.items|' + x.id + '|type"><option value="">—</option>' + INV_TYPES.map(function (t) { return "<option" + (x.type === t ? " selected" : "") + ">" + t + "</option>"; }).join("") + "</select>"
        + (x.type === "Other" ? lbl("Other item name") + ci("inventory.items", x.id, "customType", x.customType, "Type the item") : "")
        + col2(lbl("Date in service") + ci("inventory.items", x.id, "dateInService", x.dateInService, "e.g. 2026-01-15"), lbl("Quantity") + ci("inventory.items", x.id, "quantity", x.quantity, "Qty"))
        + lbl("Size") + ci("inventory.items", x.id, "size", x.size, "Size")
        + lbl("Description") + cta("inventory.items", x.id, "description", x.description, "Notes")
        + cliToggle("No longer in use (discontinue)", "inventory.items", x.id, "discontinued", x.discontinued)
        + (x.discontinued ? col2(lbl("Date decommissioned") + ci("inventory.items", x.id, "discDate", x.discDate, "e.g. 2026-05-01"), lbl("Reason") + ci("inventory.items", x.id, "discReason", x.discReason, "Why")) : ""), "inventory.items", x.id);
      return sumCard(key, esc(name) || '<span class="muted">New item — tap to edit</span>', metaBits([x.dateInService ? "In service: " + esc(x.dateInService) : "", x.quantity ? "Qty: " + esc(x.quantity) : ""]));
    };
    return '<h3>Inventory — ' + esc(f.name) + "</h3>"
      + grp("Locks", "lock", (locks.length ? '<div class="stack">' + locks.map(lockRow).join("") + "</div>" : '<div class="muted" style="font-size:13px;padding:2px 0">No locks yet.</div>') + '<div style="margin-top:8px">' + addBtn("inventory.locks", "Add lock") + "</div>")
      + '<div class="between" style="margin-top:14px"><div class="dh">Equipment &amp; supplies (' + active.length + ")</div>" + addBtn("inventory.items", "Add item") + "</div>"
      + (active.length ? '<div class="stack" style="margin-top:6px">' + active.map(itemRow).join("") + "</div>" : '<div class="empty">No items yet.</div>')
      + (disc.length ? '<div class="dh" style="margin-top:16px">Discontinued (' + disc.length + ')</div><div class="stack" style="margin-top:6px">' + disc.map(itemRow).join("") + "</div>" : "")
      + '<div class="between" style="margin-top:18px"><div class="dh">Reorder items — site-specific (' + reorder.length + ")</div>" + addBtn("inventory.reorder", "Add reorder item") + "</div>"
      + '<p class="hint" style="margin:4px 0 0">Parts to reorder for this site (latches, door springs, garage doors…), with where to buy and the cost.</p>'
      + (reorder.length ? '<div class="stack" style="margin-top:6px">' + reorder.map(reorderRow).join("") + "</div>" : '<div class="empty">No reorder items yet.</div>');
  }

  /* ---------- Section 3: Contractors ---------- */
  function contractorsSection(f) {
    var QUAL = ["Poor", "Below average", "Standard", "Above average", "Excellent"];
    var dump = gA(f, "contractors.dumpsters"), others = gA(f, "contractors.others");
    var payP = gf(f, "contractors.onsite.payPeriod");
    var onsiteEditor = headPlain("ON-SITE MAINTENANCE")
      + tf(f, "Name", "contractors.onsite.name") + col2(tf(f, "Phone", "contractors.onsite.phone"), tf(f, "Email", "contractors.onsite.email"))
      + tf(f, "Address", "contractors.onsite.address")
      + col2(tf(f, "Start date", "contractors.onsite.startDate", "e.g. 2025-03-01"), selF(f, "Check-in day", "contractors.onsite.checkInDay", DAYS))
      + col2(tf(f, "Pay amount", "contractors.onsite.payAmount", "$"), selF(f, "Pay period", "contractors.onsite.payPeriod", ["Every two weeks", "Monthly"]))
      + (payP === "Monthly" ? tf(f, "Day of month paid", "contractors.onsite.payDayOfMonth", "e.g. 1st") : "")
      + selF(f, "Quality", "contractors.onsite.quality", QUAL)
      + taF(f, "Description", "contractors.onsite.description")
      + togF(f, "Lawn care handled by on-site maintenance", "contractors.onsite.lawnByOnsite")
      + togF(f, "Garage handled by on-site maintenance", "contractors.onsite.garageByOnsite");
    var onsite = S.openItem === "contractors.onsite" ? editWrap(onsiteEditor)
      : sumCard("contractors.onsite", gf(f, "contractors.onsite.name") ? esc(gf(f, "contractors.onsite.name")) : "On-site maintenance — tap to add",
        metaBits([payP ? esc(payP) : "", gf(f, "contractors.onsite.payAmount") ? "Pay: " + esc(gf(f, "contractors.onsite.payAmount")) : "", payP === "Monthly" && gf(f, "contractors.onsite.payDayOfMonth") ? "Day " + esc(gf(f, "contractors.onsite.payDayOfMonth")) : "", gf(f, "contractors.onsite.quality") ? "Quality: " + esc(gf(f, "contractors.onsite.quality")) : ""]));
    var lawn = getPath(f.config, "contractors.onsite.lawnByOnsite") ? "" : (S.openItem === "contractors.lawn" ? editWrap(headPlain("LAWN CARE")
      + tf(f, "Company / person name", "contractors.lawn.company") + col2(tf(f, "Contact name", "contractors.lawn.contact"), tf(f, "Email", "contractors.lawn.email"))
      + col2(tf(f, "Phone", "contractors.lawn.phone"), tf(f, "Address", "contractors.lawn.address"))
      + col2(selF(f, "Frequency", "contractors.lawn.frequency", ["Every week", "Every two weeks"]), tf(f, "Amount per occurrence", "contractors.lawn.amountPerOcc", "$"))
      + tf(f, "Other payment notes", "contractors.lawn.otherPaymentNote") + tf(f, "How do they send bills?", "contractors.lawn.billingMethod")
      + togF(f, "Set up on autopay", "contractors.lawn.autopay")) : sumCard("contractors.lawn", gf(f, "contractors.lawn.company") ? esc(gf(f, "contractors.lawn.company")) : "Lawn care — tap to add", metaBits([gf(f, "contractors.lawn.frequency") ? esc(gf(f, "contractors.lawn.frequency")) : "", gf(f, "contractors.lawn.amountPerOcc") ? "$" + esc(gf(f, "contractors.lawn.amountPerOcc")) : ""])));
    var garage = getPath(f.config, "contractors.onsite.garageByOnsite") ? "" : (S.openItem === "contractors.garage" ? editWrap(headPlain("GARAGE DOORS")
      + tf(f, "Company / person name", "contractors.garage.company") + col2(tf(f, "Contact name", "contractors.garage.contact"), tf(f, "Email", "contractors.garage.email"))
      + col2(tf(f, "Phone", "contractors.garage.phone"), tf(f, "Address", "contractors.garage.address"))
      + selF(f, "Price", "contractors.garage.price", ["Low", "Medium", "High"]) + taF(f, "Description", "contractors.garage.description")) : sumCard("contractors.garage", gf(f, "contractors.garage.company") ? esc(gf(f, "contractors.garage.company")) : "Garage doors — tap to add", gf(f, "contractors.garage.price") ? "Price: " + esc(gf(f, "contractors.garage.price")) : ""));
    var dRow = function (x) {
      var key = "contractors.dumpsters#" + x.id;
      if (S.openItem === key) return editWrap(headPlain("ROLL-OFF DUMPSTER")
        + lbl("Company") + ci("contractors.dumpsters", x.id, "company", x.company)
        + col2(lbl("Contact") + ci("contractors.dumpsters", x.id, "contact", x.contact), lbl("Email") + ci("contractors.dumpsters", x.id, "email", x.email))
        + col2(lbl("Phone") + ci("contractors.dumpsters", x.id, "phone", x.phone), lbl("Address") + ci("contractors.dumpsters", x.id, "address", x.address))
        + col2(lbl("10-yard price") + ci("contractors.dumpsters", x.id, "p10", x.p10, "$"), lbl("15-yard price") + ci("contractors.dumpsters", x.id, "p15", x.p15, "$"))
        + col2(lbl("20-yard price") + ci("contractors.dumpsters", x.id, "p20", x.p20, "$"), lbl("30-yard price") + ci("contractors.dumpsters", x.id, "p30", x.p30, "$"))
        + lbl("Any other dumpster price") + ci("contractors.dumpsters", x.id, "pOther", x.pOther, "$")
        + lbl("Description") + cta("contractors.dumpsters", x.id, "description", x.description), "contractors.dumpsters", x.id);
      return sumCard(key, esc(x.company) || '<span class="muted">New dumpster — tap to edit</span>', metaBits([x.p20 ? "20yd $" + esc(x.p20) : "", x.p30 ? "30yd $" + esc(x.p30) : ""]));
    };
    var oRow = function (x) {
      var key = "contractors.others#" + x.id;
      if (S.openItem === key) return editWrap(headPlain("OTHER CONTRACTOR")
        + lbl("Service type") + ci("contractors.others", x.id, "serviceType", x.serviceType)
        + lbl("Company name") + ci("contractors.others", x.id, "company", x.company)
        + col2(lbl("Email") + ci("contractors.others", x.id, "email", x.email), lbl("Phone") + ci("contractors.others", x.id, "phone", x.phone))
        + lbl("Address") + ci("contractors.others", x.id, "address", x.address)
        + lbl("Description") + cta("contractors.others", x.id, "description", x.description), "contractors.others", x.id);
      return sumCard(key, esc(x.serviceType) || '<span class="muted">New contractor — tap to edit</span>', x.company ? esc(x.company) : "");
    };
    var incidents = gA(f, "contractors.incidents");
    var incRow = function (x) {
      var key = "contractors.incidents#" + x.id;
      if (S.openItem === key) return editWrap(headPlain("CONTRACTOR INCIDENT")
        + lbl("Date") + ciD("contractors.incidents", x.id, "date", x.date)
        + lbl("Which contractor") + '<select data-cli="contractors.incidents|' + x.id + '|who"><option value="">—</option><option' + (x.who === "On-site maintenance" ? " selected" : "") + ">On-site maintenance</option><option" + (x.who === "Sub contractor" ? " selected" : "") + ">Sub contractor</option></select>"
        + lbl("Contractor name (if sub)") + ci("contractors.incidents", x.id, "name", x.name, "Leave blank for on-site")
        + lbl("What wasn't done properly?") + cta("contractors.incidents", x.id, "description", x.description, "Describe the issue")
        + lbl("Affected unit(s) / area") + ci("contractors.incidents", x.id, "units", x.units, "Optional")
        + cliToggle("Resolved", "contractors.incidents", x.id, "resolved", x.resolved), "contractors.incidents", x.id);
      return sumCard(key, (x.who || "Incident") + (x.name ? " — " + esc(x.name) : ""), metaBits([x.date ? fmtDate(x.date) : "", x.description ? esc(x.description) : "", x.resolved ? "Resolved" : '<span style="color:var(--alert);font-weight:700">Open</span>']));
    };
    return '<h3>Contractors — ' + esc(f.name) + '</h3><p class="hint">Tap a card to edit; Save collapses it.</p>'
      + '<div class="dh" style="margin-top:6px">On-site maintenance</div><div style="margin-top:6px">' + onsite + "</div>"
      + (lawn ? '<div class="dh" style="margin-top:14px">Lawn care</div><div style="margin-top:6px">' + lawn + "</div>" : "")
      + (garage ? '<div class="dh" style="margin-top:14px">Garage doors</div><div style="margin-top:6px">' + garage + "</div>" : "")
      + '<div class="between" style="margin-top:14px"><div class="dh">Roll-off dumpsters</div>' + addBtn("contractors.dumpsters", "Add") + "</div>"
      + (dump.length ? '<div class="stack" style="margin-top:6px">' + dump.map(dRow).join("") + "</div>" : '<div class="empty">None added.</div>')
      + '<div class="between" style="margin-top:14px"><div class="dh">Other contractors</div>' + addBtn("contractors.others", "Add") + "</div>"
      + (others.length ? '<div class="stack" style="margin-top:6px">' + others.map(oRow).join("") + "</div>" : '<div class="empty">None added.</div>')
      + '<div class="between" style="margin-top:18px"><div class="dh">Incident reports</div>' + addBtn("contractors.incidents", "Report incident") + "</div>"
      + '<p class="hint" style="margin:4px 0 0">Log times a contractor didn\u2019t perform a function properly.</p>'
      + (incidents.length ? '<div class="stack" style="margin-top:6px">' + incidents.map(incRow).join("") + "</div>" : '<div class="empty">No incidents reported.</div>');
  }

  /* ---------- Section 4: Insurance / Property taxes / Utilities (super admin) ---------- */
  function financeSection(f) {
    var bills = gA(f, "finance.propertyTax.bills"), utils = gA(f, "finance.utilities");
    var bRow = function (x) {
      var key = "finance.propertyTax.bills#" + x.id;
      if (S.openItem === key) return editWrap(headPlain("PROPERTY TAX BILL")
        + lbl("Who is it due to?") + ci("finance.propertyTax.bills", x.id, "dueTo", x.dueTo)
        + lbl("Estimated payment amount") + ci("finance.propertyTax.bills", x.id, "estAmount", x.estAmount, "$")
        + lbl("Date it is due") + ciD("finance.propertyTax.bills", x.id, "dueWhen", x.dueWhen)
        + lbl("Website to pay") + ci("finance.propertyTax.bills", x.id, "payWebsite", x.payWebsite)
        + lbl("Address to pay") + ci("finance.propertyTax.bills", x.id, "payAddress", x.payAddress)
        + cliToggle("Can be paid by ACH", "finance.propertyTax.bills", x.id, "ach", x.ach)
        + (x.ach ? lbl("ACH website") + ci("finance.propertyTax.bills", x.id, "achWebsite", x.achWebsite) : ""), "finance.propertyTax.bills", x.id);
      return sumCard(key, esc(x.dueTo) || '<span class="muted">New bill — tap to edit</span>', metaBits([x.estAmount ? "Est. " + showAmt(x.estAmount) : "", x.dueWhen ? "Due " + fmtDate(x.dueWhen) : ""]));
    };
    var reassess = S.openItem === "finance.propertyTax.reassess" ? editWrap(headPlain("REASSESSMENT")
      + tfD(f, "Date property taxes are reassessed", "finance.propertyTax.reassess.when")
      + tfD(f, "Date reassessments are mailed out", "finance.propertyTax.reassess.mailedWhen")
      + tfD(f, "Last day to appeal reassessment", "finance.propertyTax.reassess.appealLastDay")
      + taF(f, "Facility / organization to contact (info)", "finance.propertyTax.reassess.contactInfo"))
      : sumCard("finance.propertyTax.reassess", "Reassessment", metaBits([gf(f, "finance.propertyTax.reassess.when") ? "Reassessed " + fmtDate(gf(f, "finance.propertyTax.reassess.when")) : "", gf(f, "finance.propertyTax.reassess.appealLastDay") ? "Appeal by " + fmtDate(gf(f, "finance.propertyTax.reassess.appealLastDay")) : ""]) || "Tap to add reassessment dates");
    var ptax = grp("Property taxes", "receipt-tax",
      togF(f, "There are multiple property-tax bills", "finance.propertyTax.multiple")
      + '<div class="between" style="margin-top:8px"><div class="dh">Bills</div>' + addBtn("finance.propertyTax.bills", "Add bill") + "</div>"
      + (bills.length ? '<div class="stack" style="margin-top:6px">' + bills.map(bRow).join("") + "</div>" : '<div class="empty">No bills added.</div>')
      + '<div class="dh" style="margin-top:14px">Reassessment</div><div style="margin-top:6px">' + reassess + "</div>");
    var freq = gf(f, "finance.insurance.frequency");
    var ins = S.openItem === "finance.insurance" ? editWrap(headPlain("INSURANCE")
      + tf(f, "Insurance provider", "finance.insurance.provider")
      + taF(f, "Contact information", "finance.insurance.contact")
      + col2(tf(f, "Annual amount", "finance.insurance.annualAmount", "$"), selF(f, "Paid", "finance.insurance.frequency", ["Quarterly", "Annually"]))
      + (freq === "Quarterly" ? col2(tfD(f, "Q1 due date", "finance.insurance.q1Date"), tfD(f, "Q2 due date", "finance.insurance.q2Date")) + col2(tfD(f, "Q3 due date", "finance.insurance.q3Date"), tfD(f, "Q4 due date", "finance.insurance.q4Date")) : freq === "Annually" ? tfD(f, "Due date", "finance.insurance.dueDate") : '<div class="hint" style="margin-top:8px">Choose how it\'s paid to set due date(s).</div>')
      + tf(f, "Portal to pay", "finance.insurance.portal"))
      : sumCard("finance.insurance", gf(f, "finance.insurance.provider") ? esc(gf(f, "finance.insurance.provider")) : "Insurance — tap to add", metaBits([gf(f, "finance.insurance.annualAmount") ? "Annual " + showAmt(gf(f, "finance.insurance.annualAmount")) : "", freq === "Quarterly" ? "Quarterly (4 dates)" : freq === "Annually" && gf(f, "finance.insurance.dueDate") ? "Due " + fmtDate(gf(f, "finance.insurance.dueDate")) : freq || ""]));
    var uRow = function (x) {
      var key = "finance.utilities#" + x.id;
      if (S.openItem === key) return editWrap(headPlain("UTILITY")
        + lbl("Utility type") + ci("finance.utilities", x.id, "type", x.type, "e.g. Electric")
        + col2(lbl("Account number") + ci("finance.utilities", x.id, "accountNumber", x.accountNumber), lbl("Login ID") + ci("finance.utilities", x.id, "loginId", x.loginId))
        + lbl("Login password") + ci("finance.utilities", x.id, "loginPassword", x.loginPassword)
        + cliToggle("Set up on autopay", "finance.utilities", x.id, "autopay", x.autopay)
        + (x.autopay ? '<div class="hint" style="margin-top:6px">On autopay — no due date needed.</div>' : lbl("Day of each month it's due") + '<input type="number" min="1" max="31" style="width:100%" data-cli="finance.utilities|' + x.id + '|dueDay" value="' + esc(x.dueDay || "") + '" placeholder="1–31">'), "finance.utilities", x.id);
      return sumCard(key, esc(x.type) || '<span class="muted">New utility — tap to edit</span>', metaBits([x.accountNumber ? "Acct " + esc(x.accountNumber) : "", x.autopay ? "Autopay" : x.dueDay ? "Due day " + esc(x.dueDay) : ""]));
    };
    return '<h3>Insurance / Property taxes / Utilities — ' + esc(f.name) + '</h3><div class="note" style="margin-bottom:10px">' + I("lock") + " Super admins only. Stored passwords are saved as entered — keep this server private.</div>"
      + ptax
      + '<div class="dh" style="margin-top:14px">Insurance</div><div style="margin-top:6px">' + ins + "</div>"
      + '<div class="between" style="margin-top:14px"><div class="dh">Utilities</div>' + addBtn("finance.utilities", "Add utility") + "</div>"
      + (utils.length ? '<div class="stack" style="margin-top:6px">' + utils.map(uRow).join("") + "</div>" : '<div class="empty">None added.</div>');
  }

  function financeSchedule() {
    var rows = [];
    S.facilities.forEach(function (f) {
      var fin = f.config.finance || {};
      ((((fin.propertyTax) || {}).bills) || []).forEach(function (b) { if (b.dueWhen) rows.push({ d: b.dueWhen, amt: b.estAmount ? showAmt(b.estAmount) : "", fac: f.name, what: "Property tax" + (b.dueTo ? " — " + b.dueTo : "") }); });
      var ins = fin.insurance || {};
      if (ins.frequency === "Quarterly") ["q1Date", "q2Date", "q3Date", "q4Date"].forEach(function (q, i) { if (ins[q]) { var a = parseAmt(ins.annualAmount); rows.push({ d: ins[q], amt: a != null ? fmtMoney(a / 4) : "", fac: f.name, what: "Insurance — Q" + (i + 1) }); } });
      else if (ins.dueDate) { var an = parseAmt(ins.annualAmount); rows.push({ d: ins.dueDate, amt: an != null ? fmtMoney(an) : showAmt(ins.annualAmount), fac: f.name, what: "Insurance (annual)" }); }
      ((fin.utilities) || []).forEach(function (u) { if (!u.autopay && u.dueDay) { var nd = nextMonthlyDate(u.dueDay); if (nd) rows.push({ d: isoOf(nd), amt: "", fac: f.name, what: "Utility — " + (u.type || "utility") + " (monthly, day " + u.dueDay + ")" }); } });
    });
    rows.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    var body = rows.length ? rows.map(function (r) {
      return '<div class="card" style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div style="min-width:0"><div style="font-weight:600">' + fmtDate(r.d) + '</div><div style="font-size:13px;color:var(--muted);margin-top:2px">' + esc(r.what) + '</div><div style="font-size:12px;color:var(--muted);margin-top:1px">' + I("building-warehouse") + " " + esc(r.fac) + '</div></div><div style="font-weight:600;white-space:nowrap">' + (r.amt ? esc(r.amt) : '<span style="color:var(--muted);font-weight:400">—</span>') + "</div></div>";
    }).join("") : '<div class="empty">No dated payments yet. Add due dates to tax bills, insurance, or non-autopay utilities.</div>';
    return '<h3>Due dates</h3><p class="hint">All upcoming payments across every facility, soonest first. Amount shows the estimate where one exists.</p><div class="stack">' + body + "</div>";
  }

  function secPicker(title, blurb) {
    return "<h3>" + title + '</h3><p class="hint">' + blurb + '</p><div class="list">'
      + S.facilities.map(function (f) { return '<button class="frow" data-a="opensec" data-id="' + f.id + '"><span class="fi">' + I("building-warehouse") + '</span><span class="fbody"><span class="fname">' + esc(f.name) + '</span><span class="faddr">' + esc(f.address || "") + "</span></span>" + I("chevron-right") + "</button>"; }).join("") + "</div>";
  }

  /* ---------- lead tracking ---------- */
  function facName(id) { var f = S.facilities.find(function (x) { return x.id === id; }); return f ? f.name : "—"; }
  function leadBucket(l) { return l.status === "rented" ? "movedin" : l.status; }
  function dueFollowups() { var now = Date.now(), out = []; (S.leads || []).forEach(function (l) { (l.followups || []).forEach(function (f) { if (!f.completed && !f.cancelled && f.dueAt <= now) out.push({ lead: l, fu: f }); }); }); return out.sort(function (a, b) { return a.fu.dueAt - b.fu.dueAt; }); }
  function leadTog(label, key, val) { return '<div class="qrow"><span>' + label + '</span><div class="seg"><button class="' + (val === true ? "sel" : "") + '" data-a="leadtog" data-k="' + key + '" data-v="1">Yes</button><button class="' + (val === false ? "sel" : "") + '" data-a="leadtog" data-k="' + key + '" data-v="0">No</button></div></div>'; }
  function fuScheduleCard(ref, selKey, selAttr, reasonHtml) {
    var mi = ref && !ref.moveInUnknown && ref.estMoveIn ? Date.parse(ref.estMoveIn + "T12:00:00") : null;
    var now = Date.now(), HOURms = 36e5, DAYms = 864e5;
    var avail = [["", "Standard schedule (recommended)"]];
    var add = function (cond, key, label) { if (cond) avail.push([key, label]); };
    add(!mi || now + 4 * HOURms <= mi, "h4", "Follow up with customer in 4 hours");
    add(!mi || now + DAYms <= mi, "d1", "Follow up with customer in a day");
    add(!mi || mi - now > 7 * DAYms, "w1", "Follow up with customer in a week");
    add(mi && mi - DAYms > now, "preMoveIn", "Follow up with customer a day before move-in");
    add(mi && mi > now, "moveInDay", "Follow up with customer the day of move-in");
    add(!mi || mi - now > 30 * DAYms, "m1", "Follow up with customer in a month");
    var sel = selKey || "";
    var options = avail.map(function (o) { return '<option value="' + o[0] + '"' + (sel === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
    return '<div class="card"><div class="label">When should the next follow-up be?</div><p class="hint" style="margin:0 0 8px"><b>* Only change this from the standard schedule if something the customer said in the conversation means they should be followed up with at a later date.</b></p><select ' + selAttr + ">" + options + '</select><p class="hint" style="margin:8px 0 0">Choosing a later start removes the earlier follow-ups; every standard follow-up after it stays the same. You can\u2019t pick a date after the move-in day \u2014 the latest option is the day of move-in. \u201cIn a week\u201d and \u201cin a month\u201d only show when there\u2019s no move-in date, or it\u2019s more than a week / a month away.</p>' + (sel ? reasonHtml : "") + "</div>";
  }
  function leadAddForm() {
    var d = S.leadDraft || {};
    var facOpts = S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (d.facilityId === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("");
    var resv = d.kind === "reservation" ? '<div class="card">' + leadTog("Was the reservation put into Cubby?", "inCubby", d.inCubby) + leadTog("Was it a SpareFoot reservation?", "spareFoot", d.spareFoot) + '<button class="check full' + (d.gotAhold ? " on" : "") + '" data-a="leadtog2" data-k="gotAhold"><span class="bx">' + (d.gotAhold ? I("check") : "") + "</span>Were you able to get ahold of the customer?</button><p class=\"hint\" style=\"margin:6px 0 0\">If checked, the 4-hour follow-up is removed. All other follow-ups stay.</p></div>" : "";
    var disc = d.kind ? '<div class="card">' + leadTog("Did you inform the customer of all move-in discounts or promotions?", "informedDiscounts", d.informedDiscounts) + "</div>" : "";
    return '<button class="btn" data-a="leadback" style="margin-bottom:12px">' + I("arrow-left") + ' Lead tracking</button><div class="stack">'
      + '<div class="card"><div class="label">Is this a reservation or a lead?</div><div class="cond"><button class="' + (d.kind === "reservation" ? "ok" : "") + '" data-a="leadkind" data-v="reservation">Reservation</button><button class="' + (d.kind === "lead" ? "ok" : "") + '" data-a="leadkind" data-v="lead">Lead</button></div></div>'
      + resv + disc
      + '<div class="card"><div class="label">Customer name' + (d.status === "rented" ? " (required for move-ins)" : "") + '</div><input data-lead="name" value="' + esc(d.name || "") + '"' + (d.nameUnknown && d.status !== "rented" ? " disabled" : "") + ">" + (d.status === "rented" ? "" : '<button class="check full' + (d.nameUnknown ? " on" : "") + '" data-a="leadtog2" data-k="nameUnknown"><span class="bx">' + (d.nameUnknown ? I("check") : "") + "</span>Name unknown</button>") + "</div>"
      + '<div class="card"><div class="label">Estimated move-in date</div><input type="date" data-lead="estMoveIn" value="' + esc(d.estMoveIn || "") + '"' + (d.moveInUnknown ? " disabled" : "") + '><p class="hint" style="margin:6px 0 0">If the customer gave a rough timeline, put the estimated date.</p><button class="check full' + (d.moveInUnknown ? " on" : "") + '" data-a="leadtog2" data-k="moveInUnknown"><span class="bx">' + (d.moveInUnknown ? I("check") : "") + "</span>Move-in date unknown</button></div>"
      + '<div class="card"><button class="check full' + (d.confirmedMoveIn ? " on" : "") + '" data-a="leadtog2" data-k="confirmedMoveIn"><span class="bx">' + (d.confirmedMoveIn ? I("check") : "") + "</span>Spoke with the customer \u2014 confirmed they\u2019ll pay on the move-in date</button><p class=\"hint\" style=\"margin:6px 0 0\">Only mark this if the customer confirmed they will plan on paying on the actual date of move-in. Don\u2019t mark it if they didn\u2019t confirm. If checked, the next follow-up is the move-in day.</p></div>"
      + '<div class="card"><div class="label">Facility</div><select data-lead="facilityId">' + facOpts + '</select><div class="label">Customer phone number</div><input data-lead="phone" value="' + esc(d.phone || "") + '"><div class="label">Customer secondary phone number (leave blank if unknown)</div><input data-lead="phone2" value="' + esc(d.phone2 || "") + '"><div class="label">Customer email (leave blank if unknown)</div><input data-lead="email" value="' + esc(d.email || "") + '"></div>'
      + '<div class="card"><div class="label">Lead status</div><div class="cond"><button class="' + (d.status === "warm" || !d.status ? "ok" : "") + '" data-a="leadstatus" data-v="warm">Warm</button><button class="' + (d.status === "rented" ? "ok" : "") + '" data-a="leadstatus" data-v="rented">Rented / moved in</button><button class="' + (d.status === "cold" ? "bad" : "") + '" data-a="leadstatus" data-v="cold">Cold</button></div><p class="hint" style="margin:6px 0 0">Only mark Cold if the customer confirmed they have no interest in renting.</p>' + (d.status === "rented" ? '<div class="label" style="margin-top:10px">Unit they moved into (required)</div><input data-lead="moveInUnit" value="' + esc(d.moveInUnit || "") + '" placeholder="e.g. A101">' : "") + "</div>"
      + '<div class="card"><div class="label">Unit size they\u2019re looking for</div><input data-lead="unitSize" value="' + esc(d.unitSize || "") + '"' + (d.sizeUnknown ? " disabled" : "") + ' placeholder="e.g. 10x10, climate 5x5"><button class="check full' + (d.sizeUnknown ? " on" : "") + '" data-a="leadtog2" data-k="sizeUnknown"><span class="bx">' + (d.sizeUnknown ? I("check") : "") + "</span>Size unknown</button></div>"
      + fuScheduleCard(d, d.firstFollowup, "data-leadfu", '<div class="label">Reason for changing the follow-up date (required)</div><textarea rows="2" data-lead="firstFollowupReason" placeholder="What did the customer say that means a later follow-up?">' + esc(d.firstFollowupReason || "") + "</textarea>")
      + '<div class="card"><div class="label">Notes</div><textarea rows="4" data-lead="notes" placeholder="Add as much detail about the conversation as possible \u2014 what they want, timing, pricing discussed, objections, anything useful for the next call.">' + esc(d.notes || "") + "</textarea></div>"
      + '<button class="btn btn-dark" data-a="savelead" style="width:100%;justify-content:center">' + I("plus") + " Save lead</button></div>";
  }
  function leadRow(l) {
    var badge = l.status === "warm" ? '<span class="pill" style="background:#FBEAE1;color:var(--hazard-d)">Warm</span>' : l.status === "rented" ? '<span class="pill" style="background:#E1F0E9;color:var(--ok)">Moved in</span>' : '<span class="pill">Cold</span>';
    return '<button class="frow" data-a="openlead" data-id="' + l.id + '"><span class="fi">' + I("user") + '</span><span class="fbody"><span class="fname">' + esc(l.nameUnknown ? "(name unknown)" : l.name || "(no name)") + '</span><span class="faddr">' + esc(facName(l.facilityId)) + (l.estMoveIn && !l.moveInUnknown ? " · move-in " + esc(l.estMoveIn) : "") + "</span></span>" + badge + "</button>";
  }
  function leadDetail(l) {
    var fuRow = function (f) {
      if (f.cancelled) return '<div class="dline muted">' + esc(f.label) + " — skipped</div>";
      if (f.completed) { var fm = f.form || {}; return '<div class="dline">' + I("check") + " " + esc(f.label) + " — done " + fdt(f.completedAt) + (fm.notInterested ? " · not interested" : fm.movedIn ? " · moved in" : fm.answered ? " · spoke with customer" : " · no answer") + "</div>"; }
      if (f.dueAt <= Date.now()) return '<button class="btn btn-dark sm" data-a="dofu" data-lid="' + l.id + '" data-fid="' + f.id + '" style="width:100%;justify-content:space-between;margin-top:6px">' + esc(f.label) + " — do now" + I("chevron-right") + "</button>";
      return '<div class="dline muted">' + esc(f.label) + " — due " + fdt(f.dueAt) + "</div>";
    };
    return '<button class="btn" data-a="leadback" style="margin-bottom:12px">' + I("arrow-left") + ' Lead tracking</button><div class="stack">'
      + '<div class="card"><div class="between"><h4 style="margin:0">' + esc(l.nameUnknown ? "(name unknown)" : l.name || "(no name)") + '</h4><span class="pill">' + esc(l.kind) + '</span></div><div class="kv" style="margin-top:8px"><span>Facility</span><span>' + esc(facName(l.facilityId)) + "</span><span>Move-in</span><span>" + (l.moveInUnknown ? "unknown" : esc(l.estMoveIn || "—")) + "</span><span>Unit size</span><span>" + (l.sizeUnknown ? "unknown" : esc(l.unitSize || "—")) + "</span><span>Phone</span><span>" + esc(l.phone || "—") + (l.phone2 ? " / " + esc(l.phone2) : "") + "</span><span>Email</span><span>" + esc(l.email || "—") + "</span></div>" + (l.kind === "reservation" ? '<div class="da" style="margin-top:8px">In Cubby: ' + (l.inCubby ? "Yes" : "No") + " \u00b7 SpareFoot: " + (l.spareFoot ? "Yes" : "No") + " \u00b7 Informed of promos: " + (l.informedDiscounts ? "Yes" : "No") + "</div>" : '<div class="da" style="margin-top:8px">Informed of promos: ' + (l.informedDiscounts ? "Yes" : "No") + "</div>") + "</div>"
      + '<div class="card"><div class="label">Notes</div><textarea rows="4" data-lnote="' + l.id + '" placeholder="Add notes about this customer at any time\u2026">' + esc(l.notes || "") + '</textarea><div class="saved" style="margin-top:6px">' + I("check") + " Notes save automatically.</div></div>"
      + '<div class="card"><div class="label">Status</div><div class="cond"><button class="' + (l.status === "warm" ? "ok" : "") + '" data-a="setlead" data-id="' + l.id + '" data-v="warm">Warm</button><button class="' + (l.status === "rented" ? "ok" : "") + '" data-a="setlead" data-id="' + l.id + '" data-v="rented">Moved in</button><button class="' + (l.status === "cold" ? "bad" : "") + '" data-a="setlead" data-id="' + l.id + '" data-v="cold">Cold</button></div></div>'
      + '<div class="card dgrp"><div class="dh">Follow-ups</div>' + ((l.followups || []).length ? l.followups.slice().sort(function (a, b) { return a.dueAt - b.dueAt; }).map(fuRow).join("") : '<div class="dline muted">No follow-ups (only warm leads get a follow-up schedule).</div>') + "</div>"
      + '<button class="btn btn-danger" data-a="dellead" data-id="' + l.id + '">' + I("trash") + " Delete lead</button></div>";
  }
  function followupForm(l, f) {
    var d = S.fuDraft || {};
    var tel = function (n) { return n ? '<a href="tel:' + esc(n.replace(/[^0-9+]/g, "")) + '">' + esc(n) + "</a>" : ""; };
    var contact = '<div class="kv" style="margin-top:8px"><span>Phone</span><span>' + (l.phone ? tel(l.phone) : "\u2014") + (l.phone2 ? " / " + tel(l.phone2) : "") + "</span><span>Email</span><span>" + (l.email ? '<a href="mailto:' + esc(l.email) + '">' + esc(l.email) + "</a>" : "\u2014") + "</span></div>";
    return '<button class="btn" data-a="fuback" style="margin-bottom:12px">' + I("arrow-left") + ' Lead</button><div class="stack">'
      + '<div class="card"><div class="eyebrow">Follow-up</div><h4 style="margin:2px 0">' + esc(f.label) + '</h4><div class="muted">' + esc(l.nameUnknown ? "(name unknown)" : l.name) + " \u00b7 " + esc(facName(l.facilityId)) + "</div>" + contact + "</div>"
      + '<div class="card">' + fuT("Has the customer moved in on Cubby yet?", "movedInCubby", d.movedInCubby) + '<button class="check full' + (d.confirmedNotMovedCubby ? " on" : "") + '" data-a="futog2" data-k="confirmedNotMovedCubby"><span class="bx">' + (d.confirmedNotMovedCubby ? I("check") : "") + "</span>I confirmed the customer hasn't moved in on Cubby yet</button></div>"
      + '<div class="card"><div class="label">How did you reach out?</div><button class="check full' + (d.called ? " on" : "") + '" data-a="futog2" data-k="called"><span class="bx">' + (d.called ? I("check") : "") + '</span>Called</button><button class="check full' + (d.emailed ? " on" : "") + '" data-a="futog2" data-k="emailed"><span class="bx">' + (d.emailed ? I("check") : "") + '</span>Emailed</button><button class="check full' + (d.texted ? " on" : "") + '" data-a="futog2" data-k="texted"><span class="bx">' + (d.texted ? I("check") : "") + "</span>Texted</button></div>"
      + '<div class="card">' + fuT("Did the customer answer the phone?", "answered", d.answered)
      + (d.answered === true ? fuT("Did they move in?", "movedIn", d.movedIn) + fuT("Did they say they're not interested in renting?", "notInterested", d.notInterested) + (d.movedIn === true ? '<div class="label">Unit they moved into (required)</div><input data-fu="moveInUnit" value="' + esc(d.moveInUnit || "") + '" placeholder="e.g. A101">' + (l.nameUnknown ? '<div class="label">Customer name (required for a move-in)</div><input data-fu="custName" value="' + esc(d.custName || "") + '">' : "") : "") + '<div class="label">Other notes about the call</div><textarea rows="2" data-fu="other">' + esc(d.other || "") + "</textarea>" : "") + "</div>"
      + '<div class="card"><button class="check full' + (d.confirmedMoveIn ? " on" : "") + '" data-a="futog2" data-k="confirmedMoveIn"><span class="bx">' + (d.confirmedMoveIn ? I("check") : "") + "</span>Spoke with the customer \u2014 confirmed they\u2019ll pay on the move-in date</button><p class=\"hint\" style=\"margin:6px 0 0\">Only mark this if the customer confirmed they will plan on paying on the actual date of move-in. Don\u2019t mark it if they didn\u2019t confirm. If checked, the next follow-up is the move-in day.</p></div>"
      + fuScheduleCard(l, d.nextFollowup, "data-funext", '<div class="label">Reason for changing the follow-up date (required)</div><textarea rows="2" data-fu="nextFollowupReason" placeholder="What did the customer say that means a later follow-up?">' + esc(d.nextFollowupReason || "") + "</textarea>")
      + '<div class="card"><div class="label">Notes</div><textarea rows="4" data-fu="notes" placeholder="Add as much detail about the conversation as possible \u2014 what was said, next steps, anything useful for the next call.">' + esc(d.notes || "") + "</textarea></div>"
      + (d.notInterested ? '<div class="note">Marking this complete will move the lead to the Cold bucket.</div>' : d.movedIn ? '<div class="note" style="border-color:var(--ok);color:var(--ok)">Marking this complete will move the lead to Moved in.</div>' : "")
      + '<button class="btn btn-ok" data-a="savefu" data-lid="' + l.id + '" data-fid="' + f.id + '" style="width:100%;justify-content:center">' + I("check") + " Mark follow-up complete</button></div>";
  }
  function fuT(label, key, val) { return '<div class="qrow"><span>' + label + '</span><div class="seg"><button class="' + (val === true ? "sel" : "") + '" data-a="futog" data-k="' + key + '" data-v="1">Yes</button><button class="' + (val === false ? "sel" : "") + '" data-a="futog" data-k="' + key + '" data-v="0">No</button></div></div>'; }
  function moveInTracker() {
    var now = new Date(), nowKey = now.getFullYear() + "-" + ("0" + (now.getMonth() + 1)).slice(-2), prev = !!S.trackerPrev;
    var mv = {};
    (S.leads || []).filter(function (l) { return l.status === "rented"; }).forEach(function (l) {
      var ts = l.movedInAt || l.createdAt, d = new Date(ts), key = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2), emp = l.movedInBy || l.createdBy || "Unknown";
      if (!mv[key]) mv[key] = { label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }), total: 0, emp: {} };
      mv[key].total++; (mv[key].emp[emp] = mv[key].emp[emp] || []).push(l);
    });
    var rv = {};
    (S.reviews || []).forEach(function (r) {
      var d = new Date(r.createdAt), key = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2), emp = r.createdBy || r.employee || "Unknown";
      if (!rv[key]) rv[key] = { label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }), total: 0, emp: {} };
      rv[key].total++; (rv[key].emp[emp] = rv[key].emp[emp] || []).push(r);
    });
    var empRows = function (m, prefix, mk, renderItem) {
      return Object.keys(m.emp).sort(function (a, b) { return m.emp[b].length - m.emp[a].length; }).map(function (e) {
        var openKey = prefix + mk + "::" + e, isOpen = S.trackerOpen === openKey;
        var detail = isOpen ? m.emp[e].map(renderItem).join("") : "";
        return '<button class="dline" data-a="trackopen" data-k="' + openKey + '" style="display:flex;justify-content:space-between;align-items:center;width:100%;background:none;border:0;border-bottom:1px solid var(--line2);text-align:left;cursor:pointer"><span>' + (isOpen ? I("chevron-down") : I("chevron-right")) + " " + esc(e) + '</span><span style="font-weight:700">' + m.emp[e].length + "</span></button>" + detail;
      }).join("");
    };
    var mvCard = function (mk) {
      var m = mv[mk]; if (!m) return mk === nowKey ? '<div class="card"><div style="font-weight:700">' + monthLabel(mk) + '</div><div class="muted" style="font-size:13px;margin-top:4px">No move-ins this month.</div></div>' : "";
      return '<div class="card"><div class="between"><div style="font-weight:700">' + esc(m.label) + '</div><span class="pill" style="background:#E1F0E9;color:var(--ok)">' + m.total + ' moved in</span></div><div class="dgrp" style="margin-top:8px">' + empRows(m, "", mk, function (l) { return '<div class="dline" style="padding-left:10px"><b>' + esc(l.nameUnknown ? "(name unknown)" : l.name || "(no name)") + "</b> \u00b7 " + esc(facName(l.facilityId)) + " \u00b7 Unit " + esc(l.moveInUnit || "\u2014") + '<div class="da">' + fdt(l.movedInAt || l.createdAt) + "</div></div>"; }) + "</div></div>";
    };
    var rvCard = function (mk) {
      var m = rv[mk]; if (!m) return mk === nowKey ? '<div class="card"><div style="font-weight:700">' + monthLabel(mk) + '</div><div class="muted" style="font-size:13px;margin-top:4px">No Google reviews this month.</div></div>' : "";
      return '<div class="card"><div class="between"><div style="font-weight:700">' + esc(m.label) + '</div><span class="pill" style="background:#E8EEF7;color:#2c4a7c">' + m.total + " review" + (m.total === 1 ? "" : "s") + '</span></div><div class="dgrp" style="margin-top:8px">' + empRows(m, "rev::", mk, function (r) { return '<div class="dline" style="padding-left:10px"><b>' + esc(r.customer || "(no name)") + "</b> \u00b7 " + esc(facName(r.facilityId)) + '<div class="da">' + fdt(r.createdAt) + ' <button class="icon-btn danger" data-a="reviewdel" data-id="' + r.id + '" style="padding:0 4px">' + I("trash") + "</button></div></div>"; }) + "</div></div>";
    };
    var mvPrev = Object.keys(mv).sort().reverse().filter(function (k) { return k !== nowKey; });
    var rvPrev = Object.keys(rv).sort().reverse().filter(function (k) { return k !== nowKey; });
    var toggle = '<button class="btn sm" data-a="trackprev" style="margin:8px 0">' + (prev ? I("chevron-up") + " Hide previous months" : I("chevron-down") + " Show previous months") + "</button>";
    var moveBlock = '<div class="dh">Move-ins \u2014 this month</div>' + mvCard(nowKey) + (mvPrev.length ? toggle + (prev ? mvPrev.map(mvCard).join("") : "") : "");
    var revBlock = '<div class="dh" style="margin-top:18px">Google reviews \u2014 this month</div>' + rvCard(nowKey) + (rvPrev.length ? toggle + (prev ? rvPrev.map(rvCard).join("") : "") : "");
    return moveBlock + revBlock;
  }
  function leadsView() {
    if (S.fuOpen) { var Lf = (S.leads || []).find(function (x) { return x.id === S.fuOpen.leadId; }); var Ff = Lf && (Lf.followups || []).find(function (x) { return x.id === S.fuOpen.fuId; }); if (Lf && Ff) return followupForm(Lf, Ff); S.fuOpen = null; }
    if (S.leadAdd) return leadAddForm();
    if (S.reviewAdd) return reviewAddForm();
    if (S.leadOpen) { var Lo = (S.leads || []).find(function (x) { return x.id === S.leadOpen; }); if (Lo) return leadDetail(Lo); S.leadOpen = null; }
    var tab = S.leadTab || "warm", due = dueFollowups();
    var counts = { warm: (S.leads || []).filter(function (l) { return leadBucket(l) === "warm"; }).length, cold: (S.leads || []).filter(function (l) { return leadBucket(l) === "cold"; }).length, movedin: (S.leads || []).filter(function (l) { return leadBucket(l) === "movedin"; }).length, todo: due.length };
    var bt = [["warm", "Warm"], ["cold", "Cold"], ["todo", "To-do"], ["tracker", "Move-in tracker"]];
    var tabs = '<div class="tabs">' + bt.map(function (t) { return '<button class="' + (tab === t[0] ? "on" : "") + '" data-a="leadtab" data-k="' + t[0] + '">' + esc(t[1]) + (t[0] === "todo" ? " (" + counts.todo + ")" : "") + "</button>"; }).join("") + "</div>";
    var content;
    if (tab === "tracker") content = moveInTracker();
    else if (tab === "todo") content = due.length ? '<div class="list">' + due.map(function (x) { return '<button class="frow" data-a="dofu" data-lid="' + x.lead.id + '" data-fid="' + x.fu.id + '"><span class="fi">' + I("bell") + '</span><span class="fbody"><span class="fname">' + esc(x.lead.nameUnknown ? "(name unknown)" : x.lead.name || "(no name)") + " — " + esc(x.fu.label) + '</span><span class="faddr">Due ' + fdt(x.fu.dueAt) + " \u00b7 " + esc(facName(x.lead.facilityId)) + (x.lead.phone ? " \u00b7 " + esc(x.lead.phone) : "") + "</span></span>" + I("chevron-right") + "</button>"; }).join("") + "</div>" : '<div class="empty">' + I("circle-check") + " Nothing due right now.</div>";
    else { var ls = (S.leads || []).filter(function (l) { return leadBucket(l) === tab; }); content = ls.length ? '<div class="list">' + ls.map(leadRow).join("") + "</div>" : '<div class="empty">No ' + tab + " leads.</div>"; }
    var recentSF = (S.leads || []).filter(function (l) { return l.spareFoot && l.createdAt >= Date.now() - 16 * 3600000; }).sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 3);
    var sfCard = recentSF.length ? '<div class="card" style="border-color:var(--hazard-d);background:#FBEAE1;margin-bottom:12px"><div style="font-weight:700;color:var(--hazard-d)">' + I("alert-triangle") + ' Recent SpareFoot reservations (last 16 hrs)</div><p class="hint" style="margin:5px 0 8px">Check here before adding a SpareFoot reservation so it doesn\u2019t get entered twice.</p>' + recentSF.map(function (l) { return '<button class="frow" data-a="openlead" data-id="' + l.id + '" style="background:#fff"><span class="fi">' + I("calendar-check") + '</span><span class="fbody"><span class="fname">' + esc(l.nameUnknown ? "(name unknown)" : l.name || "(no name)") + '</span><span class="faddr">' + esc(facName(l.facilityId)) + " \u00b7 added " + fdt(l.createdAt) + "</span></span>" + I("chevron-right") + "</button>"; }).join("") + "</div>" : "";
    return sfCard + '<div class="between"><h3>Lead tracking</h3><span class="row" style="gap:6px"><button class="btn sm" data-a="addreview">' + I("star") + ' Add Google review</button><button class="btn btn-dark sm" data-a="addlead">' + I("plus") + ' Add new lead</button></span></div><p class="hint">Track potential customers and their follow-ups.</p>' + tabs + content;
  }
  function reviewAddForm() {
    var d = S.reviewDraft || {};
    var facOpts = '<option value="">— pick a facility —</option>' + S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (d.facilityId === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("");
    return '<button class="btn" data-a="reviewback" style="margin-bottom:10px">' + I("arrow-left") + ' Lead tracking</button><h3>Add Google review</h3><div class="card">'
      + '<div class="label">Customer name</div><input data-rv="customer" value="' + esc(d.customer || "") + '">'
      + '<div class="label">Facility</div><select data-rv="facilityId">' + facOpts + "</select>"
      + '<p class="hint" style="margin:8px 0 0">This review will be credited to you (' + esc((S.auth && S.auth.name) || "you") + ").</p>"
      + '<button class="btn btn-dark" data-a="reviewsave" style="width:100%;justify-content:center;margin-top:12px">' + I("star") + " Save Google review</button></div>";
  }
  function employee() {
    if (S.editId && S.infoMode) { var efi = S.facilities.find(function (x) { return x.id === S.editId; }); if (efi) return facInfoPage(efi); }
    var T = [["leads", "Lead tracking"], ["facinfo", "Facility info"], ["maint", "Maintenance"], ["inventory", "Inventory"], ["contractors", "Contractors"]];
    var tab = S.tab && T.some(function (t) { return t[0] === S.tab; }) ? S.tab : "leads";
    var tabs = '<div class="tabs">' + T.map(function (t) { return '<button class="' + (tab === t[0] ? "on" : "") + '" data-a="tab" data-k="' + t[0] + '">' + esc(t[1]) + "</button>"; }).join("") + "</div>";
    if (tab === "leads") return tabs + leadsView();
    if (tab === "maint") return tabs + maintenanceHome();
    if (tab === "facinfo") {
      return tabs + '<h3>Facility information</h3><p class="hint">Pick a facility to view its information sheet.</p><div class="list">'
        + S.facilities.map(function (f) { return '<button class="frow" data-a="openinfo" data-id="' + f.id + '"><span class="fi">' + I("building-warehouse") + '</span><span class="fbody"><span class="fname">' + esc(f.name) + '</span><span class="faddr">' + esc(f.address || "No address yet") + "</span></span>" + I("chevron-right") + "</button>"; }).join("") + "</div>";
    }
    if (!S.secFac) { var titles = { inventory: "Inventory", contractors: "Contractors" }, blurbs = { inventory: "Pick a facility to manage its inventory.", contractors: "Pick a facility to manage its contractors." }; return tabs + secPicker(titles[tab], blurbs[tab]); }
    var fsec = S.facilities.find(function (x) { return x.id === S.secFac; }); if (!fsec) { S.secFac = null; return employee(); }
    var inner = tab === "inventory" ? inventorySection(fsec) : contractorsSection(fsec);
    return tabs + '<button class="btn" data-a="backsec" style="margin-bottom:12px">' + I("arrow-left") + " All facilities</button>" + inner;
  }

  /* ---------- payables / invoices (admins) ---------- */
  function payCard(p, actions) {
    return '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div style="font-weight:700">' + esc(facName(p.facilityId)) + '</div><span class="muted" style="font-size:12px">Logged ' + fdt(p.createdAt) + '</span></div>'
      + '<div class="kv" style="margin-top:8px"><span>Type</span><span>' + esc(p.who) + "</span><span>Contractor</span><span>" + esc(p.contractorName || "\u2014") + "</span><span>Service</span><span>" + esc(p.description || "\u2014") + "</span><span>Amount owed</span><span>" + esc(showAmt(p.amount) || "\u2014") + "</span><span>Payment cycle</span><span>" + (p.cycleDate ? fmtDate(p.cycleDate) : "\u2014") + "</span><span>Mailing address</span><span>" + esc(p.mailingAddress || "\u2014") + "</span></div>"
      + (p.invoice ? '<a href="' + esc(p.invoice) + '" target="_blank" rel="noopener" class="muted" style="font-size:12px;display:inline-block;margin-top:6px">' + I("paperclip") + " View attached invoice" + (p.invoice.indexOf("application/pdf") >= 0 ? " (PDF)" : "") + "</a>" : "")
      + (actions || "") + "</div>";
  }
  function payableForm() {
    var d = S.payDraft || {};
    var facOpts = S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (d.facilityId === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("");
    var attach = d.invoice ? '<div class="row" style="gap:8px;align-items:center">' + (d.invoiceType === "pdf" ? '<span class="pill">' + I("file-text") + " " + esc(d.invoiceName || "PDF") + "</span>" : '<img src="' + esc(d.invoice) + '" style="height:54px;border-radius:8px;border:1px solid var(--line)">') + '<button class="btn sm danger" data-a="payinvoicedel">' + I("trash") + " Remove</button></div>" : '<label class="addph" style="display:inline-flex">' + I("paperclip") + 'Attach photo or PDF<input type="file" accept="image/*,application/pdf" style="display:none" data-payinvoice></label>';
    return '<div class="stack">'
      + '<div class="card"><p class="hint" style="margin:0 0 10px">All fields are required except the mailing address and invoice.</p>'
      + '<div class="label">Facility</div><select data-pay="facilityId"><option value="">— pick a facility —</option>' + facOpts + "</select>"
      + '<div class="label">On-site maintenance or sub contractor?</div><div class="cond"><button class="' + (d.who === "On-site maintenance" ? "ok" : "") + '" data-a="paywho" data-v="On-site maintenance">On-site maintenance</button><button class="' + (d.who === "Sub contractor" ? "ok" : "") + '" data-a="paywho" data-v="Sub contractor">Sub contractor</button></div>'
      + '<div class="label">Contractor name</div><input data-pay="contractorName" value="' + esc(d.contractorName || "") + '">'
      + '<div class="label">Description of service</div><textarea rows="2" data-pay="description">' + esc(d.description || "") + "</textarea>"
      + '<div class="two-col"><div><div class="label">Payment amount owed</div><input data-pay="amount" value="' + esc(d.amount || "") + '" placeholder="$"></div><div><div class="label">Payment cycle date</div><input type="date" data-pay="cycleDate" value="' + esc(d.cycleDate || "") + '"></div></div>'
      + '<div class="label">Mailing address (optional)</div><textarea rows="2" data-pay="mailingAddress">' + esc(d.mailingAddress || "") + "</textarea>"
      + '<div class="label">Attach invoice (optional)</div>' + attach
      + '<button class="btn btn-dark" data-a="paysave" style="width:100%;justify-content:center;margin-top:12px">' + I("plus") + " Submit payable</button></div></div>";
  }
  function payPending() {
    var pend = (S.payables || []).filter(function (p) { return p.status === "pending"; });
    var rej = (S.payables || []).filter(function (p) { return p.status === "rejected"; });
    var pendHtml = pend.length ? pend.map(function (p) { return payCard(p, '<div class="row" style="gap:8px;margin-top:10px"><button class="btn btn-ok sm" data-a="payapprove" data-id="' + p.id + '">' + I("check") + ' Approve &amp; paid</button><button class="btn sm danger" data-a="payreject" data-id="' + p.id + '">Reject</button></div>'); }).join("") : '<div class="empty">No pending payables.</div>';
    var rejHtml = rej.length ? '<div class="dh" style="margin-top:16px">Rejected (' + rej.length + ")</div>" + rej.map(function (p) { return payCard(p, '<div class="row" style="justify-content:space-between;margin-top:8px"><span class="pill" style="background:#F7E4E1;color:var(--alert)">Rejected</span><button class="icon-btn danger" data-a="paydel" data-id="' + p.id + '">' + I("trash") + "</button></div>"); }).join("") : "";
    return '<div class="dh">Pending approval (' + pend.length + ")</div><div class=\"stack\" style=\"margin-top:6px\">" + pendHtml + "</div>" + rejHtml;
  }
  function payExpenses() {
    var appr = (S.payables || []).filter(function (p) { return p.status === "approved" && !p.billedBack; });
    if (!appr.length) return '<div class="empty">No expenses awaiting bill-back.</div>';
    var byFac = {};
    appr.forEach(function (p) { (byFac[p.facilityId] = byFac[p.facilityId] || []).push(p); });
    return '<p class="hint" style="margin-bottom:8px">Approved expenses by facility. Mark one billed back to move it to the Billed back bucket.</p>' + Object.keys(byFac).map(function (fid) {
      return '<div class="dh" style="margin-top:8px">' + esc(facName(fid)) + "</div><div class=\"stack\" style=\"margin-top:6px\">" + byFac[fid].map(function (p) {
        return payCard(p, '<button class="check full" data-a="paybilled" data-id="' + p.id + '" style="margin-top:10px"><span class="bx"></span>Mark billed back to facility</button>');
      }).join("") + "</div>";
    }).join("");
  }
  function payBilledBack() {
    var bb = (S.payables || []).filter(function (p) { return p.status === "approved" && p.billedBack; });
    if (!bb.length) return '<div class="empty">Nothing billed back yet.</div>';
    var byFac = {};
    bb.forEach(function (p) { (byFac[p.facilityId] = byFac[p.facilityId] || []).push(p); });
    return Object.keys(byFac).map(function (fid) {
      return '<div class="dh" style="margin-top:8px">' + esc(facName(fid)) + "</div><div class=\"stack\" style=\"margin-top:6px\">" + byFac[fid].map(function (p) {
        return payCard(p, '<div class="row" style="justify-content:space-between;margin-top:10px"><span class="pill" style="background:#E1F0E9;color:var(--ok)">' + I("check") + " Billed back" + (p.billedBackAt ? " " + fdt(p.billedBackAt) : "") + '</span><button class="btn sm" data-a="paybilled" data-id="' + p.id + '">Undo</button></div>');
      }).join("") + "</div>";
    }).join("");
  }
  function recurringView() {
    var d = S.recDraft || {};
    var facOpts = S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (d.facilityId === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("");
    var form = '<div class="card"><div style="font-weight:600">' + I("plus") + ' Add a recurring on-site payment</div>'
      + '<div class="label">Facility</div><select data-rec="facilityId"><option value="">— pick —</option>' + facOpts + "</select>"
      + '<div class="two-col"><div><div class="label">Name</div><input data-rec="name" value="' + esc(d.name || "") + '"></div><div><div class="label">Amount</div><input data-rec="amount" value="' + esc(d.amount || "") + '" placeholder="$"></div></div>'
      + '<div class="label">Payment occurrence</div><input data-rec="occurrence" value="' + esc(d.occurrence || "") + '" placeholder="e.g. Monthly, every 2 weeks">'
      + '<button class="btn btn-dark" data-a="recadd" style="width:100%;justify-content:center;margin-top:10px">' + I("plus") + " Add recurring payment</button></div>";
    var rows = (S.recurring || []).map(function (r) {
      if (S.recEditId === r.id) {
        var fo = S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (r.facilityId === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("");
        return '<div class="card" style="border-color:var(--hazard-d)"><div class="label">Facility</div><select data-recf="' + r.id + '|facilityId"><option value="">— pick —</option>' + fo + '</select><div class="two-col"><div><div class="label">Name</div><input data-recf="' + r.id + '|name" value="' + esc(r.name || "") + '"></div><div><div class="label">Amount</div><input data-recf="' + r.id + '|amount" value="' + esc(r.amount || "") + '" placeholder="$"></div></div><div class="label">Payment occurrence</div><input data-recf="' + r.id + '|occurrence" value="' + esc(r.occurrence || "") + '"><div class="label">Most recent payment</div><input type="date" data-recdate="' + r.id + '" value="' + esc(r.lastPaidDate || "") + '"><div class="row" style="gap:8px;margin-top:10px"><button class="btn btn-ok sm" data-a="recdone">' + I("check") + ' Done</button><button class="icon-btn danger" data-a="recdel" data-id="' + r.id + '">' + I("trash") + "</button></div></div>";
      }
      return '<div class="card"><div class="between"><div style="font-weight:700">' + esc(r.name || "(no name)") + '</div><button class="btn sm" data-a="recedit" data-id="' + r.id + '">' + I("edit") + ' Edit</button></div><div class="kv" style="margin-top:6px"><span>Facility</span><span>' + esc(facName(r.facilityId)) + "</span><span>Amount</span><span>" + esc(showAmt(r.amount) || "\u2014") + "</span><span>Occurrence</span><span>" + esc(r.occurrence || "\u2014") + '</span></div><div class="label">Most recent payment</div><input type="date" data-recdate="' + r.id + '" value="' + esc(r.lastPaidDate || "") + '">' + (r.lastPaidDate ? '<div class="muted" style="font-size:12px;margin-top:4px">Most recent: ' + fmtDate(r.lastPaidDate) + "</div>" : "") + "</div>";
    }).join("");
    return form + '<div class="dh" style="margin-top:16px">Recurring payments (' + (S.recurring || []).length + ")</div>" + ((S.recurring || []).length ? '<div class="stack" style="margin-top:6px">' + rows + "</div>" : '<div class="empty">None yet.</div>');
  }
  function money(n) { n = parseFloat(n); return isNaN(n) ? "$0.00" : "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function expenseCard(e, actions) {
    var src = e.source === "Other" ? (e.sourceOther || "Other") : "American Express";
    return '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div style="font-weight:700">' + esc(showAmt(e.amount) || "\u2014") + '</div><span class="muted" style="font-size:12px">' + (e.datePaid ? fmtDate(e.datePaid) : "") + '</span></div><div class="kv" style="margin-top:6px"><span>Source</span><span>' + esc(src) + "</span><span>Description</span><span>" + esc(e.description || "\u2014") + "</span></div>" + (actions || "") + "</div>";
  }
  function addExpenseForm() {
    var d = S.expDraft || { entries: [] }; if (!d.entries) d.entries = [{ id: uid(), facilityId: "", amount: "", source: "American Express", sourceOther: "", description: "", datePaid: "" }];
    var facOpts = function (sel) { return '<option value=""' + (!sel ? " selected" : "") + ">General (no facility)</option>" + S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (sel === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join(""); };
    var rows = d.entries.map(function (e) {
      return '<div class="card" style="padding:10px"><div class="between" style="margin-bottom:6px"><div class="label" style="margin:0">Expense</div><button class="icon-btn danger" data-a="eedel" data-id="' + e.id + '">' + I("trash") + "</button></div>"
        + '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">'
        + '<div style="flex:2;min-width:150px"><div class="label" style="margin:0 0 2px">Facility</div><select data-ee="' + e.id + '|facilityId">' + facOpts(e.facilityId) + "</select></div>"
        + '<div style="flex:1;min-width:110px"><div class="label" style="margin:0 0 2px">Amount</div><input data-ee="' + e.id + '|amount" value="' + esc(e.amount || "") + '" placeholder="$"></div>'
        + '<div style="flex:1;min-width:130px"><div class="label" style="margin:0 0 2px">Date paid</div><input type="date" data-ee="' + e.id + '|datePaid" value="' + esc(e.datePaid || "") + '"></div>'
        + "</div>"
        + '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:8px">'
        + '<div style="flex:1;min-width:140px"><div class="label" style="margin:0 0 2px">Source</div><select data-ee="' + e.id + '|source"><option' + (e.source !== "Other" ? " selected" : "") + ">American Express</option><option" + (e.source === "Other" ? " selected" : "") + ">Other</option></select></div>"
        + (e.source === "Other" ? '<div style="flex:1;min-width:130px"><div class="label" style="margin:0 0 2px">Source name</div><input data-ee="' + e.id + '|sourceOther" value="' + esc(e.sourceOther || "") + '"></div>' : "")
        + '<div style="flex:2;min-width:160px"><div class="label" style="margin:0 0 2px">Description</div><input data-ee="' + e.id + '|description" value="' + esc(e.description || "") + '"></div>'
        + "</div></div>";
    }).join("");
    return '<button class="btn" data-a="expback" style="margin-bottom:10px">' + I("arrow-left") + ' Expenses</button><p class="hint">Add one or more expenses, then save them all at once. Leave the facility on \u201cGeneral\u201d for an expense not tied to a facility.</p>'
      + rows
      + '<button class="btn" data-a="eeadd" style="width:100%;justify-content:center;margin-top:8px">' + I("plus") + ' Add another expense</button>'
      + '<button class="btn btn-dark" data-a="expsave" style="width:100%;justify-content:center;margin-top:10px">' + I("check") + " Save expenses</button>";
  }
  function generalExpenses() {
    var gen = (S.expenses || []).filter(function (e) { return !e.facilityId; });
    return '<div class="between"><p class="hint" style="margin:0">Expenses not tied to any facility.</p><button class="btn btn-dark sm" data-a="expadd">' + I("plus") + " Add expense</button></div>"
      + (gen.length ? '<div class="stack" style="margin-top:8px">' + gen.map(function (e) { return expenseCard(e, '<div class="row" style="justify-content:flex-end;margin-top:6px"><button class="icon-btn danger" data-a="expdel" data-id="' + e.id + '">' + I("trash") + "</button></div>"); }).join("") + "</div>" : '<div class="empty">No general expenses.</div>');
  }
  function bbUnits(fid) { var bb = S.billback[fid] || {}; if (bb.units !== undefined && bb.units !== "") { var n = parseFloat(bb.units); return isNaN(n) ? 0 : n; } var fac = S.facilities.find(function (f) { return f.id === fid; }); return fac ? (fac.config.units || []).length : 0; }
  function billbackConfig() {
    var ed = !!S.bbEdit;
    var head = '<div class="between"><p class="hint" style="margin:0">Each facility\u2019s monthly bill-back. Management and software fees are per unit, times the unit count.</p>' + (ed ? '<button class="btn btn-ok sm" data-a="bbsave">' + I("check") + " Save" : '<button class="btn btn-dark sm" data-a="bbedit">' + I("edit") + " Edit") + "</button></div>";
    if (!ed) {
      var ro = function (label, val) { return '<div class="kv"><span style="color:#E0913C;font-weight:600">' + label + '</span><span style="color:var(--ink)">' + (val !== "" && val != null ? esc(String(val)) : "\u2014") + "</span></div>"; };
      return head + S.facilities.map(function (f) {
        var bb = S.billback[f.id] || {}; var units = bbUnits(f.id);
        var mgmt = parseFloat(bb.mgmtRate || 0) * units, soft = parseFloat(bb.softwareRate || 0) * units;
        var others = bb.otherFees || [];
        return '<div class="card"><div style="font-weight:700">' + esc(f.name) + "</div>"
          + ro("Number of units", units || "")
          + ro("Management fee / unit", bb.mgmtRate ? "$" + bb.mgmtRate + " (total " + money(mgmt) + ")" : "") 
          + ro("Software fee / unit", bb.softwareRate ? "$" + bb.softwareRate + " (total " + money(soft) + ")" : "")
          + ro("On-site fee", bb.onsiteFee ? "$" + bb.onsiteFee : "")
          + (others.length ? others.map(function (o) { return ro(o.description || "Other fee", o.amount ? "$" + o.amount : ""); }).join("") : ro("Other recurring fees", ""))
          + ro("Billing entity", bb.entityName) + ro("Entity address", bb.entityAddress)
          + "</div>";
      }).join("");
    }
    return head + S.facilities.map(function (f) {
        var bb = S.billback[f.id] || { units: "", mgmtRate: "", softwareRate: "", onsiteFee: "", otherFees: [], entityName: "", entityAddress: "" };
        var units = bbUnits(f.id);
        var mgmt = parseFloat(bb.mgmtRate || 0) * units, soft = parseFloat(bb.softwareRate || 0) * units;
        var others = bb.otherFees || [];
        return '<div class="card"><div style="font-weight:700">' + esc(f.name) + "</div>"
          + '<div class="label">Number of units</div><input data-bb="' + f.id + '|units" value="' + esc(bb.units || "") + '" placeholder="e.g. 120">'
          + '<div class="two-col"><div><div class="label">Management fee / unit</div><input data-bb="' + f.id + '|mgmtRate" value="' + esc(bb.mgmtRate || "") + '" placeholder="$"></div><div><div class="label">Management total</div><div class="da" style="font-weight:700;padding-top:8px">' + money(mgmt) + "</div></div></div>"
          + '<div class="two-col"><div><div class="label">Software fee / unit</div><input data-bb="' + f.id + '|softwareRate" value="' + esc(bb.softwareRate || "") + '" placeholder="$"></div><div><div class="label">Software total</div><div class="da" style="font-weight:700;padding-top:8px">' + money(soft) + "</div></div></div>"
          + '<div class="label">On-site fee (standard)</div><input data-bb="' + f.id + '|onsiteFee" value="' + esc(bb.onsiteFee || "") + '" placeholder="$">'
          + '<div class="between" style="margin-top:10px"><div class="label" style="margin:0">Other recurring fees</div><button class="btn sm" data-a="bbother" data-id="' + f.id + '">' + I("plus") + " Add</button></div>"
          + (others.length ? others.map(function (o) { return '<div class="litem"><input style="flex:2" data-bbf="' + f.id + "|" + o.id + '|description" value="' + esc(o.description || "") + '" placeholder="Description"><input style="flex:1" data-bbf="' + f.id + "|" + o.id + '|amount" value="' + esc(o.amount || "") + '" placeholder="$"><button class="icon-btn danger" data-a="bbotherdel" data-id="' + f.id + '" data-oid="' + o.id + '">' + I("trash") + "</button></div>"; }).join("") : '<div class="muted" style="font-size:13px;margin-top:4px">None.</div>')
          + '<div class="dh" style="margin-top:12px">Billing entity (shows on the invoice)</div><div class="label">Entity name</div><input data-bb="' + f.id + '|entityName" value="' + esc(bb.entityName || "") + '" placeholder="Copper River LLC"><div class="label">Entity address</div><input data-bb="' + f.id + '|entityAddress" value="' + esc(bb.entityAddress || "") + '" placeholder="P.O. Box 568, Augusta, KS 67010">'
          + "</div>";
      }).join("")
      + '<button class="btn btn-ok" data-a="bbsave" style="width:100%;justify-content:center;margin-top:6px">' + I("check") + " Save bill-back config</button>";
  }
  function payExpenses() {
    if (S.expAdd) return addExpenseForm();
    var payAppr = (S.payables || []).filter(function (p) { return p.status === "approved" && !p.billedBack; });
    var expFac = (S.expenses || []).filter(function (e) { return e.facilityId && !e.billedBack; });
    var facIds = {}; payAppr.forEach(function (p) { facIds[p.facilityId] = 1; }); expFac.forEach(function (e) { facIds[e.facilityId] = 1; });
    var ids = Object.keys(facIds);
    var body = ids.length ? ids.map(function (fid) {
      var pays = payAppr.filter(function (p) { return p.facilityId === fid; }), exps = expFac.filter(function (e) { return e.facilityId === fid; });
      return '<div class="dh" style="margin-top:8px">' + esc(facName(fid)) + '</div><div class="stack" style="margin-top:6px">'
        + pays.map(function (p) { return payCard(p, ""); }).join("")
        + exps.map(function (e) { return expenseCard(e, '<div class="row" style="justify-content:flex-end;margin-top:6px"><button class="icon-btn danger" data-a="expdel" data-id="' + e.id + '">' + I("trash") + "</button></div>"); }).join("")
        + "</div>";
    }).join("") : '<div class="empty">No expenses awaiting bill-back.</div>';
    return '<div class="between"><p class="hint" style="margin:0">Approved payables and added expenses, by facility. Bill them back by creating an invoice below.</p><button class="btn btn-dark sm" data-a="expadd">' + I("plus") + " Add expense</button></div>" + body + '<button class="btn btn-dark" data-a="configstart" style="width:100%;justify-content:center;margin-top:16px">' + I("file-text") + " Configure bill back</button>";
  }
  function monthLabel(m) { if (!m) return ""; var p = m.split("-"); var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1); return d.toLocaleDateString(undefined, { month: "long", year: "numeric" }); }
  function invChk(group, id, label, on) { return '<button class="check full' + (on ? " on" : "") + '" data-a="invtog" data-g="' + group + '" data-k="' + id + '"><span class="bx">' + (on ? I("check") : "") + "</span>" + esc(label) + "</button>"; }
  function feeListFor(fid) {
    var bb = S.billback[fid] || { mgmtRate: "", softwareRate: "", onsiteFee: "", otherFees: [] };
    var units = bbUnits(fid);
    var list = [["mgmt", "Management fee", parseFloat(bb.mgmtRate || 0) * units, true], ["software", "Software fee", parseFloat(bb.softwareRate || 0) * units, true], ["onsite", "On-site fee", parseFloat(bb.onsiteFee || 0), true]];
    (bb.otherFees || []).forEach(function (o) { list.push(["other_" + o.id, o.description || "Other fee", parseFloat(o.amount || 0), true]); });
    return list;
  }
  function configureBillBack() {
    var d = S.invDraft || {};
    var facOpts = '<option value="">— pick a facility —</option>' + S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (d.facilityId === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("");
    var head = '<button class="btn" data-a="configback" style="margin-bottom:10px">' + I("arrow-left") + ' Expenses</button><div class="card"><div class="label">Facility to bill</div><select data-invfac>' + facOpts + "</select></div>";
    if (!d.facilityId) return head;
    var fid = d.facilityId;
    var pays = (S.payables || []).filter(function (p) { return p.status === "approved" && !p.billedBack && p.facilityId === fid; });
    var exps = (S.expenses || []).filter(function (e) { return e.facilityId === fid && !e.billedBack; });
    var fees = feeListFor(fid), months = d.months || [];
    var ckPay = pays.map(function (p) { return invChk("pay", p.id, p.who + " — " + (p.contractorName || "") + " (" + money(p.amount) + ")", d.pay && d.pay[p.id]); }).join("");
    var ckExp = exps.map(function (e) { return invChk("exp", e.id, (e.source === "Other" ? (e.sourceOther || "Other") : "American Express") + (e.description ? " — " + e.description : "") + " (" + money(e.amount) + ")", d.exp && d.exp[e.id]); }).join("");
    var ckFee = fees.map(function (fr) { return invChk("fee", fr[0], fr[1] + " (" + money(fr[2]) + "/mo)", d.fee && d.fee[fr[0]]); }).join("");
    var monthChips = months.map(function (m) { return '<span class="pill" style="margin:0 6px 6px 0">' + monthLabel(m) + ' <button data-a="invdelmonth" data-k="' + m + '" style="border:0;background:none;cursor:pointer;padding:0 0 0 4px">' + I("x") + "</button></span>"; }).join("");
    var expTotal = exps.filter(function (e) { return d.exp && d.exp[e.id]; }).reduce(function (s, e) { return s + parseFloat(e.amount || 0); }, 0);
    var payTotal = pays.filter(function (p) { return d.pay && d.pay[p.id]; }).reduce(function (s, p) { return s + parseFloat(p.amount || 0); }, 0);
    var feePerMonth = fees.filter(function (fr) { return d.fee && d.fee[fr[0]]; }).reduce(function (s, fr) { return s + fr[2]; }, 0);
    var total = expTotal + payTotal + feePerMonth * months.length;
    return head
      + '<div class="card"><div class="dh">One-time expenses to bill</div>' + ((ckPay + ckExp) || '<div class="muted" style="font-size:13px">None awaiting bill-back.</div>') + "</div>"
      + '<div class="card"><div class="dh">Recurring monthly fees</div><p class="hint" style="margin:0 0 6px">From the Bill-back config tab. Billed once per selected month.</p>' + (ckFee || '<div class="muted" style="font-size:13px">No fees configured for this facility.</div>') + "</div>"
      + '<div class="card"><div class="dh">Months to bill</div><p class="hint" style="margin:0 0 8px;color:var(--alert)">Pick a month, then click <b>Add month</b>. A month is only billed if it shows as a chip below. Just picking the date is not enough.</p><div class="row" style="gap:8px;align-items:center"><input type="month" data-invmonth value="' + esc(d.monthPick || "") + '"><button class="btn sm" data-a="invaddmonth">' + I("plus") + ' Add month</button></div><div class="row" style="flex-wrap:wrap;margin-top:8px">' + (monthChips || '<span class="muted" style="font-size:13px">No months added (recurring fees won\u2019t be billed).</span>') + "</div></div>"
      + '<div class="card"><div class="between"><div style="font-weight:700">Invoice total</div><div style="font-weight:700">' + money(total) + '</div></div><button class="btn btn-dark" data-a="invgen" style="width:100%;justify-content:center;margin-top:10px">' + I("file-text") + " Generate invoice</button></div>";
  }
  function invCard(i, paid) {
    return '<div class="card"><div class="between"><div style="font-weight:700">' + esc(i.number) + '</div><span class="muted" style="font-size:12px">' + fdt(i.createdAt) + '</span></div><div class="kv" style="margin-top:6px"><span>Facility</span><span>' + esc(facName(i.facilityId)) + "</span><span>Months</span><span>" + ((i.months || []).map(monthLabel).join(", ") || "\u2014") + '</span><span>Total</span><span style="font-weight:700">' + money(i.total) + "</span></div>"
      + '<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn btn-dark sm" data-a="invpdf" data-id="' + i.id + '">' + I("download") + " Download PDF</button>"
      + (paid ? '<span class="pill" style="background:#E1F0E9;color:var(--ok)">' + I("check") + " Billed back" + (i.paidAt ? " " + fdt(i.paidAt) : "") + "</span>" : '<button class="btn btn-ok sm" data-a="invpaid" data-id="' + i.id + '">' + I("check") + " Mark billed back</button>")
      + '<button class="icon-btn danger" data-a="invdel" data-id="' + i.id + '">' + I("trash") + "</button></div></div>";
  }
  function invFacPicker() {
    var v = S.invFac === undefined ? "__none" : S.invFac;
    return '<div class="card"><div class="label">Show invoices for facility</div><select data-invviewfac><option value="__none"' + (v === "__none" ? " selected" : "") + ">\u2014 select \u2014</option>" + S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (v === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("") + "</select></div>";
  }
  function invoicesView() {
    var open = (S.invoices || []).filter(function (i) { return i.status === "open"; });
    var paid = (S.invoices || []).filter(function (i) { return i.status === "paid"; });
    var openHtml = '<div class="dh">Open invoices (' + open.length + ")</div>" + (open.length ? '<div class="stack" style="margin-top:6px">' + open.map(function (i) { return invCard(i, false); }).join("") + "</div>" : '<div class="empty">No open invoices. Create one from Expenses \u2192 Configure bill back.</div>');
    var fv = S.invPaidFac === undefined ? "__all" : S.invPaidFac;
    var opts = '<option value="__all"' + (fv === "__all" ? " selected" : "") + ">All</option><option value=\"\"" + (fv === "" ? " selected" : "") + ">General (no facility)</option>" + S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (fv === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("");
    var paidFiltered = fv === "__all" ? paid : paid.filter(function (i) { return (i.facilityId || "") === (fv || ""); });
    var paidHtml = '<div class="between" style="margin-top:18px"><div class="dh" style="margin:0">Paid invoices (' + paid.length + ')</div><select data-invpaidfac style="width:auto;min-width:150px">' + opts + "</select></div>"
      + (paidFiltered.length ? '<div class="stack" style="margin-top:6px">' + paidFiltered.map(function (i) { return invCard(i, true); }).join("") + "</div>" : '<div class="empty">No paid invoices here.</div>');
    return openHtml + paidHtml;
  }
  function buildInvoicePDF(inv) {
    if (!window.jspdf || !window.jspdf.jsPDF) { toast("PDF tool still loading — try again in a moment."); return; }
    var doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
    var fac = S.facilities.find(function (f) { return f.id === inv.facilityId; });
    var y = 56, entName = inv.entityName || "Copper River LLC", entAddr = inv.entityAddress || "P.O. Box 568, Augusta, KS 67010";
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("INVOICE", 56, y);
    doc.setFontSize(11); doc.setFont("helvetica", "normal");
    doc.text(entName, 56, y + 26); doc.splitTextToSize(entAddr, 280).forEach(function (ln, idx) { doc.text(ln, 56, y + 40 + idx * 14); });
    doc.text("Invoice #: " + inv.number, 380, y + 26); doc.text("Date: " + new Date(inv.createdAt).toLocaleDateString(), 380, y + 40);
    var by = y + 92;
    doc.setFont("helvetica", "bold"); doc.text("Bill to", 56, by);
    doc.setFont("helvetica", "normal"); doc.text(fac ? fac.name : "Facility", 56, by + 16); if (fac && fac.address) doc.text(fac.address, 56, by + 30);
    if ((inv.months || []).length) doc.text("Period: " + inv.months.map(monthLabel).join(", "), 56, by + 46);
    var ty = by + 78;
    doc.setFont("helvetica", "bold"); doc.text("Description", 56, ty); doc.text("Source", 330, ty); doc.text("Amount", 470, ty); doc.line(56, ty + 6, 540, ty + 6);
    doc.setFont("helvetica", "normal"); var ly = ty + 24;
    (inv.lineItems || []).forEach(function (li) {
      var lines = doc.splitTextToSize(String(li.description || ""), 260);
      doc.text(lines, 56, ly); if (li.source) doc.text(String(li.source), 330, ly); doc.text(money(li.amount), 470, ly);
      ly += 15 * lines.length + 5; if (ly > 720) { doc.addPage(); ly = 56; }
    });
    doc.line(56, ly, 540, ly); doc.setFont("helvetica", "bold");
    doc.text("Total", 56, ly + 20); doc.text(money(inv.total), 470, ly + 20);
    doc.save("Invoice-" + inv.number + ".pdf");
  }
  /* ---------- check tracking / deposits ---------- */
  function depFacName(fid) { return fid ? facName(fid) : "Other"; }
  function depTotals(entries) { var byFac = {}, grand = 0, byType = { CK: 0, MO: 0 }; (entries || []).forEach(function (e) { var a = parseFloat(e.amount || 0) || 0; var kk = e.facilityId || ""; byFac[kk] = (byFac[kk] || 0) + a; grand += a; byType[e.type === "MO" ? "MO" : "CK"] += a; }); return { byFac: byFac, grand: grand, byType: byType }; }
  function depNew() {
    var d = S.depDraft || { entries: [] }; if (!d.entries) d.entries = [];
    if (S.depStage === "confirm") return depConfirm();
    var facOpts = function (sel) { return '<option value=""' + (!sel ? " selected" : "") + ">Other</option>" + S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (sel === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join(""); };
    var rows = d.entries.map(function (e) {
      return '<div class="card" style="padding:10px"><div class="between" style="margin-bottom:6px"><div class="label" style="margin:0">Payment</div><button class="icon-btn danger" data-a="depdel" data-id="' + e.id + '">' + I("trash") + "</button></div>"
        + '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">'
        + '<div style="flex:1;min-width:140px"><div class="label" style="margin:0 0 2px">Facility or other *</div><select data-de="' + e.id + '|facilityId">' + facOpts(e.facilityId) + "</select></div>"
        + '<div style="flex:1;min-width:130px"><div class="label" style="margin:0 0 2px">Name on check *</div><input data-de="' + e.id + '|customer" value="' + esc(e.customer || "") + '"></div>'
        + '<div style="flex:1;min-width:130px"><div class="label" style="margin:0 0 2px">What it\u2019s for</div><input data-de="' + e.id + '|forWhat" value="' + esc(e.forWhat || "") + '"></div>'
        + "</div>"
        + '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:8px">'
        + '<div style="width:90px"><div class="label" style="margin:0 0 2px">Type</div><select data-de="' + e.id + '|type"><option' + (e.type !== "MO" ? " selected" : "") + ">CK</option><option" + (e.type === "MO" ? " selected" : "") + ">MO</option></select></div>"
        + '<div style="flex:1;min-width:120px"><div class="label" style="margin:0 0 2px">Check / MO #</div><input data-de="' + e.id + '|checkNo" value="' + esc(e.checkNo || "") + '"></div>'
        + '<div style="flex:1;min-width:120px"><div class="label" style="margin:0 0 2px">Amount *</div><input data-de="' + e.id + '|amount" value="' + esc(e.amount || "") + '" placeholder="$"></div>'
        + "</div></div>";
    }).join("");
    var t = depTotals(d.entries);
    var totalCard = d.entries.length ? '<div class="card"><div class="dh">Facility totals</div>' + Object.keys(t.byFac).map(function (kk) { return '<div class="kv"><span>' + esc(depFacName(kk)) + '</span><span style="font-weight:700">' + money(t.byFac[kk]) + "</span></div>"; }).join("") + '<div class="kv" style="border-top:1px solid var(--line);margin-top:6px;padding-top:6px"><span style="font-weight:700">Total</span><span style="font-weight:700">' + money(t.grand) + "</span></div></div>" : "";
    return '<p class="hint">Add each check or money order as a row, then submit the deposit.</p>'
      + (rows || '<div class="empty">No payments added yet.</div>')
      + '<button class="btn" data-a="depadd" style="width:100%;justify-content:center;margin-top:8px">' + I("plus") + " Add payment</button>"
      + totalCard
      + (d.entries.length ? '<button class="btn btn-dark" data-a="depsubmit" style="width:100%;justify-content:center;margin-top:10px">' + I("arrow-right") + " Submit deposit</button>" : "");
  }
  function depConfirm() {
    var d = S.depDraft, t = depTotals(d.entries);
    return '<button class="btn" data-a="depback" style="margin-bottom:10px">' + I("arrow-left") + " Back to editing</button>"
      + '<div class="card"><div class="dh">Facility totals</div>' + Object.keys(t.byFac).map(function (kk) { return '<div class="kv"><span>' + esc(depFacName(kk)) + '</span><span style="font-weight:700">' + money(t.byFac[kk]) + "</span></div>"; }).join("") + '<div class="kv" style="border-top:1px solid var(--line);margin-top:6px;padding-top:6px"><span style="font-weight:700">Total</span><span style="font-weight:700">' + money(t.grand) + "</span></div></div>"
      + '<button class="check full' + (d.totalAddsUp ? " on" : "") + '" data-a="depchk" data-k="totalAddsUp"><span class="bx">' + (d.totalAddsUp ? I("check") : "") + "</span>Facility total adds up</button>"
      + '<button class="check full' + (d.cubbyInput ? " on" : "") + '" data-a="depchk" data-k="cubbyInput"><span class="bx">' + (d.cubbyInput ? I("check") : "") + "</span>Payments have been input on Cubby</button>"
      + '<button class="btn btn-ok" data-a="depfinal" style="width:100%;justify-content:center;margin-top:12px">' + I("check") + " Submit deposit</button>";
  }
  function depCompleted() {
    var deps = S.deposits || [];
    var notSettled = deps.filter(function (x) { return !x.settled; }), settled = deps.filter(function (x) { return x.settled; });
    var card = function (dep) {
      var t = depTotals(dep.entries);
      var open = S.depOpen === dep.id;
      var detail = "";
      if (open) {
        var byFac = {}; (dep.entries || []).forEach(function (e) { (byFac[e.facilityId || ""] = byFac[e.facilityId || ""] || []).push(e); });
        detail = '<div class="dgrp" style="margin-top:8px;border-top:1px solid var(--line);padding-top:8px">' + Object.keys(byFac).map(function (kk) {
          return '<div class="dh" style="margin-top:4px">' + esc(depFacName(kk)) + "</div>" + byFac[kk].map(function (e) { return '<div class="dline" style="display:flex;justify-content:space-between"><span>' + esc(e.customer || "(no name)") + " \u00b7 " + esc(e.forWhat || "") + " \u00b7 " + esc(e.type) + (e.checkNo ? " #" + esc(e.checkNo) : "") + '</span><span style="font-weight:700">' + money(e.amount) + "</span></div>"; }).join("");
        }).join("") + "</div>";
      }
      return '<div class="card"><div class="between"><div style="font-weight:700">Deposit \u00b7 ' + fdt(dep.createdAt) + '</div><span class="muted" style="font-size:12px">' + esc(dep.createdBy || "") + "</span></div>"
        + '<div class="dgrp" style="margin-top:6px">' + Object.keys(t.byFac).map(function (kk) { return '<div class="dline" style="display:flex;justify-content:space-between"><span>' + esc(depFacName(kk)) + '</span><span style="font-weight:700">' + money(t.byFac[kk]) + "</span></div>"; }).join("") + "</div>"
        + '<div class="kv" style="margin-top:6px"><span>Checks (CK)</span><span>' + money(t.byType.CK) + "</span><span>Money orders (MO)</span><span>" + money(t.byType.MO) + '</span><span>Total</span><span style="font-weight:700">' + money(t.grand) + "</span></div>" + detail
        + '<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn sm" data-a="depview" data-id="' + dep.id + '">' + I(open ? "eye-off" : "eye") + (open ? " Hide" : " View") + "</button>" + (dep.settled ? '<span class="pill" style="background:#E1F0E9;color:var(--ok)">' + I("check") + " Cash settled" + (dep.settledAt ? " " + fdt(dep.settledAt) : "") + "</span>" : '<button class="btn btn-ok sm" data-a="depsettle" data-id="' + dep.id + '">' + I("check") + " Cash is settled</button>") + '<button class="icon-btn danger" data-a="depdelete" data-id="' + dep.id + '">' + I("trash") + "</button></div></div>";
    };
    var sumNot = notSettled.reduce(function (s, x) { return s + depTotals(x.entries).grand; }, 0), sumSet = settled.reduce(function (s, x) { return s + depTotals(x.entries).grand; }, 0);
    return '<div class="card"><div class="between"><span>Not settled</span><span style="font-weight:700;color:var(--hazard-d)">' + money(sumNot) + '</span></div><div class="between" style="margin-top:4px"><span>Settled</span><span style="font-weight:700;color:var(--ok)">' + money(sumSet) + "</span></div></div>"
      + '<div class="dh" style="margin-top:14px">Not settled (' + notSettled.length + ")</div>" + (notSettled.length ? '<div class="stack" style="margin-top:6px">' + notSettled.map(card).join("") + "</div>" : '<div class="empty">Nothing outstanding.</div>')
      + '<div class="dh" style="margin-top:16px">Settled (' + settled.length + ")</div>" + (settled.length ? '<div class="stack" style="margin-top:6px">' + settled.map(card).join("") + "</div>" : '<div class="empty">None settled yet.</div>');
  }
  function checkTrackingView() {
    var sub = S.depSub || "new";
    var nav = '<div class="tabs"><button class="' + (sub === "new" ? "on" : "") + '" data-a="depsub" data-k="new">New deposit</button><button class="' + (sub === "completed" ? "on" : "") + '" data-a="depsub" data-k="completed">Facility deposits completed</button></div>';
    return "<h3>Check tracking</h3>" + nav + (sub === "completed" ? depCompleted() : depNew());
  }
  function receiptCard(r) {
    return '<div class="card"><div class="between"><div style="font-weight:700">' + esc(r.name || "Receipt") + '</div><span class="muted" style="font-size:12px">' + fdt(r.createdAt) + "</span></div>"
      + (r.source ? '<div class="kv" style="margin-top:6px"><span>Source</span><span>' + esc(r.source) + "</span></div>" : "")
      + '<div class="row" style="gap:8px;margin-top:8px">' + (r.file ? '<a href="' + esc(r.file) + '" target="_blank" rel="noopener" class="btn sm">' + I("eye") + " View" + (String(r.file).indexOf("application/pdf") >= 0 ? " (PDF)" : "") + "</a>" : '<span class="muted" style="font-size:12px">No file</span>') + '<button class="icon-btn danger" data-a="receiptdel" data-id="' + r.id + '">' + I("trash") + "</button></div></div>";
  }
  function receiptsView() {
    var rs = S.receipts || [], upFac = S.receiptUpFac || "";
    var upFacOpts = '<option value=""' + (upFac === "" ? " selected" : "") + ">General pool (no facility)</option>" + S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (upFac === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("");
    var upload = '<div class="card"><div style="font-weight:600">' + I("upload") + ' Upload a receipt or invoice</div><p class="hint" style="margin:6px 0 8px">Choose where it belongs, then attach a photo or PDF. Approved payable invoices land in their facility automatically.</p><div class="label">Upload to</div><select data-rcupfac>' + upFacOpts + '</select><label class="addph" style="display:inline-flex;margin-top:8px">' + I("paperclip") + 'Attach file<input type="file" accept="image/*,application/pdf" style="display:none" data-rcfile></label></div>';
    var viewFac = S.receiptFac === undefined ? "__none" : S.receiptFac;
    var viewOpts = '<option value="__none"' + (viewFac === "__none" ? " selected" : "") + ">\u2014 select \u2014</option><option value=\"\"" + (viewFac === "" ? " selected" : "") + ">General pool</option>" + S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (viewFac === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("");
    var picker = '<div class="card"><div class="label">Show receipts &amp; invoices for</div><select data-rcviewfac>' + viewOpts + "</select></div>";
    var list;
    if (viewFac === "__none") list = '<div class="empty">Pick a facility (or the general pool) to view its receipts.</div>';
    else { var rsf = rs.filter(function (r) { return (r.facilityId || "") === (viewFac || ""); }); list = rsf.length ? '<div class="stack">' + rsf.map(receiptCard).join("") + "</div>" : '<div class="empty">No receipts here yet.</div>'; }
    return upload + picker + list;
  }
  function payablesView() {
    if (S.auth.role !== "superadmin") {
      return '<h3>Payables</h3><p class="hint">Submit a contractor payable. A super admin reviews and approves it.</p>' + payableForm();
    }
    var sub = S.paySub || "pending", pend = (S.payables || []).filter(function (p) { return p.status === "pending"; }).length;
    if (sub === "new") {
      return '<div class="between"><h3>New payable</h3><button class="btn" data-a="paynewback">' + I("arrow-left") + ' Back to payables</button></div>' + payableForm();
    }
    var st = [["pending", "Pending (" + pend + ")"], ["billedback", "Billed back"], ["expenses", "Expenses"], ["general", "General"], ["invoices", "Invoices"], ["receipts", "Receipts"]];
    var nav = '<div class="tabs">' + st.map(function (t) { return '<button class="' + (sub === t[0] ? "on" : "") + '" data-a="paysub" data-k="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</div>";
    var body = sub === "expenses" ? payExpenses() : sub === "general" ? generalExpenses() : sub === "billedback" ? payBilledBack() : sub === "configure" ? configureBillBack() : sub === "invoices" ? invoicesView() : sub === "receipts" ? receiptsView() : payPending();
    return '<div class="between"><h3>Payables</h3><button class="btn btn-dark sm" data-a="paysub" data-k="new">' + I("plus") + ' Submit new payable</button></div><p class="hint">Track contractor invoices from submission through approval and billing back.</p>' + nav + body;
  }

  function manager() {
    if (S.editId) { var ef = S.facilities.find(function (x) { return x.id === S.editId; }); if (ef) return S.infoMode ? facInfoPage(ef) : facilityEditor(ef); }
    if (S.userId) { var uw = S.users.find(function (x) { return x.id === S.userId; }); if (uw) return userEditor(uw); }

    var T = [["facilities", "Facilities"], ["facinfo", "Facility info"], ["leads", "Lead tracking"], ["maint", "Maintenance"], ["inventory", "Inventory"], ["contractors", "Contractors"], ["checks", "Check tracking"], ["payables", "Payables"]];
    if (S.auth.role === "superadmin") T.push(["finance", "Insurance / Taxes"]);
    var settingsBtn = '<button class="btn sm" data-a="tab" data-k="settings"' + (S.tab === "settings" ? ' style="background:var(--ink);color:#fff;border-color:var(--ink)"' : "") + ">" + I("settings") + " Settings</button>";
    var tabs = '<div class="row" style="justify-content:space-between;gap:8px;align-items:center"><div class="tabs" style="flex:1;min-width:0">' + T.map(function (t) { return '<button class="' + (S.tab === t[0] ? "on" : "") + '" data-a="tab" data-k="' + t[0] + '">' + esc(t[1]) + "</button>"; }).join("") + "</div>" + settingsBtn + "</div>";

    if (S.tab === "inventory" || S.tab === "contractors" || S.tab === "finance") {
      if (S.tab === "finance" && S.auth.role !== "superadmin") return tabs + '<div class="empty">Not available.</div>';
      if (!S.secFac) {
        if (S.tab === "finance") {
          var due = '<button class="frow" data-a="opensec" data-id="__sched__" style="border-color:var(--hazard-d)"><span class="fi">' + I("calendar-event") + '</span><span class="fbody"><span class="fname">Due dates</span><span class="faddr">All upcoming payments, soonest first</span></span>' + I("chevron-right") + "</button>";
          var facs = S.facilities.map(function (f) { return '<button class="frow" data-a="opensec" data-id="' + f.id + '"><span class="fi">' + I("building-warehouse") + '</span><span class="fbody"><span class="fname">' + esc(f.name) + '</span><span class="faddr">' + esc(f.address || "") + "</span></span>" + I("chevron-right") + "</button>"; }).join("");
          return tabs + '<h3>Insurance / Property taxes / Utilities</h3><p class="hint">Open Due dates for the payment schedule, or pick a facility to edit.</p><div class="list">' + due + facs + "</div>";
        }
        var titles = { inventory: "Inventory", contractors: "Contractors" };
        var blurbs = { inventory: "Pick a facility to manage its inventory.", contractors: "Pick a facility to manage its contractors." };
        return tabs + secPicker(titles[S.tab], blurbs[S.tab]);
      }
      var back = '<button class="btn" data-a="backsec" style="margin-bottom:12px">' + I("arrow-left") + " All facilities</button>";
      if (S.tab === "finance" && S.secFac === "__sched__") return tabs + back + financeSchedule();
      var fsec = S.facilities.find(function (x) { return x.id === S.secFac; });
      if (!fsec) { S.secFac = null; return manager(); }
      var inner = S.tab === "inventory" ? inventorySection(fsec) : S.tab === "contractors" ? contractorsSection(fsec) : financeSection(fsec);
      return tabs + back + inner;
    }

    if (S.tab === "maint") { return tabs + maintenanceHome(); }
    if (S.tab === "leads") { return tabs + leadsView(); }
    if (S.tab === "payables") { return tabs + payablesView(); }
    if (S.tab === "checks") { return tabs + checkTrackingView(); }
    if (S.tab === "settings") { return tabs + settingsView(); }
    if (S.tab === "facinfo") {
      return tabs + '<h3>Facility information</h3><p class="hint">Pick a facility to view or edit its information sheet.</p><div class="list">'
        + S.facilities.map(function (f) { return '<button class="frow" data-a="openinfo" data-id="' + f.id + '"><span class="fi">' + I("building-warehouse") + '</span><span class="fbody"><span class="fname">' + esc(f.name) + '</span><span class="faddr">' + esc(f.address || "No address yet") + "</span></span>" + I("chevron-right") + "</button>"; }).join("") + "</div>";
    }
    if (S.subOpen) { return tabs + reportReview(S.subOpen); }
    return tabs + reportsPanel()
      + '<div class="between" style="margin-top:18px"><h3>Facilities</h3><button class="btn btn-dark sm" data-a="addfac">' + I("plus") + ' Add facility</button></div><p class="hint">Tap "Set up" to edit a facility\'s site check, audit, and reports.</p><div class="list">'
      + S.facilities.map(function (f) {
        return '<div class="fcard"><div class="row"><span class="fi">' + I("building-warehouse") + '</span><div><div class="fname">' + esc(f.name) + '</div><div class="faddr">Updated ' + fday(f.config.updatedAt) + "</div></div></div>"
          + '<div class="fc-actions"><button class="btn sm" data-a="editfac" data-id="' + f.id + '">' + I("settings") + ' Set up</button><button class="icon-btn danger" data-a="delfac" data-id="' + f.id + '">' + I("trash") + "</button></div></div>";
      }).join("") + "</div>";
  }
  function facInfoPage(f) {
    return '<button class="btn" data-a="infoback" style="margin-bottom:10px">' + I("arrow-left") + ' All facilities</button><h3 style="margin:0 0 2px">' + esc(f.name) + "</h3>" + facInfo(f);
  }
  function reportsPanel() {
    var nameOf = function (id) { var f = S.facilities.find(function (x) { return x.id === id; }); return f ? f.name : "Facility"; };
    var out = (S.reports || []).filter(function (r) { return r.status === "outstanding"; });
    var needs = (S.reports || []).filter(function (r) { return r.status === "completed" && !r.reviewed; });
    if (!out.length && !needs.length) return '<div class="dh">Pending reports</div><div class="empty">No reports waiting right now.</div>';
    var outCard = out.map(function (r) { return '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div style="font-weight:600">' + esc(nameOf(r.facilityId)) + " \u00b7 " + (r.type === "audit" ? "Audit" : "Site check") + '</div><span class="pill" style="background:#FBEAE1;color:var(--hazard-d)">' + I("clock") + ' Awaiting tech</span></div><div class="muted" style="font-size:12px;margin-top:6px">Sent ' + fdt(r.createdAt) + " by " + esc(r.createdBy || "admin") + (r.note ? " \u00b7 \u201c" + esc(r.note) + "\u201d" : "") + "</div></div>"; }).join("");
    var needRow = function (r) { return '<div class="frow"><button class="fbody" data-a="openrep" data-id="' + r.id + '" style="display:flex;align-items:center;gap:10px;background:none;border:none;text-align:left;flex:1;cursor:pointer"><span class="fi">' + I("file") + '</span><span><span class="fname">' + esc(nameOf(r.facilityId)) + " \u00b7 " + (r.type === "audit" ? "Audit" : "Site check") + '</span><span class="faddr">' + esc(r.workerName || "Tech") + " \u00b7 " + fdt(r.submittedAt) + '</span></span></button><span class="pill" style="background:#FBEAE1;color:var(--hazard-d)">Needs review</span></div>'; };
    return '<div class="dh">Pending reports</div>'
      + (out.length ? '<div class="stack" style="margin-top:6px">' + outCard + "</div>" : "")
      + (needs.length ? '<div class="dh" style="margin-top:10px">Completed \u2014 needs review (' + needs.length + ")</div><div class=\"list\" style=\"margin-top:6px\">" + needs.map(needRow).join("") + "</div>" : "");
  }

  function loginsList() {
    var roleLabel = { superadmin: "Super admin", admin: "Admin", employee: "Employee", worker: "On-site tech" };
    var roleIcon = { superadmin: "crown", admin: "key", employee: "briefcase", worker: "user" };
    var order = { superadmin: 0, admin: 1, employee: 2, worker: 3 };
    var us = (S.users || []).slice().sort(function (a, b) { return (order[a.role] - order[b.role]) || a.name.localeCompare(b.name); });
    return '<div class="between"><h3>Logins</h3><button class="btn btn-dark sm" data-a="adduser">' + I("plus") + ' Add person</button></div><p class="hint">Everyone who can sign in. Set each person\u2019s role here \u2014 techs fill out reports, employees handle leads / inventory / contractors, admins run the office.</p><div class="list">'
      + us.map(function (w) { var you = w.id === S.auth.id; return '<button class="frow" data-a="openuser" data-id="' + w.id + '"><span class="fi">' + I(roleIcon[w.role] || "user") + '</span><span class="fbody"><span class="fname">' + esc(w.name) + (you ? '<span class="you-badge">You</span>' : "") + '</span><span class="faddr">@' + esc(w.username) + " \u00b7 " + (roleLabel[w.role] || w.role) + (w.role === "worker" ? " \u00b7 " + (w.assignments || []).length + " facilit" + ((w.assignments || []).length === 1 ? "y" : "ies") : "") + "</span></span>" + I("chevron-right") + "</button>"; }).join("") + "</div>";
  }
  function settingsView() {
    var isSuper = S.auth.role === "superadmin";
    var sub = S.setSub || "logins";
    if (sub === "billback" && !isSuper) sub = "logins";
    var st = [["logins", "Logins"]];
    if (isSuper) st.push(["billback", "Bill-back config"]);
    var nav = '<div class="tabs">' + st.map(function (t) { return '<button class="' + (sub === t[0] ? "on" : "") + '" data-a="setsub" data-k="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</div>";
    var body = sub === "billback" ? billbackConfig() : loginsList();
    return "<h3>Settings</h3>" + nav + body;
  }

  function maintenanceHome() {
    var sub = S.maintSub || "report";
    var allItems = [];
    (S.facilities || []).forEach(function (f) { (f.config.maintenanceTracking || []).forEach(function (it) { if (it.status !== "completed") allItems.push({ it: it, f: f }); }); });
    var nav = '<div class="tabs"><button class="' + (sub === "report" ? "on" : "") + '" data-a="mtsub" data-k="report">Report a problem</button><button class="' + (sub === "reported" ? "on" : "") + '" data-a="mtsub" data-k="reported">Reported problems (' + allItems.length + ')</button><button class="' + (sub === "tracking" ? "on" : "") + '" data-a="mtsub" data-k="tracking">Maintenance tracking</button></div>';
    var body;
    if (sub === "tracking") {
      if (!S.secFac) {
        body = secPicker("Maintenance tracking", "Pick a facility to track its maintenance items.");
      } else {
        var ft = S.facilities.find(function (x) { return x.id === S.secFac; });
        body = ft ? ('<button class="btn" data-a="backsec" style="margin-bottom:12px">' + I("arrow-left") + " All facilities</button>" + maintenanceSection(ft)) : secPicker("Maintenance tracking", "Pick a facility.");
      }
    } else if (sub === "reported") {
      body = allItems.length ? '<div class="stack">' + allItems.map(function (row) {
        var it = row.it, f = row.f, working = it.status === "in_progress";
        return '<div class="card"' + (working ? ' style="border-color:var(--hazard-d)"' : "") + '><div class="between"><div style="font-weight:700">' + esc(f.name) + "</div>" + (working ? '<span class="pill" style="background:#FBEAE1;color:var(--hazard-d)">Working on it</span>' : '<span class="pill" style="background:#F7E4E1;color:var(--alert)">Needs attention</span>') + "</div>"
          + '<div class="da" style="margin-top:6px">' + esc(it.description || "(no description)") + "</div>" + (it.units ? '<div class="muted" style="font-size:12px;margin-top:2px">Units: ' + esc(it.units) + "</div>" : "")
          + '<div class="muted" style="font-size:12px;margin-top:2px">Reported by ' + esc(it.reportedBy || "?") + (it.reportedAt ? " on " + fdt(it.reportedAt) : "") + "</div>"
          + '<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn btn-ok sm" data-a="mtresolve" data-fid="' + f.id + '" data-id="' + it.id + '">' + I("check") + ' Resolved</button>' + (working ? "" : '<button class="btn sm" data-a="mtworking" data-fid="' + f.id + '" data-id="' + it.id + '">' + I("progress") + " Working on it</button>") + '<button class="icon-btn danger" data-a="mtdel" data-fid="' + f.id + '" data-id="' + it.id + '">' + I("trash") + "</button></div></div>";
      }).join("") + "</div>" : '<div class="empty">No open problems. Nice and clear.</div>';
    } else {
      var d = S.mtDraft || {};
      var facOpts = '<option value="">— pick a facility —</option>' + S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (d.facilityId === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("");
      var banner = S.mtJustSent ? '<div class="card" style="background:#E1F0E9;border-color:var(--ok)"><div style="color:var(--ok);font-weight:700;display:flex;align-items:center;gap:8px">' + I("check") + " Problem reported. The team can see it under Reported problems.</div></div>" : "";
      body = banner + '<div class="card"><p class="hint" style="margin:0 0 8px">Report a maintenance problem without leaving this page. Facility and a description are required.</p>'
        + '<div class="label">Facility</div><select data-mtfac>' + facOpts + "</select>"
        + '<div class="label">What\u2019s the problem?</div><textarea rows="3" data-mt="description">' + esc(d.description || "") + "</textarea>"
        + '<div class="label">Affected unit(s) (optional)</div><input data-mt="units" value="' + esc(d.units || "") + '" placeholder="e.g. A101, A102">'
        + '<button class="btn btn-dark" data-a="mtsubmit" style="width:100%;justify-content:center;margin-top:12px">' + I("flag") + " Submit report</button></div>";
    }
    return "<h3>Maintenance</h3>" + nav + body;
  }
  function reportsHome() {
    var nameOf = function (id) { var f = S.facilities.find(function (x) { return x.id === id; }); return f ? f.name : "Facility"; };
    var selFac = S.newReportFac || (S.facilities[0] || {}).id;
    var facOpts = S.facilities.map(function (f) { return '<option value="' + f.id + '"' + (selFac === f.id ? " selected" : "") + ">" + esc(f.name) + "</option>"; }).join("");
    var facSel = '<div class="card"><div class="label">Show completed reports for</div><select data-newfac>' + facOpts + '</select><p class="hint" style="margin:6px 0 0">Send a new report request from a facility\u2019s <b>Set up</b> page.</p></div>';
    var out = S.reports.filter(function (r) { return r.status === "outstanding"; });
    var comp = S.reports.filter(function (r) { return r.status === "completed" && r.facilityId === selFac; });
    var outCard = out.map(function (r) { return '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div style="font-weight:600">' + esc(nameOf(r.facilityId)) + '</div><span class="pill" style="background:#FBEAE1;color:var(--hazard-d)">' + I("clock") + ' Awaiting tech</span></div><div class="label">Note for the tech</div><textarea rows="2" data-rnote="' + r.id + '" placeholder="(no note)">' + esc(r.note || "") + '</textarea><div class="row" style="justify-content:space-between;align-items:center;margin-top:8px"><span class="muted" style="font-size:12px">Sent ' + fdt(r.createdAt) + " by " + esc(r.createdBy || "admin") + '</span><button class="btn sm danger" data-a="delreport" data-id="' + r.id + '">' + I("trash") + " Delete</button></div></div>"; }).join("");
    var compRow = function (r) { return '<div class="frow" style="cursor:default"><button class="fbody" data-a="openrep" data-id="' + r.id + '" style="display:flex;align-items:center;gap:10px;background:none;border:none;text-align:left;flex:1;cursor:pointer"><span class="fi">' + I("file") + '</span><span><span class="fname">' + esc(nameOf(r.facilityId)) + '</span><span class="faddr">' + esc(r.workerName || "Tech") + " \u00b7 " + fdt(r.submittedAt) + "</span></span></button>" + (r.reviewed ? '<span class="pill" style="background:#E1F0E9;color:var(--ok)">' + I("check") + " Reviewed</span>" : '<span class="pill" style="background:#FBEAE1;color:var(--hazard-d)">Needs review</span>') + '<button class="icon-btn danger" data-a="delreport" data-id="' + r.id + '">' + I("trash") + "</button></div>"; };
    return '<h3>Reports</h3>'
      + '<div class="dh">Outstanding \u2014 all facilities (' + out.length + ")</div>" + (out.length ? '<div class="stack" style="margin-top:6px">' + outCard + "</div>" : '<div class="empty">No reports waiting on techs.</div>')
      + '<div style="margin-top:16px">' + facSel + "</div>"
      + '<div class="dh" style="margin-top:8px">Completed \u2014 ' + esc(nameOf(selFac)) + " (" + comp.length + ")</div>" + (comp.length ? '<div class="list" style="margin-top:6px">' + comp.map(compRow).join("") + "</div>" : '<div class="empty">No completed reports for this facility.</div>');
  }
  function reportReview(rep) {
    var f = S.facilities.find(function (x) { return x.id === rep.facilityId; });
    if (!f) return '<button class="btn" data-a="backopen" style="margin-bottom:12px">' + I("arrow-left") + ' Reports</button><div class="empty">That facility was removed.</div>';
    var c = f.config, d = rep.data || {}, g = d.grounds || {}, yn = function (v) { return v === true ? "Yes" : v === false ? "No" : "—"; };
    var gal = function (arr, tag) { return arr && arr.length ? '<div class="gal">' + arr.filter(function (p) { return p.kind === "image"; }).map(function (p, i) { return '<a href="' + p.url + '" download="' + esc(f.name).replace(/[^A-Za-z0-9]+/g, "_") + "_" + (tag || "photo") + "_" + (i + 1) + '.jpg" title="Click to download"><img src="' + p.url + '"></a>'; }).join("") + '</div><div class="muted" style="font-size:12px;margin-top:4px">Tip: click a photo to download it.</div>' : ""; };
    var done = function (b) { return b ? "Done ✓" : "Not done ✗"; };
    function stepHtml(key) {
      if (key === "Tasks") return '<div class="card dgrp"><div class="dh">Weekly tasks</div>' + (c.weeklyTasks.length ? c.weeklyTasks.map(function (t) { var tr = (d.tasks || {})[t.id] || {}; return '<div class="dline"><div class="dq">' + esc(t.text) + '</div><div class="da">' + esc(tr.note || "—") + "</div>" + gal(tr.files) + "</div>"; }).join("") : '<div class="dline muted">No tasks this week.</div>') + "</div>";
      if (key === "Lockout") {
        var none = !c.lockoutAdd.length && !c.lockoutRemove.length && !c.lockoutKeep.length;
        return '<div class="card dgrp"><div class="dh">Lockout</div>'
          + (c.lockoutAdd.length ? '<div class="da" style="font-weight:600;margin-top:2px">Locks to add</div>' + c.lockoutAdd.map(function (u) { var a = (d.lockAdd || {})[u.id] || {}; return '<div class="dline">Unit ' + esc(u.unit) + ' — lock <b class="mono">' + esc(a.lockNo || "????") + "</b> — " + done(a.done) + "</div>"; }).join("") : "")
          + (c.lockoutRemove.length ? '<div class="da" style="font-weight:600;margin-top:6px">Locks removed</div>' + c.lockoutRemove.map(function (u) { return '<div class="dline">Unit ' + esc(u.unit) + " — " + done(((d.lockRemove || {})[u.id] || {}).done) + "</div>"; }).join("") : "")
          + (c.lockoutKeep.length ? '<div class="da" style="font-weight:600;margin-top:6px">Leave in place</div>' + c.lockoutKeep.map(function (u) { return '<div class="dline">Unit ' + esc(u.unit) + " — " + done(((d.lockKeep || {})[u.id] || {}).done) + "</div>"; }).join("") : "")
          + (none ? '<div class="dline muted">None</div>' : "") + "</div>";
      }
      if (key === "Maintenance") return '<div class="card dgrp"><div class="dh">Maintenance</div>' + (c.maintenance.length ? c.maintenance.map(function (u) { return '<div class="dline">Unit ' + esc(u.unit) + " — " + esc(u.note) + '<div class="da">' + esc(((d.maintenance || {})[u.id] || {}).statement || "—") + "</div></div>"; }).join("") : '<div class="dline muted">None</div>') + "</div>";
      if (key === "Vacated") return '<div class="card dgrp"><div class="dh">Recently vacated</div>' + (c.vacated.length ? c.vacated.map(function (u) { var v = (d.vacated || {})[u.id] || {}; var ck = function (k, lab) { return (v[k] ? "✓ " : "✗ ") + lab; }; return '<div class="dline">Unit ' + esc(u.unit) + " — " + (v.status === "clean" ? "Clean / broom-swept" : v.status === "problem" ? "Problem: " + esc(v.problem) : "—") + '<div class="da">' + ck("door", "door rolls up") + " · " + ck("latch", "latch") + " · " + ck("intrusion", "no intrusion") + " · " + ck("water", "no water") + "</div>" + gal(v.photos, "vacated_" + u.unit) + "</div>"; }).join("") : '<div class="dline muted">None</div>') + "</div>";
      if (key === "Vacant" && rep.type === "audit") return '<div class="card dgrp"><div class="dh">Vacant units (audit)</div>' + (c.vacant.length ? c.vacant.map(function (u) { var v = (d.vacantAudit || {})[u.id] || {}; var ck = function (k, lab) { return (v[k] ? "✓ " : "✗ ") + lab; }; return '<div class="dline">Unit ' + esc(u.unit) + " — " + (v.status === "clean" ? "Clean / broom-swept" : v.status === "problem" ? "Problem: " + esc(v.problem) : "—") + '<div class="da">' + ck("door", "door") + " · " + ck("latch", "latch") + " · " + ck("intrusion", "no intrusion") + " · " + ck("water", "no water") + "</div>" + gal(v.photos, "vacant_" + u.unit) + "</div>"; }).join("") : '<div class="dline muted">No vacant units on the master list.</div>') + "</div>";
      if (key === "Vacant") return '<div class="card dgrp"><div class="dh">Vacant</div><div class="da" style="font-weight:600">Office shows these as vacant:</div><div class="dline">' + (c.vacant.length ? c.vacant.map(function (u) { return "Unit " + esc(u.unit); }).join(", ") : "None on file") + '</div><div class="dline">' + (d.vacantConfirmed === false ? "Tech found other unlocked units: " + esc(d.vacantExtra) : d.vacantConfirmed ? "Tech confirmed only these are vacant" : "—") + "</div></div>";
      if (key === "Occupied") { var occ = occupiedUnits(c); return '<div class="card dgrp"><div class="dh">Occupied units (audit)</div>' + (occ.length ? occ.map(function (u) { var o = (d.occupied || {})[u.id] || {}; return '<div class="dline">Unit ' + esc(u.unit) + " — " + (o.hasLock === true ? "✓ customer lock on" : o.hasLock === false ? "✗ NO LOCK" + (o.note ? ": " + esc(o.note) : "") : "—") + "</div>"; }).join("") : '<div class="dline muted">No occupied units on file.</div>') + "</div>"; }
      if (key === "Auction") return '<div class="card dgrp"><div class="dh">Auction</div>' + (c.auction.length ? c.auction.map(function (u) { var a = (d.auction || {})[u.id] || {}; return '<div class="dline">Unit ' + esc(u.unit) + " — " + (a.untouched ? "✓ untouched" : "✗ touched") + " · " + (a.lockBack ? "✓ re-locked" : "✗ not re-locked") + ' · lock <b class="mono">' + esc(a.lockNo || "????") + "</b>" + (a.report ? '<div class="da">' + esc(a.report) + "</div>" : "") + gal(a.photos, "auction_" + u.unit) + "</div>"; }).join("") : '<div class="dline muted">None</div>') + "</div>";
      if (key === "Grounds") { var doorTxt = g.doors === true ? "Doors were open but they were closed" : g.doors === false ? "None open" : "—"; return '<div class="card dgrp"><div class="dh">Grounds</div><div class="dline">Weeds: ' + yn(g.weeds) + (g.weedsNote ? " — " + esc(g.weedsNote) : "") + '</div><div class="dline">Grass mowed: ' + yn(g.mowed) + '</div><div class="dline">Potholes / gravel needed: ' + yn(g.potholes) + (g.potholesNote ? " — " + esc(g.potholesNote) : "") + '</div><div class="dline">Exterior bulbs out: ' + yn(g.bulbs) + (g.bulbsNote ? " — " + esc(g.bulbsNote) : "") + '</div><div class="dline">New building damage: ' + yn(g.damage) + (g.damageNote ? " — " + esc(g.damageNote) : "") + '</div><div class="dline">Leaves / organic matter: ' + yn(g.leaves) + (g.leavesNote ? " — " + esc(g.leavesNote) : "") + '</div><div class="dline">Snow obstruction: ' + yn(g.snow) + (g.snowNote ? " — " + esc(g.snowNote) : "") + '</div><div class="dline">Trash / items out of place: ' + yn(g.trash) + (g.trashNote ? " — " + esc(g.trashNote) : "") + '</div><div class="dline">Open doors: ' + doorTxt + "</div>" + (g.notes ? '<div class="dline">Notes: ' + esc(g.notes) + "</div>" : "") + gal(g.photos, "grounds") + "</div>"; }
      if (key === "Climate") { var cl = d.climate; return cl ? '<div class="card dgrp"><div class="dh">Climate control</div><div class="dline">Temperature reasonable: ' + yn(cl.temp) + (cl.tempNote ? " — " + esc(cl.tempNote) : "") + '</div><div class="dline">Interior bulbs out: ' + yn(cl.bulbs) + (cl.bulbsNote ? " — " + esc(cl.bulbsNote) : "") + '</div><div class="dline">Interior trash: ' + yn(cl.trash) + (cl.trashNote ? " — " + esc(cl.trashNote) : "") + '</div><div class="dline">Dollies in place: ' + yn(cl.dollies) + "</div>" + gal(cl.photos, "climate") + "</div>" : '<div class="empty">No climate data.</div>'; }
      if (key === "Review") return '<div class="card"><div class="dh">Finish review</div><p class="hint" style="margin:6px 0 0">You\'ve stepped through the whole report.</p>' + (rep.reviewed ? '<div class="saved" style="margin-top:10px">' + I("check") + " Reviewed by " + esc(rep.reviewedBy || "admin") + " on " + fdt(rep.reviewedAt) + "</div>" : '<button class="btn btn-ok" data-a="markreviewed" data-id="' + rep.id + '" style="width:100%;justify-content:center;margin-top:10px">' + (S.busy ? '<span class="spin"></span> ' : I("check") + " ") + "Submit report as reviewed</button>") + "</div>";
      return "";
    }
    var STEPS = stepsFor(f, rep.type), sk = STEPS[S.subStep][0], last = S.subStep === STEPS.length - 1;
    var top = '<div class="wtop"><button class="btn" data-a="backopen">' + I("arrow-left") + " Reports</button>" + (rep.reviewed ? '<span class="pill" style="background:#E1F0E9;color:var(--ok)">' + I("check") + " Reviewed</span>" : '<span class="pill" style="background:#FBEAE1;color:var(--hazard-d)">Needs review</span>') + "</div>";
    var pips = '<div class="pips">' + STEPS.map(function (st, i) { return '<button class="pip ' + (i < S.subStep ? "done" : i === S.subStep ? "on" : "") + '" data-a="substep" data-i="' + i + '"><small>' + String(i + 1).padStart(2, "0") + "</small>" + I(st[1]) + "</button>"; }).join("") + "</div>";
    var head = '<div class="wo"><div class="between"><div><div class="eyebrow">Reviewing report</div><h4>' + esc(f.name) + '</h4></div><div class="row" style="gap:6px;flex-wrap:wrap"><span class="chip" style="display:inline-flex;align-items:center;gap:4px">' + I("user") + " " + esc(rep.workerName || "Tech") + '</span><span class="chip" style="display:inline-flex;align-items:center;gap:4px">' + I("calendar") + " " + fdt(rep.submittedAt) + "</span></div></div>" + pips + '<div class="cur">' + sk + "</div></div>";
    var nav = '<div class="navb"><button class="btn" data-a="subback"' + (S.subStep === 0 ? " disabled" : "") + ">" + I("chevron-left") + ' Back</button><span class="nc">' + (S.subStep + 1) + " / " + STEPS.length + "</span>" + (last ? '<button class="btn" data-a="backopen">' + I("list") + " Reports</button>" : '<button class="btn btn-dark" data-a="subnext">Next ' + I("chevron-right") + "</button>") + "</div>";
    return top + head + '<div class="stack" style="margin-top:14px">' + stepHtml(sk) + "</div>" + nav;
  }

  /* ---------- worker ---------- */
  function blankResp() { return { tasks: {}, lockAdd: {}, lockRemove: {}, lockKeep: {}, maintenance: {}, vacated: {}, vacantConfirmed: null, vacantExtra: "", vacantAudit: {}, occupied: {}, auction: {}, grounds: { weeds: null, weedsNote: "", mowed: null, snow: null, snowNote: "", trash: null, trashNote: "", potholes: null, potholesNote: "", bulbs: null, bulbsNote: "", damage: null, damageNote: "", leaves: null, leavesNote: "", doors: null, notes: "", photos: [] }, climate: { temp: null, tempNote: "", bulbs: null, bulbsNote: "", trash: null, trashNote: "", dollies: null, photos: [] } }; }
  function photoField(label, min, arr, scope) {
    var ok = arr.length >= min;
    return '<div class="label">' + I("camera") + " " + label + '<span class="count ' + (ok ? "ok" : "need") + '">' + arr.length + (min ? " / " + min + " min" : "") + "</span></div><div class=\"photos\">"
      + arr.map(function (p) { return '<div class="thumb"><img src="' + p.url + '"><button class="xx" data-a="delphoto" data-scope="' + scope + '" data-id="' + p.id + '">' + I("x") + "</button></div>"; }).join("")
      + '<label class="addph">' + I("plus") + 'Add<input type="file" accept="image/*" capture="environment" multiple style="display:none" data-add="' + scope + '"></label></div>';
  }
  function stepErrors(key, r, cfg, type) {
    var e = [], push = function (msg, mark) { e.push({ msg: msg, mark: mark }); }, audit = type === "audit";
    if (key === "Lockout") {
      cfg.lockoutAdd.forEach(function (u) { var a = r.lockAdd[u.id] || {}; if (!/^\d{4}$/.test(a.lockNo || "")) push("Enter the 4-digit lock number for " + u.unit + ".", "lockAdd:" + u.id); if (!a.done) push("Confirm lock added on " + u.unit + ".", "lockAdd:" + u.id); });
      cfg.lockoutRemove.forEach(function (u) { if (!(r.lockRemove[u.id] || {}).done) push("Confirm lock removed from " + u.unit + ".", "lockRemove:" + u.id); });
    }
    if (key === "Vacated") cfg.vacated.forEach(function (u) { var v = r.vacated[u.id] || {}, m = "vacated:" + u.id; if (!v.status) push("Set the condition for " + u.unit + ".", m); if (v.status === "problem" && !(v.problem || "").trim()) push("Describe the problem with " + u.unit + ".", m); });
    if (key === "Vacant" && audit) cfg.vacant.forEach(function (u) { var v = (r.vacantAudit || {})[u.id] || {}, m = "vacantAudit:" + u.id; if (!v.status) push("Set the condition for vacant unit " + u.unit + ".", m); if (v.status === "problem" && !(v.problem || "").trim()) push("Describe the problem with " + u.unit + ".", m); if (!v.door || !v.latch || !v.intrusion || !v.water) push("Complete the condition checks for " + u.unit + ".", m); if (((v.photos) || []).length < 1) push("Take a photo of vacant unit " + u.unit + ".", m); });
    else if (key === "Vacant") { if (r.vacantConfirmed === null) push("Confirm whether these are the only unlocked units.", "vacant"); if (r.vacantConfirmed === false && !r.vacantExtra.trim()) push("List the other unlocked unit(s).", "vacant"); }
    if (key === "Occupied") occupiedUnits(cfg).forEach(function (u) { var o = (r.occupied || {})[u.id] || {}, m = "occupied:" + u.id; if (o.hasLock === null || o.hasLock === undefined) push("Confirm whether unit " + u.unit + " has a customer lock.", m); if (o.hasLock === false && !(o.note || "").trim()) push("Note what you found on unit " + u.unit + " (no lock).", m); });
    if (key === "Auction") cfg.auction.forEach(function (u) { var a = r.auction[u.id] || {}, m = "auction:" + u.id; if ((a.photos || []).length < 3) push("Take 3 photos of auction unit " + u.unit + ".", m); if (!a.untouched) push("Confirm you didn't touch items in " + u.unit + ".", m); if (!a.lockBack) push("Confirm a lock was put back on " + u.unit + ".", m); if (!/^\d{4}$/.test(a.lockNo || "")) push("Enter the 4-digit lock number put on " + u.unit + ".", m); });
    if (key === "Grounds") {
      var g = r.grounds, qs = { weeds: "weeds question", mowed: "grass-mowed question", potholes: "potholes / gravel question", bulbs: "exterior-bulbs question", damage: "building-damage question", leaves: "leaves question", snow: "snow question", trash: "trash / items question", doors: "open-doors question" };
      Object.keys(qs).forEach(function (k) { if (g[k] === null) push("Answer the " + qs[k] + ".", "grounds." + k); });
      if (g.weeds === true && !g.weedsNote.trim()) push("Note where the weeds are.", "grounds.weeds");
      if (g.snow === true && !g.snowNote.trim()) push("Note where snow blocks access.", "grounds.snow");
      if (g.trash === true && !g.trashNote.trim()) push("Note what/where the trash or out-of-place items are.", "grounds.trash");
      if (g.potholes === true && !g.potholesNote.trim()) push("Note where gravel/potholes are needed.", "grounds.potholes");
      if (g.bulbs === true && !g.bulbsNote.trim()) push("Note which exterior lights are out.", "grounds.bulbs");
      if (g.damage === true && !g.damageNote.trim()) push("Describe the new building damage.", "grounds.damage");
      if (g.leaves === true && !g.leavesNote.trim()) push("Note where the leaves/organic matter are.", "grounds.leaves");
      var need = audit ? 10 : 5; if (g.photos.length < need) push("Add at least " + need + " facility photos (" + g.photos.length + "/" + need + ").", "grounds.photos");
    }
    if (key === "Climate") {
      var cl = r.climate, cqs = { temp: "temperature question", bulbs: "interior-bulbs question", trash: "interior-trash question", dollies: "dollies question" };
      Object.keys(cqs).forEach(function (k) { if (cl[k] === null) push("Answer the " + cqs[k] + ".", "climate." + k); });
      if (cl.bulbs === true && !cl.bulbsNote.trim()) push("Note which interior lights are out.", "climate.bulbs");
      if (cl.trash === true && !cl.trashNote.trim()) push("Note where the interior trash is.", "climate.trash");
    }
    return e;
  }
  function allIssues(r, cfg, STEPS, type) { var out = []; STEPS.forEach(function (s, i) { if (s[0] === "Review") return; stepErrors(s[0], r, cfg, type).forEach(function (it) { out.push({ i: i, step: s[0], msg: it.msg }); }); }); return out; }
  function issuesList(title, items, jump) {
    return '<div class="errlist"><div class="el-h">' + I("alert-triangle") + " " + esc(title) + "</div>" + items.map(function (it) {
      return jump ? '<button class="el-row" data-a="fixstep" data-i="' + it.i + '"><span class="el-step">' + esc(it.step) + '</span><span class="el-msg">' + esc(it.msg) + "</span>" + I("chevron-right") + "</button>"
        : '<div class="el-row el-static"><span class="el-dot">' + I("point") + '</span><span class="el-msg">' + esc(it.msg) + "</span></div>";
    }).join("") + "</div>";
  }
  function currentIssues() { var f = S.facilities.find(function (x) { return x.id === S.fid; }); if (!f) return []; var t = S.report && S.report.type; var ST = stepsFor(f, t); return stepErrors(ST[S.step][0], S.resp, f.config, t); }
  function saveDraft() { if (S.auth && S.auth.role === "worker" && S.report && S.resp && !S.done) { var k = S.report.id; api("PUT", "/api/drafts/" + k, { data: S.resp, step: S.step }); S.drafts = S.drafts || {}; S.drafts[k] = { facilityId: k, savedAt: Date.now(), step: S.step }; } }
  function yn(path, val, y, n) { return '<div class="seg"><button class="' + (val === true ? "y" : "") + '" data-a="yn" data-p="' + path + '" data-v="1">' + (y || "Yes") + '</button><button class="' + (val === false ? "n" : "") + '" data-a="yn" data-p="' + path + '" data-v="0">' + (n || "No") + "</button></div>"; }

  function worker() {
    var u = S.auth, mine = S.facilities; // server already scoped to assigned
    if (!S.fid) {
      var banner = '<div class="banner"><div><div class="muted" style="font-size:13px;font-weight:600">Welcome back</div><h4>' + esc(u.name) + '</h4></div><span class="pill">' + I("calendar") + " Today is " + today + "</span></div>";
      var list = S.myReports.length ? '<div class="list">' + S.myReports.map(function (rp) { return '<button class="frow" data-a="openreport" data-id="' + rp.id + '"><span class="fi">' + I("file-text") + '</span><span class="fbody"><span class="fname">' + esc(rp.facilityName) + '</span><span class="fmeta">' + (rp.type === "audit" ? '<span class="pill" style="background:#1A1D21;color:#fff">' + I("clipboard-check") + " Monthly audit</span>" : '<span class="pill" style="background:#FBEAE1;color:var(--hazard-d)">' + I("clipboard-list") + " Report to fill out</span>") + (S.drafts && S.drafts[rp.id] ? '<span class="pill draft">' + I("device-floppy") + " Draft saved</span>" : "") + "</span>" + (rp.note ? '<span class="faddr">' + I("note") + " " + esc(rp.note) + "</span>" : "") + "</span>" + I("chevron-right") + "</button>"; }).join("") + "</div>"
        : '<div class="done" style="padding:30px 16px"><div class="di" style="background:#E1F0E9;color:var(--ok)">' + I("circle-check") + '</div><h3>No reports outstanding</h3><p class="muted">You\'re all caught up. New reports your manager sends will show up here.</p></div>';
      return banner + '<h3 style="margin-bottom:10px">Outstanding reports</h3>' + list;
    }
    var f = mine.find(function (x) { return x.id === S.fid; }) || S.facilities.find(function (x) { return x.id === S.fid; }), r = S.resp, cfg = f.config;
    var aType = S.report && S.report.type, isAudit = aType === "audit";
    var STEPS = stepsFor(f, aType);
    if (S.done) return '<div class="done"><div class="di">' + I("circle-check") + '</div><h3>Report submitted</h3><p class="muted">' + esc(f.name) + ' — sent to the office. Thanks, ' + esc(u.name) + '.</p><button class="btn btn-dark" data-a="restart">Back to my reports</button></div>';

    var sk = STEPS[S.step][0], body = "";
    var marks = {}; if (S.tried) stepErrors(sk, r, cfg, aType).forEach(function (it) { if (it.mark) marks[it.mark] = 1; });
    var inv = function (m) { return marks[m] ? " invalid" : ""; };
    if (sk === "Tasks") body = cfg.weeklyTasks.length ? cfg.weeklyTasks.map(function (t, i) { var tr = r.tasks[t.id] || {}; return '<div class="card"><div class="row" style="align-items:flex-start"><span class="chip">' + (i + 1) + '</span><p style="margin:0;font-weight:600">' + esc(t.text) + '</p></div><div class="label">Your response</div><textarea rows="2" data-resp="tasks.' + t.id + '.note" placeholder="Status, what you did…">' + esc(tr.note || "") + "</textarea>" + photoField("Attach photos", 0, tr.files || [], "task:" + t.id) + "</div>"; }).join("") : '<div class="empty">No tasks this week.</div>';
    if (sk === "Lockout") {
      var sec = function (title, col, arr, key, extra) { return '<div class="section"><div class="sh" style="background:' + col + '"><span>' + title + '</span></div><div class="sb">' + (arr.length ? arr.map(function (x) { var a = r[key][x.id] || {}; return '<div class="lrow' + inv(key + ":" + x.id) + '"><span class="chip">Unit ' + x.unit + "</span>" + (extra ? '<div class="locknum"><span class="muted" style="font-size:13px">Lock #</span><input class="mono" inputmode="numeric" maxlength="4" placeholder="0000" data-resp="lockAdd.' + x.id + '.lockNo" data-num="1" value="' + esc(a.lockNo || "") + '"></div>' : "") + '<button class="check' + (a.done ? " on" : "") + '" data-a="chk" data-p="' + key + "." + x.id + '.done"><span class="bx">' + (a.done ? I("check") : "") + (extra ? "</span>Lock added</button>" : "</span>" + (key === "lockKeep" ? "Verified locked" : "Lock removed") + "</button>") + "</div>"; }).join("") : '<div class="muted" style="font-size:13px;padding:6px 0">None.</div>') + "</div></div>"; };
      body = '<div class="stack">' + sec("Locks to add", "var(--hazard)", cfg.lockoutAdd, "lockAdd", true) + sec("Locks to remove", "var(--alert)", cfg.lockoutRemove, "lockRemove") + sec("Leave in place", "var(--ok)", cfg.lockoutKeep, "lockKeep") + "</div>";
    }
    if (sk === "Maintenance") body = cfg.maintenance.length ? cfg.maintenance.map(function (x) { return '<div class="card"><div class="row" style="flex-wrap:wrap"><span class="chip">Unit ' + x.unit + '</span><span class="muted">' + esc(x.note) + '</span></div><div class="label">Where it stands now</div><textarea rows="2" data-resp="maintenance.' + x.id + '.statement">' + esc((r.maintenance[x.id] || {}).statement || "") + "</textarea></div>"; }).join("") : '<div class="empty">No units flagged.</div>';
    if (sk === "Vacated") body = cfg.vacated.length ? cfg.vacated.map(function (x) {
      var v = r.vacated[x.id] || {};
      var ck = function (key, label, note) { return '<button class="check full' + (v[key] ? " on" : "") + '" data-a="chk" data-p="vacated.' + x.id + "." + key + '"><span class="bx">' + (v[key] ? I("check") : "") + "</span><span>" + label + (note ? '<span class="muted" style="display:block;font-size:12px;font-weight:400">' + note + "</span>" : "") + "</span></button>"; };
      return '<div class="card' + inv("vacated:" + x.id) + '"><span class="chip">Unit ' + x.unit + '</span><div class="cond"><button class="' + (v.status === "clean" ? "ok" : "") + '" data-a="cond" data-id="' + x.id + '" data-v="clean">' + I("circle-check") + ' Clean / broom-swept</button><button class="' + (v.status === "problem" ? "bad" : "") + '" data-a="cond" data-id="' + x.id + '" data-v="problem">' + I("alert-triangle") + ' Problem</button></div>'
        + (v.status === "problem" ? '<textarea rows="2" style="margin-top:10px" data-resp="vacated.' + x.id + '.problem" placeholder="What is wrong?">' + esc(v.problem || "") + "</textarea>" : "")
        + '<div class="label" style="margin-top:12px">Unit condition checks</div>'
        + ck("door", "Door rolls up properly", "Doesn't suddenly close; springs in working order")
        + ck("latch", "Latch works and slides properly without prying")
        + ck("intrusion", "No intrusion into other units")
        + ck("water", "No wet spots on the floor and no water intrusion")
        + photoField("Photo of the unit", 0, v.photos || [], "vacated:" + x.id) + "</div>";
    }).join("") : '<div class="empty">No vacated units.</div>';
    if (sk === "Vacant" && isAudit) {
      body = '<div class="notice">' + I("key") + " Audit: check every vacant unit and photograph each one.</div>" + (cfg.vacant.length ? cfg.vacant.map(function (x) {
        var v = r.vacantAudit[x.id] || {};
        var ck = function (key, label, note) { return '<button class="check full' + (v[key] ? " on" : "") + '" data-a="chk" data-p="vacantAudit.' + x.id + "." + key + '"><span class="bx">' + (v[key] ? I("check") : "") + "</span><span>" + label + (note ? '<span class="muted" style="display:block;font-size:12px;font-weight:400">' + note + "</span>" : "") + "</span></button>"; };
        return '<div class="card' + inv("vacantAudit:" + x.id) + '" style="margin-top:11px"><span class="chip">Unit ' + x.unit + '</span><div class="cond"><button class="' + (v.status === "clean" ? "ok" : "") + '" data-a="cond" data-scope="vacantAudit" data-id="' + x.id + '" data-v="clean">' + I("circle-check") + ' Clean / broom-swept</button><button class="' + (v.status === "problem" ? "bad" : "") + '" data-a="cond" data-scope="vacantAudit" data-id="' + x.id + '" data-v="problem">' + I("alert-triangle") + ' Problem</button></div>'
          + (v.status === "problem" ? '<textarea rows="2" style="margin-top:10px" data-resp="vacantAudit.' + x.id + '.problem" placeholder="What is wrong?">' + esc(v.problem || "") + "</textarea>" : "")
          + '<div class="label" style="margin-top:12px">Unit condition checks</div>'
          + ck("door", "Door rolls up properly") + ck("latch", "Latch works and slides properly") + ck("intrusion", "No intrusion into other units") + ck("water", "No wet spots / water intrusion")
          + photoField("Photo of this unit", 1, v.photos || [], "vacantAudit:" + x.id) + "</div>";
      }).join("") : '<div class="empty">No vacant units on the master list. Add them on the facility Set-up page.</div>');
    } else if (sk === "Vacant") body = '<div class="card' + inv("vacant") + '"><div class="label">Office shows these as vacant (no lock)</div><div class="row" style="flex-wrap:wrap">' + (cfg.vacant.length ? cfg.vacant.map(function (x) { return '<span class="chip">Unit ' + x.unit + "</span>"; }).join("") : '<span class="muted">None.</span>') + '</div><p style="margin:12px 0 8px;font-weight:600">Are these the only units without a lock?</p>' + yn("vacantConfirmed", r.vacantConfirmed, "Yes, that's all", "No, found another") + (r.vacantConfirmed === false ? '<div class="label">List every other unit you found unlocked</div><textarea rows="2" data-resp="vacantExtra">' + esc(r.vacantExtra) + "</textarea>" : "") + "</div>";
    if (sk === "Occupied") { var occ = occupiedUnits(cfg); body = '<div class="notice">' + I("lock") + " Audit: confirm a customer's lock is on every occupied unit. Flag any that don't have one.</div>" + (occ.length ? occ.map(function (x) { var o = r.occupied[x.id] || {}; return '<div class="card' + inv("occupied:" + x.id) + '"><span class="chip">Unit ' + x.unit + '</span><div style="margin-top:10px">' + yn("occupied." + x.id + ".hasLock", o.hasLock, "Customer lock on", "No lock!") + "</div>" + (o.hasLock === false ? '<div class="label">Note (no lock found)</div><textarea rows="2" data-resp="occupied.' + x.id + '.note" placeholder="What did you find? Did you secure it?">' + esc(o.note || "") + "</textarea>" : "") + "</div>"; }).join("") : '<div class="empty">No occupied units. Add the master unit list on the facility Set-up page (occupied = any unit not marked vacant).</div>'); }
    if (sk === "Auction") body = cfg.auction.length ? '<div class="notice">' + I("shield") + ' Do not touch anything inside. Photograph as-is, then re-lock.</div>' + cfg.auction.map(function (x) { var a = r.auction[x.id] || {}; return '<div class="card' + inv("auction:" + x.id) + '" style="margin-top:11px"><span class="chip">Unit ' + x.unit + "</span>" + photoField("Photos of contents", 3, a.photos || [], "auction:" + x.id) + '<button class="check full' + (a.untouched ? " on" : "") + '" data-a="chk" data-p="auction.' + x.id + '.untouched"><span class="bx">' + (a.untouched ? I("check") : "") + '</span>I did not touch any items inside</button><button class="check full' + (a.lockBack ? " on" : "") + '" data-a="chk" data-p="auction.' + x.id + '.lockBack"><span class="bx">' + (a.lockBack ? I("check") : "") + '</span>Lock put back on the unit</button><div class="row" style="margin-top:10px"><div class="locknum"><span class="muted" style="font-size:13px">Lock # put on unit</span><input class="mono" inputmode="numeric" maxlength="4" placeholder="0000" data-resp="auction.' + x.id + '.lockNo" data-num="1" value="' + esc(a.lockNo || "") + '"></div></div><div class="label">Report</div><textarea rows="2" data-resp="auction.' + x.id + '.report">' + esc(a.report || "") + "</textarea></div>"; }).join("") : '<div class="empty">No auction units.</div>';
    if (sk === "Grounds") { var g = r.grounds; var q = function (lab, key, y, n) { return '<div class="qrow' + inv("grounds." + key) + '"><span>' + lab + "</span>" + yn("grounds." + key, g[key], y, n) + "</div>"; }; var nt = function (key, ph) { return '<textarea rows="2" data-resp="grounds.' + key + '" placeholder="' + ph + '">' + esc(g[key]) + "</textarea>"; };
      body = '<div class="card">'
        + q("Are there any weeds at the facility?", "weeds") + (g.weeds === true ? nt("weedsNote", "Where are the weeds?") : "")
        + q("Has the grass been mowed?", "mowed")
        + q("Any potholes or areas where gravel is needed?", "potholes") + (g.potholes === true ? nt("potholesNote", "Where?") : "")
        + q("Any exterior light bulbs burnt out?", "bulbs") + (g.bulbs === true ? nt("bulbsNote", "Which lights / where?") : "")
        + q("Any areas of new damage to the building?", "damage") + (g.damage === true ? nt("damageNote", "Describe the damage and where") : "")
        + q("Any large amounts of leaves on drive lanes or other organic matter?", "leaves") + (g.leaves === true ? nt("leavesNote", "Where?") : "")
        + q("Snow obstructing entry to the facility?", "snow") + (g.snow === true ? nt("snowNote", "Where is access blocked?") : "")
        + q("Any trash on the ground or items out of place?", "trash") + (g.trash === true ? nt("trashNote", "What and where? If not removed yet, include it in your photos below.") : "")
        + q("Closed any doors that were open?", "doors", "Yes", "None open")
        + '<div class="label">Anything else to note?</div><textarea rows="2" data-resp="grounds.notes">' + esc(g.notes) + "</textarea></div>"
        + '<div class="card' + inv("grounds.photos") + '">' + photoField("Facility photos (different areas — include any trash/items out of place)", isAudit ? 10 : 5, g.photos, "grounds") + "</div>"; }
    if (sk === "Climate") { var cl = r.climate; var cq = function (lab, key, y, n) { return '<div class="qrow' + inv("climate." + key) + '"><span>' + lab + "</span>" + yn("climate." + key, cl[key], y, n) + "</div>"; };
      body = '<div class="notice">' + I("temperature") + ' Climate-controlled building checks.</div><div class="card" style="margin-top:11px">'
        + cq("Is the facility's temperature at a reasonable level?", "temp", "Yes", "No") + (cl.temp !== null ? '<textarea rows="1" data-resp="climate.tempNote" placeholder="Optional: note the reading (e.g. 74°F)">' + esc(cl.tempNote) + "</textarea>" : "")
        + cq("Any interior light bulbs burnt out?", "bulbs") + (cl.bulbs === true ? '<textarea rows="2" data-resp="climate.bulbsNote" placeholder="Which / where?">' + esc(cl.bulbsNote) + "</textarea>" : "")
        + cq("Any trash on the ground inside?", "trash") + (cl.trash === true ? '<textarea rows="2" data-resp="climate.trashNote" placeholder="Where?">' + esc(cl.trashNote) + "</textarea>" : "")
        + cq("All dollies / moving-assist items in their proper place?", "dollies", "Yes", "No")
        + photoField("Interior photos (optional)", 0, cl.photos || [], "climate") + "</div>"; }
    if (sk === "Review") { var rows = [[0, "Weekly tasks", Object.values(r.tasks).filter(function (t) { return t.note && t.note.trim(); }).length + " of " + cfg.weeklyTasks.length + " answered"], [1, "Locks", cfg.lockoutAdd.length + " add · " + cfg.lockoutRemove.length + " remove"], [2, "Maintenance", cfg.maintenance.length + " unit(s)"], [3, "Recently vacated", cfg.vacated.length + " unit(s)"], [4, "Vacant", r.vacantConfirmed === false ? "Extra reported" : r.vacantConfirmed ? "Confirmed" : "—"], [5, "Auction", cfg.auction.length + " unit(s)"], [6, "Grounds", r.grounds.photos.length + " photos"]]; if (cfg.climateControlled) rows.push([7, "Climate control", "included"]);
      body = '<div class="card"><p class="hint" style="margin:0">Review before sending. Tap a line to jump back.</p></div>' + rows.map(function (x) { return '<button class="review-row" data-a="step" data-i="' + x[0] + '" style="margin-top:10px"><span style="flex:1">' + x[1] + '</span><span class="v">' + x[2] + "</span>" + I("chevron-right") + "</button>"; }).join("") + '<div class="note" style="margin-top:14px;border:1px solid var(--alert);background:#FBEEEC;color:var(--alert);font-weight:600">' + I("alert-triangle") + " Are you sure? Once you submit this report you can't go back and change it.</div>"; }

    var all = allIssues(r, cfg, STEPS), last = S.step === STEPS.length - 1;
    if (last && all.length) body = issuesList("Finish these " + all.length + " item(s) before submitting", all, true) + body;
    var pips = '<div class="pips">' + STEPS.map(function (s, i) { return '<button class="pip ' + (i < S.step ? "done" : i === S.step ? "on" : "") + '" data-a="step" data-i="' + i + '"><small>' + String(i + 1).padStart(2, "0") + "</small>" + I(s[1]) + "</button>"; }).join("") + "</div>";
    var hometop = '<div class="wtop"><button class="btn" data-a="home">' + I("arrow-left") + ' My facilities</button><button class="btn" data-a="saveexit">' + I("device-floppy") + " Save &amp; exit</button></div>";
    var head = '<div class="wo"><div class="between"><div><div class="eyebrow">Work order</div><h4>' + esc(f.name) + '</h4></div><div class="row" style="gap:6px;flex-wrap:wrap"><span class="chip" style="display:inline-flex;align-items:center;gap:4px">' + I("calendar") + " " + (f.checkInDay || "—") + '</span><span class="chip" style="display:inline-flex;align-items:center;gap:4px">' + I("refresh") + " " + fday(f.config.updatedAt) + "</span></div></div>" + pips + '<div class="cur">' + sk + "</div></div>";
    var issues = stepErrors(sk, r, cfg);
    var err = (!last && S.tried && issues.length) ? issuesList("Please fix " + issues.length + " item(s) on this step", issues, false) : "";
    var nav = '<div class="navb"><button class="btn" data-a="back"' + (S.step === 0 ? " disabled" : "") + ">" + I("chevron-left") + ' Back</button><span class="nc">' + (S.step + 1) + " / " + STEPS.length + "</span>" + (last ? '<button class="btn btn-ok" data-a="submit"' + (all.length || S.busy ? " disabled" : "") + ">" + (S.busy ? '<span class="spin"></span> ' : "") + "Submit report</button>" : '<button class="btn btn-dark" data-a="next">Next ' + I("chevron-right") + "</button>") + "</div>";
    return hometop + head + '<div class="stack" style="margin-top:14px">' + body + "</div>" + err + nav;
  }

  /* ---------- render + topbar ---------- */
  function render() {
    if (S.auth) {
      topright.innerHTML = '<span class="pill">' + I("user") + " " + esc(S.auth.name) + '</span><button class="btn sm" data-a="logout">' + I("logout") + " Log out</button>";
    } else topright.innerHTML = "";
    app.innerHTML = (!S.auth ? login() : S.auth.role === "worker" ? worker() : S.auth.role === "employee" ? employee() : manager()) + (S.auth ? photoLightbox() : "");
  }

  /* ---------- input binding (no re-render to keep focus) ---------- */
  document.addEventListener("input", function (ev) {
    var t = ev.target;
    if (t.id === "lu") { S.lu = t.value; return; } if (t.id === "lp") { S.lp = t.value; return; }
    var v = t.value;
    if (t.getAttribute("data-num")) { v = v.replace(/\D/g, "").slice(0, 4); t.value = v; }
    var fac = t.getAttribute("data-fac");
    if (fac && S.editId) { var f = S.facilities.find(function (x) { return x.id === S.editId; }); f[fac] = v; saveSoon(function () { putFacility(f); }); return; }
    var li = t.getAttribute("data-li");
    if (li && S.editId) { var p = li.split("."), f2 = S.facilities.find(function (x) { return x.id === S.editId; }), it = f2.config[p[0]].find(function (x) { return x.id === p[1]; }); if (it) { it[p[2]] = v; saveSoon(function () { putFacility(f2); }); } return; }
    var usr = t.getAttribute("data-usr");
    if (usr && S.userId) { var w = S.users.find(function (x) { return x.id === S.userId; }); w[usr === "password" ? "_pwd" : usr] = v; saveSoon(function () { putUser(w); }); return; }
    var cfg = t.getAttribute("data-cfg");
    if (cfg && (S.secFac || S.editId)) { var sf = S.facilities.find(function (x) { return x.id === (S.secFac || S.editId); }); if (sf) { setPath(sf.config, cfg, v); saveSoon(function () { putFacility(sf); }); } return; }
    var cli = t.getAttribute("data-cli");
    if (cli && S.secFac) { var pr = cli.split("|"), sf2 = S.facilities.find(function (x) { return x.id === S.secFac; }); if (sf2) { var arr = getPath(sf2.config, pr[0]) || [], item = arr.find(function (z) { return z.id === pr[1]; }); if (item) { item[pr[2]] = v; saveSoon(function () { putFacility(sf2); }); } } return; }
    if (t.getAttribute("data-newnote") !== null) { S.newReportNote = v; return; }
    var rnote = t.getAttribute("data-rnote");
    if (rnote) { var rr = S.reports.find(function (z) { return z.id === rnote; }); if (rr) { rr.note = v; saveSoon(function () { api("PUT", "/api/reports/" + rnote, { note: rr.note }); }); } return; }
    var note = t.getAttribute("data-note");
    if (note) { var nfid = S.editId || S.newReportFac; var fnn = S.facilities.find(function (x) { return x.id === nfid; }); if (fnn) { var nn = (fnn.config.adminNotes || []).find(function (z) { return z.id === note; }); if (nn) { nn.text = v; saveSoon(function () { putFacility(fnn); }); } } return; }
    var ln = t.getAttribute("data-lnote");
    if (ln) { var Ln = (S.leads || []).find(function (x) { return x.id === ln; }); if (Ln) { Ln.notes = v; saveSoon(function () { api("PUT", "/api/leads/" + ln, { notes: Ln.notes }); }); } return; }
    var pay = t.getAttribute("data-pay");
    if (pay) { S.payDraft = S.payDraft || {}; S.payDraft[pay] = v; return; }
    var exp = t.getAttribute("data-exp");
    if (exp) { S.expDraft = S.expDraft || {}; S.expDraft[exp] = v; return; }
    var de = t.getAttribute("data-de");
    if (de) { var dp = de.split("|"), den = (S.depDraft.entries || []).find(function (z) { return z.id === dp[0]; }); if (den) den[dp[1]] = v; return; }
    var rv = t.getAttribute("data-rv");
    if (rv) { S.reviewDraft = S.reviewDraft || {}; S.reviewDraft[rv] = v; return; }
    var mt = t.getAttribute("data-mt");
    if (mt) { S.mtDraft = S.mtDraft || {}; S.mtDraft[mt] = v; return; }
    var ee = t.getAttribute("data-ee");
    if (ee) { var ep = ee.split("|"), een = ((S.expDraft || {}).entries || []).find(function (z) { return z.id === ep[0]; }); if (een) een[ep[1]] = v; return; }
    var bb = t.getAttribute("data-bb");
    if (bb) { var bp = bb.split("|"); if (!S.billback[bp[0]]) S.billback[bp[0]] = { mgmtRate: "", softwareRate: "", onsiteFee: "", otherFees: [] }; S.billback[bp[0]][bp[1]] = v; saveSoon(function () { api("PUT", "/api/billback/" + bp[0], S.billback[bp[0]]); }); return; }
    var bbf = t.getAttribute("data-bbf");
    if (bbf) { var fp = bbf.split("|"); var cfg2 = S.billback[fp[0]]; if (cfg2) { var of = (cfg2.otherFees || []).find(function (z) { return z.id === fp[1]; }); if (of) { of[fp[2]] = v; saveSoon(function () { api("PUT", "/api/billback/" + fp[0], cfg2); }); } } return; }
    var rec = t.getAttribute("data-rec");
    if (rec) { S.recDraft = S.recDraft || {}; S.recDraft[rec] = v; return; }
    var recf = t.getAttribute("data-recf");
    if (recf) { var rp = recf.split("|"), rr2 = (S.recurring || []).find(function (x) { return x.id === rp[0]; }); if (rr2) { rr2[rp[1]] = v; saveSoon(function () { var body = {}; body[rp[1]] = v; api("PUT", "/api/recurring/" + rp[0], body); }); } return; }
    var ld = t.getAttribute("data-lead");
    if (ld) { S.leadDraft = S.leadDraft || {}; S.leadDraft[ld] = v; return; }
    var fud = t.getAttribute("data-fu");
    if (fud) { S.fuDraft = S.fuDraft || {}; S.fuDraft[fud] = v; return; }
    var rp = t.getAttribute("data-resp");
    if (rp && S.resp) { setPath(S.resp, rp, v); }
  });
  document.addEventListener("change", function (ev) {
    var t = ev.target, day = t.getAttribute("data-day");
    if (t.getAttribute("data-lead") === "estMoveIn") { S.leadDraft = S.leadDraft || {}; S.leadDraft.estMoveIn = t.value; S.leadDraft.firstFollowup = ""; S.leadDraft.firstFollowupReason = ""; render(); return; }
    var pay = t.getAttribute("data-pay");
    if (pay) { S.payDraft = S.payDraft || {}; S.payDraft[pay] = t.value; return; }
    if (t.getAttribute("data-leadfu") !== null) { S.leadDraft = S.leadDraft || {}; S.leadDraft.firstFollowup = t.value; render(); return; }
    if (t.getAttribute("data-funext") !== null) { S.fuDraft = S.fuDraft || {}; S.fuDraft.nextFollowup = t.value; render(); return; }
    if (t.getAttribute("data-mtfac") !== null) { S.mtDraft = S.mtDraft || {}; S.mtDraft.facilityId = t.value; S.mtJustSent = false; render(); return; }
    if (t.getAttribute("data-invpaidfac") !== null) { S.invPaidFac = t.value; render(); return; }
    if (t.getAttribute("data-invviewfac") !== null) { S.invFac = t.value; render(); return; }
    if (t.getAttribute("data-rcupfac") !== null) { S.receiptUpFac = t.value; return; }
    if (t.getAttribute("data-rcviewfac") !== null) { S.receiptFac = t.value; render(); return; }
    if (t.getAttribute("data-rcfile") !== null) { var rfiles = Array.prototype.slice.call(t.files); t.value = ""; var rfile = rfiles[0]; if (rfile) { var post = function (url) { api("POST", "/api/receipts", { name: rfile.name, file: url, source: "", facilityId: S.receiptUpFac || "" }).then(function () { S.receiptFac = S.receiptUpFac || ""; return reloadReceipts(); }).then(function () { toast("Receipt uploaded."); render(); }).catch(function (e) { toast(e.message); }); }; if (rfile.type === "application/pdf") { var frr = new FileReader(); frr.onload = function (e) { post(e.target.result); }; frr.readAsDataURL(rfile); } else { compress(rfile).then(function (im) { if (im) post(im.url); }); } } return; }
    if (t.getAttribute("data-invfac") !== null) { S.invDraft = S.invDraft || {}; S.invDraft.facilityId = t.value; render(); return; }
    if (t.getAttribute("data-invmonth") !== null) { S.invDraft = S.invDraft || {}; S.invDraft.monthPick = t.value; return; }
    var exp = t.getAttribute("data-exp");
    if (exp) { S.expDraft = S.expDraft || {}; S.expDraft[exp] = t.value; return; }
    var de = t.getAttribute("data-de");
    if (de) { var dp = de.split("|"), den = (S.depDraft.entries || []).find(function (z) { return z.id === dp[0]; }); if (den) { den[dp[1]] = t.value; render(); } return; }
    var rv = t.getAttribute("data-rv");
    if (rv) { S.reviewDraft = S.reviewDraft || {}; S.reviewDraft[rv] = t.value; return; }
    var ee = t.getAttribute("data-ee");
    if (ee) { var ep = ee.split("|"), een = ((S.expDraft || {}).entries || []).find(function (z) { return z.id === ep[0]; }); if (een) { een[ep[1]] = t.value; if (ep[1] === "source") render(); } return; }
    var bbc = t.getAttribute("data-bb");
    if (bbc) { var bcp = bbc.split("|"); if (!S.billback[bcp[0]]) S.billback[bcp[0]] = { mgmtRate: "", softwareRate: "", onsiteFee: "", otherFees: [] }; S.billback[bcp[0]][bcp[1]] = t.value; api("PUT", "/api/billback/" + bcp[0], S.billback[bcp[0]]); render(); return; }
    var rec = t.getAttribute("data-rec");
    if (rec) { S.recDraft = S.recDraft || {}; S.recDraft[rec] = t.value; return; }
    var recdate = t.getAttribute("data-recdate");
    if (recdate) { var rr = (S.recurring || []).find(function (x) { return x.id === recdate; }); if (rr) { rr.lastPaidDate = t.value; api("PUT", "/api/recurring/" + recdate, { lastPaidDate: t.value }).then(render); } return; }
    if (t.getAttribute("data-facphoto") !== null) { var ff = Array.prototype.slice.call(t.files); t.value = ""; var fac = S.facilities.find(function (x) { return x.id === S.editId; }); if (fac) { if (!Array.isArray(fac.config.facilityPhotos)) fac.config.facilityPhotos = []; Promise.all(ff.map(function (file) { return compress(file); })).then(function (ims) { ims.forEach(function (im) { if (im) fac.config.facilityPhotos.push(im); }); putFacility(fac); render(); }); } return; }
    if (t.getAttribute("data-payinvoice") !== null) { var files = Array.prototype.slice.call(t.files); t.value = ""; var file = files[0]; if (file) { S.payDraft = S.payDraft || {}; if (file.type === "application/pdf") { var fr = new FileReader(); fr.onload = function (e) { S.payDraft.invoice = e.target.result; S.payDraft.invoiceType = "pdf"; S.payDraft.invoiceName = file.name; render(); }; fr.readAsDataURL(file); } else { compress(file).then(function (im) { if (im) { S.payDraft.invoice = im.url; S.payDraft.invoiceType = "image"; S.payDraft.invoiceName = file.name; render(); } }); } } return; }
    var recf = t.getAttribute("data-recf");
    if (recf) { var rp = recf.split("|"), rr2 = (S.recurring || []).find(function (x) { return x.id === rp[0]; }); if (rr2) { rr2[rp[1]] = t.value; var body = {}; body[rp[1]] = t.value; api("PUT", "/api/recurring/" + rp[0], body); } return; }
    if (t.getAttribute("data-newfac") !== null) { S.newReportFac = t.value; render(); return; }
    if (day && S.userId) { var w = S.users.find(function (x) { return x.id === S.userId; }); var a = (w.assignments || []).find(function (x) { return x.facilityId === day; }); if (a) { a.checkInDay = t.value; putUser(w); } return; }
    var urole = t.getAttribute("data-usr");
    if (urole === "role" && S.userId) { var wr = S.users.find(function (x) { return x.id === S.userId; }); wr.role = t.value; putUser(wr).then(render); return; }
    var cfg = t.getAttribute("data-cfg");
    if (cfg && (S.secFac || S.editId)) { var sf = S.facilities.find(function (x) { return x.id === (S.secFac || S.editId); }); if (sf) { setPath(sf.config, cfg, t.value); putFacility(sf).then(render); } return; }
    var cli = t.getAttribute("data-cli");
    if (cli && S.secFac) { var pr = cli.split("|"), sf2 = S.facilities.find(function (x) { return x.id === S.secFac; }); if (sf2) { var arr = getPath(sf2.config, pr[0]) || [], item = arr.find(function (z) { return z.id === pr[1]; }); if (item) { item[pr[2]] = t.value; putFacility(sf2).then(render); } } return; }
    var add = t.getAttribute("data-add");
    if (add && S.resp) {
      var files = Array.prototype.slice.call(t.files); t.value = "";
      Promise.all(files.map(compress)).then(function (imgs) { imgs.filter(Boolean).forEach(function (im) { pushPhoto(add, im); }); render(); });
    }
  });
  function setPath(o, p, v) { var a = p.split("."), c = o; for (var i = 0; i < a.length - 1; i++) { if (c[a[i]] == null) c[a[i]] = {}; c = c[a[i]]; } c[a[a.length - 1]] = v; }
  function getPath(o, p) { var a = p.split("."), c = o; for (var i = 0; i < a.length; i++) { if (c == null) return undefined; c = c[a[i]]; } return c; }
  function pushPhoto(scope, im) { var r = S.resp; if (scope === "grounds") r.grounds.photos.push(im); else if (scope === "climate") { (r.climate.photos = r.climate.photos || []).push(im); } else if (scope.indexOf("auction:") === 0) { var id = scope.split(":")[1]; (r.auction[id] = r.auction[id] || {}); (r.auction[id].photos = r.auction[id].photos || []).push(im); } else if (scope.indexOf("vacated:") === 0) { var vid = scope.split(":")[1]; (r.vacated[vid] = r.vacated[vid] || {}); (r.vacated[vid].photos = r.vacated[vid].photos || []).push(im); } else if (scope.indexOf("task:") === 0) { var tid = scope.split(":")[1]; (r.tasks[tid] = r.tasks[tid] || {}); (r.tasks[tid].files = r.tasks[tid].files || []).push(im); } }
  function delPhoto(scope, pid) { var r = S.resp, filt = function (arr) { return arr.filter(function (p) { return p.id !== pid; }); }; if (scope === "grounds") r.grounds.photos = filt(r.grounds.photos); else if (scope === "climate") r.climate.photos = filt(r.climate.photos); else if (scope.indexOf("auction:") === 0) { var id = scope.split(":")[1]; r.auction[id].photos = filt(r.auction[id].photos); } else if (scope.indexOf("vacated:") === 0) { var vid = scope.split(":")[1]; r.vacated[vid].photos = filt(r.vacated[vid].photos); } else if (scope.indexOf("task:") === 0) { var tid = scope.split(":")[1]; r.tasks[tid].files = filt(r.tasks[tid].files); } }

  /* ---------- API-backed mutations ---------- */
  function putFacility(f) { return api("PUT", "/api/facilities/" + f.id, { name: f.name, address: f.address, config: f.config }).catch(function (e) { toast(e.message); }); }
  function putUser(w) { var body = { name: w.name, username: w.username, role: w.role, assignments: w.assignments }; if (w._pwd) body.password = w._pwd; return api("PUT", "/api/users/" + w.id, body).then(function (u) { delete w._pwd; if (u && u.role) w.role = u.role; }).catch(function (e) { toast(e.message); }); }

  /* ---------- clicks ---------- */
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-a]"); if (!el) return;
    var a = el.getAttribute("data-a"), id = el.getAttribute("data-id"), k = el.getAttribute("data-k");

    if (a === "login" || a === "demo") {
      var uname = a === "demo" ? el.getAttribute("data-u") : S.lu;
      var pwd = a === "demo" ? el.getAttribute("data-p") : S.lp;
      S.busy = true; render();
      api("POST", "/api/login", { username: uname, password: pwd }).then(function (r) {
        setToken(r.token); S.auth = r.user; S.lerr = ""; S.lu = ""; S.lp = ""; S.busy = false;
        S.tab = S.auth.role === "employee" ? "leads" : "facilities"; S.editId = S.userId = S.subOpen = S.secFac = S.fid = S.leadOpen = S.fuOpen = null; S.leadAdd = false;
        return loadForRole();
      }).then(render).catch(function (e) { S.busy = false; S.lerr = e.message; render(); });
      return;
    }
    if (a === "logout") { saveDraft(); flushSave(); setToken(null); S.auth = null; S.fid = null; S.resp = null; S.editId = S.userId = S.subOpen = S.secFac = S.leadOpen = S.fuOpen = null; S.leadAdd = false; render(); return; }

    if (a === "tab") { flushSave(); S.tab = k; S.secFac = null; S.openItem = null; S.subOpen = null; S.userId = null; S.editId = null; S.infoMode = false; S.facEdit = false; S.leadOpen = null; S.leadAdd = false; S.reviewAdd = false; S.fuOpen = null; render(); return; }

    /* facilities */
    if (a === "addfac") { api("POST", "/api/facilities", {}).then(function (f) { S.facilities.push(f); S.editId = f.id; S.facView = "info"; S.facEdit = true; S.subOpen = null; render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "editfac") { S.editId = id; S.facView = "info"; S.facEdit = false; S.subOpen = null; render(); return; }
    if (a === "facview") { flushSave(); S.facView = k; S.facEdit = false; S.subOpen = null; render(); return; }
    if (a === "facphotoview") { var pf = el.getAttribute("data-fid"); S.photoView = { fid: pf, idx: parseInt(k, 10) || 0 }; render(); return; }
    if (a === "photonav") { if (S.photoView) { var pvf = S.facilities.find(function (x) { return x.id === S.photoView.fid; }); var n = pvf ? gA(pvf, "facilityPhotos").length : 0; if (n) { var d = parseInt(el.getAttribute("data-d"), 10) || 1; S.photoView.idx = (S.photoView.idx + d + n) % n; render(); } } return; }
    if (a === "photoclose") { S.photoView = null; render(); return; }
    if (a === "photonoop") { return; }
    if (a === "facphotodel") { var fp = S.facilities.find(function (x) { return x.id === S.editId; }); if (fp) { var pk = parseInt(k, 10); fp.config.facilityPhotos = (fp.config.facilityPhotos || []).filter(function (z, zi) { return id && z.id ? z.id !== id : zi !== pk; }); putFacility(fp); render(); } return; }
    if (a === "facedit") { S.facEdit = true; render(); return; }
    if (a === "facdone") { flushSave(); S.facEdit = false; api("GET", "/api/facilities").then(function (fl) { S.facilities = fl; render(); }); return; }
    if (a === "facconfig") { S.editId = id; S.facView = "audit"; S.facEdit = false; S.subOpen = null; render(); return; }
    if (a === "backedit") { flushSave(); S.editId = null; S.facView = "info"; S.facEdit = false; S.subOpen = null; api("GET", "/api/facilities").then(function (f) { S.facilities = f; render(); }); return; }
    if (a === "delfac") { if (!confirm("Delete this facility and its setup?")) return; api("DELETE", "/api/facilities/" + id).then(function () { S.facilities = S.facilities.filter(function (x) { return x.id !== id; }); render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "ladd") { var f = S.facilities.find(function (x) { return x.id === S.editId; }); if (!Array.isArray(f.config[k])) f.config[k] = []; f.config[k].push({ id: uid() }); putFacility(f); render(); return; }
    if (a === "ldel") { var f2 = S.facilities.find(function (x) { return x.id === S.editId; }); f2.config[k] = f2.config[k].filter(function (x) { return x.id !== id; }); putFacility(f2); render(); return; }

    /* staff */
    if (a === "adduser") { api("POST", "/api/users", { role: "worker", name: "New person", username: "user" + Date.now().toString().slice(-4), password: "changeme", assignments: [] }).then(function (w) { S.users.push(w); S.userId = w.id; render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "openuser") { S.userId = id; render(); return; }
    if (a === "backuser") { flushSave(); S.userId = null; render(); return; }
    if (a === "assign") {
      var w = S.users.find(function (x) { return x.id === S.userId; }); w.assignments = w.assignments || [];
      var i = w.assignments.findIndex(function (x) { return x.facilityId === id; });
      if (i >= 0) w.assignments.splice(i, 1); else w.assignments.push({ facilityId: id, checkInDay: "Monday" });
      putUser(w); render(); return;
    }
    if (a === "deluser") {
      if (!confirm("Remove this login?")) return;
      api("DELETE", "/api/users/" + id).then(function () { S.users = S.users.filter(function (x) { return x.id !== id; }); S.userId = null; render(); }).catch(function (e) { toast(e.message); });
      return;
    }

    /* per-facility admin sections */
    if (a === "opensec") { S.secFac = id; S.openItem = null; render(); return; }
    if (a === "backsec") { flushSave(); S.secFac = null; S.openItem = null; render(); return; }
    if (a === "openitem") { S.openItem = el.getAttribute("data-key"); render(); return; }
    if (a === "saveitem") { flushSave(); S.openItem = null; render(); return; }
    if (a === "cfgtoggle") { var sf = S.facilities.find(function (x) { return x.id === (S.secFac || S.editId); }); var p = el.getAttribute("data-p"); setPath(sf.config, p, !getPath(sf.config, p)); putFacility(sf); render(); return; }
    if (a === "reportproblem") { var srp = S.facilities.find(function (x) { return x.id === S.secFac; }); if (!getPath(srp.config, "maintenanceTracking")) setPath(srp.config, "maintenanceTracking", []); var arrp = getPath(srp.config, "maintenanceTracking"); var rid = uid(); arrp.push({ id: rid, reportedBy: S.auth.name, reportedAt: Date.now(), status: "needs_action" }); putFacility(srp); S.openItem = "maintenanceTracking#" + rid; render(); return; }
    if (a === "cfgadd") { var sfa = S.facilities.find(function (x) { return x.id === (S.secFac || S.editId); }); var pa = el.getAttribute("data-p"); var arr = getPath(sfa.config, pa); if (!Array.isArray(arr)) { setPath(sfa.config, pa, []); arr = getPath(sfa.config, pa); } var nid = uid(); arr.push({ id: nid }); putFacility(sfa); S.openItem = pa + "#" + nid; render(); return; }
    if (a === "cfgdel") { var sfd = S.facilities.find(function (x) { return x.id === (S.secFac || S.editId); }); var pd = el.getAttribute("data-p"); var arrd = getPath(sfd.config, pd) || []; setPath(sfd.config, pd, arrd.filter(function (z) { return z.id !== id; })); putFacility(sfd); S.openItem = null; render(); return; }
    if (a === "clitoggle") { var sft = S.facilities.find(function (x) { return x.id === S.secFac; }); var pt = el.getAttribute("data-p"), fld = el.getAttribute("data-f"); var it = (getPath(sft.config, pt) || []).find(function (z) { return z.id === id; }); if (it) { it[fld] = !it[fld]; putFacility(sft); render(); } return; }
    if (a === "setstatus") { var sfs = S.facilities.find(function (x) { return x.id === S.secFac; }); var item = (getPath(sfs.config, "maintenanceTracking") || []).find(function (z) { return z.id === id; }); if (item) { item.status = el.getAttribute("data-v"); putFacility(sfs); render(); } return; }

    /* reports (admin) */
    /* lead tracking */
    if (a === "trackprev") { S.trackerPrev = !S.trackerPrev; render(); return; }
    if (a === "trackopen") { S.trackerOpen = (S.trackerOpen === k ? null : k); render(); return; }
    if (a === "leadtab") { S.leadTab = k; render(); return; }
    if (a === "addreview") { S.reviewAdd = true; S.leadAdd = false; S.leadOpen = null; S.reviewDraft = { facilityId: (S.facilities[0] || {}).id || "" }; render(); return; }
    if (a === "reviewback") { S.reviewAdd = false; render(); return; }
    if (a === "reviewsave") { var rv = S.reviewDraft || {}; if (!(rv.customer || "").trim()) { toast("Enter the customer name."); return; } api("POST", "/api/reviews", { customer: rv.customer, facilityId: rv.facilityId || "" }).then(function () { S.reviewDraft = {}; S.reviewAdd = false; S.leadTab = "tracker"; return reloadReviews(); }).then(function () { toast("Google review logged."); render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "reviewdel") { if (!confirm("Delete this review?")) return; api("DELETE", "/api/reviews/" + id).then(function () { return reloadReviews(); }).then(render).catch(function (e) { toast(e.message); }); return; }
    if (a === "addlead") { S.leadAdd = true; S.leadOpen = null; S.leadDraft = { kind: "", status: "warm", facilityId: (S.facilities[0] || {}).id || "" }; render(); return; }
    if (a === "leadback") { S.leadAdd = false; S.leadOpen = null; S.leadDraft = {}; render(); return; }
    if (a === "openlead") { S.leadOpen = id; render(); return; }
    if (a === "leadkind") { S.leadDraft.kind = el.getAttribute("data-v"); render(); return; }
    if (a === "leadtog") { S.leadDraft[el.getAttribute("data-k")] = el.getAttribute("data-v") === "1"; render(); return; }
    if (a === "leadtog2") { var lk = el.getAttribute("data-k"); S.leadDraft[lk] = !S.leadDraft[lk]; if (lk === "moveInUnknown") { S.leadDraft.firstFollowup = ""; S.leadDraft.firstFollowupReason = ""; } render(); return; }
    if (a === "leadstatus") { S.leadDraft.status = el.getAttribute("data-v"); if (S.leadDraft.status === "rented") S.leadDraft.nameUnknown = false; render(); return; }
    if (a === "savelead") {
      var dd = S.leadDraft || {};
      if (!dd.kind) { toast("Choose reservation or lead."); return; }
      if (dd.status === "rented") { if (dd.nameUnknown || !(dd.name || "").trim()) { toast("A move-in needs the customer's name."); return; } if (!(dd.moveInUnit || "").trim()) { toast("Enter the unit they moved into."); return; } }
      if (dd.firstFollowup && !(dd.firstFollowupReason || "").trim()) { toast("Add a reason for changing the follow-up date."); return; }
      api("POST", "/api/leads", dd).then(function () { return reloadLeads(); }).then(function () { S.leadAdd = false; S.leadDraft = {}; S.leadTab = dd.status === "rented" ? "tracker" : dd.status === "cold" ? "cold" : "warm"; toast("Lead saved."); render(); }).catch(function (e) { toast(e.message); });
      return;
    }
    if (a === "setlead") { var sv = el.getAttribute("data-v"); api("PUT", "/api/leads/" + id, { status: sv }).then(function () { return reloadLeads(); }).then(render).catch(function (e) { toast(e.message); }); return; }
    if (a === "dellead") { if (!confirm("Delete this lead? This can't be undone.")) return; api("DELETE", "/api/leads/" + id).then(function () { S.leadOpen = null; return reloadLeads(); }).then(render).catch(function (e) { toast(e.message); }); return; }
    if (a === "dofu") { S.fuOpen = { leadId: el.getAttribute("data-lid"), fuId: el.getAttribute("data-fid") }; S.fuDraft = {}; render(); return; }
    if (a === "fuback") { S.fuOpen = null; S.fuDraft = {}; render(); return; }
    if (a === "futog") { S.fuDraft[el.getAttribute("data-k")] = el.getAttribute("data-v") === "1"; render(); return; }
    if (a === "futog2") { var fk = el.getAttribute("data-k"); S.fuDraft[fk] = !S.fuDraft[fk]; render(); return; }
    if (a === "savefu") { var lid = el.getAttribute("data-lid"), fid2 = el.getAttribute("data-fid"); var fd = S.fuDraft || {}; if (fd.nextFollowup && !(fd.nextFollowupReason || "").trim()) { toast("Add a reason for changing the follow-up date."); return; } if (fd.movedIn === true) { if (!(fd.moveInUnit || "").trim()) { toast("Enter the unit they moved into."); return; } var lf = (S.leads || []).find(function (x) { return x.id === lid; }); if (lf && lf.nameUnknown && !(fd.custName || "").trim()) { toast("Enter the customer's name for the move-in."); return; } } api("POST", "/api/leads/" + lid + "/followup/" + fid2, fd).then(function () { return reloadLeads(); }).then(function () { S.fuOpen = null; S.fuDraft = {}; toast("Follow-up logged."); render(); }).catch(function (e) { toast(e.message); }); return; }

    /* payables */
    if (a === "openinfo") { S.editId = id; S.infoMode = true; S.facEdit = false; render(); return; }
    if (a === "infoback") { flushSave(); S.editId = null; S.infoMode = false; S.facEdit = false; api("GET", "/api/facilities").then(function (f) { S.facilities = f; render(); }); return; }
    if (a === "mtsub") { S.maintSub = k; S.secFac = null; S.mtJustSent = false; render(); return; }
    if (a === "mtfac") { S.mtDraft = S.mtDraft || {}; S.mtDraft.facilityId = el.getAttribute("data-v"); render(); return; }
    if (a === "mtsubmit") {
      var md = S.mtDraft || {}; if (!md.facilityId) { toast("Pick a facility."); return; } if (!(md.description || "").trim()) { toast("Describe the problem."); return; }
      var mf = S.facilities.find(function (x) { return x.id === md.facilityId; }); if (!mf) { toast("Facility not found."); return; }
      if (!Array.isArray(mf.config.maintenanceTracking)) mf.config.maintenanceTracking = [];
      mf.config.maintenanceTracking.push({ id: uid(), reportedBy: S.auth.name, reportedAt: Date.now(), status: "needs_action", description: md.description, units: md.units || "" });
      putFacility(mf).then(function () { S.mtDraft = {}; S.mtJustSent = true; toast("Problem reported."); render(); }).catch(function (e) { toast(e.message); });
      return;
    }
    if (a === "mtresolve" || a === "mtworking" || a === "mtdel") {
      var fid = el.getAttribute("data-fid"), mff = S.facilities.find(function (x) { return x.id === fid; }); if (!mff) return;
      var arr = mff.config.maintenanceTracking || [];
      if (a === "mtdel") { mff.config.maintenanceTracking = arr.filter(function (z) { return z.id !== id; }); }
      else { var it = arr.find(function (z) { return z.id === id; }); if (it) { it.status = (a === "mtresolve" ? "completed" : "in_progress"); if (a === "mtresolve") it.resolvedAt = Date.now(); } }
      putFacility(mff).then(function () { toast(a === "mtdel" ? "Removed." : a === "mtresolve" ? "Marked resolved." : "Marked in progress."); render(); }).catch(function (e) { toast(e.message); });
      return;
    }
    if (a === "bbedit") { S.bbEdit = true; render(); return; }
    if (a === "bbsave") { flushSave(); S.bbEdit = false; toast("Bill-back config saved."); render(); return; }
    if (a === "setsub") { S.setSub = k; render(); return; }
    if (a === "paynewback") { S.paySub = "pending"; S.payDraft = {}; render(); return; }
    if (a === "paysub") { S.paySub = k; render(); return; }
    if (a === "paywho") { S.payDraft = S.payDraft || {}; S.payDraft.who = el.getAttribute("data-v"); render(); return; }
    if (a === "payinvoicedel") { if (S.payDraft) S.payDraft.invoice = null; render(); return; }
    if (a === "paysave") { var pd = S.payDraft || {}; var miss = []; if (!pd.facilityId) miss.push("facility"); if (!pd.who) miss.push("on-site/sub"); if (!(pd.contractorName || "").trim()) miss.push("contractor name"); if (!(pd.description || "").trim()) miss.push("description"); if (!(pd.amount || "").trim()) miss.push("amount"); if (!(pd.cycleDate || "").trim()) miss.push("payment cycle date"); if (miss.length) { toast("Please fill in: " + miss.join(", ") + "."); return; } api("POST", "/api/payables", pd).then(function () { S.payDraft = {}; S.paySub = "pending"; return reloadPayables(); }).then(function () { toast("Payable submitted."); render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "payapprove") { api("PUT", "/api/payables/" + id, { status: "approved" }).then(function () { return Promise.all([reloadPayables(), reloadReceipts()]); }).then(function () { toast("Approved & moved to expenses."); render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "payreject") { api("PUT", "/api/payables/" + id, { status: "rejected" }).then(function () { return reloadPayables(); }).then(render).catch(function (e) { toast(e.message); }); return; }
    if (a === "paybilled") { var pb = S.payables.find(function (x) { return x.id === id; }); var nv = !(pb && pb.billedBack); api("PUT", "/api/payables/" + id, { billedBack: nv }).then(function () { return reloadPayables(); }).then(render).catch(function (e) { toast(e.message); }); return; }
    if (a === "paydel") { if (!confirm("Delete this payable?")) return; api("DELETE", "/api/payables/" + id).then(function () { return reloadPayables(); }).then(render).catch(function (e) { toast(e.message); }); return; }
    if (a === "recedit") { S.recEditId = id; render(); return; }
    if (a === "recdone") { flushSave(); S.recEditId = null; render(); return; }
    if (a === "recadd") { var rd = S.recDraft || {}; if (!rd.facilityId) { toast("Pick a facility."); return; } api("POST", "/api/recurring", rd).then(function () { S.recDraft = {}; S.paySub = "recurring"; return reloadRecurring(); }).then(function () { toast("Recurring payment added."); render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "recdel") { if (!confirm("Delete this recurring payment?")) return; api("DELETE", "/api/recurring/" + id).then(function () { S.recEditId = null; return reloadRecurring(); }).then(render).catch(function (e) { toast(e.message); }); return; }

    if (a === "depview") { S.depOpen = (S.depOpen === id ? null : id); render(); return; }
    if (a === "depsub") { S.depSub = k; S.depStage = "entry"; render(); return; }
    if (a === "depadd") { S.depDraft = S.depDraft || { entries: [] }; if (!S.depDraft.entries) S.depDraft.entries = []; S.depDraft.entries.push({ id: uid(), facilityId: "", forWhat: "", customer: "", type: "CK", amount: "" }); render(); return; }
    if (a === "depdel") { if (S.depDraft && S.depDraft.entries) S.depDraft.entries = S.depDraft.entries.filter(function (z) { return z.id !== id; }); render(); return; }
    if (a === "detype") { var de = (S.depDraft.entries || []).find(function (z) { return z.id === id; }); if (de) de.type = el.getAttribute("data-v"); render(); return; }
    if (a === "depsubmit") {
      var ents = (S.depDraft.entries || []).filter(function (e) { return (e.amount || "").toString().trim() || (e.customer || "").trim() || (e.forWhat || "").trim(); });
      if (!ents.length) { toast("Add at least one payment."); return; }
      var bad = ents.some(function (e) { return !(e.customer || "").trim() || !(e.amount || "").toString().trim(); });
      if (bad) { toast("Each payment needs a name on check and an amount (facility or other is preselected)."); return; }
      S.depStage = "confirm"; render(); return;
    }
    if (a === "depback") { S.depStage = "entry"; render(); return; }
    if (a === "depchk") { S.depDraft[k] = !S.depDraft[k]; render(); return; }
    if (a === "depfinal") { var d = S.depDraft || {}; if (!d.totalAddsUp || !d.cubbyInput) { toast("Confirm both checkboxes before submitting."); return; } api("POST", "/api/deposits", { entries: d.entries || [], totalAddsUp: true, cubbyInput: true }).then(function () { S.depDraft = { entries: [] }; S.depStage = "entry"; S.depSub = "completed"; return reloadDeposits(); }).then(function () { toast("Deposit submitted."); render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "depsettle") { api("PUT", "/api/deposits/" + id, { settled: true }).then(function () { return reloadDeposits(); }).then(function () { toast("Marked settled."); render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "depdelete") { if (!confirm("Delete this deposit?")) return; api("DELETE", "/api/deposits/" + id).then(function () { return reloadDeposits(); }).then(render).catch(function (e) { toast(e.message); }); return; }

    if (a === "receiptdel") { if (!confirm("Delete this receipt?")) return; api("DELETE", "/api/receipts/" + id).then(function () { return reloadReceipts(); }).then(render).catch(function (e) { toast(e.message); }); return; }
    if (a === "configstart") { S.paySub = "configure"; S.invDraft = { facilityId: "", exp: {}, pay: {}, fee: {}, months: [], monthPick: "" }; render(); return; }
    if (a === "configback") { S.paySub = "expenses"; S.invDraft = {}; render(); return; }
    if (a === "invtog") { var g = el.getAttribute("data-g"); S.invDraft[g] = S.invDraft[g] || {}; S.invDraft[g][k] = !S.invDraft[g][k]; render(); return; }
    if (a === "invaddmonth") { var mp = (S.invDraft.monthPick || "").trim(); if (!mp) { toast("Pick a month first."); return; } S.invDraft.months = S.invDraft.months || []; if (S.invDraft.months.indexOf(mp) < 0) S.invDraft.months.push(mp); S.invDraft.months.sort(); render(); return; }
    if (a === "invdelmonth") { S.invDraft.months = (S.invDraft.months || []).filter(function (m) { return m !== k; }); render(); return; }
    if (a === "invgen") {
      var d = S.invDraft || {}, fid = d.facilityId; if (!fid) { toast("Pick a facility."); return; }
      var pays = (S.payables || []).filter(function (p) { return p.status === "approved" && !p.billedBack && p.facilityId === fid; });
      var exps = (S.expenses || []).filter(function (e) { return e.facilityId === fid && !e.billedBack; });
      var fees = feeListFor(fid), months = d.months || [], items = [];
      pays.filter(function (p) { return d.pay && d.pay[p.id]; }).forEach(function (p) { items.push({ description: p.who + " — " + (p.contractorName || "") + (p.description ? " (" + p.description + ")" : ""), source: "", amount: parseFloat(p.amount || 0) }); });
      exps.filter(function (e) { return d.exp && d.exp[e.id]; }).forEach(function (e) { items.push({ description: e.description || "Expense", source: e.source === "Other" ? (e.sourceOther || "Other") : "American Express", amount: parseFloat(e.amount || 0) }); });
      fees.filter(function (fr) { return d.fee && d.fee[fr[0]]; }).forEach(function (fr) { months.forEach(function (m) { items.push({ description: fr[1] + " — " + monthLabel(m), source: "", amount: fr[2] }); }); });
      if (!items.length) { toast("Select at least one expense or fee (and a month for recurring fees)."); return; }
      var total = items.reduce(function (s, i) { return s + i.amount; }, 0);
      var expenseIds = exps.filter(function (e) { return d.exp && d.exp[e.id]; }).map(function (e) { return e.id; });
      var payableIds = pays.filter(function (p) { return d.pay && d.pay[p.id]; }).map(function (p) { return p.id; });
      var bbcfg = S.billback[fid] || {};
      api("POST", "/api/invoices", { facilityId: fid, months: months, lineItems: items, total: total, expenseIds: expenseIds, payableIds: payableIds, entityName: bbcfg.entityName || "", entityAddress: bbcfg.entityAddress || "" })
        .then(function () { return Promise.all([reloadInvoices(), reloadExpenses(), reloadPayables()]); })
        .then(function () { S.invDraft = {}; S.paySub = "invoices"; toast("Invoice created."); render(); }).catch(function (e) { toast(e.message); });
      return;
    }
    if (a === "invpdf") { var inv = S.invoices.find(function (x) { return x.id === id; }); if (inv) buildInvoicePDF(inv); return; }
    if (a === "invpaid") { api("PUT", "/api/invoices/" + id, { status: "paid" }).then(function () { return reloadInvoices(); }).then(function () { toast("Marked billed back."); render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "invdel") { if (!confirm("Delete this invoice?")) return; api("DELETE", "/api/invoices/" + id).then(function () { return reloadInvoices(); }).then(render).catch(function (e) { toast(e.message); }); return; }

    if (a === "expadd") { S.expAdd = true; S.paySub = "expenses"; S.expDraft = { entries: [{ id: uid(), facilityId: "", amount: "", source: "American Express", sourceOther: "", description: "", datePaid: "" }] }; render(); return; }
    if (a === "expback") { S.expAdd = false; S.expDraft = { entries: [] }; render(); return; }
    if (a === "eeadd") { S.expDraft = S.expDraft || { entries: [] }; if (!S.expDraft.entries) S.expDraft.entries = []; S.expDraft.entries.push({ id: uid(), facilityId: "", amount: "", source: "American Express", sourceOther: "", description: "", datePaid: "" }); render(); return; }
    if (a === "eedel") { if (S.expDraft && S.expDraft.entries) S.expDraft.entries = S.expDraft.entries.filter(function (z) { return z.id !== id; }); render(); return; }
    if (a === "expsrc") { S.expDraft = S.expDraft || {}; S.expDraft.source = el.getAttribute("data-v"); render(); return; }
    if (a === "expsave") { var ents = ((S.expDraft || {}).entries || []).filter(function (e) { return (e.amount || "").toString().trim(); }); if (!ents.length) { toast("Add at least one expense with an amount."); return; } Promise.all(ents.map(function (e) { return api("POST", "/api/expenses", e); })).then(function () { S.expDraft = { entries: [] }; S.expAdd = false; return reloadExpenses(); }).then(function () { toast(ents.length + " expense" + (ents.length === 1 ? "" : "s") + " saved."); render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "expbilled") { api("PUT", "/api/expenses/" + id, { billedBack: true }).then(function () { return reloadExpenses(); }).then(render).catch(function (e) { toast(e.message); }); return; }
    if (a === "expdel") { if (!confirm("Delete this expense?")) return; api("DELETE", "/api/expenses/" + id).then(function () { return reloadExpenses(); }).then(render).catch(function (e) { toast(e.message); }); return; }
    if (a === "bbother") { if (!S.billback[id]) S.billback[id] = { mgmtRate: "", softwareRate: "", onsiteFee: "", otherFees: [] }; if (!Array.isArray(S.billback[id].otherFees)) S.billback[id].otherFees = []; S.billback[id].otherFees.push({ id: uid(), description: "", amount: "" }); api("PUT", "/api/billback/" + id, S.billback[id]); render(); return; }
    if (a === "bbotherdel") { var oid = el.getAttribute("data-oid"); if (S.billback[id]) { S.billback[id].otherFees = (S.billback[id].otherFees || []).filter(function (z) { return z.id !== oid; }); api("PUT", "/api/billback/" + id, S.billback[id]); render(); } return; }

    if (a === "sendaudit") { api("POST", "/api/reports", { facilityId: id, type: "audit", note: S.newReportNote || "Monthly audit" }).then(function () { S.newReportNote = ""; var ff = S.facilities.find(function (x) { return x.id === id; }); if (ff) { ff.config.lastAuditAt = Date.now(); ff.config.updatedAt = Date.now(); } return reloadReports(); }).then(function () { toast("Audit sent to the facility's techs."); render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "auditdone") { api("POST", "/api/facilities/" + id + "/audit-done", {}).then(function () { var ff = S.facilities.find(function (x) { return x.id === id; }); if (ff) ff.config.lastAuditAt = Date.now(); toast("Audit cleared for this month."); render(); }).catch(function (e) { toast(e.message); }); return; }

    if (a === "sendreport") { var fid = S.editId || S.newReportFac || (S.facilities[0] || {}).id; if (!fid) { toast("Add a facility first."); return; } api("POST", "/api/reports", { facilityId: fid, note: S.newReportNote || "" }).then(function () { S.newReportNote = ""; var ff = S.facilities.find(function (x) { return x.id === fid; }); if (ff) ff.config.updatedAt = Date.now(); return reloadReports(); }).then(function () { toast("Report request sent."); render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "delreport") { if (!confirm("Delete this report? This can't be undone.")) return; api("DELETE", "/api/reports/" + id, {}).then(function () { if (S.subOpen && S.subOpen.id === id) { S.subOpen = null; S.subStep = 0; } return reloadReports(); }).then(render).catch(function (e) { toast(e.message); }); return; }
    if (a === "openrep") { S.subOpen = S.reports.find(function (x) { return x.id === id; }); S.subStep = 0; render(); return; }
    if (a === "noteadd") { var snf = S.editId || S.newReportFac || (S.facilities[0] || {}).id; var fn = S.facilities.find(function (x) { return x.id === snf; }); if (!fn) return; if (!Array.isArray(fn.config.adminNotes)) fn.config.adminNotes = []; fn.config.adminNotes.push({ id: uid(), text: "" }); putFacility(fn); render(); return; }
    if (a === "notedel") { var snf2 = S.editId || S.newReportFac || (S.facilities[0] || {}).id; var fdl = S.facilities.find(function (x) { return x.id === snf2; }); if (!fdl) return; fdl.config.adminNotes = (fdl.config.adminNotes || []).filter(function (z) { return z.id !== id; }); putFacility(fdl); render(); return; }
    if (a === "backopen") { S.subOpen = null; S.subStep = 0; render(); return; }
    if (a === "subnext") { S.subStep++; render(); return; }
    if (a === "subback") { S.subStep--; render(); return; }
    if (a === "substep") { S.subStep = +el.getAttribute("data-i"); render(); return; }
    if (a === "markreviewed") {
      var sid = S.subOpen.id; S.busy = true; render();
      api("POST", "/api/reports/" + sid + "/review", {}).then(function (r) {
        S.busy = false; S.subOpen.reviewed = true; S.subOpen.reviewedAt = r.reviewedAt; S.subOpen.reviewedBy = r.reviewedBy;
        var it = S.reports.find(function (x) { return x.id === sid; }); if (it) { it.reviewed = true; it.reviewedAt = r.reviewedAt; it.reviewedBy = r.reviewedBy; }
        toast("Report marked as reviewed."); S.subOpen = null; S.subStep = 0; render();
      }).catch(function (e) { S.busy = false; toast(e.message); render(); });
      return;
    }

    /* worker wizard */
    if (a === "step") { S.step = +el.getAttribute("data-i"); S.tried = false; saveDraft(); render(); return; }
    if (a === "fixstep") { S.step = +el.getAttribute("data-i"); S.tried = true; render(); return; }
    if (a === "next") { if (currentIssues().length) { S.tried = true; render(); return; } S.step++; S.tried = false; saveDraft(); render(); return; }
    if (a === "back") { S.step--; S.tried = false; saveDraft(); render(); return; }
    if (a === "openreport") { var rp = S.myReports.find(function (x) { return x.id === id; }); if (!rp) return; S.report = rp; S.fid = rp.facilityId; S.tried = false; var dr = S.drafts && S.drafts[rp.id]; if (dr) { api("GET", "/api/drafts/" + rp.id).then(function (d) { S.resp = d && d.data ? Object.assign(blankResp(), d.data) : blankResp(); S.step = (d && d.step) || 0; S.done = false; render(); }).catch(function () { S.resp = blankResp(); S.step = 0; S.done = false; render(); }); } else { S.resp = blankResp(); S.step = 0; S.done = false; render(); } return; }
    if (a === "home") { saveDraft(); S.fid = null; S.report = null; S.resp = null; S.tried = false; render(); return; }
    if (a === "saveexit") { saveDraft(); toast("Draft saved — open the report again any time to resume."); S.fid = null; S.report = null; S.resp = null; S.tried = false; render(); return; }
    if (a === "restart") { S.fid = null; S.report = null; S.resp = null; S.done = false; S.tried = false; render(); return; }
    if (a === "chk") { var p = el.getAttribute("data-p"); setPath(S.resp, p, !getPath(S.resp, p)); render(); return; }
    if (a === "yn") { setPath(S.resp, el.getAttribute("data-p"), el.getAttribute("data-v") === "1"); render(); return; }
    if (a === "cond") { var scope = el.getAttribute("data-scope") || "vacated"; var cur = S.resp[scope][id] || {}; cur.status = el.getAttribute("data-v"); S.resp[scope][id] = cur; render(); return; }
    if (a === "cctoggle") { var fc = S.facilities.find(function (x) { return x.id === S.editId; }); fc.config.climateControlled = !fc.config.climateControlled; putFacility(fc); render(); return; }
    if (a === "delphoto") { delPhoto(el.getAttribute("data-scope"), id); render(); return; }
    if (a === "submit") {
      var fsub = S.facilities.find(function (x) { return x.id === S.fid; });
      if (allIssues(S.resp, fsub.config, stepsFor(fsub, S.report.type), S.report.type).length) { S.tried = true; render(); return; }
      if (!confirm("Are you sure? Once you submit this report you can't go back and change it.")) return;
      S.busy = true; render();
      api("POST", "/api/reports/" + S.report.id + "/submit", { data: S.resp }).then(function () {
        S.busy = false; S.done = true; S.myReports = S.myReports.filter(function (x) { return x.id !== S.report.id; });
        if (S.drafts) delete S.drafts[S.report.id]; api("DELETE", "/api/drafts/" + S.report.id); render();
      }).catch(function (e) { S.busy = false; toast(e.message); render(); });
      return;
    }
  });

  boot();
})();
