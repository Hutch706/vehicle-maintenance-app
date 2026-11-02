"use strict";
/* Vehicle Maintenance App: screens and interactions. Storage, math and CSV are in data.js. */

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(cls, text, onClick) { const b = el("button", cls, text); b.type = "button"; if (onClick) b.addEventListener("click", onClick); return b; }
const numIn = (v) => { const s = String(v).trim(); if (s === "") return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
const intIn = (v) => { const n = numIn(v); return n == null || Number.isNaN(n) ? n : Number.isInteger(n) ? n : NaN; };
const money = (n, d = 2) => (Number.isFinite(n) ? "$" + n.toFixed(d) : "—");
const mi = (n) => Math.round(n).toLocaleString() + " mi";
const shortDate = (iso) => { const [y, m, d] = String(iso).split("-"); return `${+m}/${+d}/${y.slice(2)}`; };
function longDate(iso) { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many || one + "s"}`;
function andList(parts) { parts = parts.filter(Boolean); return parts.length < 2 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]; }
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function setMsg(node, text, kind = "") { node.textContent = text; node.className = "status" + (kind ? " " + kind : ""); }
const setStatus = (text, kind) => setMsg($("status"), text, kind);
const pref = {
  get(k, d = null) { try { const v = localStorage.getItem("vma:" + k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("vma:" + k, v); } catch {} },
};
// Screen settings saved under the app's old name (Fill-Up Receipts, "fur:") move to the new prefix once.
try {
  const old = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("fur:")) old.push(k); }
  for (const k of old) { const nk = "vma:" + k.slice(4); if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k)); localStorage.removeItem(k); }
} catch {}
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(navigator.userAgent);
const isMobile = isIOS || isAndroid;
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const daysAgo = (iso) => Math.round((Date.parse(today()) - Date.parse(iso.slice(0, 10))) / 864e5);
const agoText = (n) => (n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);
function saveErrorText(e) {
  if (e && e.name === "QuotaExceededError") return "This device is out of space for the app's data. Free up some space, then try again.";
  return "Couldn't save" + (e && e.message ? ` (${e.message})` : "") + ". Try again.";
}
// "Tap again to …" confirmation for small destructive buttons.
function armedButton(label, armedLabel, action) {
  const b = btn("del", label);
  let armed = false, timer;
  b.addEventListener("click", async () => {
    if (!armed) { armed = true; b.textContent = armedLabel; b.classList.add("armed"); timer = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove("armed"); }, 4000); return; }
    clearTimeout(timer); b.disabled = true;
    try { await action(); } catch (e) { setStatus(saveErrorText(e), "err"); b.disabled = false; }
  });
  return b;
}

// ---------- Saving: write, tell other open tabs, redraw ----------
const bc = "BroadcastChannel" in self ? new BroadcastChannel("vehicle-maintenance-app") : null;
if (bc) bc.onmessage = async () => { await reload(); renderAll(); };
let persistState = null, persistAsked = false;
async function persistOnce() {
  if (persistAsked || persistState === true) return;
  persistAsked = true;
  persistState = await askPersist();
  renderStorage();
}
async function commit(changes, opts) {
  await save(changes, opts);
  bc?.postMessage("changed");
  renderAll();
  persistOnce();
}

// ---------- Confirm / ask dialog ----------
function askDialog({ title, body = "", ok = "OK", cancel = "Cancel", danger = false, input = null, validate = null }) {
  const d = $("cDialog"), form = $("cForm");
  $("cTitle").textContent = title;
  $("cBody").textContent = body; $("cBody").hidden = !body;
  $("cOk").textContent = ok; $("cOk").className = "save" + (danger ? " danger" : "");
  $("cCancel").textContent = cancel;
  $("cInputWrap").hidden = !input;
  setMsg($("cStatus"), "");
  if (input) { $("cInputLabel").textContent = input.label; $("cInput").value = input.value || ""; $("cInput").placeholder = input.placeholder || ""; }
  return new Promise((resolve) => {
    const onSubmit = (ev) => {
      if (ev.submitter?.value === "ok" && input && validate) {
        const err = validate($("cInput").value);
        if (err) { ev.preventDefault(); setMsg($("cStatus"), err, "err"); }
      }
    };
    const onKey = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $("cOk").click(); } };
    const onClose = () => {
      form.removeEventListener("submit", onSubmit); $("cInput").removeEventListener("keydown", onKey); d.removeEventListener("close", onClose);
      const yes = d.returnValue === "ok";
      resolve(input ? (yes ? cleanText($("cInput").value, 80) : null) : yes);
    };
    form.addEventListener("submit", onSubmit);
    $("cInput").addEventListener("keydown", onKey);
    d.addEventListener("close", onClose);
    d.returnValue = "cancel";
    d.showModal();
    (input ? $("cInput") : $("cCancel")).focus();
  });
}

// ---------- Screens ----------
const SCREENS = ["log", "vehicles", "backup"];
let curScreen = null, pendingOpen = null;
function route() {
  let s = location.hash.replace(/^#/, "");
  if (!SCREENS.includes(s)) s = S.vehicles.length ? "log" : "vehicles";
  for (const n of SCREENS) $("screen-" + n).hidden = n !== s;
  for (const a of document.querySelectorAll(".tabbar a")) {
    if (a.dataset.screen === s) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  if (s !== curScreen) { curScreen = s; window.scrollTo(0, 0); }
  if (s === "vehicles" && !S.vehicles.length && !wiz) startWizard();
  if (s === "log") maybeAutoOpen();
  if (pendingOpen) {
    const d = $(pendingOpen); pendingOpen = null;
    if (d) { d.open = true; setTimeout(() => d.scrollIntoView({ block: "start", behavior: "smooth" }), 50); }
  }
}
window.addEventListener("hashchange", route);
document.addEventListener("click", (ev) => {
  const a = ev.target.closest("[data-open]");
  if (a) { pendingOpen = a.dataset.open; if (location.hash === a.getAttribute("href")) route(); }
  const t = ev.target.closest(".tabbar a");
  if (t && location.hash === t.getAttribute("href")) window.scrollTo({ top: 0, behavior: "smooth" });
});

function renderAll() {
  fillVehicleSelects();
  renderLog();
  renderVehicles();
  renderBackup();
  renderNudges();
}

// ---------- Vehicle pickers ----------
// Two pickers in the entry forms (kept in sync) and "history" at the top of the Log screen, which drives the panels below it.
const histSel = $("vehicle"), entrySels = [$("eVehicle"), $("mVehicle")], showInactive = $("showInactive");
function fillSelect(sel, keep) {
  sel.replaceChildren();
  const active = S.vehicles.filter((v) => v.active), inactive = S.vehicles.filter((v) => !v.active);
  for (const v of active) sel.add(new Option(v.name, v.id));
  if ((showInactive.checked || !active.length) && inactive.length) {
    if (active.length) { const d = new Option("\u2500".repeat(18), ""); d.disabled = true; sel.add(d); }
    for (const v of inactive) sel.add(new Option(v.name + " (inactive)", v.id));
  }
  const ok = [...sel.options].some((o) => o.value === keep && !o.disabled);
  sel.value = ok ? keep : (sel.options[0]?.value ?? "");
}
function fillVehicleSelects() {
  const hist = histSel.value || pref.get("vehicle"), ent = entrySels[0].value || pref.get("entryVehicle");
  fillSelect(histSel, hist);
  for (const s of entrySels) fillSelect(s, ent);
}
function selectVehicle(id) {
  pref.set("vehicle", id); pref.set("entryVehicle", id);
  if (!vehicleById(id)?.active) { showInactive.checked = true; pref.set("showInactive", "1"); }
  fillSelect(histSel, id); for (const s of entrySels) fillSelect(s, id);
}
showInactive.addEventListener("change", () => {
  pref.set("showInactive", showInactive.checked ? "1" : "0");
  const hist = histSel.value;
  fillVehicleSelects();
  if (histSel.value !== hist) renderLog();
});
histSel.addEventListener("change", () => { pref.set("vehicle", histSel.value); renderLog(); });
for (const sel of entrySels) sel.addEventListener("change", () => {
  for (const o of entrySels) if (o !== sel) o.value = sel.value;
  pref.set("entryVehicle", sel.value);
  fillMaintItems(); prefillMaintOdo();
});
// Hide / Show buttons on the Log screen sections, remembered on this device.
for (const b of document.querySelectorAll(".hidebtn")) {
  const body = $(b.dataset.target), key = "hide:" + b.dataset.target;
  const set = (h) => { body.hidden = h; b.textContent = h ? "Show" : "Hide"; b.setAttribute("aria-expanded", String(!h)); };
  set(pref.get(key) === "1");
  b.addEventListener("click", () => { const h = !body.hidden; set(h); pref.set(key, h ? "1" : "0"); });
}

// ---------- Log screen ----------
function renderLog() {
  const has = S.vehicles.length > 0;
  $("noVehicles").hidden = has;
  $("logMain").hidden = !has;
  if (!has) { $("mBanner").hidden = true; closeEntry(); return; }
  $("showInactiveWrap").hidden = !S.vehicles.some((v) => !v.active) || !S.vehicles.some((v) => v.active);
  renderMpg(); renderAllVehicles(); renderList(); renderServices(); refreshMaint();
  fillStationList(); fillShopSelect(); fillMaintItems();
}

// Entry: the Fill-up and Maintenance tabs
function openEntry(maint) {
  if ($("entry").hidden) {
    // Start with the vehicle you're looking at.
    const hv = histSel.value;
    if (hv && [...entrySels[0].options].some((o) => o.value === hv && !o.disabled)) { for (const s of entrySels) s.value = hv; pref.set("entryVehicle", hv); }
    resetFillForm(); resetMaintForm(); fillMaintItems();
  }
  $("entry").hidden = false;
  setStatus("");
  showTab(maint);
  $("entry").scrollIntoView({ block: "start", behavior: "smooth" });
  setTimeout(() => (maint ? $("mOdo") : $("odometer")).focus({ preventScroll: true }), 250);
}
function closeEntry() { $("entry").hidden = true; }
function showTab(maint) {
  $("tabFill").setAttribute("aria-selected", String(!maint)); $("tabMaint").setAttribute("aria-selected", String(maint));
  $("panelFill").inert = maint; $("panelMaint").inert = !maint;
  if (maint) { if (!$("mDate").value) $("mDate").value = today(); if (!$("mOdo").value) prefillMaintOdo(); fillMaintItems(); }
}
$("addFillBtn").addEventListener("click", () => openEntry(false));
$("addMaintBtn").addEventListener("click", () => openEntry(true));
$("tabFill").addEventListener("click", () => showTab(false));
$("tabMaint").addEventListener("click", () => showTab(true));

// Fill-up form
function resetFillForm() {
  for (const id of ["station", "odometer", "ppg", "gallons", "rtotal"]) $(id).value = "";
  $("date").value = today();
  setMsg($("fStatus"), "");
  refreshDisplay();
}
function refreshDisplay() {
  const p = numIn($("ppg").value), g = numIn($("gallons").value), t = numIn($("rtotal").value);
  const ok = (x) => x != null && !Number.isNaN(x);
  $("dPrice").textContent = ok(p) ? money(p, 3) : "—";
  $("dGal").textContent = ok(g) ? g.toFixed(3) : "—";
  const cost = ok(p) && ok(g) ? p * g : null;
  $("dCost").textContent = money(cost);
  const chk = $("check");
  chk.className = "check";
  if (cost != null && ok(t)) {
    if (Math.abs(cost - t) > 0.05) { chk.textContent = `Receipt total is ${money(t)}, but $/gallon × gallons = ${money(cost)}. Check both numbers.`; chk.classList.add("warn"); }
    else { chk.textContent = `Matches the receipt total of ${money(t)}.`; chk.classList.add("ok"); }
  } else chk.textContent = "";
}
for (const id of ["ppg", "gallons", "rtotal"]) $(id).addEventListener("input", refreshDisplay);
$("cancelBtn").addEventListener("click", () => { resetFillForm(); closeEntry(); setStatus(""); });
function fillStationList() {
  const seen = new Set(), list = $("stationList");
  list.replaceChildren();
  for (const f of [...S.fillups].sort((a, b) => cmp(b.date, a.date))) {
    if (f.station && !seen.has(lower(f.station))) { seen.add(lower(f.station)); list.append(new Option(f.station)); }
    if (seen.size >= 30) break;
  }
}
function warningText(name, s) {
  const pct = Math.round(Math.abs(s.deviation) * 100), dir = s.deviation < 0 ? "below" : "above";
  const hint = s.deviation < 0
    ? "A missed fill-up, a partial fill or an odometer typo can cause this. If the numbers are right, it may be worth a look at the vehicle."
    : "This usually means the last fill-up wasn't a full tank, or the odometer or gallons were mistyped.";
  return { title: `${s.latest.mpg.toFixed(1)} MPG is ${pct}% ${dir} average`,
    body: `${name}'s fill-up on ${shortDate(s.latest.date)} got ${s.latest.mpg.toFixed(1)} MPG; its average before that was ${s.priorAvg.toFixed(1)}. ${hint}` };
}
$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fail = (t) => setMsg($("fStatus"), t, "err");
  const v = vehicleById(entrySels[0].value);
  if (!v) return fail("Choose a vehicle.");
  const odometer = intIn($("odometer").value), ppg = numIn($("ppg").value), gallons = numIn($("gallons").value), total = numIn($("rtotal").value);
  if (!$("date").value) return fail("Enter the date.");
  if (odometer == null || Number.isNaN(odometer)) return fail("Enter the odometer as a whole number of miles.");
  if (!(ppg > 0)) return fail("Enter the price per gallon.");
  if (!(gallons > 0)) return fail("Enter the gallons.");
  if (Number.isNaN(total)) return fail("The receipt total isn't a number. Fix it or clear it.");
  const r = makeFillup({ vehicleId: v.id, date: $("date").value, odometer, gallons, pricePerGallon: ppg, total, station: $("station").value, missed: false });
  if (r.error) return fail(cap(r.error) + ".");
  if (S.fillups.some((f) => fillupKey(f) === fillupKey(r.rec))) return fail("This fill-up is already saved (same vehicle, date and odometer).");
  $("saveBtn").disabled = true;
  try {
    await commit({ put: { fillups: [r.rec] } });
    resetFillForm(); closeEntry();
    if (histSel.value !== v.id) { selectVehicle(v.id); renderLog(); }
    const s = vehicleStats(fillupsFor(v.id));
    if (s.latest?.id === r.rec.id && s.flagged) setStatus(`Saved. Heads up: ${warningText(v.name, s).title}. Check the odometer and gallons.`, "warn");
    else if (s.latest?.id === r.rec.id) setStatus(`Saved: ${v.name}, ${s.latest.mpg.toFixed(1)} MPG on this tank.`, "ok");
    else setStatus(`Saved: ${v.name}, ${gallons.toFixed(3)} gal at ${mi(odometer)}.${s.fillups === 1 ? " MPG shows up after the next fill-up." : ""}`, "ok");
  } catch (e) { fail(saveErrorText(e)); }
  finally { $("saveBtn").disabled = false; }
});

