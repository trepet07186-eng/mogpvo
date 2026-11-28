window.onerror = function(msg, url, line) {
  const h = document.getElementById("hintText");
  if (h) { h.textContent = "Ошибка JS (стр. " + line + "): " + msg; h.style.color = "#f87171"; }
};

const R_EARTH = 6371000;
const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => (r * 180 / Math.PI + 360) % 360;

function calcDistance(lat1, lon1, lat2, lon2) {
  const f1 = toRad(lat1), f2 = toRad(lat2), df = toRad(lat2 - lat1), dl = toRad(lon2 - lon1);
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcBearing(lat1, lon1, lat2, lon2) {
  const f1 = toRad(lat1), f2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return toDeg(Math.atan2(y, x));
}

function destPoint(lat, lon, brngDeg, distMeters) {
  const d = distMeters / R_EARTH, t = toRad(brngDeg), f1 = toRad(lat), l1 = toRad(lon);
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return { lat: f2 * 180 / Math.PI, lng: ((l2 * 180 / Math.PI + 540) % 360) - 180 };
}

function intersectBearings(p1, brng1, p2, brng2) {
  const f1 = toRad(p1.lat), l1 = toRad(p1.lng), f2 = toRad(p2.lat), l2 = toRad(p2.lng);
  const t13 = toRad(brng1), t23 = toRad(brng2), df = f2 - f1, dl = l2 - l1;
  const d12 = 2 * Math.asin(Math.sqrt(Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2));
  if (d12 === 0) return null;
  let ta = Math.acos((Math.sin(f2) - Math.sin(f1) * Math.cos(d12)) / (Math.sin(d12) * Math.cos(f1)));
  let tb = Math.acos((Math.sin(f1) - Math.sin(f2) * Math.cos(d12)) / (Math.sin(d12) * Math.cos(f2)));
  if (isNaN(ta) || isNaN(tb)) return null;
  const t12 = Math.sin(dl) > 0 ? ta : 2 * Math.PI - ta;
  const t21 = Math.sin(dl) > 0 ? 2 * Math.PI - tb : tb;
  const a1 = ((t13 - t12 + Math.PI) % (2 * Math.PI)) - Math.PI;
  const a2 = ((t21 - t23 + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (Math.sin(a1) * Math.sin(a2) <= 0) return null;
  const a3 = Math.acos(-Math.cos(a1) * Math.cos(a2) + Math.sin(a1) * Math.sin(a2) * Math.cos(d12));
  const d13 = Math.atan2(Math.sin(d12) * Math.sin(a1) * Math.sin(a2), Math.cos(a2) + Math.cos(a1) * Math.cos(a3));
  const f3 = Math.asin(Math.sin(f1) * Math.cos(d13) + Math.cos(f1) * Math.sin(d13) * Math.cos(t13));
  const dl13 = Math.atan2(Math.sin(t13) * Math.sin(d13) * Math.cos(f1), Math.cos(d13) - Math.sin(f1) * Math.sin(f3));
  const res = { lat: f3 * 180 / Math.PI, lng: (((l1 + dl13) * 180 / Math.PI + 540) % 360) - 180 };
  return calcDistance(p1.lat, p1.lng, res.lat, res.lng) > 50000 ? null : res;
}

function buildSectorPolygon(lat, lng, startDeg, endDeg, radiusM) {
  const pts = Array.of(L.latLng(lat, lng));
  let span = (endDeg - startDeg + 360) % 360;
  if (span === 0) span = 360;
  const steps = Math.max(10, Math.ceil(span / 4));
  for (let i = 0; i <= steps; i++) {
    const p = destPoint(lat, lng, (startDeg + (span * i) / steps) % 360, radiusM);
    pts.push(L.latLng(p.lat, p.lng));
  }
  pts.push(L.latLng(lat, lng));
  return pts;
}

const map = L.map("map", { zoomControl: false }).setView(L.latLng(56.6344, 47.8999), 12);
const uEsri = "https://server." + "arcgisonline." + "com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const uRef  = "https://server." + "arcgisonline." + "com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const uOsm  = "https://tile." + "openstreetmap." + "org/{z}/{x}/{y}.png";

const layers = {
  hybrid: L.layerGroup(Array.of(L.tileLayer(uEsri, { maxZoom: 19 }), L.tileLayer(uRef, { maxZoom: 19 }))),
  dark: L.tileLayer(uOsm, { maxZoom: 19, className: "dark-tiles" }),
  light: L.tileLayer(uOsm, { maxZoom: 19 })
};
let currentLayer = layers.hybrid.addTo(map);
document.getElementById("mapTheme").onchange = (e) => {
  if (currentLayer) map.removeLayer(currentLayer);
  currentLayer = Reflect.get(layers, e.target.value).addTo(map);
};

let mogsState = {};
for (let i = 1; i <= 12; i++) Reflect.set(mogsState, i, { id: i, blue: null, green: null, sector: null });
let targets = new Array(), nextTargetId = 1, isDay = true, targetsMoving = false;
let currentRole = "cmd", clickMode = "greenMog";
let pendingGreenPt = null, tempTargetStart = null, tempTargetMarker = null, selectedTargetForAssign = null;

const unitsLayer = L.layerGroup().addTo(map);
const routesLayer = L.layerGroup().addTo(map);
const targetsLayer = L.layerGroup().addTo(map);
const vectorsLayer = L.layerGroup().addTo(map);
const triRaysLayer = L.layerGroup().addTo(map);
const hintText = document.getElementById("hintText");
const routeBanner = document.getElementById("routeBanner");

function getMyMogId() { return currentRole.startsWith("mog_") ? Number(currentRole.slice(4)) : null; }
let lastRouteKey = "";
async function updateRoadRoute(mog) {
  routesLayer.clearLayers();
  const myId = getMyMogId();
  if (!myId || myId !== mog.id || !mog.blue || !mog.green) {
    routeBanner.style.display = "none";
    lastRouteKey = "";
    return;
  }
  const distDirect = calcDistance(mog.blue.lat, mog.blue.lng, mog.green.lat, mog.green.lng);
  if (distDirect <= 50) {
    mog.blue = { lat: mog.green.lat, lng: mog.green.lng };
    mog.green = null;
    routeBanner.style.display = "block";
    routeBanner.style.background = "rgba(3, 105, 161, 0.95)";
    routeBanner.textContent = "✅ МОГ-" + mog.id + ": Вы прибыли на позицию (<= 50 м).";
    setTimeout(() => { if (!mog.green) routeBanner.style.display = "none"; }, 4000);
    broadcastState();
    renderAll();
    return;
  }
  routeBanner.style.display = "block";
  routeBanner.style.background = "rgba(20, 83, 45, 0.95)";
  const key = mog.blue.lat.toFixed(4) + "," + mog.blue.lng.toFixed(4) + "->" + mog.green.lat.toFixed(4) + "," + mog.green.lng.toFixed(4);
  if (key === lastRouteKey && window._cachedRouteCoords) {
    L.polyline(window._cachedRouteCoords, { color: "#4ade80", weight: 5, opacity: 0.85 }).addTo(routesLayer);
    return;
  }
  lastRouteKey = key;
  try {
    const u = "https://router." + "project-osrm." + "org/route/v1/driving/" + mog.blue.lng + "," + mog.blue.lat + ";" + mog.green.lng + "," + mog.green.lat + "?overview=full&geometries=geojson";
    const data = await (await fetch(u)).json();
    if (data.routes && data.routes.length > 0) {
      const r = Reflect.get(data.routes, 0);
      window._cachedRouteCoords = r.geometry.coordinates.map((c) => L.latLng(Reflect.get(c, 1), Reflect.get(c, 0)));
      L.polyline(window._cachedRouteCoords, { color: "#4ade80", weight: 5, opacity: 0.9 }).addTo(routesLayer);
      routeBanner.textContent = "🚙 МАРШ МОГ-" + mog.id + ": " + (r.distance / 1000).toFixed(1) + " км • ~" + Math.max(1, Math.round(r.duration / 60)) + " мин (" + Math.round(distDirect) + " м)";
      return;
    }
  } catch (e) {}
  window._cachedRouteCoords = Array.of(L.latLng(mog.blue.lat, mog.blue.lng), L.latLng(mog.green.lat, mog.green.lng));
  L.polyline(window._cachedRouteCoords, { color: "#4ade80", weight: 4, dashArray: "8,8" }).addTo(routesLayer);
  routeBanner.textContent = "🚙 МАРШ МОГ-" + mog.id + ": направление • " + Math.round(distDirect) + " м";
}

function renderUnitsAndSectors() {
  unitsLayer.clearLayers();
  const detectR = isDay ? 4000 : 1000, myId = getMyMogId();
  Object.values(mogsState).forEach((m) => {
    if (!m.blue && !m.green) return;
    const showDet = (currentRole === "cmd" || myId === m.id);
    const activePos = m.green || m.blue;
    if (showDet && activePos) {
      const cPos = L.latLng(activePos.lat, activePos.lng);
      L.circle(cPos, { radius: detectR, color: "#38bdf8", weight: 1.2, dashArray: "8,8", fillOpacity: 0.01, interactive: false }).addTo(unitsLayer);
      L.circle(cPos, { radius: 1000, color: "#94a3b8", weight: 1.5, dashArray: "5,6", fillOpacity: 0.01, interactive: false }).addTo(unitsLayer);
      if (m.sector && m.sector.from !== null && m.sector.to !== null) {
        const allowPoly = buildSectorPolygon(activePos.lat, activePos.lng, Number(m.sector.to), Number(m.sector.from), 1000);
        L.polygon(allowPoly, { color: "#22c55e", weight: 2.5, fillColor: "#22c55e", fillOpacity: 0.24, interactive: false }).addTo(unitsLayer);
      } else {
        L.circle(cPos, { radius: 1000, color: "#22c55e", weight: 2, fillColor: "#22c55e", fillOpacity: 0.16, interactive: false }).addTo(unitsLayer);
      }
    }
    if (m.blue) {
      const bm = L.circleMarker(L.latLng(m.blue.lat, m.blue.lng), { radius: 9, color: "#fff", weight: 2, fillColor: "#0284c7", fillOpacity: 1 }).addTo(unitsLayer);
      bm.bindTooltip("МОГ-" + m.id + " (ФАКТ)", { permanent: true, direction: "top", offset: L.point(0, -6), className: "mog-lbl-blue" });
      bm.on("click", (ev) => { L.DomEvent.stopPropagation(ev); handleMogClick(m.id); });
    }
    if (m.green) {
      const gm = L.circleMarker(L.latLng(m.green.lat, m.green.lng), { radius: 9, color: "#fff", weight: 2, fillColor: "#16a34a", fillOpacity: 1 }).addTo(unitsLayer);
      gm.bindTooltip("МОГ-" + m.id + " (ПЛАН)", { permanent: true, direction: "bottom", offset: L.point(0, 8), className: "mog-lbl-green" });
      gm.on("click", (ev) => { L.DomEvent.stopPropagation(ev); handleMogClick(m.id); });
      if (m.blue) L.polyline(Array.of(L.latLng(m.blue.lat, m.blue.lng), L.latLng(m.green.lat, m.green.lng)), { color: "#4ade80", weight: 1.5, dashArray: "4,6", opacity: 0.7 }).addTo(unitsLayer);
    }
  });
  const myMog = myId ? Reflect.get(mogsState, myId) : null;
  if (myMog) updateRoadRoute(myMog);
  else { routesLayer.clearLayers(); routeBanner.style.display = "none"; }
}
function handleMogClick(mogId) {
  if (currentRole !== "cmd" || clickMode !== "assign") return;
  if (!selectedTargetForAssign) { hintText.textContent = "Сначала нажмите на ЦЕЛЬ, затем на МОГ!"; return; }
  const tgt = targets.find((t) => t.id === selectedTargetForAssign);
  if (tgt) {
    tgt.assignedMogId = (tgt.assignedMogId === mogId) ? null : mogId;
    hintText.textContent = tgt.assignedMogId ? "✅ ЦУ: Ц-" + tgt.id + " -> МОГ-" + mogId : "ЦУ снято";
  }
  selectedTargetForAssign = null; setClickMode("greenMog"); broadcastState(); renderAll();
}

function renderTargetsAndVectors() {
  targetsLayer.clearLayers(); vectorsLayer.clearLayers();
  const listEl = document.getElementById("infoList"), myId = getMyMogId();
  let html = "";
  targets.forEach((t) => {
    const isSel = (selectedTargetForAssign === t.id), tPos = L.latLng(t.lat, t.lng);
    const tm = L.circleMarker(tPos, { radius: isSel ? 11 : 8, color: isSel ? "#fff" : "#ffd23f", weight: 2.5, fillColor: "#dc2626", fillOpacity: 1 }).addTo(targetsLayer);
    tm.bindTooltip(t.assignedMogId ? ("Ц-" + t.id + " -> М" + t.assignedMogId) : ("ЦЕЛЬ-" + t.id), { permanent: true, direction: "bottom", offset: L.point(0, 10), className: "vec-lbl-red" });
    tm.on("click", (ev) => { L.DomEvent.stopPropagation(ev); selectedTargetForAssign = (selectedTargetForAssign === t.id) ? null : t.id; updateClearTargetsBtn(); hintText.textContent = selectedTargetForAssign ? ("Выбрана ЦЕЛЬ-" + t.id + ". Нажмите «Удалить» или кликните снова.") : "Выделение снято."; renderTargetsAndVectors(); });
    const tip = destPoint(t.lat, t.lng, t.heading, 650);
    L.polyline(Array.of(tPos, L.latLng(tip.lat, tip.lng)), { color: "#ffd23f", weight: 3 }).addTo(targetsLayer);
    Object.values(mogsState).forEach((m) => {
      const pos = m.blue || m.green;
      if (!pos || (myId && myId !== m.id)) return;
      const az = Math.round(calcBearing(pos.lat, pos.lng, t.lat, t.lng));
      const dist = Math.round(calcDistance(pos.lat, pos.lng, t.lat, t.lng));
      const isAsg = (t.assignedMogId === m.id);
      L.polyline(Array.of(L.latLng(pos.lat, pos.lng), tPos), { color: isAsg ? "#ef4444" : "#38bdf8", weight: isAsg ? 3.5 : 2, dashArray: "7,7", opacity: 0.95 }).addTo(vectorsLayer);
      L.marker(L.latLng((pos.lat + t.lat) / 2, (pos.lng + t.lng) / 2), { interactive: false, icon: L.divIcon({ className: "", html: '<span class="' + (isAsg ? 'vec-lbl-red' : 'vec-lbl') + '">М' + m.id + '→Ц' + t.id + ': ' + String(az).padStart(3, "0") + '° (' + dist + 'м)</span>' }) }).addTo(vectorsLayer);
      const det = isDay ? 4000 : 1000;
      html += '<div class="card ' + (isAsg ? 'assigned' : (dist <= det ? 'zone-detect' : '')) + '"><div style="font-weight:800; color:' + (isAsg ? '#f87171' : '#38bdf8') + ';">МОГ-' + m.id + ' → Ц-' + t.id + (isAsg ? ' 🎯 ВАША ЦЕЛЬ' : '') + '</div><div class="card-big">Аз: ' + String(az).padStart(3, "0") + '°</div><div class="card-sub">Дальность: ' + dist + ' м</div></div>';
    });
  });
  listEl.innerHTML = html || '<div style="font-size:12px; color:#64748b; grid-column:1/-1;">Нет активных целей или позиций МОГ.</div>';
}

function renderAll() { renderUnitsAndSectors(); renderTargetsAndVectors(); }

document.getElementById("roleSelect").onchange = (e) => {
  currentRole = e.target.value;
  const isCmd = (currentRole === "cmd");
  document.querySelectorAll(".cmd-only").forEach((el) => el.style.display = isCmd ? "inline-block" : "none");
  document.querySelectorAll(".mog-only").forEach((el) => el.style.display = isCmd ? "none" : "inline-block");
  if (isCmd) setClickMode("greenMog");
  else {
    setClickMode("simMoveMog");
    const m = Reflect.get(mogsState, getMyMogId());
    if (m && (m.blue || m.green)) map.panTo(L.latLng((m.blue || m.green).lat, (m.blue || m.green).lng));
  }
  renderAll();
};

function setClickMode(m) {
  clickMode = m;
  Array.of("modeGreenMog", "modeTarget2Pt", "modeAssign", "modeSimMoveMog").forEach((id) => document.getElementById(id).classList.remove("active"));
  document.getElementById(m === "greenMog" ? "modeGreenMog" : m === "target2pt" ? "modeTarget2Pt" : m === "assign" ? "modeAssign" : "modeSimMoveMog").classList.add("active");
  if (tempTargetMarker) { map.removeLayer(tempTargetMarker); tempTargetMarker = null; tempTargetStart = null; }
}

document.getElementById("modeGreenMog").onclick = () => setClickMode("greenMog");
document.getElementById("modeTarget2Pt").onclick = () => setClickMode("target2pt");
document.getElementById("modeAssign").onclick = () => { selectedTargetForAssign = null; setClickMode("assign"); };
document.getElementById("modeSimMoveMog").onclick = () => setClickMode("simMoveMog");
document.getElementById("btnGpsNow").onclick = () => {
  const id = getMyMogId(); if (!id || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((p) => {
    Reflect.get(mogsState, id).blue = { lat: p.coords.latitude, lng: p.coords.longitude };
    map.setView(L.latLng(p.coords.latitude, p.coords.longitude), 14);
    broadcastState(); renderAll();
  });
};

map.on("click", (e) => { if (selectedTargetForAssign !== null) { selectedTargetForAssign = null; updateClearTargetsBtn(); renderTargetsAndVectors(); }
  const lat = e.latlng.lat, lng = e.latlng.lng;
  if (currentRole === "cmd" && clickMode === "greenMog") {
    let freeId = 1;
    for (let i = 1; i <= 12; i++) if (!Reflect.get(mogsState, i).green && !Reflect.get(mogsState, i).blue) { freeId = i; break; }
    const chosenId = Number(prompt("Номер МОГ (1..12):", String(freeId)));
    if (!chosenId || chosenId < 1 || chosenId > 12) return;
    pendingGreenPt = { id: chosenId, lat: lat, lng: lng };
    const sec = Reflect.get(mogsState, chosenId).sector;
    document.getElementById("sectorModalTitle").textContent = "МОГ-" + chosenId + ": сектор запрета (1000 м)";
    document.getElementById("secFrom").value = sec ? sec.from : "";
    document.getElementById("secTo").value = sec ? sec.to : "";
    document.getElementById("sectorModal").style.display = "block";
  } else if (clickMode === "simMoveMog") {
    const id = getMyMogId(); if (!id) return;
    Reflect.get(mogsState, id).blue = { lat: lat, lng: lng };
    broadcastState(); renderAll();
  } else if (clickMode === "target2pt") {
    if (!tempTargetStart) {
      tempTargetStart = { lat: lat, lng: lng };
      tempTargetMarker = L.circleMarker(L.latLng(lat, lng), { radius: 6, color: "#ffd23f", fillOpacity: 1 }).addTo(map);
    } else {
      const hdg = calcBearing(tempTargetStart.lat, tempTargetStart.lng, lat, lng);
      const spd = Number(document.getElementById("speedRange").value) || 200;
      saveHistory(); targets.push({ id: nextTargetId++, lat: tempTargetStart.lat, lng: tempTargetStart.lng, heading: hdg, speedKmh: spd, assignedMogId: null, createdTs: Date.now() });
      map.removeLayer(tempTargetMarker); tempTargetMarker = null; tempTargetStart = null;
      setClickMode(currentRole === "cmd" ? "greenMog" : "simMoveMog");
      broadcastState(); renderAll();
    }
  }
});

document.getElementById("btnSaveSector").onclick = () => {
  if (!pendingGreenPt) return;
  const { id, lat, lng } = pendingGreenPt;
  const fStr = document.getElementById("secFrom").value.trim(), tStr = document.getElementById("secTo").value.trim();
  saveHistory(); const m = Reflect.get(mogsState, id);
  m.green = { lat: lat, lng: lng };
  m.sector = (fStr !== "" && tStr !== "") ? { from: ((Number(fStr) % 360) + 360) % 360, to: ((Number(tStr) % 360) + 360) % 360 } : null;
  pendingGreenPt = null; document.getElementById("sectorModal").style.display = "none";
  broadcastState(); renderAll();
};
document.getElementById("btnCancelSector").onclick = () => { pendingGreenPt = null; document.getElementById("sectorModal").style.display = "none"; };
document.getElementById("btnDayNight").onclick = function() { isDay = !isDay; this.textContent = isDay ? "☀️ День" : "🌙 Ночь"; this.className = isDay ? "btn green" : "btn amber"; renderAll(); };
document.getElementById("btnOpenTri").onclick = () => {
  const s1 = document.getElementById("triMog1"), s2 = document.getElementById("triMog2");
  s1.innerHTML = ""; s2.innerHTML = "";
  Object.values(mogsState).forEach((m) => { if (m.blue || m.green) { s1.add(new Option("МОГ-" + m.id, m.id)); s2.add(new Option("МОГ-" + m.id, m.id)); } });
  if (s1.options.length < 2) { alert("Выставьте минимум 2 МОГ!"); return; }
  s2.selectedIndex = 1; document.getElementById("triModal").style.display = "block";
};
document.getElementById("btnCloseTri").onclick = () => document.getElementById("triModal").style.display = "none";
document.getElementById("btnCalcTri").onclick = () => {
  const id1 = Number(document.getElementById("triMog1").value), id2 = Number(document.getElementById("triMog2").value);
  const az1 = Number(document.getElementById("triAz1").value), az2 = Number(document.getElementById("triAz2").value);
  if (id1 === id2 || isNaN(az1) || isNaN(az2)) return;
  const p1 = Reflect.get(mogsState, id1).blue || Reflect.get(mogsState, id1).green, p2 = Reflect.get(mogsState, id2).blue || Reflect.get(mogsState, id2).green;
  const hit = intersectBearings(p1, az1, p2, az2);
  if (!hit) { alert("Лучи не пересекаются!"); return; }
  saveHistory(); targets.push({ id: nextTargetId++, lat: hit.lat, lng: hit.lng, heading: Number(document.getElementById("triCourse").value) || 0, speedKmh: Number(document.getElementById("speedRange").value) || 200, assignedMogId: null, createdTs: Date.now() });
  document.getElementById("triModal").style.display = "none"; map.panTo(L.latLng(hit.lat, hit.lng));
  broadcastState(); renderAll();
};

document.getElementById("speedRange").oninput = (e) => { document.getElementById("speedVal").textContent = e.target.value + " км/ч"; targets.forEach((t) => t.speedKmh = Number(e.target.value)); };
document.getElementById("btnToggleMove").onclick = function() { targetsMoving = !targetsMoving; this.textContent = targetsMoving ? "⏸ Пауза" : "▶ Пуск целей"; this.className = targetsMoving ? "btn amber" : "btn green"; };


let netRoom = "", netRoomHash = "", rxCount = 0, txCount = 0, netOnline = false, syncTimer = null, isBusy = false;
let lastResetTs = 0, lastTargetsClearTs = 0, deletedTargetIds = [], undoStack = [];
const bc = ("BroadcastChannel" in window) ? new BroadcastChannel("mog_pvo_local") : null;
const FB_URL = "https://" + "nebo22-default-rtdb." + "firebaseio." + "com/rooms/";

const CryptoSync = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const SALT = enc.encode("MOG_PVO_SALT_2026_V1");

  async function hashRoomId(secret) {
    const buf = await crypto.subtle.digest("SHA-256", enc.encode("ROOM_" + secret));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  }

  async function deriveKey(secret) {
    const baseKey = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: SALT, iterations: 10000, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptObj(obj, secret) {
    const key = await deriveKey(secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
    const combined = new Uint8Array(iv.length + cipher.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipher), iv.length);
    let bin = "";
    for (let i = 0; i < combined.length; i++) bin += String.fromCharCode(combined[i]);
    return { enc: btoa(bin) };
  }

  async function decryptNode(node, secret) {
    if (!node || typeof node !== "object") return node;
    if (typeof node.enc === "string") {
      try {
        const bin = atob(node.enc);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const iv = bytes.slice(0, 12);
        const data = bytes.slice(12);
        const key = await deriveKey(secret);
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
        return JSON.parse(dec.decode(plain));
      } catch (e) { return null; }
    }
    return node;
  }

  return { hashRoomId, encryptObj, decryptNode };
})();

(function() {
  const b = document.getElementById("btnClearAll");
  if (b && b.parentNode && !document.getElementById("btnUndoAction")) {
    const u = document.createElement("button");
    u.id = "btnUndoAction"; u.className = "btn amber"; u.textContent = "↩️ Отмена";
    u.style.marginRight = "4px"; u.onclick = undoLastAction;
    b.parentNode.insertBefore(u, b);
  }
})();

function updateClearTargetsBtn() {
  const btn = document.getElementById("btnClearTargets");
  if (btn) btn.textContent = selectedTargetForAssign ? ("🗑 Удалить Ц-" + selectedTargetForAssign) : "Снять цели";
}

function saveHistory() {
  undoStack.push(JSON.stringify({ mogs: mogsState, targets: targets, deletedTargetIds: deletedTargetIds }));
  if (undoStack.length > 25) undoStack.shift();
}

function undoLastAction() {
  if (!undoStack.length) { hintText.textContent = "Нет действий для отмены."; return; }
  const prev = JSON.parse(undoStack.pop());
  mogsState = prev.mogs; targets = prev.targets; deletedTargetIds = prev.deletedTargetIds || [];
  selectedTargetForAssign = null; updateClearTargetsBtn();
  hintText.textContent = "↩️ Последнее действие отменено.";
  broadcastState(); renderAll();
}

function wipeLocalTraces() {
  undoStack = []; targets = []; deletedTargetIds = []; selectedTargetForAssign = null; nextTargetId = 1;
  window._cachedRouteCoords = null; lastRouteKey = "";
  updateClearTargetsBtn(); triRaysLayer.clearLayers(); routesLayer.clearLayers();
  for (let i = 1; i <= 12; i++) Reflect.set(mogsState, i, { id: i, blue: null, green: null, sector: null });
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
}

document.getElementById("btnClearTargets").onclick = () => {
  if (selectedTargetForAssign !== null) {
    saveHistory();
    const delId = selectedTargetForAssign;
    targets = targets.filter((t) => t.id !== delId);
    if (!deletedTargetIds.includes(delId)) deletedTargetIds.push(delId);
    selectedTargetForAssign = null; updateClearTargetsBtn();
    hintText.textContent = "🗑 Цель Ц-" + delId + " удалена.";
    broadcastState(); renderAll(); return;
  }
  if (!targets.length) return;
  saveHistory(); targets = []; triRaysLayer.clearLayers();
  lastTargetsClearTs = Date.now(); selectedTargetForAssign = null; updateClearTargetsBtn();
  hintText.textContent = "🗑 Все цели сняты."; broadcastState(); renderAll();
};

document.getElementById("btnClearAll").onclick = async () => {
  if (!confirm("Очистить всю обстановку и удалить данные с сервера?")) return;
  lastResetTs = Date.now(); lastTargetsClearTs = lastResetTs;
  wipeLocalTraces(); renderAll();
  hintText.textContent = "⏳ Очистка устройств и удаление данных из облака...";
  if (bc) bc.postMessage({ sender: currentRole, resetTs: lastResetTs, mogs: {}, targets: [] });
  if (netRoom && netRoomHash) {
    isBusy = true;
    const roomUrl = FB_URL + netRoomHash + ".json";
    try {
      const encCmd = await CryptoSync.encryptObj({ mogs: {}, targets: [], deletedTargetIds: [], targetsClearedTs: lastTargetsClearTs, ts: lastResetTs }, netRoom);
      await fetch(roomUrl, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetTs: lastResetTs, cmd: encCmd, mogs: {} })
      });
      await new Promise((r) => setTimeout(r, 4000));
      await fetch(roomUrl, { method: "DELETE" });
      rxCount = 0; txCount = 0; updateNetLabel("");
      hintText.textContent = "🧹 Обстановка полностью сброшена, облако очищено.";
    } catch (e) { updateNetLabel("Ошибка сброса: " + e.message); } finally { isBusy = false; }
  } else {
    hintText.textContent = "🧹 Локальная обстановка полностью сброшена.";
  }
};
function updateNetLabel(errTxt) {
  const st = document.getElementById("netStatus");
  if (!st) return;
  st.textContent = errTxt ? ("❌ " + errTxt) : ((netOnline ? "✅ В эфире [AES-256] (" + netRoom + ")" : "⏳ Подключение...") + " | Отпр: " + txCount + " • Прин: " + rxCount);
  st.style.color = errTxt ? "#f87171" : (netOnline ? "#4ade80" : "#ffd23f");
}

