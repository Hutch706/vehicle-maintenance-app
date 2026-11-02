"use strict";
/* Vehicle Maintenance App: the data layer. No screens in here.
   - Storage: IndexedDB in this browser. No server, no accounts.
   - Math: MPG and maintenance due mileage.
   - Backup: CSV export and import (with a preview plan before anything is saved).
   app.js loads after this file and builds the screens on top of it. */

// ---------- Small helpers ----------
const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => isoDate(new Date());
const nowISO = () => new Date().toISOString();
const lower = (s) => String(s ?? "").trim().toLowerCase();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // plain comparison: the same on every device and language
function newId(prefix) {
  const a = new Uint8Array(5);
  crypto.getRandomValues(a);
  return prefix + "_" + Date.now().toString(36) + Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("");
}
function validISODate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2100 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const isWhole = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const isNum = (n, lo, hi) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
// Text is trimmed, runs of spaces collapsed and length capped. Running it twice gives the same result,
// which keeps export -> import -> export identical.
const cleanText = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim();
const cleanNotes = (s, max) => String(s ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max).trim();

// ---------- Standard maintenance schedule ----------
// Common intervals for normal driving. Every new vehicle gets its own copy, which the user can edit.
// every = miles between services; remind = start showing it as "due soon" this many miles before.
const STANDARD_SCHEDULE = [
  { id: "oil", name: "Oil & filter change", every: 5000, remind: 1000 },
  { id: "rotate", name: "Tire rotation", every: 5000, remind: 1000 },
  { id: "cabin", name: "Cabin air filter", every: 15000, remind: 1000 },
  { id: "airfilter", name: "Engine air filter", every: 30000, remind: 5000 },
  { id: "brakefluid", name: "Brake fluid flush", every: 30000, remind: 5000 },
  { id: "transfluid", name: "Transmission fluid", every: 60000, remind: 5000 },
  { id: "plugs", name: "Spark plugs", every: 60000, remind: 5000 },
  { id: "coolant", name: "Engine coolant", every: 100000, remind: 5000 },
];
const standardItems = () => STANDARD_SCHEDULE.map((it) => ({ ...it }));

// ---------- Records ----------
// Every record is built by one of these, whether it comes from a form or an imported file,
// so a record always has exactly the same shape. Each returns { rec } or { error }.
const MAX_ODO = 9999999;
const opt = (x) => (x == null || x === "" ? null : x);

function makeItem(it) {
  const name = cleanText(it.name, 80);
  if (!name) return { error: "a maintenance item needs a name" };
  if (!isWhole(it.every, 1, 999999)) return { error: `“${name}” needs a whole number of miles between services` };
  if (!isWhole(it.remind, 0, 999999)) return { error: `“${name}” needs a whole number of miles for the reminder` };
  return { rec: { id: cleanText(it.id, 60) || newId("i"), name, every: it.every, remind: it.remind } };
}
function makeVehicle(v) {
  const name = cleanText(v.name, 80);
  if (!name) return { error: "the vehicle needs a name" };
  const odometer = opt(v.odometer);
  if (odometer != null && !isWhole(odometer, 0, MAX_ODO)) return { error: "the starting odometer must be a whole number of miles" };
  const odometerDate = odometer == null ? "" : String(v.odometerDate || "");
  if (odometerDate && !validISODate(odometerDate)) return { error: "the starting odometer date isn't a real date" };
  const items = [];
  for (const it of v.items || []) { const r = makeItem(it); if (r.error) return r; items.push(r.rec); }
  return { rec: { id: cleanText(v.id, 60) || newId("v"), name, active: v.active !== false, odometer, odometerDate, items, createdAt: v.createdAt || nowISO() } };
}
function makeFillup(f) {
  if (!validISODate(f.date)) return { error: "the date isn't a real date" };
  if (!isWhole(f.odometer, 0, MAX_ODO)) return { error: "the odometer must be a whole number of miles" };
  const gallons = opt(f.gallons), pricePerGallon = opt(f.pricePerGallon), total = opt(f.total);
  if (gallons != null && !isNum(gallons, 0, 999)) return { error: "gallons must be a number from 0 to 999" };
  if (pricePerGallon != null && !isNum(pricePerGallon, 0, 99.999)) return { error: "$/gallon must be a number from 0 to 99.999" };
  if (total != null && !isNum(total, 0, 99999)) return { error: "the receipt total must be a number from 0 to 99,999" };
  return { rec: { id: cleanText(f.id, 60) || newId("f"), vehicleId: f.vehicleId, date: f.date, odometer: f.odometer, gallons, pricePerGallon, total,
    station: cleanText(f.station, 80), missed: !!f.missed, createdAt: f.createdAt || nowISO() } };
}
function makeService(s) {
  if (!validISODate(s.date)) return { error: "the date isn't a real date" };
  if (!isWhole(s.odometer, 0, MAX_ODO)) return { error: "the odometer must be a whole number of miles" };
  const itemName = cleanText(s.itemName, 120), notes = cleanNotes(s.notes, 2000);
  if (!itemName && !notes) return { error: "it needs a maintenance item or a note" };
  return { rec: { id: cleanText(s.id, 60) || newId("m"), vehicleId: s.vehicleId, date: s.date, odometer: s.odometer, shop: cleanText(s.shop, 80),
    itemId: cleanText(s.itemId, 60) || "other", itemName, notes, visit: cleanText(s.visit, 60) || newId("x"), createdAt: s.createdAt || nowISO() } };
}
const fillupKey = (f) => `${f.vehicleId}|${f.date}|${f.odometer}`;
const serviceKey = (s) => [s.vehicleId, s.date, s.odometer, s.itemId, lower(s.itemName), s.notes].join("|");