// Maintenance form
const ADD_SHOP = "__add_shop__";
function fillShopSelect() {
  const sel = $("mShop"), keep = sel.value;
  sel.replaceChildren(new Option("Not specified", ""));
  for (const s of S.shops) sel.add(new Option(s, s));
  sel.add(new Option("Add a shop…", ADD_SHOP));
  sel.value = [...sel.options].some((o) => o.value === keep) && keep !== ADD_SHOP ? keep : "";
  sel.dataset.prev = sel.value;
}
$("mShop").addEventListener("change", async () => {
  const sel = $("mShop");
  if (sel.value !== ADD_SHOP) { sel.dataset.prev = sel.value; return; }
  const name = await askDialog({ title: "Add a shop", ok: "Add shop", input: { label: "Shop name", placeholder: "e.g. DIY, Main St. Auto" }, validate: shopNameError });
  if (!name) { sel.value = sel.dataset.prev || ""; return; }
  try { await commit({ settings: { shops: [...S.shops, name] } }); } catch (e) { setMsg($("mStatus"), saveErrorText(e), "err"); }
  fillShopSelect(); sel.value = name; sel.dataset.prev = name;
});
function updateMaintSummary() {
  const names = [...$("mItemsList").querySelectorAll("input:checked")].map((i) => i.parentElement.textContent);
  $("mItemsSum").textContent = !names.length ? "Select items" : names.length <= 2 ? names.join(", ") : `${names.length} items selected`;
}
function fillMaintItems() {
  const list = $("mItemsList"), keep = new Set([...list.querySelectorAll("input:checked")].map((i) => i.value));
  const v = vehicleById(entrySels[0].value);
  list.replaceChildren();
  if (v && !v.items.length) list.append(el("div", "mempty", "This vehicle has no maintenance schedule. Use Other repairs below, or add items in Vehicles."));
  for (const it of v?.items || []) {
    const lab = el("label"), cb = el("input");
    cb.type = "checkbox"; cb.value = it.id; cb.checked = keep.has(it.id);
    cb.addEventListener("change", updateMaintSummary);
    lab.append(cb, document.createTextNode(it.name));
    list.append(lab);
  }
  updateMaintSummary();
}
function prefillMaintOdo() { const cur = latestOdo(entrySels[0].value); $("mOdo").value = cur ? cur.odometer : ""; }
function resetMaintForm() {
  for (const cb of $("mItemsList").querySelectorAll("input:checked")) cb.checked = false;
  $("mOther").value = ""; $("mItems").open = false; $("mDate").value = today(); $("mShop").value = "";
  setMsg($("mStatus"), ""); prefillMaintOdo(); updateMaintSummary();
}
$("mCancel").addEventListener("click", () => { resetMaintForm(); closeEntry(); setStatus(""); });
$("mForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fail = (t) => setMsg($("mStatus"), t, "err");
  const v = vehicleById(entrySels[0].value);
  if (!v) return fail("Choose a vehicle.");
  const date = $("mDate").value, odometer = intIn($("mOdo").value), shop = $("mShop").value === ADD_SHOP ? "" : $("mShop").value;
  const picked = [...$("mItemsList").querySelectorAll("input:checked")].map((i) => v.items.find((it) => it.id === i.value)).filter(Boolean);
  const other = $("mOther").value.trim();
  if (!date) return fail("Enter the date.");
  if (odometer == null || Number.isNaN(odometer)) return fail("Enter the odometer as a whole number of miles.");
  if (!picked.length && !other) return fail("Pick at least one maintenance item, or describe the other repairs.");
  // One record per item (so each item's countdown restarts), tied together by a visit id.
  const visit = newId("x"), createdAt = nowISO(), recs = [];
  for (const it of picked) recs.push(makeService({ vehicleId: v.id, date, odometer, shop, itemId: it.id, itemName: it.name, notes: "", visit, createdAt }));
  if (other) recs.push(makeService({ vehicleId: v.id, date, odometer, shop, itemId: "other", itemName: "Other repairs", notes: other, visit, createdAt }));
  const errs = recs.filter((r) => r.error);
  if (errs.length) return fail(cap(errs[0].error) + ".");
  $("mSave").disabled = true;
  try {
    await commit({ put: { services: recs.map((r) => r.rec) } });
    setStatus(`Saved maintenance: ${v.name}, ${mi(odometer)}${shop ? " at " + shop : ""}: ${andList([...picked.map((i) => i.name), other ? "other repairs" : null])}.`, "ok");
    resetMaintForm(); closeEntry();
    if (histSel.value !== v.id) { selectVehicle(v.id); renderLog(); }
  } catch (e) { fail(saveErrorText(e)); }
  finally { $("mSave").disabled = false; }
});