function applyIncomingRoom(roomData) {
  if (roomData === null) {
    if (targets.length > 0 || Object.values(mogsState).some((m) => m.blue || m.green)) {
      wipeLocalTraces(); renderAll();
      hintText.textContent = "🧹 Канал очищен командиром.";
    }
    return;
  }
  if (!roomData || typeof roomData !== "object") return;
  let changed = false;
  if (roomData.resetTs && roomData.resetTs > lastResetTs) {
    lastResetTs = roomData.resetTs; lastTargetsClearTs = roomData.resetTs;
    wipeLocalTraces(); renderAll();
    hintText.textContent = "🧹 Получен сигнал полного сброса.";
    return;
  }
  if (currentRole === "cmd") {
    if (roomData.mogs && typeof roomData.mogs === "object") {
      Object.keys(roomData.mogs).forEach((k) => {
        const id = Number(k), inc = Reflect.get(roomData.mogs, k), cur = Reflect.get(mogsState, id);
        if (inc && inc.blue && cur && (!cur.blue || cur.blue.lat !== inc.blue.lat || cur.blue.lng !== inc.blue.lng)) { cur.blue = inc.blue; changed = true; }
        if (inc && Array.isArray(inc.targets)) {
          inc.targets.forEach((mt) => {
            if ((mt.createdTs || 0) > lastTargetsClearTs && !deletedTargetIds.includes(mt.id) && !targets.some((t) => t.id === mt.id)) {
              targets.push(mt); if (mt.id >= nextTargetId) nextTargetId = mt.id + 1; changed = true;
            }
          });
        }
      });
    }
  } else {
    const myId = getMyMogId();
    if (roomData.cmd) {
      const cMogs = roomData.cmd.mogs || {};
      for (let i = 1; i <= 12; i++) {
        const inc = Reflect.get(cMogs, String(i)), cur = Reflect.get(mogsState, i);
        if (!cur) continue;
        const newG = inc ? (inc.green || null) : null, newS = inc ? (inc.sector || null) : null;
        if (JSON.stringify(cur.green) !== JSON.stringify(newG) || JSON.stringify(cur.sector) !== JSON.stringify(newS)) { cur.green = newG; cur.sector = newS; changed = true; }
      }
      const cmdClearTs = roomData.cmd.targetsClearedTs || 0;
      if (cmdClearTs > lastTargetsClearTs) { lastTargetsClearTs = cmdClearTs; targets = []; deletedTargetIds = []; changed = true; }
      const cmdDelIds = Array.isArray(roomData.cmd.deletedTargetIds) ? roomData.cmd.deletedTargetIds : [];
      deletedTargetIds = Array.from(new Set(deletedTargetIds.concat(cmdDelIds)));
      const cmdTargets = Array.isArray(roomData.cmd.targets) ? roomData.cmd.targets : [];
      const myLocalNew = targets.filter((lt) => (lt.createdTs || 0) > lastTargetsClearTs && !deletedTargetIds.includes(lt.id) && !cmdTargets.some((ct) => ct.id === lt.id));
      const merged = cmdTargets.filter((ct) => !deletedTargetIds.includes(ct.id)).concat(myLocalNew);
      if (JSON.stringify(targets) !== JSON.stringify(merged)) {
        targets = merged;
        if (selectedTargetForAssign && !targets.some((t) => t.id === selectedTargetForAssign)) { selectedTargetForAssign = null; updateClearTargetsBtn(); }
        changed = true;
      }
    }
    if (roomData.mogs && typeof roomData.mogs === "object") {
      Object.keys(roomData.mogs).forEach((k) => {
        const id = Number(k), inc = Reflect.get(roomData.mogs, k), cur = Reflect.get(mogsState, id);
        if (id !== myId && inc && inc.blue && cur && (!cur.blue || cur.blue.lat !== inc.blue.lat || cur.blue.lng !== inc.blue.lng)) { cur.blue = inc.blue; changed = true; }
      });
    }
  }
  if (changed) renderAll();
}