// ---------- Storage (IndexedDB) ----------
// Stores: vehicles, fillups, services (maintenance log), settings ({ key, value }: shops, lastExport, lastChange).
const DB_NAME = "vehicle-maintenance-app";
const OLD_DB_NAME = "fillup-receipts"; // where data was kept when the app was called Fill-Up Receipts
const DB_VERSION = 1;
let idb = null;
const S = { vehicles: [], fillups: [], services: [], shops: [], lastExport: null, lastChange: null };

function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function openDB() {
  return new Promise((res, rej) => {
    if (!("indexedDB" in self)) { rej(new Error("no-indexeddb")); return; }
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ["vehicles", "fillups", "services"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id" });
      if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings", { keyPath: "key" });
    };
    r.onsuccess = () => { idb = r.result; idb.onversionchange = () => idb.close(); res(moveFromOldName().catch(() => {}).then(() => idb)); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error("blocked"));
  });
}
// One-time move: if this browser has data saved under the app's old name and nothing under the new one,
// copy it over, then remove the old copy. Opening the old name never creates it if it isn't there.
function openIfExists(name) {
  return new Promise((res) => {
    let r;
    try { r = indexedDB.open(name); } catch { res(null); return; }
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch {} };
    r.onsuccess = () => res(r.result);
    r.onerror = (e) => { e.preventDefault?.(); res(null); };
    r.onblocked = () => res(null);
  });
}
async function moveFromOldName() {
  const stores = ["vehicles", "fillups", "services", "settings"];
  const counts = await Promise.all(stores.map((s) => reqP(idb.transaction(s).objectStore(s).count())));
  if (counts.some((n) => n > 0)) return;
  const old = await openIfExists(OLD_DB_NAME);
  if (!old) return;
  const have = stores.filter((s) => old.objectStoreNames.contains(s));
  const data = {};
  try { for (const s of have) data[s] = await reqP(old.transaction(s).objectStore(s).getAll()); }
  finally { old.close(); }
  if (have.length) {
    await new Promise((res, rej) => {
      const t = idb.transaction(have, "readwrite");
      for (const s of have) for (const rec of data[s]) t.objectStore(s).put(rec);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  indexedDB.deleteDatabase(OLD_DB_NAME);
}
const getAll = (store) => reqP(idb.transaction(store).objectStore(store).getAll());
const byCreated = (a, b) => cmp(String(a.createdAt), String(b.createdAt)) || cmp(a.id, b.id);

async function reload() {
  const [v, f, s, settings] = await Promise.all(["vehicles", "fillups", "services", "settings"].map(getAll));
  S.vehicles = v.sort(byCreated);
  S.fillups = f;
  S.services = s;
  const set = Object.fromEntries(settings.map((x) => [x.key, x.value]));
  S.shops = Array.isArray(set.shops) ? set.shops : [];
  S.lastExport = set.lastExport || null;
  S.lastChange = set.lastChange || null;
}

// Saves a set of changes in one transaction (all or nothing), then reloads S.
// changes = { clear: [stores], del: { store: [ids] }, put: { store: [records] }, settings: { key: value } }
async function save(changes, { touch = true } = {}) {
  const stores = new Set(["settings", ...(changes.clear || []), ...Object.keys(changes.del || {}), ...Object.keys(changes.put || {})]);
  await new Promise((res, rej) => {
    const t = idb.transaction([...stores], "readwrite");
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error("The save was cancelled."));
    try {
      for (const s of changes.clear || []) t.objectStore(s).clear();
      for (const [s, ids] of Object.entries(changes.del || {})) for (const id of ids) t.objectStore(s).delete(id);
      for (const [s, recs] of Object.entries(changes.put || {})) for (const r of recs) t.objectStore(s).put(r);
      for (const [k, v] of Object.entries(changes.settings || {})) t.objectStore("settings").put({ key: k, value: v });
      if (touch) t.objectStore("settings").put({ key: "lastChange", value: nowISO() });
    } catch (e) { try { t.abort(); } catch {} rej(e); }
  });
  await reload();
}

// Ask the browser not to clear this site's data when space runs low. Returns true, false or null (not supported).
async function askPersist() {
  if (!navigator.storage?.persist) return null;
  try { return (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch { return false; }
}

const vehicleById = (id) => S.vehicles.find((v) => v.id === id) || null;
const fillupsFor = (id) => S.fillups.filter((f) => f.vehicleId === id);
const servicesFor = (id) => S.services.filter((s) => s.vehicleId === id);
const recordCount = () => S.fillups.length + S.services.length;

// ---------- MPG math ----------
// Trip = this fill-up's odometer minus the previous one's; MPG = trip / gallons bought at this fill-up.
// Lifetime and 2-month MPG are total miles / total gallons, so long trips weigh more than short ones.
const WARN_PCT = 0.20;  // warn when a fill-up is this far above or below the vehicle's average
// A stretch whose MPG is far above the vehicle's usual (median) MPG means fill-ups in between weren't logged,
// so it's left out. It adapts to each vehicle, so a hybrid isn't flagged for being efficient.
const GAP_RATIO = 1.6, GAP_MIN_TRIPS = 4;

function twoMonthsBefore(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 3, d)).toISOString().slice(0, 10);
}
function ratio(trips) { const m = trips.reduce((s, t) => s + t.miles, 0), g = trips.reduce((s, t) => s + t.gallons, 0); return g > 0 ? m / g : null; }
function median(xs) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }

function vehicleStats(recs) {
  // Every fill-up is a reference point; one with no gallons is just an odometer reading.
  const sorted = recs.filter((r) => Number.isFinite(+r.odometer))
    .sort((a, b) => a.odometer - b.odometer || cmp(String(a.date), String(b.date)) || cmp(String(a.createdAt), String(b.createdAt)));
  const cands = [];
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    if (!(+r.gallons > 0)) continue;
    const miles = r.odometer - sorted[i - 1].odometer;
    if (miles > 0) cands.push({ r, miles, mpg: miles / r.gallons });
  }
  const usual = cands.length >= GAP_MIN_TRIPS ? median(cands.filter((c) => !c.r.missed).map((c) => c.mpg)) : null;
  const trips = [];
  let gaps = 0;
  for (const c of cands) {
    if (c.r.missed || (usual && c.mpg > usual * GAP_RATIO)) { gaps++; continue; }
    trips.push({ id: c.r.id, date: c.r.date, odometer: c.r.odometer, miles: c.miles, gallons: +c.r.gallons, mpg: c.mpg });
  }
  for (const t of trips) { const from = twoMonthsBefore(t.date); t.running = ratio(trips.filter((u) => u.date >= from && u.date <= t.date)); }
  const latest = trips[trips.length - 1] || null;
  const priorAvg = ratio(trips.slice(0, -1));
  const deviation = latest && priorAvg ? (latest.mpg - priorAvg) / priorAvg : null;
  return { fillups: sorted.length, gaps, trips, lifetime: ratio(trips), twoMonth: latest ? latest.running : null, latest, priorAvg,
    deviation, flagged: deviation != null && Math.abs(deviation) >= WARN_PCT };
}