// MPG panel and chart
const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
function drawChart(trips) {
  const box = $("chart"); box.replaceChildren();
  if (trips.length < 2) { $("legend").hidden = true; return; }
  const W = 320, H = 150, L = 30, R = 8, T = 8, B = 20;
  const vals = trips.flatMap((t) => [t.mpg, t.running]).filter((v) => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(1, (hi - lo) * 0.15); lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad);
  const x = (i) => L + (i * (W - L - R)) / (trips.length - 1);
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "MPG by fill-up" });
  for (const v of [lo, (lo + hi) / 2, hi]) {
    svg.append(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: "var(--line)", "stroke-width": 1 }));
    const t = svgEl("text", { x: L - 4, y: y(v) + 3, "text-anchor": "end" }); t.textContent = v.toFixed(0); svg.append(t);
  }
  const path = (key) => trips.map((t, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(t[key]).toFixed(1)}`).join(" ");
  svg.append(svgEl("path", { d: path("mpg"), fill: "none", stroke: "var(--accent)", "stroke-width": 1.5 }));
  svg.append(svgEl("path", { d: path("running"), fill: "none", stroke: "var(--run)", "stroke-width": 3, "stroke-linejoin": "round" }));
  trips.forEach((t, i) => svg.append(svgEl("circle", { cx: x(i), cy: y(t.mpg), r: i === trips.length - 1 ? 4 : 2.5, fill: "var(--accent)" })));
  const d0 = svgEl("text", { x: L, y: H - 4, "text-anchor": "start" }); d0.textContent = shortDate(trips[0].date);
  const d1 = svgEl("text", { x: W - R, y: H - 4, "text-anchor": "end" }); d1.textContent = shortDate(trips[trips.length - 1].date);
  svg.append(d0, d1);
  // Hover or touch-drag: snap to the nearest fill-up and show its MPG and the 2-month running MPG.
  const guide = svgEl("line", { y1: T, y2: H - B, stroke: "var(--muted)", "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" });
  const dot = svgEl("circle", { r: 5, fill: "var(--accent)", stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" });
  const hit = svgEl("rect", { x: L, y: 0, width: W - L - R, height: H, fill: "transparent" });
  svg.append(guide, dot, hit);
  const tip = el("div", "tip"); tip.hidden = true;
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(trips.length - 1, Math.round(((sx - L) * (trips.length - 1)) / (W - L - R))));
    const t = trips[i];
    for (const [k, v] of Object.entries({ x1: x(i), x2: x(i), visibility: "visible" })) guide.setAttribute(k, v);
    for (const [k, v] of Object.entries({ cx: x(i), cy: y(t.mpg), visibility: "visible" })) dot.setAttribute(k, v);
    tip.replaceChildren(el("span", null, `${t.mpg.toFixed(1)} MPG · ${shortDate(t.date)}`), el("span", "run", t.running != null ? `${t.running.toFixed(1)} running` : ""));
    tip.hidden = false;
    const px = (x(i) / W) * r.width, half = tip.offsetWidth / 2;
    tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, px - half)) + "px";
  };
  const hide = () => { tip.hidden = true; guide.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", hide);
  box.append(svg, tip);
  $("legend").hidden = false;
}
function renderMpg() {
  const v = vehicleById(histSel.value);
  if (!v) return;
  const s = vehicleStats(fillupsFor(v.id));
  $("mpgTitle").textContent = `${v.name} MPG`;
  $("sLife").textContent = s.lifetime ? s.lifetime.toFixed(1) : "—";
  $("sLifeU").textContent = s.trips.length ? `${s.trips.reduce((a, t) => a + t.miles, 0).toLocaleString()} mi` : "";
  $("s2mo").textContent = s.twoMonth ? s.twoMonth.toFixed(1) : "—";
  $("sLast").textContent = s.latest ? s.latest.mpg.toFixed(1) : "—";
  const warn = $("mpgWarn");
  if (s.flagged) { const w = warningText(v.name, s); warn.replaceChildren(el("strong", null, w.title), document.createTextNode(w.body)); warn.hidden = false; }
  else warn.hidden = true;
  drawChart(s.trips);
  $("mpgNote").textContent =
    s.fillups === 0 ? "No fill-ups for this vehicle yet. The first one sets the starting odometer; MPG starts with the second."
    : s.fillups === 1 ? "One fill-up saved. MPG shows up after the next one."
    : `${plural(s.fillups, "fill-up")}.${s.gaps ? ` ${s.gaps === 1 ? "One stretch" : s.gaps + " stretches"} with fill-ups that weren't logged ${s.gaps === 1 ? "is" : "are"} left out of the MPG.` : ""} You'll get a warning when a fill-up's MPG is 20% or more above or below the vehicle's average.`;
}
function renderAllVehicles() {
  const box = $("allVeh"); box.replaceChildren();
  const rows = S.vehicles.map((v) => ({ v, s: vehicleStats(fillupsFor(v.id)) })).filter((x) => x.s.fillups > 0);
  if (!rows.length) { box.append(el("div", "empty", "Lifetime MPG for each vehicle shows here once it has two fill-ups.")); return; }
  for (const { v, s } of rows) {
    const row = el("div", "item");
    const life = el("div", "lifetime" + (s.flagged ? " flag" : ""), s.lifetime ? s.lifetime.toFixed(1) : "—");
    if (s.lifetime) life.append(el("span", "unit", "MPG"));
    row.append(el("div", "veh", v.name + (v.active ? "" : " (inactive)")), life,
      el("div", "meta", s.trips.length ? `${plural(s.fillups, "fill-up")} · last ${s.latest.mpg.toFixed(1)} MPG${s.flagged ? " (check)" : ""}` : `${plural(s.fillups, "fill-up")} · needs one more for MPG`));
    box.append(row);
  }
}
function renderList() {
  const list = $("list"); list.replaceChildren();
  const v = vehicleById(histSel.value);
  if (!v) return;
  const mpgById = new Map(vehicleStats(fillupsFor(v.id)).trips.map((t) => [t.id, t.mpg]));
  // Newest date first; odometer breaks ties.
  const recent = fillupsFor(v.id).sort((a, b) => cmp(b.date, a.date) || b.odometer - a.odometer).slice(0, 25);
  if (!recent.length) { list.append(el("div", "empty", `No fill-ups for the ${v.name} yet.`)); return; }
  for (const r of recent) {
    const row = el("div", "item");
    const m = mpgById.get(r.id);
    const right = el("div", "lifetime", m ? m.toFixed(1) : "—");
    if (m) right.append(el("span", "unit", "MPG"));
    const cost = +r.gallons > 0 && r.pricePerGallon != null ? r.gallons * r.pricePerGallon : null;
    row.append(el("div", "veh", `${shortDate(r.date)}${r.station ? " · " + r.station : ""}`), right,
      el("div", "meta", `${Number(r.odometer).toLocaleString()} mi · ` + (+r.gallons > 0 ? `${Number(r.gallons).toFixed(3)} gal` + (r.pricePerGallon != null ? ` @ ${money(r.pricePerGallon, 3)}` : "") + (cost != null ? ` = ${money(cost)}` : "") : "odometer reading only")));
    // "Missed": fill-ups weren't logged between the previous one and this one. That stretch is left out of the MPG.
    const acts = el("div", "acts");
    const miss = btn("del", r.missed ? "Marked missed before this fill-up (undo)" : "Mark fill-up(s) missed before this one", async () => {
      miss.disabled = true;
      try { await commit({ put: { fillups: [{ ...r, missed: !r.missed }] } }); } catch (e) { setStatus(saveErrorText(e), "err"); miss.disabled = false; }
    });
    acts.append(miss, armedButton("Delete", "Tap again to delete", () => commit({ del: { fillups: [r.id] } })));
    row.append(acts);
    list.append(row);
  }
}
function renderServices() {
  const box = $("svcList"); box.replaceChildren();
  const v = vehicleById(histSel.value);
  if (!v) return;
  const visits = new Map();
  for (const s of servicesFor(v.id)) { if (!visits.has(s.visit)) visits.set(s.visit, []); visits.get(s.visit).push(s); }
  const groups = [...visits.values()].map((g) => g.sort((a, b) => cmp(String(a.createdAt), String(b.createdAt)) || cmp(a.id, b.id)))
    .sort((a, b) => cmp(b[0].date, a[0].date) || b[0].odometer - a[0].odometer).slice(0, 25);
  if (!groups.length) { box.append(el("div", "empty", `No maintenance logged for the ${v.name} yet.`)); return; }
  for (const g of groups) {
    const s0 = g[0], row = el("div", "item");
    const names = g.map((s) => s.itemId === "other" ? (s.notes ? `Other: ${s.notes}` : s.itemName || "Other repairs") : s.itemName || s.notes);
    row.append(el("div", "veh", andList(names)), el("div", "meta", [shortDate(s0.date), mi(s0.odometer), s0.shop].filter(Boolean).join(" · ")));
    const acts = el("div", "acts");
    acts.append(armedButton("Delete", "Tap again to delete", () => commit({ del: { services: g.map((s) => s.id) } })));
    row.append(acts);
    box.append(row);
  }
}