if (bc) bc.onmessage = (ev) => {
  const d = ev.data;
  if (!d || d.sender === currentRole) return;
  if (d.resetTs) { applyIncomingRoom({ resetTs: d.resetTs }); return; }
  if (d.sender === "cmd") applyIncomingRoom({ cmd: { mogs: d.mogs, targets: d.targets, deletedTargetIds: d.deletedTargetIds, targetsClearedTs: d.targetsClearedTs } });
  else { const mObj = {}, mid = d.sender.slice(4); Reflect.set(mObj, mid, { blue: Reflect.get(d.mogs, mid)?.blue || null, targets: d.targets || [] }); applyIncomingRoom({ mogs: mObj }); }
};

async function syncFirebase(pushMine) {
  if (!netRoom || !netRoomHash || isBusy) return;
  isBusy = true;
  const activeMogs = {};
  Object.keys(mogsState).forEach((k) => { const m = Reflect.get(mogsState, k); if (m && (m.blue || m.green || m.sector)) Reflect.set(activeMogs, k, m); });
  if (bc && pushMine) bc.postMessage({ sender: currentRole, mogs: activeMogs, targets: targets, deletedTargetIds: deletedTargetIds, targetsClearedTs: lastTargetsClearTs });
  const roomBase = FB_URL + netRoomHash;
  try {
    const rGet = await fetch(roomBase + ".json?t=" + Date.now());
    if (!rGet.ok) throw new Error("HTTP " + rGet.status);
    const rawData = await rGet.json();
    netOnline = true; rxCount++;
    if (rawData === null) {
      applyIncomingRoom(null);
    } else if (typeof rawData === "object") {
      const decData = { resetTs: rawData.resetTs || 0 };
      if (rawData.cmd) decData.cmd = await CryptoSync.decryptNode(rawData.cmd, netRoom);
      if (rawData.mogs && typeof rawData.mogs === "object") {
        decData.mogs = {};
        for (const k of Object.keys(rawData.mogs)) {
          const decMog = await CryptoSync.decryptNode(Reflect.get(rawData.mogs, k), netRoom);
          if (decMog) Reflect.set(decData.mogs, k, decMog);
        }
      }
      applyIncomingRoom(decData);
    }
    if (pushMine) {
      if (currentRole === "cmd") {
        const payload = await CryptoSync.encryptObj({ mogs: activeMogs, targets: targets, deletedTargetIds: deletedTargetIds, targetsClearedTs: lastTargetsClearTs, ts: Date.now() }, netRoom);
        const r1 = await fetch(roomBase + "/cmd.json", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!r1.ok) throw new Error("HTTP " + r1.status);
        txCount++;
      } else {
        const myId = getMyMogId(), myMog = Reflect.get(mogsState, myId);
        const payload = await CryptoSync.encryptObj({ blue: (myMog && myMog.blue) ? myMog.blue : null, targets: targets, arrivedTs: myMog?.arrivedTs || 0, ts: Date.now() }, netRoom);
        const r2 = await fetch(roomBase + "/mogs/" + myId + ".json", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!r2.ok) throw new Error("HTTP " + r2.status);
        txCount++;
      }
    }
    updateNetLabel("");
  } catch (e) { netOnline = false; updateNetLabel("Ошибка: " + e.message); } finally { isBusy = false; }
}