// ---------- Maintenance math ----------
function latestOdo(vehicleId) {
  let best = null;
  const v = vehicleById(vehicleId);
  if (v && v.odometer != null) best = { odometer: v.odometer, date: v.odometerDate || String(v.createdAt).slice(0, 10) };
  for (const r of [...S.fillups, ...S.services]) {
    const o = +r.odometer;
    if (r.vehicleId === vehicleId && Number.isFinite(o) && (!best || o > best.odometer)) best = { odometer: o, date: r.date };
  }
  return best;
}
// Until a service is logged, assume it was done at the last regular interval (e.g. oil every 5,000: last at 85,000).
const scheduledDue = (it, odo) => Math.max(it.every, Math.ceil(odo / it.every) * it.every);
function lastLogged(vehicleId, itemId) {
  let best = null;
  for (const s of S.services) {
    if (s.vehicleId !== vehicleId || s.itemId !== itemId) continue;
    if (!best || s.odometer > best.odometer || (s.odometer === best.odometer && cmp(String(s.createdAt), String(best.createdAt)) > 0)) best = s;
  }
  return best;
}
function maintStatus(vehicleId) {
  const v = vehicleById(vehicleId), cur = latestOdo(vehicleId);
  if (!v || !v.items.length || !cur) return null;
  const rows = v.items.map((it) => {
    const logged = lastLogged(vehicleId, it.id);
    const due = logged ? logged.odometer + it.every : scheduledDue(it, cur.odometer);
    const assumedLast = logged || due - it.every <= 0 ? null : due - it.every;
    const left = due - cur.odometer;
    return { ...it, logged, assumedLast, due, left, soon: left <= it.remind };
  }).sort((a, b) => a.left - b.left);
  return { vehicleId, name: v.name, odo: cur.odometer, asOf: cur.date, rows, soon: rows.filter((r) => r.soon) };
}
const dueSoonAll = () => S.vehicles.filter((v) => v.active).map((v) => maintStatus(v.id)).filter((s) => s && s.soon.length);