// Maintenance: section for the chosen vehicle, banner, and the pop-up listing what's due
const isEditing = (box) => box.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
function dueText(r) {
  if (r.left < 0) return { text: `Due at ${mi(r.due)} · overdue by ${mi(-r.left)}`, cls: "over" };
  if (r.left === 0) return { text: `Due now (${mi(r.due)})`, cls: "over" };
  return { text: `Due at ${mi(r.due)} · ${mi(r.left)} to go`, cls: r.soon ? "soon" : "" };
}
function maintRow(st, r, { showLast }) {
  const row = el("div", "mrow" + (showLast && r.soon ? " soonrow" : ""));
  row.append(el("div", "mname", r.name));
  const d = dueText(r);
  row.append(el("div", "mmeta " + d.cls, d.text));
  if (showLast) {
    row.append(el("div", "mmeta", r.logged ? `Last done ${mi(r.logged.odometer)} on ${shortDate(r.logged.date)}`
      : r.assumedLast != null ? `Last done ~${mi(r.assumedLast)} (assumed)` : "Not logged yet"));
  }
  const acts = el("div", "acts");
  acts.append(btn("mbtn", "Mark done", () => openDoneForm(acts, st, r)));
  if (showLast && r.logged) acts.append(armedButton("Undo last log", "Tap again to undo", () => commit({ del: { services: [r.logged.id] } })));
  row.append(acts);
  return row;
}
function openDoneForm(acts, st, r) {
  const form = el("form", "doneform");
  const lab = el("label", null, "Done at");
  const inp = el("input");
  Object.assign(inp, { type: "number", inputMode: "numeric", min: "0", step: "1", required: true, value: String(st.odo) });
  inp.setAttribute("aria-label", `${r.name} done at odometer`);
  lab.append(inp, document.createTextNode("mi"));
  const go = el("button", "go", "Save"); go.type = "submit";
  const msg = el("span");
  form.append(lab, go, btn("mbtn quiet", "Cancel", () => form.replaceWith(acts)), msg);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const odo = intIn(inp.value);
    if (odo == null || Number.isNaN(odo)) { msg.textContent = "Enter the odometer."; return; }
    const res = makeService({ vehicleId: st.vehicleId, date: today(), odometer: odo, shop: "", itemId: r.id, itemName: r.name, notes: "" });
    if (res.error) { msg.textContent = cap(res.error) + "."; return; }
    go.disabled = true; inp.blur();
    try { await commit({ put: { services: [res.rec] } }); } catch (e) { msg.textContent = saveErrorText(e); go.disabled = false; }
  });
  acts.replaceWith(form);
  inp.focus(); inp.select();
}
function maintCarCard(st, rows, { showLast }) {
  const card = el("div", "mcar"), head = el("div", "mcar-head");
  head.append(el("strong", null, st.name), el("span", null, `${mi(st.odo)} as of ${shortDate(st.asOf)}`));
  card.append(head);
  for (const r of rows) card.append(maintRow(st, r, { showLast }));
  return card;
}
function renderMaintSection() {
  const v = vehicleById(histSel.value), sec = $("maintSec"), box = $("maintBox");
  sec.hidden = !v;
  if (!v) return;
  $("maintTitle").textContent = `${v.name} maintenance`;
  if (isEditing(box)) return;
  box.replaceChildren();
  const st = maintStatus(v.id);
  if (!st) {
    const wrap = el("div", "list"), e = el("div", "empty");
    if (!v.items.length) e.append("No maintenance schedule for this vehicle. ", btn("mbtn", "Add items", () => openVehicleDialog(v.id)));
    else e.textContent = "Log a fill-up, or add a starting odometer in Vehicles, to see what's due.";
    wrap.append(e); box.append(wrap); return;
  }
  box.append(maintCarCard(st, st.rows, { showLast: true }));
}
function renderMaintBanner() {
  const due = dueSoonAll(), b = $("mBanner");
  b.hidden = !due.length || !S.vehicles.length;
  if (due.length) $("mBannerSub").textContent = due.map((d) => `${d.name}: ${d.soon.map((r) => r.name.toLowerCase()).join(", ")}`).join(" · ");
}
function renderMaintDialog() {
  const body = $("mDlgBody");
  if (isEditing(body)) return;
  body.replaceChildren();
  const due = dueSoonAll();
  if (!due.length) { body.append(el("div", "mempty", "All caught up. Nothing is due soon.")); return; }
  for (const d of due) body.append(maintCarCard(d, d.soon, { showLast: false }));
}
function openMaint() { renderMaintDialog(); const d = $("mDialog"); if (!d.open) d.showModal(); }
const closeMaint = () => { if ($("mDialog").open) $("mDialog").close(); };
$("mBanner").addEventListener("click", openMaint);
$("mClose").addEventListener("click", closeMaint);
$("mOk").addEventListener("click", closeMaint);
$("mDialog").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) closeMaint(); });
// Pops up by itself once a day while something is due; the banner stays up meanwhile.
let autoChecked = false;
function maybeAutoOpen() {
  if (autoChecked || curScreen !== "log" || !S.vehicles.length) return;
  autoChecked = true;
  if (!dueSoonAll().length || pref.get("maintPopupDay") === today()) return;
  pref.set("maintPopupDay", today());
  openMaint();
}
function refreshMaint() {
  renderMaintBanner(); renderMaintSection();
  if ($("mDialog").open) renderMaintDialog();
}