function broadcastState() { syncFirebase(true); }
document.getElementById("btnOpenSync").onclick = () => document.getElementById("syncModal").style.display = "block";
document.getElementById("btnCloseSync").onclick = () => document.getElementById("syncModal").style.display = "none";
document.getElementById("btnConnectNet").onclick = async () => {
  const room = document.getElementById("roomCode").value.trim().toUpperCase().replace(/[^A-ZА-Я0-9_-]/g, "");
  if (!room) return;
  if (syncTimer) clearInterval(syncTimer);
  netRoom = room; netRoomHash = await CryptoSync.hashRoomId(room);
  rxCount = 0; txCount = 0; netOnline = false;
  updateNetLabel(""); syncFirebase(true); syncTimer = setInterval(() => syncFirebase(true), 2000);
};
document.getElementById("btnCopyPacket").onclick = () => { navigator.clipboard.writeText(JSON.stringify({ mogs: mogsState, targets: targets })).then(() => alert("✅ Пакет скопирован!")); };
document.getElementById("btnPastePacket").onclick = () => { const raw = prompt("Вставьте пакет:"); if (!raw) return; try { saveHistory(); const d = JSON.parse(raw); if (d.mogs) mogsState = d.mogs; if (d.targets) targets = d.targets; renderAll(); alert("✅ Загружено!"); } catch (e) { alert("❌ Ошибка пакета"); } };
setInterval(() => {
  if (!targetsMoving || targets.length === 0) return;
  targets.forEach((t) => { const nxt = destPoint(t.lat, t.lng, t.heading, (t.speedKmh * 1000 / 3600) * 0.25); t.lat = nxt.lat; t.lng = nxt.lng; });
  renderTargetsAndVectors();
}, 250);
hintText.textContent = "Система готова. Нажмите на карту для постановки плановой позиции МОГ.";
renderAll();

