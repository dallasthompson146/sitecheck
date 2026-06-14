/* SiteCheck frontend — talks to the backend API. No build step. */
(function () {
  var app = document.getElementById("app");
  var topright = document.getElementById("topright");
  var TOKEN_KEY = "sc_token";
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var today = DAYS[new Date().getDay()];
  function stepsFor(f) {
    var s = [["Tasks", "clipboard-list"], ["Lockout", "lock"], ["Maintenance", "tool"], ["Vacated", "door"],
      ["Vacant", "key"], ["Auction", "gavel"], ["Grounds", "plant-2"]];
    if (f && f.config && f.config.climateControlled) s.push(["Climate", "temperature"]);
    s.push(["Review", "check"]);
    return s;
  }

  var S = {
    auth: null, lu: "", lp: "", lerr: "",
    facilities: [], users: [], subs: [],
    tab: "facilities", editId: null, teamId: null, adminId: null, subsFid: null, subOpen: null, subStep: 0, secFac: null, openItem: null,
    fid: null, step: 0, resp: null, done: false, busy: false, tried: false, drafts: {}, savedAt: 0,
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
      return Promise.all([api("GET", "/api/facilities"), api("GET", "/api/users")])
        .then(function (r) { S.facilities = r[0]; S.users = r[1]; });
    }
    return Promise.all([api("GET", "/api/facilities"), api("GET", "/api/drafts")])
      .then(function (r) { S.facilities = r[0]; S.drafts = {}; (r[1] || []).forEach(function (d) { S.drafts[d.facilityId] = d; }); });
  }
  function boot() {
    if (!token()) { render(); return; }
    api("GET", "/api/me").then(function (r) { S.auth = r.user; return loadForRole(); })
      .then(render).catch(function () { S.auth = null; render(); });
  }

  /* ---------- views ---------- */
  function login() {
    return '<div class="login"><div class="login-head"><span class="bm" style="width:46px;height:46px;font-size:23px">' + I("helmet") + '</span><h3>SiteCheck</h3><p class="hint" style="text-align:center;margin:0">Sign in to your portal</p></div>'
      + '<div class="card"><div class="label">Username</div><input id="lu" value="' + esc(S.lu) + '" autocomplete="off">'
      + '<div class="label">Password</div><input id="lp" type="password" value="' + esc(S.lp) + '" autocomplete="off">'
      + (S.lerr ? '<div class="errbar">' + I("alert-triangle") + " " + esc(S.lerr) + "</div>" : "")
      + '<button class="btn btn-dark" data-a="login" style="width:100%;margin-top:12px;justify-content:center">' + (S.busy ? '<span class="spin"></span> ' : "") + "Log in</button></div>"
      + '<p class="hint" style="text-align:center;margin-top:14px">Demo accounts</p>'
      + '<div class="demo-row"><button class="btn sm" data-a="demo" data-u="owner" data-p="owner123">' + I("crown") + " Super admin</button>"
      + '<button class="btn sm" data-a="demo" data-u="manager" data-p="manager123">' + I("settings") + " Admin</button>"
      + '<button class="btn sm" data-a="demo" data-u="marcus" data-p="marcus123">' + I("user") + " Marcus</button>"
      + '<button class="btn sm" data-a="demo" data-u="dana" data-p="dana123">' + I("user") + " Dana</button></div></div>";
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
    return '<button class="btn" data-a="backedit" style="margin-bottom:12px">' + I("arrow-left") + ' All facilities</button><div class="stack">'
      + '<div class="card"><div class="label">Facility name</div><input data-fac="name" value="' + esc(f.name) + '"><div class="label">Address</div><input data-fac="address" value="' + esc(f.address || "") + '"><button class="check full' + (f.config.climateControlled ? " on" : "") + '" data-a="cctoggle"><span class="bx">' + (f.config.climateControlled ? I("check") : "") + '</span><span>This building is climate controlled<span class="muted" style="display:block;font-size:12px;font-weight:400">Adds the climate checks (temperature, interior lights, trash, dollies) to this facility\'s check-in.</span></span></button></div>'
      + grp("Weekly tasks", "clipboard-list", listEditor(f.config.weeklyTasks, "weeklyTasks", [{ k: "text", ph: "Describe the task…", area: 1 }], "Add task"))
      + grp("Lockout — add a lock", "lock", listEditor(f.config.lockoutAdd, "lockoutAdd", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"))
      + grp("Lockout — remove a lock", "lock", listEditor(f.config.lockoutRemove, "lockoutRemove", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"))
      + grp("Lockout — leave in place", "lock", listEditor(f.config.lockoutKeep, "lockoutKeep", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"))
      + grp("Units needing maintenance", "tool", listEditor(f.config.maintenance, "maintenance", [{ k: "unit", ph: "Unit #", unit: 1 }, { k: "note", ph: "What needs doing…", area: 1 }], "Add unit"))
      + grp("Recently vacated units", "door", listEditor(f.config.vacated, "vacated", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"))
      + grp("Vacant units (no lock)", "key", listEditor(f.config.vacant, "vacant", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"))
      + grp("Units ready for auction", "gavel", listEditor(f.config.auction, "auction", [{ k: "unit", ph: "Unit #", unit: 1 }], "Add unit"))
      + '<div class="card" style="border-color:var(--ok)"><div class="row" style="font-weight:600;margin-bottom:4px">' + I("send") + ' Submit site check</div><p class="hint" style="margin:0 0 10px">Your edits save as you type, but the "form updated" date your techs see only changes when you submit. Submit when this facility\'s form is ready.</p><button class="btn btn-dark" data-a="submitsite" style="width:100%;justify-content:center">' + I("send") + ' Submit site check (update the date)</button><div class="saved" style="margin-top:8px">' + I("check") + ' Last submitted: ' + fday(f.config.updatedAt) + '</div></div></div>';
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
      if (S.openItem === key) return editWrap(headPlain("MAINTENANCE ITEM")
        + lbl("Header") + ci("maintenanceTracking", x.id, "header", x.header, "Short title")
        + lbl("Description") + cta("maintenanceTracking", x.id, "description", x.description, "What needs to be done")
        + lbl("Affected unit(s)") + ci("maintenanceTracking", x.id, "units", x.units, "e.g. A101, A102 (blank if none)")
        + lbl("Follow-up notes") + cta("maintenanceTracking", x.id, "followNotes", x.followNotes, "Updates over time")
        + lbl("Status") + statusButtons(x), "maintenanceTracking", x.id);
      return sumCard(key, esc(x.header), metaBits([x.description ? esc(x.description) : "", x.units ? "Units: " + esc(x.units) : ""]) + (x.description || x.units ? "<br>" : "") + statusMeta(x.status));
    };
    var open = items.filter(function (x) { return x.status !== "completed"; });
    var done = items.filter(function (x) { return x.status === "completed"; });
    return '<h3>Maintenance tracking — ' + esc(f.name) + '</h3><div class="between"><p class="hint">Tap an item to edit; Save collapses it.</p>' + addBtn("maintenanceTracking", "Add item") + "</div>"
      + '<div class="dh">Open (' + open.length + ")</div>" + (open.length ? '<div class="stack" style="margin-top:6px">' + open.map(row).join("") + "</div>" : '<div class="empty">Nothing outstanding.</div>')
      + '<div class="dh" style="margin-top:16px">Completed (' + done.length + ")</div>" + (done.length ? '<div class="stack" style="margin-top:6px">' + done.map(row).join("") + "</div>" : '<div class="empty">None completed yet.</div>');
  }

  /* ---------- Section 2: Inventory ---------- */
  var INV_TYPES = ["Broom", "Grinder", "Grinder discs", "Weed killer", "Block poison", "Safety glasses", "Sprayer", "Mouse traps", "Door springs", "Latches", "Other"];
  function inventorySection(f) {
    var locks = gA(f, "inventory.locks"), items = gA(f, "inventory.items");
    var active = items.filter(function (x) { return !x.discontinued; }), disc = items.filter(function (x) { return x.discontinued; });
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
      + (disc.length ? '<div class="dh" style="margin-top:16px">Discontinued (' + disc.length + ')</div><div class="stack" style="margin-top:6px">' + disc.map(itemRow).join("") + "</div>" : "");
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
    return '<h3>Contractors — ' + esc(f.name) + '</h3><p class="hint">Tap a card to edit; Save collapses it.</p>'
      + '<div class="dh" style="margin-top:6px">On-site maintenance</div><div style="margin-top:6px">' + onsite + "</div>"
      + (lawn ? '<div class="dh" style="margin-top:14px">Lawn care</div><div style="margin-top:6px">' + lawn + "</div>" : "")
      + (garage ? '<div class="dh" style="margin-top:14px">Garage doors</div><div style="margin-top:6px">' + garage + "</div>" : "")
      + '<div class="between" style="margin-top:14px"><div class="dh">Roll-off dumpsters</div>' + addBtn("contractors.dumpsters", "Add") + "</div>"
      + (dump.length ? '<div class="stack" style="margin-top:6px">' + dump.map(dRow).join("") + "</div>" : '<div class="empty">None added.</div>')
      + '<div class="between" style="margin-top:14px"><div class="dh">Other contractors</div>' + addBtn("contractors.others", "Add") + "</div>"
      + (others.length ? '<div class="stack" style="margin-top:6px">' + others.map(oRow).join("") + "</div>" : '<div class="empty">None added.</div>');
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

  function manager() {
    if (S.editId) { var ef = S.facilities.find(function (x) { return x.id === S.editId; }); if (ef) return facilityEditor(ef); }
    if (S.teamId) { var tw = S.users.find(function (x) { return x.id === S.teamId; }); if (tw) return workerEditor(tw); }
    if (S.adminId) { var aw = S.users.find(function (x) { return x.id === S.adminId; }); if (aw) return adminEditor(aw); }
    if (S.subsFid) return submissionsView();

    var T = [["facilities", "Facilities"], ["team", "Staff logins"], ["admins", "Admins"], ["reports", "Reports"], ["maint", "Maintenance"], ["inventory", "Inventory"], ["contractors", "Contractors"]];
    if (S.auth.role === "superadmin") T.push(["finance", "Insurance / Taxes"]);
    var tabs = '<div class="tabs">' + T.map(function (t) { return '<button class="' + (S.tab === t[0] ? "on" : "") + '" data-a="tab" data-k="' + t[0] + '">' + esc(t[1]) + "</button>"; }).join("") + "</div>";

    if (S.tab === "maint" || S.tab === "inventory" || S.tab === "contractors" || S.tab === "finance") {
      if (S.tab === "finance" && S.auth.role !== "superadmin") return tabs + '<div class="empty">Not available.</div>';
      if (!S.secFac) {
        if (S.tab === "finance") {
          var due = '<button class="frow" data-a="opensec" data-id="__sched__" style="border-color:var(--hazard-d)"><span class="fi">' + I("calendar-event") + '</span><span class="fbody"><span class="fname">Due dates</span><span class="faddr">All upcoming payments, soonest first</span></span>' + I("chevron-right") + "</button>";
          var facs = S.facilities.map(function (f) { return '<button class="frow" data-a="opensec" data-id="' + f.id + '"><span class="fi">' + I("building-warehouse") + '</span><span class="fbody"><span class="fname">' + esc(f.name) + '</span><span class="faddr">' + esc(f.address || "") + "</span></span>" + I("chevron-right") + "</button>"; }).join("");
          return tabs + '<h3>Insurance / Property taxes / Utilities</h3><p class="hint">Open Due dates for the payment schedule, or pick a facility to edit.</p><div class="list">' + due + facs + "</div>";
        }
        var titles = { maint: "Maintenance tracking", inventory: "Inventory", contractors: "Contractors" };
        var blurbs = { maint: "Pick a facility to track its maintenance items.", inventory: "Pick a facility to manage its inventory.", contractors: "Pick a facility to manage its contractors." };
        return tabs + secPicker(titles[S.tab], blurbs[S.tab]);
      }
      var back = '<button class="btn" data-a="backsec" style="margin-bottom:12px">' + I("arrow-left") + " All facilities</button>";
      if (S.tab === "finance" && S.secFac === "__sched__") return tabs + back + financeSchedule();
      var fsec = S.facilities.find(function (x) { return x.id === S.secFac; });
      if (!fsec) { S.secFac = null; return manager(); }
      var inner = S.tab === "maint" ? maintenanceSection(fsec) : S.tab === "inventory" ? inventorySection(fsec) : S.tab === "contractors" ? contractorsSection(fsec) : financeSection(fsec);
      return tabs + back + inner;
    }

    if (S.tab === "reports") {
      return tabs + '<h3>Reports</h3><p class="hint">Pick a facility to review its check-in reports.</p><div class="list">' + S.facilities.map(function (f) { return '<button class="frow" data-a="subs" data-id="' + f.id + '"><span class="fi">' + I("file-text") + '</span><span class="fbody"><span class="fname">' + esc(f.name) + '</span><span class="faddr">' + esc(f.address || "") + "</span></span>" + I("chevron-right") + "</button>"; }).join("") + "</div>";
    }
    if (S.tab === "team") {
      var wk = S.users.filter(function (u) { return u.role === "worker"; });
      return tabs + '<div class="between"><h3>Maintenance staff</h3><button class="btn btn-dark sm" data-a="addworker">' + I("plus") + ' Add person</button></div><p class="hint">Each person signs in and sees only the facilities you assign, on the check-in day you set.</p><div class="list">'
        + wk.map(function (w) { return '<button class="frow" data-a="team" data-id="' + w.id + '"><span class="fi">' + I("user") + '</span><span class="fbody"><span class="fname">' + esc(w.name) + '</span><span class="faddr">@' + esc(w.username) + " · " + (w.assignments || []).length + " facilit" + ((w.assignments || []).length === 1 ? "y" : "ies") + "</span></span>" + I("chevron-right") + "</button>"; }).join("") + "</div>";
    }
    if (S.tab === "admins") {
      var ad = S.users.filter(function (u) { return u.role === "admin" || u.role === "superadmin"; });
      return tabs + '<div class="between"><h3>Admin accounts</h3><button class="btn btn-dark sm" data-a="addadmin">' + I("plus") + ' Add admin</button></div><p class="hint">Admins manage everything except Insurance / Taxes. Super admins have full access.</p><div class="list">'
        + ad.map(function (w) { var you = w.id === S.auth.id; var sup = w.role === "superadmin"; return '<button class="frow" data-a="admin" data-id="' + w.id + '"><span class="fi">' + I(sup ? "crown" : "key") + '</span><span class="fbody"><span class="fname">' + esc(w.name) + (you ? '<span class="you-badge">You</span>' : "") + '</span><span class="faddr">@' + esc(w.username) + " · " + (sup ? "Super admin" : "Admin") + "</span></span>" + I("chevron-right") + "</button>"; }).join("") + "</div>";
    }
    return tabs + '<div class="between"><h3>Facilities</h3><button class="btn btn-dark sm" data-a="addfac">' + I("plus") + ' Add facility</button></div><p class="hint">Tap "Set up" to edit a facility\'s lists. Saving stamps the "form updated" date your techs see.</p><div class="list">'
      + S.facilities.map(function (f) {
        return '<div class="fcard"><div class="row"><span class="fi">' + I("building-warehouse") + '</span><div><div class="fname">' + esc(f.name) + '</div><div class="faddr">Updated ' + fday(f.config.updatedAt) + "</div></div></div>"
          + '<div class="fc-actions"><button class="btn sm" data-a="subs" data-id="' + f.id + '">' + I("eye") + ' Reports</button><button class="btn sm" data-a="editfac" data-id="' + f.id + '">' + I("settings") + ' Set up</button><button class="icon-btn danger" data-a="delfac" data-id="' + f.id + '">' + I("trash") + "</button></div></div>";
      }).join("") + "</div>";
  }

  function submissionsView() {
    var f = S.facilities.find(function (x) { return x.id === S.subsFid; });
    if (S.subOpen) return submissionReview(f, S.subOpen);
    var notes = gA(f, "adminNotes");
    var noteCard = '<div class="card"><div class="row" style="justify-content:space-between"><div style="font-weight:600">' + I("notes") + ' Internal notes</div><button class="btn btn-dark sm" data-a="noteadd">' + I("plus") + ' Add note</button></div><p class="hint" style="margin:6px 0 0">Reminders for next time — only admins see these; staff never do, and they stay until you delete them.</p>'
      + (notes.length ? '<div class="stack" style="margin-top:8px">' + notes.map(function (n) { return '<div class="litem"><textarea rows="2" style="flex:1" data-note="' + n.id + '" placeholder="e.g. Have the tech photograph the new fence next time">' + esc(n.text || "") + '</textarea><button class="icon-btn danger" data-a="notedel" data-id="' + n.id + '">' + I("trash") + "</button></div>"; }).join("") + "</div>" : '<div class="muted" style="font-size:13px;margin-top:8px">No notes yet.</div>') + "</div>";
    var pend = S.subs.filter(function (s) { return !s.reviewed; }), done = S.subs.filter(function (s) { return s.reviewed; });
    var rowFor = function (s) { var i = S.subs.indexOf(s); return '<button class="frow" data-a="opensub" data-i="' + i + '"><span class="fi">' + I("file") + '</span><span class="fbody"><span class="fname">' + esc(s.workerName || "Tech") + '</span><span class="faddr">' + fdt(s.submittedAt) + (s.reviewed ? " · reviewed by " + esc(s.reviewedBy || "admin") : "") + "</span></span>" + (s.reviewed ? '<span class="pill" style="background:#E1F0E9;color:var(--ok)">' + I("check") + " Reviewed</span>" : '<span class="pill" style="background:#FBEAE1;color:var(--hazard-d)">Pending</span>') + "</button>"; };
    return '<button class="btn" data-a="backsubs" style="margin-bottom:12px">' + I("arrow-left") + ' All facilities</button><h3>' + esc(f.name) + " — reports</h3>" + noteCard
      + '<div class="dh" style="margin-top:14px">Pending review (' + pend.length + ")</div>" + (pend.length ? '<div class="list" style="margin-top:6px">' + pend.map(rowFor).join("") + "</div>" : '<div class="empty">Nothing waiting.</div>')
      + '<div class="dh" style="margin-top:16px">Reviewed (' + done.length + ")</div>" + (done.length ? '<div class="list" style="margin-top:6px">' + done.map(rowFor).join("") + "</div>" : '<div class="empty">None reviewed yet.</div>');
  }
  function submissionReview(f, s) {
    var c = f.config, d = s.data, g = d.grounds || {}, yn = function (v) { return v === true ? "Yes" : v === false ? "No" : "—"; };
    var gal = function (arr, tag) { return arr && arr.length ? '<div class="gal">' + arr.filter(function (p) { return p.kind === "image"; }).map(function (p, i) { return '<a href="' + p.url + '" download="' + esc(f.name).replace(/[^A-Za-z0-9]+/g, "_") + "_" + (tag || "photo") + "_" + (i + 1) + '.jpg" title="Click to download"><img src="' + p.url + '"></a>'; }).join("") + '</div><div class="muted" style="font-size:12px;margin-top:4px">Tip: click a photo to download it.</div>' : ""; };
    function stepHtml(key) {
      if (key === "Tasks") return '<div class="card dgrp"><div class="dh">Weekly tasks</div>' + (c.weeklyTasks.length ? c.weeklyTasks.map(function (t) { var tr = (d.tasks || {})[t.id] || {}; return '<div class="dline"><div class="dq">' + esc(t.text) + '</div><div class="da">' + esc(tr.note || "—") + "</div>" + gal(tr.files) + "</div>"; }).join("") : '<div class="dline muted">No tasks this week.</div>') + "</div>";
      if (key === "Lockout") return '<div class="card dgrp"><div class="dh">Lockout</div>'
        + c.lockoutAdd.map(function (u) { var a = (d.lockAdd || {})[u.id] || {}; return '<div class="dline"><span class="chip sm">' + u.unit + '</span> add · lock <b class="mono">' + esc(a.lockNo || "????") + "</b> · " + (a.done ? "✓" : "✗") + "</div>"; }).join("")
        + c.lockoutRemove.map(function (u) { return '<div class="dline"><span class="chip sm">' + u.unit + "</span> remove · " + (((d.lockRemove || {})[u.id] || {}).done ? "✓" : "✗") + "</div>"; }).join("")
        + c.lockoutKeep.map(function (u) { return '<div class="dline"><span class="chip sm">' + u.unit + "</span> leave · " + (((d.lockKeep || {})[u.id] || {}).done ? "✓" : "—") + "</div>"; }).join("")
        + (!c.lockoutAdd.length && !c.lockoutRemove.length && !c.lockoutKeep.length ? '<div class="dline muted">None</div>' : "") + "</div>";
      if (key === "Maintenance") return '<div class="card dgrp"><div class="dh">Maintenance</div>' + (c.maintenance.length ? c.maintenance.map(function (u) { return '<div class="dline"><span class="chip sm">' + u.unit + "</span> " + esc(u.note) + '<div class="da">' + esc(((d.maintenance || {})[u.id] || {}).statement || "—") + "</div></div>"; }).join("") : '<div class="dline muted">None</div>') + "</div>";
      if (key === "Vacated") return '<div class="card dgrp"><div class="dh">Recently vacated</div>' + (c.vacated.length ? c.vacated.map(function (u) { var v = (d.vacated || {})[u.id] || {}; var ck = function (k, lab) { return (v[k] ? "✓ " : "✗ ") + lab; }; return '<div class="dline"><span class="chip sm">' + u.unit + "</span> " + (v.status === "clean" ? "Clean / broom-swept" : v.status === "problem" ? "Problem: " + esc(v.problem) : "—") + '<div class="da">' + ck("door", "door rolls up") + " · " + ck("latch", "latch") + " · " + ck("intrusion", "no intrusion") + " · " + ck("water", "no water") + "</div>" + gal(v.photos, "vacated_" + u.unit) + "</div>"; }).join("") : '<div class="dline muted">None</div>') + "</div>";
      if (key === "Vacant") return '<div class="card dgrp"><div class="dh">Vacant</div><div class="dline">' + (d.vacantConfirmed === false ? "Extra unlocked units: " + esc(d.vacantExtra) : d.vacantConfirmed ? "Confirmed only those are unlocked" : "—") + "</div></div>";
      if (key === "Auction") return '<div class="card dgrp"><div class="dh">Auction</div>' + (c.auction.length ? c.auction.map(function (u) { var a = (d.auction || {})[u.id] || {}; return '<div class="dline"><span class="chip sm">' + u.unit + "</span> " + (a.untouched ? "✓ untouched" : "✗") + " · " + (a.lockBack ? "✓ re-locked" : "✗") + ' · lock <b class="mono">' + esc(a.lockNo || "????") + "</b>" + (a.report ? '<div class="da">' + esc(a.report) + "</div>" : "") + gal(a.photos, "auction_" + u.unit) + "</div>"; }).join("") : '<div class="dline muted">None</div>') + "</div>";
      if (key === "Grounds") return '<div class="card dgrp"><div class="dh">Grounds</div><div class="dline">Weeds: ' + yn(g.weeds) + (g.weedsNote ? " — " + esc(g.weedsNote) : "") + '</div><div class="dline">Grass mowed: ' + yn(g.mowed) + '</div><div class="dline">Potholes / gravel needed: ' + yn(g.potholes) + (g.potholesNote ? " — " + esc(g.potholesNote) : "") + '</div><div class="dline">Exterior bulbs out: ' + yn(g.bulbs) + (g.bulbsNote ? " — " + esc(g.bulbsNote) : "") + '</div><div class="dline">New building damage: ' + yn(g.damage) + (g.damageNote ? " — " + esc(g.damageNote) : "") + '</div><div class="dline">Leaves / organic matter: ' + yn(g.leaves) + (g.leavesNote ? " — " + esc(g.leavesNote) : "") + '</div><div class="dline">Snow obstruction: ' + yn(g.snow) + (g.snowNote ? " — " + esc(g.snowNote) : "") + '</div><div class="dline">Trash / items out of place: ' + yn(g.trash) + (g.trashNote ? " — " + esc(g.trashNote) : "") + '</div><div class="dline">Closed open doors: ' + yn(g.doors) + "</div>" + (g.notes ? '<div class="dline">Notes: ' + esc(g.notes) + "</div>" : "") + gal(g.photos, "grounds") + "</div>";
      if (key === "Climate") { var cl = d.climate; return cl ? '<div class="card dgrp"><div class="dh">Climate control</div><div class="dline">Temperature reasonable: ' + yn(cl.temp) + (cl.tempNote ? " — " + esc(cl.tempNote) : "") + '</div><div class="dline">Interior bulbs out: ' + yn(cl.bulbs) + (cl.bulbsNote ? " — " + esc(cl.bulbsNote) : "") + '</div><div class="dline">Interior trash: ' + yn(cl.trash) + (cl.trashNote ? " — " + esc(cl.trashNote) : "") + '</div><div class="dline">Dollies in place: ' + yn(cl.dollies) + "</div>" + gal(cl.photos, "climate") + "</div>" : '<div class="empty">No climate data.</div>'; }
      if (key === "Review") return '<div class="card"><div class="dh">Finish review</div><p class="hint" style="margin:6px 0 0">You\'ve stepped through the whole report.</p>' + (s.reviewed ? '<div class="saved" style="margin-top:10px">' + I("check") + " Reviewed by " + esc(s.reviewedBy || "admin") + " on " + fdt(s.reviewedAt) + "</div>" : '<button class="btn btn-ok" data-a="markreviewed" style="width:100%;justify-content:center;margin-top:10px">' + (S.busy ? '<span class="spin"></span> ' : I("check") + " ") + "Submit report as reviewed</button>") + "</div>";
      return "";
    }
    var STEPS = stepsFor(f), sk = STEPS[S.subStep][0], last = S.subStep === STEPS.length - 1;
    var top = '<div class="wtop"><button class="btn" data-a="backopen">' + I("arrow-left") + " Reports</button>" + (s.reviewed ? '<span class="pill" style="background:#E1F0E9;color:var(--ok)">' + I("check") + " Reviewed</span>" : '<span class="pill" style="background:#FBEAE1;color:var(--hazard-d)">Pending review</span>') + "</div>";
    var pips = '<div class="pips">' + STEPS.map(function (st, i) { return '<button class="pip ' + (i < S.subStep ? "done" : i === S.subStep ? "on" : "") + '" data-a="substep" data-i="' + i + '"><small>' + String(i + 1).padStart(2, "0") + "</small>" + I(st[1]) + "</button>"; }).join("") + "</div>";
    var head = '<div class="wo"><div class="between"><div><div class="eyebrow">Reviewing report</div><h4>' + esc(f.name) + '</h4></div><div class="row" style="gap:6px;flex-wrap:wrap"><span class="chip" style="display:inline-flex;align-items:center;gap:4px">' + I("user") + " " + esc(s.workerName || "Tech") + '</span><span class="chip" style="display:inline-flex;align-items:center;gap:4px">' + I("calendar") + " " + fdt(s.submittedAt) + "</span></div></div>" + pips + '<div class="cur">' + sk + "</div></div>";
    var nav = '<div class="navb"><button class="btn" data-a="subback"' + (S.subStep === 0 ? " disabled" : "") + ">" + I("chevron-left") + ' Back</button><span class="nc">' + (S.subStep + 1) + " / " + STEPS.length + "</span>" + (last ? '<button class="btn" data-a="backopen">' + I("list") + " Reports</button>" : '<button class="btn btn-dark" data-a="subnext">Next ' + I("chevron-right") + "</button>") + "</div>";
    return top + head + '<div class="stack" style="margin-top:14px">' + stepHtml(sk) + "</div>" + nav;
  }

  /* ---------- worker ---------- */
  function blankResp() { return { tasks: {}, lockAdd: {}, lockRemove: {}, lockKeep: {}, maintenance: {}, vacated: {}, vacantConfirmed: null, vacantExtra: "", auction: {}, grounds: { weeds: null, weedsNote: "", mowed: null, snow: null, snowNote: "", trash: null, trashNote: "", potholes: null, potholesNote: "", bulbs: null, bulbsNote: "", damage: null, damageNote: "", leaves: null, leavesNote: "", doors: null, notes: "", photos: [] }, climate: { temp: null, tempNote: "", bulbs: null, bulbsNote: "", trash: null, trashNote: "", dollies: null, photos: [] } }; }
  function photoField(label, min, arr, scope) {
    var ok = arr.length >= min;
    return '<div class="label">' + I("camera") + " " + label + '<span class="count ' + (ok ? "ok" : "need") + '">' + arr.length + (min ? " / " + min + " min" : "") + "</span></div><div class=\"photos\">"
      + arr.map(function (p) { return '<div class="thumb"><img src="' + p.url + '"><button class="xx" data-a="delphoto" data-scope="' + scope + '" data-id="' + p.id + '">' + I("x") + "</button></div>"; }).join("")
      + '<label class="addph">' + I("plus") + 'Add<input type="file" accept="image/*" capture="environment" multiple style="display:none" data-add="' + scope + '"></label></div>';
  }
  function stepErrors(key, r, cfg) {
    var e = [], push = function (msg, mark) { e.push({ msg: msg, mark: mark }); };
    if (key === "Lockout") {
      cfg.lockoutAdd.forEach(function (u) { var a = r.lockAdd[u.id] || {}; if (!/^\d{4}$/.test(a.lockNo || "")) push("Enter the 4-digit lock number for " + u.unit + ".", "lockAdd:" + u.id); if (!a.done) push("Confirm lock added on " + u.unit + ".", "lockAdd:" + u.id); });
      cfg.lockoutRemove.forEach(function (u) { if (!(r.lockRemove[u.id] || {}).done) push("Confirm lock removed from " + u.unit + ".", "lockRemove:" + u.id); });
    }
    if (key === "Vacated") cfg.vacated.forEach(function (u) { var v = r.vacated[u.id] || {}, m = "vacated:" + u.id; if (!v.status) push("Set the condition for " + u.unit + ".", m); if (v.status === "problem" && !(v.problem || "").trim()) push("Describe the problem with " + u.unit + ".", m); });
    if (key === "Vacant") { if (r.vacantConfirmed === null) push("Confirm whether these are the only unlocked units.", "vacant"); if (r.vacantConfirmed === false && !r.vacantExtra.trim()) push("List the other unlocked unit(s).", "vacant"); }
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
      if (g.photos.length < 5) push("Add at least 5 facility photos (" + g.photos.length + "/5).", "grounds.photos");
    }
    if (key === "Climate") {
      var cl = r.climate, cqs = { temp: "temperature question", bulbs: "interior-bulbs question", trash: "interior-trash question", dollies: "dollies question" };
      Object.keys(cqs).forEach(function (k) { if (cl[k] === null) push("Answer the " + cqs[k] + ".", "climate." + k); });
      if (cl.bulbs === true && !cl.bulbsNote.trim()) push("Note which interior lights are out.", "climate.bulbs");
      if (cl.trash === true && !cl.trashNote.trim()) push("Note where the interior trash is.", "climate.trash");
    }
    return e;
  }
  function allIssues(r, cfg, STEPS) { var out = []; STEPS.forEach(function (s, i) { if (s[0] === "Review") return; stepErrors(s[0], r, cfg).forEach(function (it) { out.push({ i: i, step: s[0], msg: it.msg }); }); }); return out; }
  function issuesList(title, items, jump) {
    return '<div class="errlist"><div class="el-h">' + I("alert-triangle") + " " + esc(title) + "</div>" + items.map(function (it) {
      return jump ? '<button class="el-row" data-a="fixstep" data-i="' + it.i + '"><span class="el-step">' + esc(it.step) + '</span><span class="el-msg">' + esc(it.msg) + "</span>" + I("chevron-right") + "</button>"
        : '<div class="el-row el-static"><span class="el-dot">' + I("point") + '</span><span class="el-msg">' + esc(it.msg) + "</span></div>";
    }).join("") + "</div>";
  }
  function currentIssues() { var f = S.facilities.find(function (x) { return x.id === S.fid; }); if (!f) return []; var ST = stepsFor(f); return stepErrors(ST[S.step][0], S.resp, f.config); }
  function saveDraft() { if (S.auth && S.auth.role === "worker" && S.fid && S.resp && !S.done) { api("PUT", "/api/drafts/" + S.fid, { data: S.resp, step: S.step }); S.drafts = S.drafts || {}; S.drafts[S.fid] = { facilityId: S.fid, savedAt: Date.now(), step: S.step }; } }
  function yn(path, val, y, n) { return '<div class="seg"><button class="' + (val === true ? "y" : "") + '" data-a="yn" data-p="' + path + '" data-v="1">' + (y || "Yes") + '</button><button class="' + (val === false ? "n" : "") + '" data-a="yn" data-p="' + path + '" data-v="0">' + (n || "No") + "</button></div>"; }

  function worker() {
    var u = S.auth, mine = S.facilities; // server already scoped to assigned
    if (!S.fid) {
      var banner = '<div class="banner"><div><div class="muted" style="font-size:13px;font-weight:600">Welcome back</div><h4>' + esc(u.name) + '</h4></div><span class="pill">' + I("calendar") + " Today is " + today + "</span></div>";
      var list = mine.length ? '<div class="list">' + mine.map(function (f) { var is = f.checkInDay === today; return '<button class="frow" data-a="pick" data-id="' + f.id + '"><span class="fi">' + I("building-warehouse") + '</span><span class="fbody"><span class="fname">' + esc(f.name) + '</span><span class="fmeta"><span class="pill' + (is ? " today" : "") + '">' + I("calendar") + " Check-in: " + (f.checkInDay || "—") + (is ? " · today" : "") + '</span><span class="pill">' + I("refresh") + " Form updated " + fday(f.config.updatedAt) + "</span>" + (S.drafts && S.drafts[f.id] ? '<span class="pill draft">' + I("device-floppy") + " Draft saved</span>" : "") + "</span></span>" + I("chevron-right") + "</button>"; }).join("") + "</div>"
        : '<div class="empty">' + I("inbox") + " No facilities assigned to you yet. Your manager assigns sites and a check-in day.</div>";
      return banner + '<h3 style="margin-bottom:10px">Your facilities</h3>' + list;
    }
    var f = mine.find(function (x) { return x.id === S.fid; }), r = S.resp, cfg = f.config;
    var STEPS = stepsFor(f);
    if (S.done) return '<div class="done"><div class="di">' + I("circle-check") + '</div><h3>Report submitted</h3><p class="muted">' + esc(f.name) + ' — sent to the office. Thanks, ' + esc(u.name) + '.</p><button class="btn btn-dark" data-a="restart">Back to my facilities</button></div>';

    var sk = STEPS[S.step][0], body = "";
    var marks = {}; if (S.tried) stepErrors(sk, r, cfg).forEach(function (it) { if (it.mark) marks[it.mark] = 1; });
    var inv = function (m) { return marks[m] ? " invalid" : ""; };
    if (sk === "Tasks") body = cfg.weeklyTasks.length ? cfg.weeklyTasks.map(function (t, i) { var tr = r.tasks[t.id] || {}; return '<div class="card"><div class="row" style="align-items:flex-start"><span class="chip">' + (i + 1) + '</span><p style="margin:0;font-weight:600">' + esc(t.text) + '</p></div><div class="label">Your response</div><textarea rows="2" data-resp="tasks.' + t.id + '.note" placeholder="Status, what you did…">' + esc(tr.note || "") + "</textarea>" + photoField("Attach photos", 0, tr.files || [], "task:" + t.id) + "</div>"; }).join("") : '<div class="empty">No tasks this week.</div>';
    if (sk === "Lockout") {
      var sec = function (title, col, arr, key, extra) { return '<div class="section"><div class="sh" style="background:' + col + '"><span>' + title + '</span></div><div class="sb">' + (arr.length ? arr.map(function (x) { var a = r[key][x.id] || {}; return '<div class="lrow' + inv(key + ":" + x.id) + '"><span class="chip">' + x.unit + "</span>" + (extra ? '<div class="locknum"><span class="muted" style="font-size:13px">Lock #</span><input class="mono" inputmode="numeric" maxlength="4" placeholder="0000" data-resp="lockAdd.' + x.id + '.lockNo" data-num="1" value="' + esc(a.lockNo || "") + '"></div>' : "") + '<button class="check' + (a.done ? " on" : "") + '" data-a="chk" data-p="' + key + "." + x.id + '.done"><span class="bx">' + (a.done ? I("check") : "") + (extra ? "</span>Lock added</button>" : "</span>" + (key === "lockKeep" ? "Verified locked" : "Lock removed") + "</button>") + "</div>"; }).join("") : '<div class="muted" style="font-size:13px;padding:6px 0">None.</div>') + "</div></div>"; };
      body = '<div class="stack">' + sec("Locks to add", "var(--hazard)", cfg.lockoutAdd, "lockAdd", true) + sec("Locks to remove", "var(--alert)", cfg.lockoutRemove, "lockRemove") + sec("Leave in place", "var(--ok)", cfg.lockoutKeep, "lockKeep") + "</div>";
    }
    if (sk === "Maintenance") body = cfg.maintenance.length ? cfg.maintenance.map(function (x) { return '<div class="card"><div class="row" style="flex-wrap:wrap"><span class="chip">' + x.unit + '</span><span class="muted">' + esc(x.note) + '</span></div><div class="label">Where it stands now</div><textarea rows="2" data-resp="maintenance.' + x.id + '.statement">' + esc((r.maintenance[x.id] || {}).statement || "") + "</textarea></div>"; }).join("") : '<div class="empty">No units flagged.</div>';
    if (sk === "Vacated") body = cfg.vacated.length ? cfg.vacated.map(function (x) {
      var v = r.vacated[x.id] || {};
      var ck = function (key, label, note) { return '<button class="check full' + (v[key] ? " on" : "") + '" data-a="chk" data-p="vacated.' + x.id + "." + key + '"><span class="bx">' + (v[key] ? I("check") : "") + "</span><span>" + label + (note ? '<span class="muted" style="display:block;font-size:12px;font-weight:400">' + note + "</span>" : "") + "</span></button>"; };
      return '<div class="card' + inv("vacated:" + x.id) + '"><span class="chip">' + x.unit + '</span><div class="cond"><button class="' + (v.status === "clean" ? "ok" : "") + '" data-a="cond" data-id="' + x.id + '" data-v="clean">' + I("circle-check") + ' Clean / broom-swept</button><button class="' + (v.status === "problem" ? "bad" : "") + '" data-a="cond" data-id="' + x.id + '" data-v="problem">' + I("alert-triangle") + ' Problem</button></div>'
        + (v.status === "problem" ? '<textarea rows="2" style="margin-top:10px" data-resp="vacated.' + x.id + '.problem" placeholder="What is wrong?">' + esc(v.problem || "") + "</textarea>" : "")
        + '<div class="label" style="margin-top:12px">Unit condition checks</div>'
        + ck("door", "Door rolls up properly", "Doesn't suddenly close; springs in working order")
        + ck("latch", "Latch works and slides properly without prying")
        + ck("intrusion", "No intrusion into other units")
        + ck("water", "No wet spots on the floor and no water intrusion")
        + photoField("Photo of the unit", 0, v.photos || [], "vacated:" + x.id) + "</div>";
    }).join("") : '<div class="empty">No vacated units.</div>';
    if (sk === "Vacant") body = '<div class="card' + inv("vacant") + '"><div class="label">Office shows these as vacant (no lock)</div><div class="row" style="flex-wrap:wrap">' + (cfg.vacant.length ? cfg.vacant.map(function (x) { return '<span class="chip">' + x.unit + "</span>"; }).join("") : '<span class="muted">None.</span>') + '</div><p style="margin:12px 0 8px;font-weight:600">Are these the only units without a lock?</p>' + yn("vacantConfirmed", r.vacantConfirmed, "Yes, that's all", "No, found another") + (r.vacantConfirmed === false ? '<div class="label">List every other unit you found unlocked</div><textarea rows="2" data-resp="vacantExtra">' + esc(r.vacantExtra) + "</textarea>" : "") + "</div>";
    if (sk === "Auction") body = cfg.auction.length ? '<div class="notice">' + I("shield") + ' Do not touch anything inside. Photograph as-is, then re-lock.</div>' + cfg.auction.map(function (x) { var a = r.auction[x.id] || {}; return '<div class="card' + inv("auction:" + x.id) + '" style="margin-top:11px"><span class="chip">' + x.unit + "</span>" + photoField("Photos of contents", 3, a.photos || [], "auction:" + x.id) + '<button class="check full' + (a.untouched ? " on" : "") + '" data-a="chk" data-p="auction.' + x.id + '.untouched"><span class="bx">' + (a.untouched ? I("check") : "") + '</span>I did not touch any items inside</button><button class="check full' + (a.lockBack ? " on" : "") + '" data-a="chk" data-p="auction.' + x.id + '.lockBack"><span class="bx">' + (a.lockBack ? I("check") : "") + '</span>Lock put back on the unit</button><div class="row" style="margin-top:10px"><div class="locknum"><span class="muted" style="font-size:13px">Lock # put on unit</span><input class="mono" inputmode="numeric" maxlength="4" placeholder="0000" data-resp="auction.' + x.id + '.lockNo" data-num="1" value="' + esc(a.lockNo || "") + '"></div></div><div class="label">Report</div><textarea rows="2" data-resp="auction.' + x.id + '.report">' + esc(a.report || "") + "</textarea></div>"; }).join("") : '<div class="empty">No auction units.</div>';
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
        + '<div class="card' + inv("grounds.photos") + '">' + photoField("Facility photos (different areas — include any trash/items out of place)", 5, g.photos, "grounds") + "</div>"; }
    if (sk === "Climate") { var cl = r.climate; var cq = function (lab, key, y, n) { return '<div class="qrow' + inv("climate." + key) + '"><span>' + lab + "</span>" + yn("climate." + key, cl[key], y, n) + "</div>"; };
      body = '<div class="notice">' + I("temperature") + ' Climate-controlled building checks.</div><div class="card" style="margin-top:11px">'
        + cq("Is the facility's temperature at a reasonable level?", "temp", "Yes", "No") + (cl.temp !== null ? '<textarea rows="1" data-resp="climate.tempNote" placeholder="Optional: note the reading (e.g. 74°F)">' + esc(cl.tempNote) + "</textarea>" : "")
        + cq("Any interior light bulbs burnt out?", "bulbs") + (cl.bulbs === true ? '<textarea rows="2" data-resp="climate.bulbsNote" placeholder="Which / where?">' + esc(cl.bulbsNote) + "</textarea>" : "")
        + cq("Any trash on the ground inside?", "trash") + (cl.trash === true ? '<textarea rows="2" data-resp="climate.trashNote" placeholder="Where?">' + esc(cl.trashNote) + "</textarea>" : "")
        + cq("All dollies / moving-assist items in their proper place?", "dollies", "Yes", "No")
        + photoField("Interior photos (optional)", 0, cl.photos || [], "climate") + "</div>"; }
    if (sk === "Review") { var rows = [[0, "Weekly tasks", Object.values(r.tasks).filter(function (t) { return t.note && t.note.trim(); }).length + " of " + cfg.weeklyTasks.length + " answered"], [1, "Locks", cfg.lockoutAdd.length + " add · " + cfg.lockoutRemove.length + " remove"], [2, "Maintenance", cfg.maintenance.length + " unit(s)"], [3, "Recently vacated", cfg.vacated.length + " unit(s)"], [4, "Vacant", r.vacantConfirmed === false ? "Extra reported" : r.vacantConfirmed ? "Confirmed" : "—"], [5, "Auction", cfg.auction.length + " unit(s)"], [6, "Grounds", r.grounds.photos.length + " photos"]]; if (cfg.climateControlled) rows.push([7, "Climate control", "included"]);
      body = '<div class="card"><p class="hint" style="margin:0">Review before sending. Tap a line to jump back.</p></div>' + rows.map(function (x) { return '<button class="review-row" data-a="step" data-i="' + x[0] + '" style="margin-top:10px"><span style="flex:1">' + x[1] + '</span><span class="v">' + x[2] + "</span>" + I("chevron-right") + "</button>"; }).join(""); }

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
    app.innerHTML = !S.auth ? login() : S.auth.role === "worker" ? worker() : manager();
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
    if (usr && (S.teamId || S.adminId)) { var id = S.teamId || S.adminId, w = S.users.find(function (x) { return x.id === id; }); w[usr === "password" ? "_pwd" : usr] = v; saveSoon(function () { putUser(w); }); return; }
    var cfg = t.getAttribute("data-cfg");
    if (cfg && S.secFac) { var sf = S.facilities.find(function (x) { return x.id === S.secFac; }); if (sf) { setPath(sf.config, cfg, v); saveSoon(function () { putFacility(sf); }); } return; }
    var cli = t.getAttribute("data-cli");
    if (cli && S.secFac) { var pr = cli.split("|"), sf2 = S.facilities.find(function (x) { return x.id === S.secFac; }); if (sf2) { var arr = getPath(sf2.config, pr[0]) || [], item = arr.find(function (z) { return z.id === pr[1]; }); if (item) { item[pr[2]] = v; saveSoon(function () { putFacility(sf2); }); } } return; }
    var note = t.getAttribute("data-note");
    if (note && S.subsFid) { var fnn = S.facilities.find(function (x) { return x.id === S.subsFid; }); var nn = (fnn.config.adminNotes || []).find(function (z) { return z.id === note; }); if (nn) { nn.text = v; saveSoon(function () { putFacility(fnn); }); } return; }
    var rp = t.getAttribute("data-resp");
    if (rp && S.resp) { setPath(S.resp, rp, v); }
  });
  document.addEventListener("change", function (ev) {
    var t = ev.target, day = t.getAttribute("data-day");
    if (day && S.teamId) { var w = S.users.find(function (x) { return x.id === S.teamId; }); var a = (w.assignments || []).find(function (x) { return x.facilityId === day; }); if (a) { a.checkInDay = t.value; putUser(w); } return; }
    var urole = t.getAttribute("data-usr");
    if (urole === "role" && (S.adminId || S.teamId)) { var uid2 = S.adminId || S.teamId, wr = S.users.find(function (x) { return x.id === uid2; }); wr.role = t.value; putUser(wr).then(render); return; }
    var cfg = t.getAttribute("data-cfg");
    if (cfg && S.secFac) { var sf = S.facilities.find(function (x) { return x.id === S.secFac; }); if (sf) { setPath(sf.config, cfg, t.value); putFacility(sf).then(render); } return; }
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
        S.tab = "facilities"; S.editId = S.teamId = S.adminId = S.subsFid = S.subOpen = S.secFac = S.fid = null;
        return loadForRole();
      }).then(render).catch(function (e) { S.busy = false; S.lerr = e.message; render(); });
      return;
    }
    if (a === "logout") { saveDraft(); flushSave(); setToken(null); S.auth = null; S.fid = null; S.resp = null; S.editId = S.teamId = S.adminId = S.subsFid = S.subOpen = S.secFac = null; render(); return; }

    if (a === "tab") { flushSave(); S.tab = k; S.secFac = null; S.openItem = null; S.subsFid = null; S.subOpen = null; render(); return; }

    /* facilities */
    if (a === "addfac") { api("POST", "/api/facilities", {}).then(function (f) { S.facilities.push(f); S.editId = f.id; render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "editfac") { S.editId = id; render(); return; }
    if (a === "backedit") { flushSave(); S.editId = null; api("GET", "/api/facilities").then(function (f) { S.facilities = f; render(); }); return; }
    if (a === "delfac") { if (!confirm("Delete this facility and its setup?")) return; api("DELETE", "/api/facilities/" + id).then(function () { S.facilities = S.facilities.filter(function (x) { return x.id !== id; }); render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "ladd") { var f = S.facilities.find(function (x) { return x.id === S.editId; }); f.config[k].push({ id: uid() }); putFacility(f); render(); return; }
    if (a === "ldel") { var f2 = S.facilities.find(function (x) { return x.id === S.editId; }); f2.config[k] = f2.config[k].filter(function (x) { return x.id !== id; }); putFacility(f2); render(); return; }

    /* staff */
    if (a === "addworker") { api("POST", "/api/users", { role: "worker", name: "New person", username: "user" + Date.now().toString().slice(-4), password: "changeme", assignments: [] }).then(function (w) { S.users.push(w); S.teamId = w.id; render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "team") { S.teamId = id; render(); return; }
    if (a === "backteam") { flushSave(); S.teamId = null; render(); return; }
    if (a === "assign") {
      var w = S.users.find(function (x) { return x.id === S.teamId; }); w.assignments = w.assignments || [];
      var i = w.assignments.findIndex(function (x) { return x.facilityId === id; });
      if (i >= 0) w.assignments.splice(i, 1); else w.assignments.push({ facilityId: id, checkInDay: "Monday" });
      putUser(w); render(); return;
    }

    /* admins */
    if (a === "addadmin") { api("POST", "/api/users", { role: "admin", name: "New admin", username: "admin" + Date.now().toString().slice(-4), password: "changeme" }).then(function (w) { S.users.push(w); S.adminId = w.id; render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "admin") { S.adminId = id; render(); return; }
    if (a === "backadmin") { flushSave(); S.adminId = null; render(); return; }
    if (a === "deluser") {
      if (!confirm("Remove this login?")) return;
      api("DELETE", "/api/users/" + id).then(function () { S.users = S.users.filter(function (x) { return x.id !== id; }); S.teamId = S.adminId = null; render(); }).catch(function (e) { toast(e.message); });
      return;
    }

    /* per-facility admin sections */
    if (a === "opensec") { S.secFac = id; S.openItem = null; render(); return; }
    if (a === "backsec") { flushSave(); S.secFac = null; S.openItem = null; render(); return; }
    if (a === "openitem") { S.openItem = el.getAttribute("data-key"); render(); return; }
    if (a === "saveitem") { flushSave(); S.openItem = null; render(); return; }
    if (a === "cfgtoggle") { var sf = S.facilities.find(function (x) { return x.id === S.secFac; }); var p = el.getAttribute("data-p"); setPath(sf.config, p, !getPath(sf.config, p)); putFacility(sf); render(); return; }
    if (a === "cfgadd") { var sfa = S.facilities.find(function (x) { return x.id === S.secFac; }); var pa = el.getAttribute("data-p"); var arr = getPath(sfa.config, pa); if (!Array.isArray(arr)) { setPath(sfa.config, pa, []); arr = getPath(sfa.config, pa); } var nid = uid(); arr.push({ id: nid }); putFacility(sfa); S.openItem = pa + "#" + nid; render(); return; }
    if (a === "cfgdel") { var sfd = S.facilities.find(function (x) { return x.id === S.secFac; }); var pd = el.getAttribute("data-p"); var arrd = getPath(sfd.config, pd) || []; setPath(sfd.config, pd, arrd.filter(function (z) { return z.id !== id; })); putFacility(sfd); S.openItem = null; render(); return; }
    if (a === "clitoggle") { var sft = S.facilities.find(function (x) { return x.id === S.secFac; }); var pt = el.getAttribute("data-p"), fld = el.getAttribute("data-f"); var it = (getPath(sft.config, pt) || []).find(function (z) { return z.id === id; }); if (it) { it[fld] = !it[fld]; putFacility(sft); render(); } return; }
    if (a === "setstatus") { var sfs = S.facilities.find(function (x) { return x.id === S.secFac; }); var item = (getPath(sfs.config, "maintenanceTracking") || []).find(function (z) { return z.id === id; }); if (item) { item.status = el.getAttribute("data-v"); putFacility(sfs); render(); } return; }
    if (a === "submitsite") { var sfsub = S.facilities.find(function (x) { return x.id === S.editId; }); flushSave(); api("PUT", "/api/facilities/" + sfsub.id, { name: sfsub.name, address: sfsub.address, config: sfsub.config, submit: true }).then(function (u) { sfsub.config.updatedAt = u.config.updatedAt; toast("Site check submitted — techs now see today's date."); render(); }).catch(function (e) { toast(e.message); }); return; }

    /* reports */
    if (a === "subs") { S.subsFid = id; S.subOpen = null; S.subStep = 0; api("GET", "/api/facilities/" + id + "/submissions").then(function (s) { S.subs = s; render(); }).catch(function (e) { toast(e.message); }); return; }
    if (a === "backsubs") { S.subsFid = null; S.subOpen = null; S.subStep = 0; render(); return; }
    if (a === "opensub") { S.subOpen = S.subs[+el.getAttribute("data-i")]; S.subStep = 0; render(); return; }
    if (a === "backopen") { S.subOpen = null; S.subStep = 0; render(); return; }
    if (a === "subnext") { S.subStep++; render(); return; }
    if (a === "subback") { S.subStep--; render(); return; }
    if (a === "substep") { S.subStep = +el.getAttribute("data-i"); render(); return; }
    if (a === "markreviewed") {
      var sid = S.subOpen.id; S.busy = true; render();
      api("POST", "/api/submissions/" + sid + "/review", {}).then(function (r) {
        S.busy = false; S.subOpen.reviewed = true; S.subOpen.reviewedAt = r.reviewedAt; S.subOpen.reviewedBy = r.reviewedBy;
        var it = S.subs.find(function (x) { return x.id === sid; }); if (it) { it.reviewed = true; it.reviewedAt = r.reviewedAt; it.reviewedBy = r.reviewedBy; }
        toast("Report marked as reviewed."); S.subOpen = null; S.subStep = 0; render();
      }).catch(function (e) { S.busy = false; toast(e.message); render(); });
      return;
    }
    if (a === "noteadd") { var fn = S.facilities.find(function (x) { return x.id === S.subsFid; }); if (!Array.isArray(fn.config.adminNotes)) fn.config.adminNotes = []; fn.config.adminNotes.push({ id: uid(), text: "" }); putFacility(fn); render(); return; }
    if (a === "notedel") { var fd = S.facilities.find(function (x) { return x.id === S.subsFid; }); fd.config.adminNotes = (fd.config.adminNotes || []).filter(function (z) { return z.id !== id; }); putFacility(fd); render(); return; }

    /* worker wizard */
    if (a === "pick") { S.fid = id; S.tried = false; var dr = S.drafts && S.drafts[id]; if (dr) { api("GET", "/api/drafts/" + id).then(function (d) { S.resp = d && d.data ? Object.assign(blankResp(), d.data) : blankResp(); S.step = (d && d.step) || 0; S.done = false; render(); }).catch(function () { S.resp = blankResp(); S.step = 0; S.done = false; render(); }); } else { S.resp = blankResp(); S.step = 0; S.done = false; render(); } return; }
    if (a === "step") { S.step = +el.getAttribute("data-i"); S.tried = false; saveDraft(); render(); return; }
    if (a === "fixstep") { S.step = +el.getAttribute("data-i"); S.tried = true; render(); return; }
    if (a === "next") { if (currentIssues().length) { S.tried = true; render(); return; } S.step++; S.tried = false; saveDraft(); render(); return; }
    if (a === "back") { S.step--; S.tried = false; saveDraft(); render(); return; }
    if (a === "home") { saveDraft(); S.fid = null; S.resp = null; S.tried = false; render(); return; }
    if (a === "saveexit") { saveDraft(); toast("Draft saved — pick the facility again any time to resume."); S.fid = null; S.resp = null; S.tried = false; render(); return; }
    if (a === "restart") { S.fid = null; S.resp = null; S.done = false; S.tried = false; render(); return; }
    if (a === "chk") { var p = el.getAttribute("data-p"); setPath(S.resp, p, !getPath(S.resp, p)); render(); return; }
    if (a === "yn") { setPath(S.resp, el.getAttribute("data-p"), el.getAttribute("data-v") === "1"); render(); return; }
    if (a === "cond") { var cur = S.resp.vacated[id] || {}; cur.status = el.getAttribute("data-v"); S.resp.vacated[id] = cur; render(); return; }
    if (a === "cctoggle") { var fc = S.facilities.find(function (x) { return x.id === S.editId; }); fc.config.climateControlled = !fc.config.climateControlled; putFacility(fc); render(); return; }
    if (a === "delphoto") { delPhoto(el.getAttribute("data-scope"), id); render(); return; }
    if (a === "submit") {
      var fsub = S.facilities.find(function (x) { return x.id === S.fid; });
      if (allIssues(S.resp, fsub.config, stepsFor(fsub)).length) { S.tried = true; render(); return; }
      S.busy = true; render();
      api("POST", "/api/submissions", { facilityId: S.fid, data: S.resp }).then(function () { S.busy = false; S.done = true; if (S.drafts) delete S.drafts[S.fid]; api("DELETE", "/api/drafts/" + S.fid); render(); })
        .catch(function (e) { S.busy = false; toast(e.message); render(); });
      return;
    }
  });

  boot();
})();