// Nudges: back up now and then; on iPhone, use it from the Home Screen
function backupDue() {
  const n = recordCount();
  if (!n || (S.lastExport && S.lastChange && S.lastChange <= S.lastExport)) return null;
  if (!S.lastExport) return n >= 5 ? { never: true } : null;
  const days = daysAgo(isoDate(new Date(S.lastExport)));
  return days >= 30 ? { days } : null;
}
function backupDueText(due) {
  return due.never
    ? "You haven't exported a backup yet. Your records are only on this device, so if it's lost or the browser clears its data, they're gone."
    : `It's been ${due.days} days since your last backup, and you've added records since. Your data lives only on this device.`;
}
function renderNudges() {
  const due = backupDue();
  $("backupDot").hidden = !due;
  const snoozed = pref.get("nudgeSnooze", "") > today();
  $("backupNudge").hidden = !due || snoozed;
  if (due) $("backupNudgeText").textContent = backupDueText(due);
  $("iosNudge").hidden = !(isIOS && !isStandalone() && S.vehicles.length && pref.get("iosNudgeHidden") !== "1");
}
$("nudgeLater").addEventListener("click", () => {
  const d = new Date(); d.setDate(d.getDate() + 7);
  pref.set("nudgeSnooze", isoDate(d)); renderNudges();
});
$("nudgeExport").addEventListener("click", () => doExport($("status")));
$("iosNudgeLater").addEventListener("click", () => { pref.set("iosNudgeHidden", "1"); renderNudges(); });

// ---------- Vehicles screen ----------
let wiz = null; // the add-a-vehicle walkthrough: { step: 1 | 2 | 3 | "done", name, odometer, items }
const rawItem = (it) => ({ id: it.id, name: it.name, every: String(it.every), remind: String(it.remind) });

function renderVehicles() {
  const has = S.vehicles.length > 0;
  $("welcome").hidden = has;
  $("vehTitle").textContent = has ? "My vehicles" : "Welcome";
  $("vehSub").hidden = !has;
  $("iosWelcome").hidden = !(isIOS && !isStandalone());
  $("importHint").hidden = has || (wiz && wiz.step === "done");
  $("addVehicleBtn").hidden = !has || !!wiz;
  $("shopsCard").hidden = !has;
  $("vehList").hidden = !has;
  const list = $("vehList");
  list.replaceChildren();
  for (const v of S.vehicles) {
    const row = el("div", "vrow" + (v.active ? "" : " off"));
    const name = el("div", "vname", v.name);
    if (!v.active) name.append(el("span", "chip", "Inactive"));
    const f = fillupsFor(v.id).length, m = servicesFor(v.id).length, cur = latestOdo(v.id);
    const edit = btn("go", "Edit", () => openVehicleDialog(v.id));
    edit.setAttribute("aria-label", "Edit " + v.name);
    row.append(name, edit, el("div", "meta", [plural(f, "fill-up"), plural(m, "maintenance record"), cur ? mi(cur.odometer) : null].filter(Boolean).join(" · ")));
    list.append(row);
  }
  renderShops();
}
$("addVehicleBtn").addEventListener("click", () => { setMsg($("vStatus"), ""); startWizard(); });