// === МОДУЛЬ КОМПАСА И ОРИЕНТИРОВАНИЯ КАРТЫ ===
(function initCompassModule() {
  let compassMode = "north"; // "north" | "fixed" | "auto"
  let currentHeading = 0;
  let mapAngle = 0;
  let sensorActive = false;

  const btn = document.createElement("button");
  btn.id = "btnCompassMode";
  btn.type = "button";
  btn.style.cssText = "position:fixed; top:220px; right:12px; z-index:1100; background:rgba(15,23,42,0.92); color:#f8fafc; border:1.5px solid #38bdf8; border-radius:10px; padding:7px 11px; font-size:12px; font-weight:700; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.45); display:flex; align-items:center; gap:5px; touch-action:none;";
  btn.innerHTML = '<span id="compassArrow" style="display:inline-block; font-size:15px; transition:transform 0.15s;">🧭</span><span id="compassLabel">На север</span>';
  document.body.appendChild(btn);

  function placeBelowTopPanel() {
    if (btn.dataset.dragged === "1") return;
    let maxBottom = 210;
    document.querySelectorAll("button, select, input").forEach((el) => {
      if (el.id === "btnCompassMode") return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom < window.innerHeight * 0.45) {
        if (r.bottom > maxBottom) maxBottom = r.bottom;
      }
    });
    btn.style.top = "10px";
    btn.style.right = "12px";
  }
  setTimeout(placeBelowTopPanel, 250);
  window.addEventListener("resize", placeBelowTopPanel);
  document.getElementById("roleSelect")?.addEventListener("change", () => setTimeout(placeBelowTopPanel, 100));

  let dragStartY = 0, dragStartX = 0, btnStartTop = 0, btnStartRight = 0, wasMoved = false;
  btn.addEventListener("touchstart", (e) => {
    const t = e.touches;
    dragStartX = t.clientX; dragStartY = t.clientY;
    const r = btn.getBoundingClientRect();
    btnStartTop = r.top; btnStartRight = window.innerWidth - r.right;
    wasMoved = false;
  }, { passive: true });
  btn.addEventListener("touchmove", (e) => {
    const t = e.touches;
    const dx = t.clientX - dragStartX, dy = t.clientY - dragStartY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      wasMoved = true;
      btn.dataset.dragged = "1";
      btn.style.top = Math.max(10, Math.min(window.innerHeight - 50, btnStartTop + dy)) + "px";
      btn.style.right = Math.max(5, Math.min(window.innerWidth - 90, btnStartRight - dx)) + "px";
    }
  }, { passive: true });

  const st = document.createElement("style");
  st.textContent = `
    body, html { overflow: hidden !important; }
    #map { transition: transform 0.15s ease-out; transform-origin: center center !important; }
    #map.compass-rotated {
      position: fixed !important;
      width: 165vmax !important;
      height: 165vmax !important;
      left: 50% !important;
      top: 50% !important;
      right: auto !important;
      bottom: auto !important;
      margin: 0 !important;
    }
  `;
  document.head.appendChild(st);

  function applyMapRotation(deg) {
    const prevAngle = mapAngle;
    mapAngle = (deg + 360) % 360;
    const mapEl = document.getElementById("map");
    const arrowEl = document.getElementById("compassArrow");
    if (!mapEl) return;

    if (mapAngle === 0) {
      mapEl.classList.remove("compass-rotated");
      mapEl.style.transform = "";
    } else {
      mapEl.classList.add("compass-rotated");
      mapEl.style.transform = "translate(-50%, -50%) rotate(" + (-mapAngle) + "deg)";
    }
    if (arrowEl) arrowEl.style.transform = "rotate(" + (-mapAngle) + "deg)";

    // Пересчитываем размер холста тайлов Leaflet при входе/выходе из режима поворота
    if ((prevAngle === 0) !== (mapAngle === 0) && typeof map !== "undefined") {
      setTimeout(() => map.invalidateSize({ animate: false }), 50);
    }
  }

  // Точный пересчет кликов по увеличенному и повернутому холсту #map
  if (typeof map !== "undefined" && map.mouseEventToContainerPoint) {
    map.mouseEventToContainerPoint = function(ev) {
      const e = ev.touches ? ev.touches : (ev.changedTouches ? ev.changedTouches : ev);
      const clientX = e.clientX, clientY = e.clientY;
      const size = this.getSize();
      const cx = size.x / 2, cy = size.y / 2;
      const dx = clientX - window.innerWidth / 2;
      const dy = clientY - window.innerHeight / 2;
      if (mapAngle === 0) {
        return L.point(cx + dx, cy + dy);
      }
      const rad = (mapAngle * Math.PI) / 180;
      return L.point(
        cx + dx * Math.cos(rad) - dy * Math.sin(rad),
        cy + dx * Math.sin(rad) + dy * Math.cos(rad)
      );
    };
  }

  function onOrientation(e) {
    let heading = null;
    if (typeof e.webkitCompassHeading === "number") heading = e.webkitCompassHeading;
    else if (e.alpha !== null) heading = (360 - e.alpha) % 360;
    if (heading === null || isNaN(heading)) return;
    const scrAngle = (screen.orientation && typeof screen.orientation.angle === "number")
      ? screen.orientation.angle
      : (typeof window.orientation === "number" ? window.orientation : 0);
    heading = (heading + scrAngle + 360) % 360;

    let diff = ((heading - currentHeading + 540) % 360) - 180;
    currentHeading = (currentHeading + diff * 0.25 + 360) % 360;

    const lbl = document.getElementById("compassLabel");
    if (compassMode === "auto") {
      applyMapRotation(currentHeading);
      if (lbl) lbl.textContent = "Авто: " + Math.round(currentHeading) + "°";
    } else if (compassMode === "fixed") {
      if (lbl) lbl.textContent = "Ориент: " + Math.round(mapAngle) + "°";
    }
  }

  async function enableCompassSensor() {
    if (sensorActive) return true;
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== "granted") { alert("Доступ к компасу запрещен в настройках браузера."); return false; }
      } catch (err) { alert("Ошибка запроса компаса (нужен HTTPS): " + err.message); return false; }
    }
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);
    sensorActive = true;
    return true;
  }

  btn.onclick = async () => {
    if (wasMoved) { wasMoved = false; return; }
    const lbl = document.getElementById("compassLabel");
    if (compassMode === "north") {
      const ok = await enableCompassSensor();
      if (!ok) return;
      compassMode = "fixed";
      btn.style.borderColor = "#f59e0b";
      setTimeout(() => {
        applyMapRotation(currentHeading);
        if (lbl) lbl.textContent = "Ориент: " + Math.round(currentHeading) + "°";
        if (typeof hintText !== "undefined") hintText.textContent = "🧭 Карта сориентирована по компасу (" + Math.round(currentHeading) + "°). Нажмите еще раз для Авто-компаса.";
      }, 200);
    } else if (compassMode === "fixed") {
      compassMode = "auto";
      btn.style.borderColor = "#22c55e";
      if (lbl) lbl.textContent = "Авто: " + Math.round(currentHeading) + "°";
      if (typeof hintText !== "undefined") hintText.textContent = "🔄 Включен режим Авто-компаса (карта вращается за телефоном).";
    } else {
      compassMode = "north";
      btn.style.borderColor = "#38bdf8";
      applyMapRotation(0);
      if (lbl) lbl.textContent = "На север";
      if (typeof hintText !== "undefined") hintText.textContent = "⬆️ Карта возвращена на Север (0°).";
    }
  };
})();