// ---------- CSV export ----------
// One file with everything: vehicles and their schedules, shops, fill-ups and the maintenance log.
// record_type says what each row is. Dates are YYYY-MM-DD. Columns that don't apply to a row are left blank.
const CSV_COLUMNS = ["record_type", "vehicle", "date", "odometer", "gallons", "price_per_gallon", "total", "station", "missed",
  "shop", "item", "notes", "every_mi", "remind_mi", "active", "vehicle_id", "item_id", "visit", "id", "created_at"];
const CSV_TEXT = new Set(["vehicle", "station", "shop", "item", "notes"]);
// Excel runs text starting with = + - @ as a formula. Such text gets a leading ' on export, removed again on import.
const FORMULA_START = /^'*[=+\-@\t\r]/;

function csvCell(col, value) {
  let s = value == null ? "" : String(value);
  if (CSV_TEXT.has(col) && FORMULA_START.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCSV() {
  const lines = [CSV_COLUMNS.join(",")];
  const add = (o) => lines.push(CSV_COLUMNS.map((c) => csvCell(c, o[c])).join(","));
  const order = new Map(S.vehicles.map((v, i) => [v.id, i]));
  const vName = (id) => vehicleById(id)?.name ?? "";
  const byVehicleThenDate = (a, b) => (order.get(a.vehicleId) ?? 1e9) - (order.get(b.vehicleId) ?? 1e9) || cmp(a.date, b.date)
    || a.odometer - b.odometer || cmp(String(a.createdAt), String(b.createdAt)) || cmp(a.id, b.id);
  for (const v of S.vehicles) add({ record_type: "vehicle", vehicle: v.name, date: v.odometerDate, odometer: v.odometer, active: v.active ? "yes" : "no", vehicle_id: v.id, created_at: v.createdAt });
  for (const v of S.vehicles) for (const it of v.items) add({ record_type: "schedule", vehicle: v.name, item: it.name, every_mi: it.every, remind_mi: it.remind, vehicle_id: v.id, item_id: it.id });
  for (const s of S.shops) add({ record_type: "shop", shop: s });
  for (const f of [...S.fillups].sort(byVehicleThenDate)) add({ record_type: "fillup", vehicle: vName(f.vehicleId), date: f.date, odometer: f.odometer, gallons: f.gallons,
    price_per_gallon: f.pricePerGallon, total: f.total, station: f.station, missed: f.missed ? "yes" : "", vehicle_id: f.vehicleId, id: f.id, created_at: f.createdAt });
  for (const m of [...S.services].sort(byVehicleThenDate)) add({ record_type: "maintenance", vehicle: vName(m.vehicleId), date: m.date, odometer: m.odometer, shop: m.shop,
    item: m.itemName, notes: m.notes, vehicle_id: m.vehicleId, item_id: m.itemId, visit: m.visit, id: m.id, created_at: m.createdAt });
  return lines.join("\r\n") + "\r\n";
}
const exportFileName = () => `vehicle-maintenance-app-${today()}.csv`;

// ---------- CSV import: reading the file ----------
async function readTextFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { text = new TextDecoder("windows-1252").decode(buf); } // Excel's plain "CSV (Comma delimited)"
  return text.replace(/^\ufeff/, "");
}
// Comma, semicolon (Excel in many European languages) or tab, whichever the header row uses most.
function detectDelimiter(text) {
  const first = text.split(/\r\n|\n|\r/, 1)[0] || "";
  let best = ",", n = -1;
  for (const d of [",", ";", "\t"]) { const c = first.split(d).length - 1; if (c > n) { best = d; n = c; } }
  return best;
}
// RFC 4180 parser. Each row remembers the line it starts on, so errors can point at a line number.
function parseCSV(text, delim) {
  const rows = [];
  let row = [], field = "", inQ = false, line = 1, rowLine = 1, i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++;
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { inQ = true; i++; continue; }
    if (c === delim) { row.push(field); field = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      row.push(field); rows.push({ cells: row, line: rowLine });
      row = []; field = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++; line++; rowLine = line; continue;
    }
    field += c; i++;
  }
  if (inQ) return { rows, unclosedAt: rowLine };
  if (field !== "" || row.length) { row.push(field); rows.push({ cells: row, line: rowLine }); }
  return { rows, unclosedAt: null };
}
function normalizeHeader(h) {
  const k = String(h).replace(/^\ufeff/, "").trim().toLowerCase().replace(/[\s\-/.]+/g, "_").replace(/[^a-z0-9_$]/g, "");
  return { record: "record_type", type: "record_type", recordtype: "record_type", record_kind: "record_type", kind: "record_type" }[k] || k;
}
// Numbers: tolerate $ signs and thousands separators. With semicolon files, a comma is the decimal point.
function parseNumber(raw, decimalComma, whole) {
  let s = String(raw).replace(/[\s$\u00a0]/g, "");
  if (!s) return null;
  if (whole && /^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");
  else if (decimalComma) { if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); }
  else s = s.replace(/,(?=\d{3}(\D|$))/g, "");
  return /^-?(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN;
}
function parseBool(raw, dflt) {
  const s = lower(raw);
  if (!s) return dflt;
  if (["yes", "y", "true", "1", "x", "✓"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return undefined;
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Dates: YYYY-MM-DD, or what Excel writes after re-saving: M/D/YYYY (or D/M/YYYY in other languages), 14-Oct-26, serial numbers.
function parseDateCell(raw, dayFirst) {
  const s = String(raw).trim();
  if (!s) return { iso: null };
  let y, m, d, t;
  if ((t = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/))) [, y, m, d] = t;
  else if ((t = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?: .*)?$/))) {
    const a = +t[1], b = +t[2];
    y = t[3];
    [m, d] = dayFirst || s.includes(".") ? [b, a] : [a, b];
  } else if ((t = s.match(/^(\d{1,2})[-\s]([a-z]{3,})\.?[-\s,]+(\d{4}|\d{2})$/i)) && MONTHS.includes(t[2].slice(0, 3).toLowerCase())) {
    [d, m, y] = [t[1], MONTHS.indexOf(t[2].slice(0, 3).toLowerCase()) + 1, t[3]];
  } else if ((t = s.match(/^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/i)) && MONTHS.includes(t[1].slice(0, 3).toLowerCase())) {
    [m, d, y] = [MONTHS.indexOf(t[1].slice(0, 3).toLowerCase()) + 1, t[2], t[3]];
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000);
    return validISODate(dt.toISOString().slice(0, 10)) ? { iso: dt.toISOString().slice(0, 10) } : { error: true };
  } else return { error: true };
  if (String(y).length === 2) y = (+y < 70 ? 2000 : 1900) + +y;
  const iso = `${String(y).padStart(4, "0")}-${pad2(+m)}-${pad2(+d)}`;
  return validISODate(iso) ? { iso } : { error: true };
}
function parseTimestamp(raw) {
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s)) return s; // ours: keep exactly
  const t = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/); // Excel: M/D/YYYY H:MM
  const ms = t ? new Date(+t[3], +t[1] - 1, +t[2], +t[4], +t[5], +(t[6] || 0)).getTime() : Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