function startWizard() {
  wiz = { step: 1, name: "", odometer: "", items: standardItems().map(rawItem) };
  renderWizard();
}
function renderWizard() {
  const box = $("wizard");
  box.hidden = !wiz;
  $("addVehicleBtn").hidden = !!wiz || !S.vehicles.length;
  $("importHint").hidden = !!S.vehicles.length || (wiz && wiz.step === "done");
  box.replaceChildren();
  if (!wiz) return;
  if (wiz.step === "done") {
    const mark = el("div", "done-mark");
    mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    const go = el("a", "save", "Log a fill-up"); go.href = "#log";
    go.addEventListener("click", () => { const id = wiz.id; wiz = null; renderWizard(); setTimeout(() => { selectVehicle(id); openEntry(false); }, 0); });
    box.append(mark, el("h2", null, `${wiz.name} is ready`),
      el("p", "hint", "When you fill up, tap Add fill-up on the Log screen and enter the odometer, $/gallon and gallons. MPG shows up after your second fill-up."),
      go, btn("link", "Add another vehicle", startWizard), btn("link", "Close", () => { wiz = null; renderWizard(); }));
    box.querySelector("a").focus({ preventScroll: true });
    return;
  }
  const steps = el("ol", "steps"); steps.setAttribute("aria-hidden", "true");
  for (let i = 1; i <= 3; i++) steps.append(el("li", i <= wiz.step ? "on" : ""));
  const form = el("form", "stack"); form.noValidate = true;
  const msg = el("div", "status"); msg.setAttribute("role", "status");
  const nav = el("div", "wiz-btns");
  const next = el("button", "save", wiz.step === 3 ? "Add vehicle" : "Next"); next.type = "submit";
  const back = wiz.step > 1 ? btn("btn2", "Back", () => { wiz.step--; renderWizard(); })
    : S.vehicles.length ? btn("btn2", "Cancel", () => { wiz = null; renderWizard(); }) : null;
  if (back) nav.append(back);
  nav.append(next);
  let field = null;
  if (wiz.step === 1) {
    field = el("input"); Object.assign(field, { type: "text", id: "wName", value: wiz.name, maxLength: 80, autocomplete: "off", placeholder: "e.g. 2019 Honda Civic" });
    field.addEventListener("input", () => { wiz.name = field.value; });
    const lab = el("label", null, "Vehicle name"); lab.htmlFor = "wName"; lab.append(field);
    form.append(el("p", "stepnum", "Step 1 of 3"), el("h2", null, "What do you drive?"), lab, el("p", "hint", "Year, make and model works well. You can rename it later."), msg, nav);
  } else if (wiz.step === 2) {
    field = el("input"); Object.assign(field, { type: "number", id: "wOdo", value: wiz.odometer, inputMode: "numeric", min: "0", step: "1", placeholder: "Optional" });
    field.addEventListener("input", () => { wiz.odometer = field.value; });
    const lab = el("label", null, "Odometer (miles)"); lab.htmlFor = "wOdo"; lab.append(field);
    form.append(el("p", "stepnum", "Step 2 of 3"), el("h2", null, "What does the odometer say?"), lab,
      el("p", "hint", "Used for maintenance reminders until your first fill-up. Leave it blank if you're not near the vehicle."), msg, nav);
  } else {
    form.append(el("p", "stepnum", "Step 3 of 3"), el("h2", null, "Maintenance schedule"),
      el("p", "hint", "A standard schedule for normal driving. Change the miles to match your owner's manual, remove what doesn't apply, or add your own. You can edit it later."),
      schedEditor(wiz.items), msg, nav);
  }
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fail = (t) => setMsg(msg, t, "err");
    if (wiz.step === 1) {
      const name = cleanText(wiz.name, 80);
      if (!name) return fail("Enter a name for the vehicle.");
      if (S.vehicles.some((v) => lower(v.name) === lower(name))) return fail(`You already have a vehicle called ${name}. Use a different name.`);
      wiz.name = name; wiz.step = 2; renderWizard(); return;
    }
    if (wiz.step === 2) {
      if (Number.isNaN(intIn(wiz.odometer))) return fail("Enter the odometer as a whole number of miles, or leave it blank.");
      wiz.step = 3; renderWizard(); return;
    }
    const sched = readSchedule(wiz.items);
    if (sched.error) return fail(sched.error);
    const odometer = intIn(wiz.odometer);
    const r = makeVehicle({ name: wiz.name, odometer, odometerDate: odometer != null ? today() : "", items: sched.items });
    if (r.error) return fail(cap(r.error) + ".");
    next.disabled = true;
    try {
      await commit({ put: { vehicles: [r.rec] } });
      selectVehicle(r.rec.id); renderLog();
      wiz = { step: "done", id: r.rec.id, name: r.rec.name };
      renderWizard(); renderVehicles();
    } catch (e) { fail(saveErrorText(e)); next.disabled = false; }
  });
  box.append(steps, form);
  if (field) field.focus({ preventScroll: true });
}

// Schedule editor: rows of name / every / remind, edited in place on a list of plain (string) items.
function schedEditor(items) {
  const wrap = el("div", "stack-sm"), list = el("div", "sched");
  const draw = () => {
    list.replaceChildren();
    if (!items.length) list.append(el("div", "sched-empty", "No items. Add one, or reset to the standard schedule."));
    items.forEach((it, i) => {
      const row = el("div", "srow");
      const name = el("input"); Object.assign(name, { type: "text", value: it.name, maxLength: 80, placeholder: "Item name" });
      name.setAttribute("aria-label", "Item name");
      const rm = btn("xbtn", "×", () => { items.splice(i, 1); draw(); });
      rm.setAttribute("aria-label", "Remove " + (it.name || "item"));
      name.addEventListener("input", () => { it.name = name.value; rm.setAttribute("aria-label", "Remove " + (name.value || "item")); });
      const nums = el("div", "nums");
      const numField = (label, key) => {
        const l = el("label"), inp = el("input");
        Object.assign(inp, { type: "number", inputMode: "numeric", min: "0", step: "1", value: it[key] });
        inp.addEventListener("input", () => { it[key] = inp.value; });
        l.append(label, inp);
        return l;
      };
      nums.append(numField("Every (mi)", "every"), numField("Remind before (mi)", "remind"));
      row.append(name, rm, nums);
      list.append(row);
    });
  };
  draw();
  const acts = el("div", "sched-acts");
  acts.append(
    btn("mbtn", "Add item", () => { items.push({ id: "", name: "", every: "", remind: "" }); draw(); list.lastElementChild.querySelector("input").focus(); }),
    btn("mbtn quiet", "Reset to standard schedule", () => { items.splice(0, items.length, ...standardItems().map(rawItem)); draw(); }));
  wrap.append(list, acts);
  return wrap;
}
function readSchedule(items) {
  const out = [], names = new Set();
  for (const it of items) {
    if (!String(it.name).trim() && !String(it.every).trim() && !String(it.remind).trim()) continue; // blank row
    const every = intIn(it.every);
    const remind = String(it.remind).trim() === "" ? (every <= 15000 ? 1000 : 5000) : intIn(it.remind);
    const r = makeItem({ id: it.id, name: it.name, every, remind });
    if (r.error) return { error: cap(r.error) + "." };
    if (names.has(lower(r.rec.name))) return { error: `“${r.rec.name}” is listed twice.` };
    names.add(lower(r.rec.name));
    out.push(r.rec);
  }
  return { items: out };
}