// === МОДУЛЬ НАВИГАЦИИ GPS, WAKE LOCK И ЗВУКОВЫХ ОПОВЕЩЕНИЙ ===
(function initNavAndAlertsModule() {
  let wakeLock = null;
  let audioCtx = null;
  let gpsWatchId = null;
  let lastGpsSendTs = 0;
  let lastOcrRouteTs = 0;
  let lastOcrRoutePos = null;

  // 1. Синтезатор короткого звукового сигнала ("бип") без внешних аудиофайлов
  function playBeep(freq = 880, durationMs = 180) {
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioCtx = new Ctx();
      }
      if (!audioCtx) return;
      if (audioCtx.state === "suspended") audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + durationMs / 1000);
    } catch (e) {}
  }
  window.playAppBeep = playBeep;

  // 2. Удержание экрана включенным (Wake Lock API)
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (e) {}
  }
  document.addEventListener("click", () => {
    requestWakeLock();
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestWakeLock();
  });

  // 3. Оптимизация перестроения маршрута (не чаще 1 раза в 5 сек и при сдвиге > 25 м)
  const origUpdateRoadRoute = window.updateRoadRoute;
  if (typeof origUpdateRoadRoute === "function") {
    window.updateRoadRoute = async function(mog) {
      const myId = getMyMogId();
      if (!myId || myId !== mog.id || !mog.blue || !mog.green) {
        return origUpdateRoadRoute(mog);
      }
      const distDirect = calcDistance(mog.blue.lat, mog.blue.lng, mog.green.lat, mog.green.lng);
      // Фиксируем донесение о прибытии в точку "по плану" (<= 50 м)
      if (distDirect <= 50) {
        mog.arrivedTs = Date.now();
        playBeep(1040, 220);
        if (typeof hintText !== "undefined") {
          hintText.textContent = "✅ Прибытие на позицию! Донесение отправлено командиру.";
        }
        return origUpdateRoadRoute(mog);
      }
      const now = Date.now();
      const movedM = lastOcrRoutePos ? calcDistance(lastOcrRoutePos.lat, lastOcrRoutePos.lng, mog.blue.lat, mog.blue.lng) : 999;
      if (now - lastOcrRouteTs < 5000 && movedM < 25 && window._cachedRouteCoords) {
        routesLayer.clearLayers();
        L.polyline(window._cachedRouteCoords, { color: "#4ade80", weight: 5, opacity: 0.85 }).addTo(routesLayer);
        routeBanner.style.display = "block";
        routeBanner.style.background = "rgba(20, 83, 45, 0.95)";
        routeBanner.textContent = "🚙 МАРШ МОГ-" + mog.id + ": до точки ~" + Math.round(distDirect) + " м";
        return;
      }
      lastOcrRouteTs = now;
      lastOcrRoutePos = { lat: mog.blue.lat, lng: mog.blue.lng };
      return origUpdateRoadRoute(mog);
    };
  }

  // 4. Непрерывный GPS-навигатор для роли МОГ
  function startGpsNavigation() {
    if (gpsWatchId !== null || !navigator.geolocation) return;
    gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const myId = getMyMogId();
        if (!myId) return;
        const m = Reflect.get(mogsState, myId);
        if (!m) return;
        const newPt = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const moved = m.blue ? calcDistance(m.blue.lat, m.blue.lng, newPt.lat, newPt.lng) : 999;
        if (moved >= 5) {
          m.blue = newPt;
          renderAll();
          if (Date.now() - lastGpsSendTs > 2500) {
            lastGpsSendTs = Date.now();
            broadcastState();
          }
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  }

  function stopGpsNavigation() {
    if (gpsWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
  }

  const roleEl = document.getElementById("roleSelect");
  if (roleEl) {
    roleEl.addEventListener("change", () => {
      requestWakeLock();
      if (getMyMogId()) startGpsNavigation();
      else stopGpsNavigation();
    });
  }

  // 5. Отслеживание событий для озвучивания (новая точка ПЛАН, новая цель, ЦУ, прибытие МОГ)
  let prevPlanHash = "";
  let prevTargetIds = new Set();
  let prevAssignedHash = "";
  let prevArrivedMap = {};

  function getSnapshot() {
    const myId = getMyMogId();
    const myMog = myId ? Reflect.get(mogsState, myId) : null;
    const planHash = (myMog && myMog.green) ? (myMog.green.lat.toFixed(5) + "," + myMog.green.lng.toFixed(5)) : "";
    const tIds = new Set(targets.map((t) => t.id));
    const asgHash = myId
      ? targets.filter((t) => t.assignedMogId === myId).map((t) => t.id).sort().join(",")
      : "";
    return { planHash, tIds, asgHash };
  }

  // Перехватываем renderAll для мгновенного звукового оповещения при входящих изменениях
  const origRenderAll = window.renderAll;
  if (typeof origRenderAll === "function") {
    window.renderAll = function() {
      origRenderAll();
      const snap = getSnapshot();
      const myId = getMyMogId();

      // Событие А: Появилась или изменилась точка "по плану" для МОГ
      if (myId && snap.planHash && snap.planHash !== prevPlanHash) {
        playBeep(880, 180);
        if (typeof hintText !== "undefined") hintText.textContent = "📍 Получена новая плановая позиция (маршрут построен)!";
      }
      prevPlanHash = snap.planHash;

      // Событие Б: Появилась новая цель на экране
      let hasNewTarget = false;
      snap.tIds.forEach((id) => { if (!prevTargetIds.has(id)) hasNewTarget = true; });
      if (hasNewTarget) {
        playBeep(880, 180);
      }
      prevTargetIds = snap.tIds;

      // Событие В: Получено целеуказание (ЦУ)
      if (myId && snap.asgHash && snap.asgHash !== prevAssignedHash) {
        playBeep(880, 180);
        if (typeof hintText !== "undefined") hintText.textContent = "🎯 Получено целеуказание!";
      }
      prevAssignedHash = snap.asgHash;
    };
  }

  // Событие Г: Донесение командиру о прибытии МОГ в плановую точку
  const origApplyIncoming = window.applyIncomingRoom;
  if (typeof origApplyIncoming === "function") {
    window.applyIncomingRoom = function(roomData) {
      if (currentRole === "cmd" && roomData && roomData.mogs) {
        Object.keys(roomData.mogs).forEach((k) => {
          const inc = Reflect.get(roomData.mogs, k);
          if (inc && inc.arrivedTs && inc.arrivedTs > (prevArrivedMap[k] || 0)) {
            prevArrivedMap[k] = inc.arrivedTs;
            playBeep(880, 220);
            if (typeof hintText !== "undefined") {
              hintText.textContent = "✅ ДОНЕСЕНИЕ: МОГ-" + k + " прибыл на плановую позицию!";
              hintText.style.color = "#4ade80";
            }
          }
        });
      }
      return origApplyIncoming(roomData);
    };
  }

  // Передаем флаг прибытия arrivedTs при отправке состояния от МОГ
  const origFetch = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === "string" && url.includes("/mogs/") && opts && opts.method === "PUT" && opts.body) {
      try {
        const myId = getMyMogId();
        const myMog = myId ? Reflect.get(mogsState, myId) : null;
        if (myMog && myMog.arrivedTs) {
          const parsed = JSON.parse(opts.body);
          parsed.arrivedTs = myMog.arrivedTs;
          opts.body = JSON.stringify(parsed);
        }
      } catch (e) {}
    }
    return origFetch.apply(this, arguments);
  };
})();
// === ВСТРОЕННЫЙ МОДУЛЬ ГОЛОСОВОЙ РАЦИИ (PTT) ===
(function initEmbeddedPttModule() {
  const PTT_FB_URL = "https://" + "nebo22-default-rtdb." + "firebaseio." + "com/ptt_rooms/";
  const MAX_REC_SEC = 20;
  const MAX_HISTORY = 15;

  let mediaStream = null, mediaRecorder = null, audioChunks = [], recStartTs = 0, recTimer = null;
  let audioCtx = null, playedIds = new Set(), playQueue = [], isPlaying = false, firstSync = true;
  let lastPttRoom = "", pttPollTimer = null, isPttPolling = false, lastPttResetTs = 0;

  const btnPtt = document.getElementById("btnPttMain");
  const pttFabLbl = document.getElementById("pttFabLbl");
  const btnHistory = document.getElementById("btnPttHistory");
  const pttCount = document.getElementById("pttCount");
  const pttModal = document.getElementById("pttModal");
  const btnCloseModal = document.getElementById("btnClosePttModal");
  const pttStatusLine = document.getElementById("pttStatusLine");
  const pttMsgList = document.getElementById("pttMsgList");

  if (!btnPtt) return;

  window.addEventListener("orientationchange", () => setTimeout(() => { if (typeof map !== "undefined") map.invalidateSize(); }, 250));
  window.addEventListener("resize", () => { if (typeof map !== "undefined") map.invalidateSize(); });

  btnHistory.onclick = () => { pttModal.style.display = (pttModal.style.display === "flex") ? "none" : "flex"; };
  btnCloseModal.onclick = () => { pttModal.style.display = "none"; };

  function getMyCallsign() {
    if (currentRole === "cmd") return "КОМАНДИР";
    const id = getMyMogId();
    return id ? ("МОГ-" + id) : "АБОНЕНТ";
  }

  function playPttTone(f1, f2, dur = 0.1) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f1, audioCtx.currentTime);
      if (f2) osc.frequency.setValueAtTime(f2, audioCtx.currentTime + dur * 0.5);
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + dur + 0.01);
    } catch (e) {}
  }

  function enqueuePlayback(msgObj, domEl) { playQueue.push({ msg: msgObj, el: domEl }); processQueue(); }

  function processQueue() {
    if (isPlaying || playQueue.length === 0) return;
    isPlaying = true;
    const { msg, el } = playQueue.shift();

    btnPtt.classList.add("receiving");
    pttFabLbl.textContent = "ПРИЁМ";
    pttStatusLine.textContent = "🔊 Говорит " + msg.sender + " (" + msg.dur + "с)...";
    if (typeof hintText !== "undefined") hintText.textContent = "📻 Рация: говорит " + msg.sender + "...";
    if (el) el.classList.add("playing");

    playPttTone(1100, 850, 0.09);

    let audioUrl = "";
    try {
      const rawB64 = Array.isArray(msg.audio) ? msg.audio : msg.audio;
      const bin = atob(rawB64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      audioUrl = URL.createObjectURL(new Blob([bytes], { type: msg.mime || "audio/webm" }));
    } catch (e) {}

    const audio = new Audio(audioUrl);
    const finish = () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (el) el.classList.remove("playing");
      btnPtt.classList.remove("receiving");
      pttFabLbl.textContent = "PTT";
      isPlaying = false;
      if (playQueue.length === 0) {
        pttStatusLine.textContent = netRoom ? ("Канал " + netRoom + " • Готов к приёму") : "Подключитесь в меню «📡 Связь»";
      }
      processQueue();
    };
    audio.onended = finish; audio.onerror = finish;
    setTimeout(() => { audio.play().catch(finish); }, 100);
  }
  async function pollPtt() {
    if (!netRoom || !netRoomHash || isPttPolling) return;
    if (lastPttRoom !== netRoomHash) {
      lastPttRoom = netRoomHash;
      playedIds.clear(); playQueue = []; firstSync = true;
      pttMsgList.innerHTML = ""; pttCount.textContent = "0";
      pttStatusLine.textContent = "Канал " + netRoom + " • Ожидание эфира";
    }
    isPttPolling = true;
    try {
      const res = await fetch(PTT_FB_URL + netRoomHash + ".json?t=" + Date.now());
      if (!res.ok) return;
      const data = await res.json();
      if (data === null || (data && data.resetTs && data.resetTs > lastPttResetTs)) {
        if (data && data.resetTs) lastPttResetTs = data.resetTs;
        playedIds.clear(); playQueue = [];
        pttMsgList.innerHTML = ""; pttCount.textContent = "0";
        return;
      }
      const msgsObj = (data && data.msgs) ? data.msgs : {};
      const keys = Object.keys(msgsObj).sort();
      const myName = getMyCallsign();

      for (const k of keys) {
        if (playedIds.has(k)) continue;
        playedIds.add(k);
        const dec = await CryptoSync.decryptNode({ enc: msgsObj[k] }, netRoom);
        if (!dec || !dec.audio) continue;

        const isMine = (dec.sender === myName);
        const row = document.createElement("div");
        row.className = "ptt-row" + (isMine ? " mine" : "");
        row.innerHTML = '<div><b>' + dec.sender + '</b> <span style="color:#94a3b8;font-size:10px;">' + dec.time + ' • ' + dec.dur + 'с</span></div>';
        const btnRep = document.createElement("button");
        btnRep.className = "btn"; btnRep.style.padding = "3px 7px"; btnRep.textContent = "▶";
        btnRep.onclick = () => enqueuePlayback(dec, row);
        row.appendChild(btnRep);
        pttMsgList.appendChild(row);
        pttMsgList.scrollTop = pttMsgList.scrollHeight;
        pttCount.textContent = String(pttMsgList.children.length);

        if (!firstSync && !isMine) enqueuePlayback(dec, row);
      }
      firstSync = false;
    } catch (e) {} finally { isPttPolling = false; }
  }

  async function sendVoice(blob, durSec, mimeType) {
    pttStatusLine.textContent = "⏳ Отправка голоса (" + durSec + "с)...";
    const b64 = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(","));
      r.readAsDataURL(blob);
    });
    const now = new Date();
    const timeStr = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0") + ":" + String(now.getSeconds()).padStart(2, "0");
    const msgId = Date.now() + "_" + Math.floor(100 + Math.random() * 900);
    const encObj = await CryptoSync.encryptObj({ sender: getMyCallsign(), time: timeStr, dur: durSec, mime: mimeType, audio: b64 }, netRoom);

    try {
      await fetch(PTT_FB_URL + netRoomHash + "/msgs/" + msgId + ".json", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(encObj.enc)
      });
      pttStatusLine.textContent = "✅ Передано (" + durSec + "с)";
      const rList = await fetch(PTT_FB_URL + netRoomHash + "/msgs.json?shallow=true");
      const keysObj = await rList.json();
      if (keysObj) {
        const ks = Object.keys(keysObj).sort();
        while (ks.length > MAX_HISTORY) {
          const oldK = ks.shift();
          fetch(PTT_FB_URL + netRoomHash + "/msgs/" + oldK + ".json", { method: "DELETE" }).catch(() => {});
        }
      }
      pollPtt();
    } catch (e) { pttStatusLine.textContent = "❌ Ошибка отправки голоса"; }
  }

  function getMime() {
    for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
    }
    return "";
  }

  async function startPtt(e) {
    if (e) e.preventDefault();
    if (!netRoom || !netRoomHash) {
      if (typeof hintText !== "undefined") hintText.textContent = "⚠️ Сначала подключитесь к каналу в меню «📡 Связь»!";
      return;
    }
    if (mediaRecorder && mediaRecorder.state === "recording") return;
    try {
      if (!mediaStream) {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      }
    } catch (err) { alert("Разрешите доступ к микрофону для работы рации!"); return; }

    playPttTone(880, 1320, 0.09);
    if (navigator.vibrate) navigator.vibrate(40);

    audioChunks = [];
    const mime = getMime();
    mediaRecorder = mime ? new MediaRecorder(mediaStream, { mimeType: mime, audioBitsPerSecond: 24000 }) : new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) audioChunks.push(ev.data); };
    mediaRecorder.onstop = () => {
      const dur = Math.max(1, Math.round((Date.now() - recStartTs) / 1000));
      if (audioChunks.length > 0 && (Date.now() - recStartTs) >= 450) {
        sendVoice(new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" }), dur, mediaRecorder.mimeType || "audio/webm");
      }
    };

    recStartTs = Date.now();
    mediaRecorder.start(150);
    btnPtt.classList.add("active");
    pttFabLbl.textContent = "00:00";

    recTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - recStartTs) / 1000);
      pttFabLbl.textContent = "00:" + String(sec).padStart(2, "0");
      if (sec >= MAX_REC_SEC) stopPtt();
    }, 250);
  }

  function stopPtt(e) {
    if (e) e.preventDefault();
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    btnPtt.classList.remove("active");
    pttFabLbl.textContent = "PTT";
    if (mediaRecorder && mediaRecorder.state === "recording") { playPttTone(1040, 780, 0.09); mediaRecorder.stop(); }
  }

  btnPtt.addEventListener("pointerdown", startPtt);
  btnPtt.addEventListener("pointerup", stopPtt);
  btnPtt.addEventListener("pointercancel", stopPtt);
  btnPtt.addEventListener("pointerleave", (e) => { if (e.buttons === 0 && mediaRecorder && mediaRecorder.state === "recording") stopPtt(e); });

  const origClearBtn = document.getElementById("btnClearAll");
  if (origClearBtn) {
    origClearBtn.addEventListener("click", () => {
      if (netRoomHash) {
        const ts = Date.now();
        lastPttResetTs = ts; playedIds.clear(); playQueue = [];
        pttMsgList.innerHTML = ""; pttCount.textContent = "0";
        fetch(PTT_FB_URL + netRoomHash + ".json", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resetTs: ts }) })
          .then(() => setTimeout(() => fetch(PTT_FB_URL + netRoomHash + ".json", { method: "DELETE" }).catch(() => {}), 3500))
          .catch(() => {});
      }
    });
  }

  pttPollTimer = setInterval(pollPtt, 1400);
})();