const unFormula = (s) => (/^'+[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

// ---------- CSV import: checking every row ----------
// Returns what's in the file plus any bad rows (with line numbers). Nothing is saved here.
const TYPE_NAMES = { vehicle: "vehicle", vehicles: "vehicle", schedule: "schedule", maintenance_item: "schedule", shop: "shop", shops: "shop",
  fillup: "fillup", "fill-up": "fillup", fill_up: "fillup", fillups: "fillup", maintenance: "maintenance", service: "maintenance" };

function analyzeImport(text) {
  const out = { fatal: null, bad: [], vehicles: [], schedule: [], shops: [], fillups: [], services: [], rows: 0 };
  if (!text.trim()) { out.fatal = "This file is empty."; return out; }
  if (/[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 4000))) { out.fatal = "This isn't a CSV file. Choose the .csv file you exported from Vehicle Maintenance App."; return out; }
  const delim = detectDelimiter(text);
  const { rows, unclosedAt } = parseCSV(text, delim);
  const hi = rows.findIndex((r) => r.cells.some((c) => c.trim()));
  if (hi < 0) { out.fatal = "This file is empty."; return out; }
  const col = {};
  rows[hi].cells.map(normalizeHeader).forEach((h, i) => { if (h && !(h in col)) col[h] = i; });
  if (!("record_type" in col)) {
    out.fatal = "This doesn't look like a Vehicle Maintenance App backup. Its first row should be the column names, starting with record_type.";
    return out;
  }
  const decimalComma = delim === ";";
  const cell = (r, name) => (col[name] == null ? "" : String(r.cells[col[name]] ?? "").trim());
  const text1 = (r, name) => unFormula(cell(r, name));
  const data = rows.slice(hi + 1).filter((r) => r.cells.some((c) => c.trim()));
  out.rows = data.length;

  // Day-first dates (D/M/YYYY) if any slash date in the file can only be read that way.
  let df = 0, mf = 0;
  for (const r of data) {
    const t = cell(r, "date").match(/^(\d{1,2})[/\-](\d{1,2})[/\-]\d{2,4}/);
    if (t) { if (+t[1] > 12) df++; if (+t[2] > 12) mf++; }
  }
  const dayFirst = df > 0 && mf === 0;
  const bad = (r, msg) => out.bad.push({ line: r.line, msg });
  const num = (r, name, label, whole) => {
    const raw = cell(r, name), v = parseNumber(raw, decimalComma, whole);
    if (Number.isNaN(v)) return { error: `${label} “${raw}” isn't a number` };
    if (whole && v != null && !Number.isInteger(v)) return { error: `${label} “${raw}” must be a whole number` };
    return { v };
  };
  const date = (r) => {
    const raw = cell(r, "date"), d = parseDateCell(raw, dayFirst);
    return d.error ? { error: `date “${raw}” isn't a real date` } : { v: d.iso };
  };
  const ref = (r) => ({ id: cell(r, "vehicle_id"), name: text1(r, "vehicle") });
  const baseTime = Date.now();

  const fileById = new Map(), fileByName = new Map();
  // Vehicle rows first, so the other rows can refer to them wherever they are in the file.
  data.forEach((r, idx) => {
    if (TYPE_NAMES[lower(cell(r, "record_type"))] !== "vehicle") return;
    const o = num(r, "odometer", "odometer", true);
    if (o.error) return bad(r, `Vehicle: ${o.error}.`);
    const d = cell(r, "date") ? date(r) : { v: "" };
    if (d.error) return bad(r, `Vehicle: ${d.error}.`);
    const active = parseBool(cell(r, "active"), true);
    if (active === undefined) return bad(r, `Vehicle: active should be yes or no, not “${cell(r, "active")}”.`);
    const id = cell(r, "vehicle_id"), name = text1(r, "vehicle");
    const twin = (id && fileById.get(id)) || fileByName.get(lower(name));
    if (twin) return bad(r, `Vehicle “${name}” is already listed on line ${twin.line}.`);
    const res = makeVehicle({ id, name, active, odometer: o.v, odometerDate: d.v || (o.v != null ? today() : ""), items: [],
      createdAt: parseTimestamp(cell(r, "created_at")) || new Date(baseTime + idx).toISOString() });
    if (res.error) return bad(r, `Vehicle: ${res.error}.`);
    const fv = { rec: res.rec, line: r.line };
    out.vehicles.push(fv);
    fileById.set(res.rec.id, fv); fileByName.set(lower(res.rec.name), fv);
  });
  const resolveFile = (rf) => (rf.id && fileById.get(rf.id)) || (rf.name && fileByName.get(lower(rf.name))) || null;
  const seenShops = new Set(), visitKeys = new Map();

  data.forEach((r, idx) => {
    const rawType = cell(r, "record_type"), type = TYPE_NAMES[lower(rawType)];
    if (type === "vehicle") return;
    if (!type) return bad(r, rawType ? `record_type “${rawType}” isn't one of vehicle, schedule, shop, fillup or maintenance.` : "record_type is blank.");
    if (type === "shop") {
      const name = cleanText(text1(r, "shop"), 80);
      if (!name) return bad(r, "Shop: the shop name is blank.");
      if (!seenShops.has(lower(name))) { seenShops.add(lower(name)); out.shops.push(name); }
      return;
    }
    const rf = ref(r);
    if (!rf.id && !rf.name) return bad(r, `${type === "fillup" ? "Fill-up" : type === "schedule" ? "Schedule" : "Maintenance"}: the vehicle is blank.`);
    const fv = resolveFile(rf);
    const vref = fv ? { file: fv } : { id: rf.id, name: rf.name };
    const created = parseTimestamp(cell(r, "created_at")) || new Date(baseTime + idx).toISOString();
    if (type === "schedule") {
      const every = num(r, "every_mi", "every_mi", true), remind = num(r, "remind_mi", "remind_mi", true);
      const e = every.error || remind.error;
      if (e) return bad(r, `Schedule: ${e}.`);
      const res = makeItem({ id: cell(r, "item_id"), name: text1(r, "item"), every: every.v, remind: remind.v ?? (every.v != null && every.v <= 15000 ? 1000 : 5000) });
      if (res.error) return bad(r, `Schedule: ${res.error}.`);
      out.schedule.push({ vref, rec: res.rec, line: r.line });
    } else if (type === "fillup") {
      const d = date(r), o = num(r, "odometer", "odometer", true), g = num(r, "gallons", "gallons"), p = num(r, "price_per_gallon", "price_per_gallon"), t = num(r, "total", "total");
      const e = (cell(r, "date") ? d.error : "the date is blank") || (cell(r, "odometer") ? o.error : "the odometer is blank") || g.error || p.error || t.error;
      if (e) return bad(r, `Fill-up: ${e}.`);
      const missed = parseBool(cell(r, "missed"), false);
      if (missed === undefined) return bad(r, `Fill-up: missed should be yes or blank, not “${cell(r, "missed")}”.`);
      const res = makeFillup({ id: cell(r, "id"), vehicleId: "", date: d.v, odometer: o.v, gallons: g.v, pricePerGallon: p.v, total: t.v,
        station: text1(r, "station"), missed, createdAt: created });
      if (res.error) return bad(r, `Fill-up: ${res.error}.`);
      out.fillups.push({ vref, rec: res.rec, line: r.line });
    } else {
      const d = date(r), o = num(r, "odometer", "odometer", true);
      const e = (cell(r, "date") ? d.error : "the date is blank") || (cell(r, "odometer") ? o.error : "the odometer is blank");
      if (e) return bad(r, `Maintenance: ${e}.`);
      const shop = text1(r, "shop");
      // Rows without a visit id are grouped into one visit by vehicle, date, odometer and shop.
      const vk = [rf.id || lower(rf.name), d.v, o.v, lower(shop)].join("|");
      if (!visitKeys.has(vk)) visitKeys.set(vk, "~" + visitKeys.size);
      const res = makeService({ id: cell(r, "id"), vehicleId: "", date: d.v, odometer: o.v, shop, itemId: cell(r, "item_id") || "?", itemName: text1(r, "item"),
        notes: unFormula(cell(r, "notes")), visit: cell(r, "visit") || visitKeys.get(vk), createdAt: created });
      if (res.error) return bad(r, `Maintenance: ${res.error}.`);
      out.services.push({ vref, rec: res.rec, rawItemId: cell(r, "item_id"), line: r.line });
    }
  });
  if (unclosedAt) out.bad.push({ line: unclosedAt, msg: "A quote mark on this line is never closed, so the rest of the file can't be read." });
  out.bad.sort((a, b) => a.line - b.line);
  if (!out.vehicles.length && !out.fillups.length && !out.services.length && !out.schedule.length && !out.shops.length && !out.bad.length)
    out.fatal = "There are no records in this file.";
  return out;
}