// Edit vehicle dialog: rename, inactive, starting odometer, schedule, delete
let editing = null;
function openVehicleDialog(id) {
  const v = vehicleById(id);
  if (!v) return;
  editing = { id, items: v.items.map(rawItem) };
  $("vName").value = v.name;
  $("vInactive").checked = !v.active;
  $("vOdo").value = v.odometer ?? "";
  $("vSched").replaceChildren(schedEditor(editing.items));
  setMsg($("vDlgStatus"), "");
  $("vDialog").showModal();
  $("vName").blur();
}
const closeVehicleDialog = () => { editing = null; if ($("vDialog").open) $("vDialog").close(); };
$("vClose").addEventListener("click", closeVehicleDialog);
$("vCancel").addEventListener("click", closeVehicleDialog);
$("vForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fail = (t) => setMsg($("vDlgStatus"), t, "err");
  const v = editing && vehicleById(editing.id);
  if (!v) return closeVehicleDialog();
  const name = cleanText($("vName").value, 80);
  if (!name) return fail("Enter a name for the vehicle.");
  if (S.vehicles.some((o) => o.id !== v.id && lower(o.name) === lower(name))) return fail(`You already have a vehicle called ${name}.`);
  const odometer = intIn($("vOdo").value);
  if (Number.isNaN(odometer)) return fail("Enter the starting odometer as a whole number of miles, or leave it blank.");
  const sched = readSchedule(editing.items);
  if (sched.error) return fail(sched.error);
  const odometerDate = odometer == null ? "" : odometer === v.odometer && v.odometerDate ? v.odometerDate : today();
  const r = makeVehicle({ ...v, name, active: !$("vInactive").checked, odometer, odometerDate, items: sched.items });
  if (r.error) return fail(cap(r.error) + ".");
  try {
    await commit({ put: { vehicles: [r.rec] } });
    closeVehicleDialog();
    setMsg($("vStatus"), `Saved ${name}.`, "ok");
  } catch (e) { fail(saveErrorText(e)); }
});
$("vDelete").addEventListener("click", async () => {
  const v = editing && vehicleById(editing.id);
  if (!v) return;
  const f = fillupsFor(v.id), m = servicesFor(v.id);
  if (f.length || m.length) {
    const ok = await askDialog({ title: `Delete ${v.name}?`,
      body: `This also deletes its ${andList([f.length && plural(f.length, "fill-up"), m.length && plural(m.length, "maintenance record")])}. This can't be undone. If you might want them later, export a backup first.`,
      ok: "Delete", danger: true });
    if (!ok) return;
  }
  try {
    await commit({ del: { vehicles: [v.id], fillups: f.map((x) => x.id), services: m.map((x) => x.id) } });
    closeVehicleDialog();
    setMsg($("vStatus"), `Deleted ${v.name}.`);
  } catch (e) { setMsg($("vDlgStatus"), saveErrorText(e), "err"); }
});

// Shops
function shopNameError(raw, except = -1) {
  const name = cleanText(raw, 80);
  if (!name) return "Enter a shop name.";
  if (S.shops.some((s, i) => i !== except && lower(s) === lower(name))) return `${name} is already in your list.`;
  return null;
}
function renderShops() {
  const ul = $("shopList");
  if (ul.contains(document.activeElement)) return;
  ul.replaceChildren();
  if (!S.shops.length) ul.append(el("li", "none", "No shops yet."));
  S.shops.forEach((name, i) => {
    const li = el("li"), inp = el("input");
    Object.assign(inp, { type: "text", value: name, maxLength: 80 });
    inp.setAttribute("aria-label", "Shop name");
    inp.addEventListener("change", async () => {
      const err = shopNameError(inp.value, i);
      if (err) { setMsg($("shopStatus"), err, "err"); inp.value = name; return; }
      const next = [...S.shops]; next[i] = cleanText(inp.value, 80);
      try { await commit({ settings: { shops: next } }); setMsg($("shopStatus"), "Saved."); } catch (e) { setMsg($("shopStatus"), saveErrorText(e), "err"); }
    });
    const rm = btn("xbtn", "×", async () => {
      try { await commit({ settings: { shops: S.shops.filter((_, j) => j !== i) } }); setMsg($("shopStatus"), `Removed ${name}. Maintenance already logged there keeps the name.`); }
      catch (e) { setMsg($("shopStatus"), saveErrorText(e), "err"); }
    });
    rm.setAttribute("aria-label", "Remove " + name);
    li.append(inp, rm);
    ul.append(li);
  });
}
$("shopAdd").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = shopNameError($("shopNew").value);
  if (err) return setMsg($("shopStatus"), err, "err");
  try {
    await commit({ settings: { shops: [...S.shops, cleanText($("shopNew").value, 80)] } });
    $("shopNew").value = ""; setMsg($("shopStatus"), "");
  } catch (e) { setMsg($("shopStatus"), saveErrorText(e), "err"); }
});