try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch(e) {}


// === ЛОГИКА ВЫДВИЖНЫХ ПАНЕЛЕЙ НАД КАРТОЙ ===
(function initCleanMapHud() {
  const btnApp = document.getElementById("btnToggleAppMenu");
  const appPanel = document.querySelector(".top-bar");
  const btnTgt = document.getElementById("btnToggleTargetsMenu");
  const tgtPanel = document.querySelector(".bottom-sheet");
  const tgtBadge = document.getElementById("tgtFabBadge");

  if (btnApp && appPanel) {
    btnApp.onclick = (e) => {
      e.stopPropagation();
      const willOpen = !appPanel.classList.contains("visible");
      appPanel.classList.toggle("visible", willOpen);
      btnApp.classList.toggle("open", willOpen);
      if (willOpen && tgtPanel) { tgtPanel.classList.remove("visible"); btnTgt?.classList.remove("open"); }
    };
  }

  if (btnTgt && tgtPanel) {
    btnTgt.onclick = (e) => {
      e.stopPropagation();
      const willOpen = !tgtPanel.classList.contains("visible");
      tgtPanel.classList.toggle("visible", willOpen);
      btnTgt.classList.toggle("open", willOpen);
      if (willOpen && appPanel) { appPanel.classList.remove("visible"); btnApp?.classList.remove("open"); }
    };
  }

  if (typeof map !== "undefined") {
    map.on("click", () => {
      if (tgtPanel && tgtPanel.classList.contains("visible")) {
        tgtPanel.classList.remove("visible");
        btnTgt?.classList.remove("open");
      }
    });
  }

  const origRenderTargets = window.renderTargetsAndVectors;
  if (typeof origRenderTargets === "function") {
    window.renderTargetsAndVectors = function() {
      origRenderTargets();
      if (tgtBadge && btnTgt) {
        const cnt = Array.isArray(targets) ? targets.length : 0;
        tgtBadge.textContent = "ЦЕЛИ (" + cnt + ")";
        const myId = typeof getMyMogId === "function" ? getMyMogId() : null;
        const hasMyAssign = myId && Array.isArray(targets) && targets.some(t => t.assignedMogId === myId);
        btnTgt.classList.toggle("alert", !!hasMyAssign);
      }
    };
  }
})();