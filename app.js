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


let netRoom = "", rxCount = 0, txCount = 0, netOnline = false, syncTimer = null, isBusy = false;
let lastResetTs = 0, lastTargetsClearTs = 0, deletedTargetIds = [], undoStack = [];
const bc = ("BroadcastChannel" in window) ? new BroadcastChannel("mog_pvo_local") : null;
const FB_URL = "https://" + "nebo22-default-rtdb." + "firebaseio." + "com/rooms/";

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
  if (!confirm("Очистить всю обстановку у командира и всех МОГ?")) return;
  saveHistory(); targets = []; deletedTargetIds = []; selectedTargetForAssign = null;
  updateClearTargetsBtn(); triRaysLayer.clearLayers(); routesLayer.clearLayers();
  for (let i = 1; i <= 12; i++) Reflect.set(mogsState, i, { id: i, blue: null, green: null, sector: null });
  lastResetTs = Date.now(); lastTargetsClearTs = lastResetTs;
  renderAll(); hintText.textContent = "🧹 Обстановка полностью сброшена.";
  if (bc) bc.postMessage({ sender: currentRole, resetTs: lastResetTs, mogs: {}, targets: [] });
  if (netRoom) {
    isBusy = true;
    try {
      await fetch(FB_URL + encodeURIComponent(netRoom) + ".json", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetTs: lastResetTs, cmd: { mogs: {}, targets: [], deletedTargetIds: [], targetsClearedTs: lastTargetsClearTs, ts: lastResetTs }, mogs: {} })
      });
      txCount++; updateNetLabel("");
    } catch (e) { updateNetLabel("Ошибка сброса: " + e.message); } finally { isBusy = false; }
  }
};
function updateNetLabel(errTxt) {
  const st = document.getElementById("netStatus");
  if (!st) return;
  st.textContent = errTxt ? ("❌ " + errTxt) : ((netOnline ? "✅ В эфире (" + netRoom + ")" : "⏳ Подключение...") + " | Отпр: " + txCount + " • Прин: " + rxCount);
  st.style.color = errTxt ? "#f87171" : (netOnline ? "#4ade80" : "#ffd23f");
}

function applyIncomingRoom(roomData) {
  if (!roomData || typeof roomData !== "object") return;
  let changed = false;
  if (roomData.resetTs && roomData.resetTs > lastResetTs) {
    lastResetTs = roomData.resetTs; lastTargetsClearTs = roomData.resetTs;
    targets = []; deletedTargetIds = []; selectedTargetForAssign = null; updateClearTargetsBtn();
    triRaysLayer.clearLayers(); routesLayer.clearLayers();
    for (let i = 1; i <= 12; i++) Reflect.set(mogsState, i, { id: i, blue: null, green: null, sector: null });
    renderAll(); return;
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
  if (!netRoom || isBusy) return;
  isBusy = true;
  const activeMogs = {};
  Object.keys(mogsState).forEach((k) => { const m = Reflect.get(mogsState, k); if (m && (m.blue || m.green || m.sector)) Reflect.set(activeMogs, k, m); });
  if (bc && pushMine) bc.postMessage({ sender: currentRole, mogs: activeMogs, targets: targets, deletedTargetIds: deletedTargetIds, targetsClearedTs: lastTargetsClearTs });
  const roomBase = FB_URL + encodeURIComponent(netRoom);
  try {
    const rGet = await fetch(roomBase + ".json?t=" + Date.now());
    if (!rGet.ok) throw new Error("HTTP " + rGet.status);
    const data = await rGet.json();
    netOnline = true; rxCount++; applyIncomingRoom(data);
    if (pushMine) {
      if (currentRole === "cmd") {
        const r1 = await fetch(roomBase + "/cmd.json", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mogs: activeMogs, targets: targets, deletedTargetIds: deletedTargetIds, targetsClearedTs: lastTargetsClearTs, ts: Date.now() }) });
        if (!r1.ok) throw new Error("HTTP " + r1.status);
        txCount++;
      } else {
        const myId = getMyMogId(), myMog = Reflect.get(mogsState, myId);
        const r2 = await fetch(roomBase + "/mogs/" + myId + ".json", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blue: (myMog && myMog.blue) ? myMog.blue : null, targets: targets, ts: Date.now() }) });
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
document.getElementById("btnConnectNet").onclick = () => {
  const room = document.getElementById("roomCode").value.trim().toUpperCase().replace(/[^A-ZА-Я0-9_-]/g, "");
  if (!room) return;
  if (syncTimer) clearInterval(syncTimer);
  netRoom = room; rxCount = 0; txCount = 0; netOnline = false;
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

  // Автоматически ставим кнопку ниже самого нижнего элемента верхней панели
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
    btn.style.top = (Math.round(maxBottom) + 12) + "px";
  }
  setTimeout(placeBelowTopPanel, 250);
  window.addEventListener("resize", placeBelowTopPanel);
  document.getElementById("roleSelect")?.addEventListener("change", () => setTimeout(placeBelowTopPanel, 100));

  // Возможность перетащить кнопку пальцем в любое место экрана
  let dragStartY = 0, dragStartX = 0, btnStartTop = 0, btnStartRight = 0, wasMoved = false;
  btn.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    dragStartX = t.clientX; dragStartY = t.clientY;
    const r = btn.getBoundingClientRect();
    btnStartTop = r.top; btnStartRight = window.innerWidth - r.right;
    wasMoved = false;
  }, { passive: true });
  btn.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
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
    #map { transition: transform 0.15s ease-out; transform-origin: center center; }
    .compass-rotated .leaflet-tooltip { transform-origin: center center; }
  `;
  document.head.appendChild(st);

  function applyMapRotation(deg) {
    mapAngle = (deg + 360) % 360;
    const mapEl = document.getElementById("map");
    const arrowEl = document.getElementById("compassArrow");
    if (!mapEl) return;

    if (mapAngle === 0) {
      mapEl.style.transform = "";
      mapEl.style.width = "";
      mapEl.style.height = "";
      mapEl.style.left = "";
      mapEl.style.top = "";
      mapEl.classList.remove("compass-rotated");
    } else {
      mapEl.style.width = "142vw";
      mapEl.style.height = "142vh";
      mapEl.style.left = "-21vw";
      mapEl.style.top = "-21vh";
      mapEl.style.transform = "rotate(" + (-mapAngle) + "deg)";
      mapEl.classList.add("compass-rotated");
    }
    if (arrowEl) arrowEl.style.transform = "rotate(" + (-mapAngle) + "deg)";
    setTimeout(() => { if (typeof map !== "undefined") map.invalidateSize({ animate: false }); }, 160);
  }

  if (typeof map !== "undefined" && map.mouseEventToContainerPoint) {
    const origMouseToPoint = map.mouseEventToContainerPoint.bind(map);
    map.mouseEventToContainerPoint = function(ev) {
      const pt = origMouseToPoint(ev);
      if (mapAngle === 0) return pt;
      const size = this.getSize();
      const cx = size.x / 2, cy = size.y / 2;
      const rad = (mapAngle * Math.PI) / 180;
      const dx = pt.x - cx, dy = pt.y - cy;
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