// ---------- Backup screen ----------
function renderBackup() {
  if (S.lastExport) {
    const d = isoDate(new Date(S.lastExport));
    $("lastExp").textContent = `Last exported: ${longDate(d)} (${agoText(daysAgo(d))})`;
  } else $("lastExp").textContent = "Last exported: never";
  const due = backupDue();
  $("expReminder").hidden = !due;
  if (due) $("expReminder").textContent = backupDueText(due);
  $("expCounts").textContent = `On this device: ${andList([plural(S.vehicles.length, "vehicle"), plural(S.fillups.length, "fill-up"), plural(S.services.length, "maintenance record")])}.`;
  $("exportBtn").disabled = !S.vehicles.length && !S.shops.length;
  $("expHow").textContent = isIOS ? "Opens the share sheet so you can AirDrop it, email it to yourself or save it to Files."
    : isAndroid ? "Opens the share sheet so you can email it to yourself or save it to Drive or Files."
    : `Saves ${exportFileName()} to your Downloads folder. It opens in Excel.`;
  renderStorage();
  renderInstall();
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = el("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function markExported() {
  await save({ settings: { lastExport: nowISO() } }, { touch: false });
  bc?.postMessage("changed");
  renderAll();
}
// Build the file right away (no waiting), so the share sheet still counts as a response to the tap.
async function doExport(statusNode) {
  if (!S.vehicles.length && !S.shops.length) return setMsg(statusNode, "Nothing to export yet.", "err");
  const name = exportFileName();
  const blob = new Blob(["\ufeff" + buildCSV()], { type: "text/csv;charset=utf-8" }); // the BOM tells Excel it's UTF-8
  if (isMobile && navigator.share && navigator.canShare) {
    const file = new File([blob], name, { type: "text/csv" });
    let can = false;
    try { can = navigator.canShare({ files: [file] }); } catch {}
    if (can) {
      try {
        await navigator.share({ files: [file], title: name });
        await markExported();
        return setMsg(statusNode, `Exported ${name}.`, "ok");
      } catch (e) {
        if (e && e.name === "AbortError") return setMsg(statusNode, "Export cancelled.");
        // Sharing failed for another reason: fall back to a download.
      }
    }
  }
  downloadBlob(blob, name);
  await markExported();
  setMsg(statusNode, `Exported ${name}.${isMobile ? "" : " It's in your Downloads folder."}`, "ok");
}
$("exportBtn").addEventListener("click", () => doExport($("expStatus")));

// Import: pick a file, check it, preview, then Merge or Replace
let pendingImport = null; // { name, an }
$("importFile").addEventListener("change", async () => {
  const file = $("importFile").files[0];
  $("importFile").value = "";
  if (!file) return;
  setMsg($("impStatus"), "");
  pendingImport = null;
  if (file.size > 20 * 1024 * 1024) { setMsg($("impStatus"), `This file is too big (${(file.size / 1048576).toFixed(0)} MB) to be a backup from this app.`, "err"); renderImportPreview(); return; }
  let text;
  try { text = await readTextFile(file); } catch { setMsg($("impStatus"), "Couldn't read that file. Try choosing it again.", "err"); renderImportPreview(); return; }
  pendingImport = { name: file.name, an: analyzeImport(text) };
  renderImportPreview();
  $("impPreview").scrollIntoView({ block: "nearest", behavior: "smooth" });
});
const clearImport = () => { pendingImport = null; renderImportPreview(); };
function countsText(v, f, m, extra = []) {
  return andList([v && plural(v, "vehicle"), f && plural(f, "fill-up"), m && plural(m, "maintenance record"), ...extra]);
}
function renderImportPreview() {
  const box = $("impPreview");
  box.replaceChildren();
  box.hidden = !pendingImport;
  if (!pendingImport) return;
  const { name, an } = pendingImport;
  const pv = el("div", "pv");
  pv.append(el("h3", null, name));
  if (an.fatal) {
    pv.append(el("p", "status err", an.fatal), btn("btn2", "Choose another file", () => { clearImport(); $("importFile").click(); }));
    box.append(pv); return;
  }
  const merge = planImport(an, "merge"), replace = planImport(an, "replace");
  // Usable records only: rows listed as bad below aren't counted.
  const inFile = countsText(an.vehicles.length, merge.fillups.length + merge.dupFillups, merge.services.length + merge.dupServices, [an.shops.length && plural(an.shops.length, "shop")]);
  pv.append(el("p", null, `In this file: ${inFile || "no usable records"}.`));

  const dups = merge.dupFillups + merge.dupServices;
  const mAdds = countsText(merge.newVehicles.length, merge.fillups.length, merge.services.length,
    [merge.shopsAdded && plural(merge.shopsAdded, "shop"), merge.itemsAdded && plural(merge.itemsAdded, "schedule item")]);
  const mo = el("div", "opt");
  mo.append(el("strong", null, "Merge"),
    el("span", null, mAdds ? `Adds ${mAdds}. Nothing on this device is changed or removed.` : "Adds nothing: everything in this file is already on this device."),
    el("span", "hint", dups ? `Skips ${plural(dups, "duplicate")} (${andList([merge.dupFillups && plural(merge.dupFillups, "fill-up"), merge.dupServices && plural(merge.dupServices, "maintenance record")])}).` : "No duplicates found."));
  if (merge.vehiclesMatched) mo.append(el("span", "hint", `${plural(merge.vehiclesMatched, "vehicle")} in the file ${merge.vehiclesMatched === 1 ? "is" : "are"} already on this device; their records are added to the existing ${merge.vehiclesMatched === 1 ? "one" : "ones"}.`));
  const ro = el("div", "opt");
  const here = countsText(S.vehicles.length, S.fillups.length, S.services.length);
  const rAdds = countsText(replace.newVehicles.length, replace.fillups.length, replace.services.length, [replace.shops.length && plural(replace.shops.length, "shop")]);
  ro.append(el("strong", null, "Replace everything"),
    el("span", null, (here ? `Deletes this device's ${here}, then loads ` : "Loads ") + (rAdds || "nothing") + " from the file."));
  if (replace.dupFillups) ro.append(el("span", "hint", `Skips ${plural(replace.dupFillups, "duplicate fill-up")} listed twice in the file.`));
  if (replace.bad.length > merge.bad.length) ro.append(el("span", "hint", `Also skips ${plural(replace.bad.length - merge.bad.length, "row")} for vehicles that are on this device but not in the file.`));
  pv.append(mo, ro);

  const bad = [...an.bad, ...merge.bad].sort((a, b) => a.line - b.line);
  if (bad.length) {
    const al = el("div", "alert bad");
    al.append(el("strong", null, `${plural(bad.length, "row")} can't be used and will be skipped`));
    const ul = el("ul", "badrows");
    for (const b of bad.slice(0, 50)) { const li = el("li"); li.append(el("b", null, `Line ${b.line}: `), b.msg); ul.append(li); }
    if (bad.length > 50) ul.append(el("li", null, `…and ${bad.length - 50} more.`));
    al.append(ul);
    pv.append(al);
  }
  const btns = el("div", "pv-btns");
  const mb = btn("save", "Merge", () => runImport("merge"));
  mb.disabled = merge.adds === 0;
  const rb = btn("btn2", "Replace everything…", () => runImport("replace"));
  rb.disabled = replace.adds === 0;
  btns.append(mb, rb, btn("link", "Cancel", () => { clearImport(); setMsg($("impStatus"), "Import cancelled. Nothing was saved."); }));
  pv.append(btns);
  box.append(pv);
}
async function runImport(mode) {
  if (!pendingImport) return;
  const { an } = pendingImport;
  if (mode === "replace") {
    const here = countsText(S.vehicles.length, S.fillups.length, S.services.length);
    const ok1 = await askDialog({ title: "Replace everything on this device?",
      body: here ? `This deletes the ${here} on this device and loads the file in their place.` : "This loads the file in place of anything on this device.", ok: "Continue" });
    if (!ok1) return;
    const ok2 = await askDialog({ title: "Are you sure?",
      body: "This can't be undone. If you might need what's on this device, cancel and export a backup of it first.", ok: "Delete and replace", danger: true });
    if (!ok2) return;
  }
  const plan = planImport(an, mode); // worked out again in case anything changed since the preview
  for (const b of $("impPreview").querySelectorAll("button")) b.disabled = true;
  try { await applyImport(plan); }
  catch (e) {
    setMsg($("impStatus"), `Couldn't import${e && e.message ? ` (${e.message})` : ""}. Nothing was changed.`, "err");
    renderImportPreview(); return;
  }
  bc?.postMessage("changed");
  pendingImport = null;
  renderAll(); renderImportPreview();
  persistOnce();
  const added = countsText(plan.newVehicles.length, plan.fillups.length, plan.services.length);
  const dups = plan.dupFillups + plan.dupServices, bad = an.bad.length + plan.bad.length;
  const skipped = andList([dups && plural(dups, "duplicate"), bad && plural(bad, "bad row")]);
  const st = $("impStatus");
  setMsg(st, `${mode === "replace" ? "Replaced. Loaded" : "Merged. Added"} ${added || "nothing new"}.${skipped ? ` Skipped ${skipped}.` : ""} `, "ok");
  const go = el("a", null, "Go to Log"); go.href = "#log";
  st.append(go);
}

// Storage and install
function renderStorage() {
  const t = $("storageText");
  if (persistState === true) t.textContent = "This browser has agreed to keep this app's data, so it won't be cleared to free up space. Clearing the browser's website data would still delete it, and it's only on this device, so keep exporting backups.";
  else if (isIOS && !isStandalone()) t.textContent = "You're using this in a Safari tab. Safari can clear data for websites you haven't opened in a while. Add it to your Home Screen (see below) and use it from there.";
  else if (persistState === false) t.textContent = "This browser hasn't promised to keep this app's data, so it could clear it if the device runs low on space. Installing the app (below) usually helps. Either way, export a backup now and then.";
  else t.textContent = "Your data is stored in this browser. Clearing the browser's history or website data deletes it, so keep a backup.";
}
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { installEvt = e; renderInstall(); });
window.addEventListener("appinstalled", () => { installEvt = null; renderInstall(); persistOnce(); });
$("installBtn").addEventListener("click", async () => {
  if (!installEvt) return;
  try { await installEvt.prompt(); await installEvt.userChoice; } catch {}
  installEvt = null; renderInstall();
});
function renderInstall() {
  $("installBtn").hidden = !installEvt || isStandalone();
  $("installLead").textContent = isStandalone() ? "You're using the installed app. To put it on another device, open the same link there and follow the steps below."
    : "Installing gives it its own icon, opens it full screen and lets it work offline.";
}

// ---------- Start ----------
async function boot() {
  try { await openDB(); await reload(); }
  catch {
    $("fatal").textContent = "This browser won't let the app save data here, so it can't run. If you're in a private or incognito window, open it in a normal one.";
    $("fatal").hidden = false;
    return;
  }
  showInactive.checked = pref.get("showInactive") === "1";
  const saved = vehicleById(pref.get("vehicle"));
  if (saved && !saved.active) showInactive.checked = true;
  const platform = isIOS ? "install-ios" : isAndroid ? "install-android" : /Mac/.test(navigator.platform) ? "install-mac" : /Win/.test(navigator.platform) ? "install-windows" : null;
  if (platform && !isStandalone()) $(platform).open = true;
  renderAll();
  route();
  if (navigator.storage?.persisted) { try { persistState = await navigator.storage.persisted(); } catch {} renderStorage(); }
  if (S.vehicles.length || recordCount()) persistOnce();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderAll(); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
}
boot();