// ---------- CSV import: what Merge or Replace would do ----------
// Merge keeps everything on this device and adds what's new. A fill-up is a duplicate when the vehicle, date
// and odometer match. Replace deletes everything here first. Rows for vehicles that can't be found are bad rows.
function planImport(an, mode) {
  const merge = mode === "merge";
  const plan = { mode, newVehicles: [], changedVehicles: new Map(), shops: merge ? [...S.shops] : [], fillups: [], services: [],
    vehiclesMatched: 0, itemsAdded: 0, shopsAdded: 0, dupFillups: 0, dupServices: 0, bad: [] };
  const devById = new Map(merge ? S.vehicles.map((v) => [v.id, v]) : []);
  const devByName = new Map(merge ? S.vehicles.map((v) => [lower(v.name), v]) : []);
  const target = new Map(); // file vehicle -> vehicle record being written (new, or a copy of one on this device)

  for (const fv of an.vehicles) {
    const dev = devById.get(fv.rec.id) || devByName.get(lower(fv.rec.name));
    if (dev) { plan.vehiclesMatched++; target.set(fv, dev); }
    else { const v = { ...fv.rec, items: [] }; plan.newVehicles.push(v); target.set(fv, v); }
  }
  // A vehicle record that can be changed: a new one, or a copy of the device's (only saved if something changes).
  const writable = (v) => {
    if (plan.newVehicles.includes(v)) return v;
    if (!plan.changedVehicles.has(v.id)) plan.changedVehicles.set(v.id, { ...v, items: [...v.items] });
    return plan.changedVehicles.get(v.id);
  };
  const resolve = (vref) => {
    if (vref.file) return target.get(vref.file);
    return (vref.id && devById.get(vref.id)) || (vref.name && devByName.get(lower(vref.name))) || null;
  };
  const current = (v) => plan.changedVehicles.get(v.id) || v;
  const noVehicle = (x, what) => plan.bad.push({ line: x.line, msg: `${what}: vehicle “${x.vref.name || x.vref.id}” isn't in this file${merge ? " or on this device" : ""}.` });

  for (const s of an.schedule) {
    const v = resolve(s.vref);
    if (!v) { noVehicle(s, "Schedule"); continue; }
    if (current(v).items.some((it) => it.id === s.rec.id || lower(it.name) === lower(s.rec.name))) continue;
    writable(v).items.push({ ...s.rec });
    if (!plan.newVehicles.includes(v)) plan.itemsAdded++;
  }
  for (const name of an.shops) {
    if (plan.shops.some((x) => lower(x) === lower(name))) continue;
    plan.shops.push(name);
    if (merge) plan.shopsAdded++;
  }
  const fKeys = new Set(merge ? S.fillups.map(fillupKey) : []), fIds = new Set(merge ? S.fillups.map((f) => f.id) : []);
  for (const f of an.fillups) {
    const v = resolve(f.vref);
    if (!v) { noVehicle(f, "Fill-up"); continue; }
    const rec = { ...f.rec, vehicleId: v.id };
    const key = fillupKey(rec);
    if (fKeys.has(key)) { plan.dupFillups++; continue; }
    if (fIds.has(rec.id)) rec.id = newId("f");
    fKeys.add(key); fIds.add(rec.id);
    plan.fillups.push(rec);
  }
  const sKeys = new Set(merge ? S.services.map(serviceKey) : []), sIds = new Set(merge ? S.services.map((s) => s.id) : []);
  const visits = new Map();
  for (const s of an.services) {
    const v = resolve(s.vref);
    if (!v) { noVehicle(s, "Maintenance"); continue; }
    const rec = { ...s.rec, vehicleId: v.id };
    if (!s.rawItemId) rec.itemId = current(v).items.find((it) => lower(it.name) === lower(rec.itemName))?.id || "other";
    if (rec.visit.startsWith("~")) { if (!visits.has(rec.visit)) visits.set(rec.visit, newId("x")); rec.visit = visits.get(rec.visit); }
    // Same id = same record. Same content as one already on this device = duplicate. Two rows in the file with
    // different ids are kept, since they were separate records on the device that exported them.
    if (sIds.has(rec.id) || sKeys.has(serviceKey(rec))) { plan.dupServices++; continue; }
    sIds.add(rec.id);
    plan.services.push(rec);
  }
  plan.bad.sort((a, b) => a.line - b.line);
  plan.adds = plan.newVehicles.length + plan.changedVehicles.size + plan.shopsAdded + plan.fillups.length + plan.services.length + (merge ? 0 : plan.shops.length);
  return plan;
}

async function applyImport(plan) {
  const changes = {
    put: { vehicles: [...plan.newVehicles, ...plan.changedVehicles.values()], fillups: plan.fillups, services: plan.services },
    settings: { shops: plan.shops },
  };
  if (plan.mode === "replace") changes.clear = ["vehicles", "fillups", "services"];
  await save(changes);
}
