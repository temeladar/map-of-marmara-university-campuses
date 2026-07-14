// Odak: yalnızca RTE Külliyesi. Harita, kampüs sınırlarının 1 km çevresindeki
// dikdörtgen alanla sınırlıdır; dışarısı beyaz maskeyle kapatılır ve kamera
// bu alanın dışına çıkamaz.
const STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
// Kampüs çevresinde korunacak şerit (metre).
const FRAME_MARGIN_M = 1000;
// Başıbüyük çevresi arama kutusu (güney,batı,kuzey,doğu).
const BBOX = "40.92,29.10,40.98,29.18";
const CACHE_KEY = "marmara-rte-data-v3";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 hafta

const map = new maplibregl.Map({
  container: "map",
  style: STYLE_URL,
  center: [CAMPUS.lng, CAMPUS.lat],
  zoom: 14.5,
  pitch: 55,
  bearing: -15,
  antialias: true,
  attributionControl: { compact: false }
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

const marker = new maplibregl.Marker({ color: "#c2185b" })
  .setLngLat([CAMPUS.lng, CAMPUS.lat])
  .setPopup(new maplibregl.Popup({ offset: 32 }).setHTML(
    `<strong>${CAMPUS.name}</strong><br><em>${CAMPUS.district}</em><br>${CAMPUS.info}`
  ))
  .addTo(map);

map.on("load", () => {
  // Yollar gri/beyaz tonlarda kalsın (sade görünüm).
  for (const layer of map.getStyle().layers) {
    if (layer.type === "line" && layer["source-layer"] === "transportation") {
      const gray = layer.id.includes("casing") || layer.id.includes("tunnel");
      try {
        map.setPaintProperty(layer.id, "line-color", gray ? "#c9c9c9" : "#ffffff");
      } catch (e) { /* tek katman boyanamazsa geri kalanı etkilenmesin */ }
    }
  }

  map.addSource("satellite", {
    type: "raster",
    tiles: [SATELLITE_TILES],
    tileSize: 256,
    maxzoom: 19,
    attribution: "Uydu görüntüsü © Esri, Maxar, Earthstar Geographics"
  });
  map.addLayer({
    id: "satellite",
    type: "raster",
    source: "satellite",
    layout: { visibility: "none" }
  });

  // Çerçeve dışını kapatan beyaz maske (dünya − dikdörtgen delik).
  map.addSource("frame-mask", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });
  map.addLayer({
    id: "frame-mask",
    type: "fill",
    source: "frame-mask",
    paint: { "fill-color": "#fafafa", "fill-opacity": 1 }
  });
  map.addLayer({
    id: "frame-border",
    type: "line",
    source: "frame-mask",
    paint: { "line-color": "#c2185b", "line-width": 2 }
  });

  // Kampüs arazisi sınırı.
  map.addSource("campus-grounds", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });
  map.addLayer({
    id: "campus-grounds-fill",
    type: "fill",
    source: "campus-grounds",
    paint: { "fill-color": "#34a853", "fill-opacity": 0.10 }
  });
  map.addLayer({
    id: "campus-grounds-line",
    type: "line",
    source: "campus-grounds",
    paint: { "line-color": "#34a853", "line-width": 2.5 }
  });

  // Külliye binaları — Apple Maps benzeri açık krem/pastel 3B stil.
  map.addSource("campus-buildings", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });
  map.addLayer({
    id: "campus-buildings",
    type: "fill-extrusion",
    source: "campus-buildings",
    minzoom: 11,
    paint: {
      "fill-extrusion-color": [
        "case",
        ["get", "isRoof"], "#dcd9d3",
        ["get", "isHospital"], "#e7c3bc",
        ["get", "isMosque"], "#c9dec9",
        ["get", "isDorm"], "#d4cbe6",
        "#eae6df"
      ],
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": ["get", "minHeight"],
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": true
    }
  });

  map.setLight({ anchor: "viewport", color: "#ffffff", intensity: 0.35 });
  loadCampusData();
});

// ---- Geometri yardımcıları ----

function distKm(a, b) {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d2r, dLng = (b.lng - a.lng) * d2r;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function polyCentroid(ring) {
  let lng = 0, lat = 0;
  for (const [x, y] of ring) { lng += x; lat += y; }
  return [lng / ring.length, lat / ring.length];
}

function ringAreaM2(ring) {
  const R = 6378137, d2r = Math.PI / 180;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    sum += (x2 - x1) * d2r * (2 + Math.sin(y1 * d2r) + Math.sin(y2 * d2r));
  }
  return Math.abs(sum * R * R / 2);
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ---- Çerçeve: kampüs sınırı + 1 km dikdörtgeni ----

// Kampüs poligonlarının sınır kutusunu her yönde 1 km genişletir.
function frameRect(rings) {
  let minLng = CAMPUS.lng, maxLng = CAMPUS.lng;
  let minLat = CAMPUS.lat, maxLat = CAMPUS.lat;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }
  }
  const dLat = FRAME_MARGIN_M / 111320;
  const dLng = FRAME_MARGIN_M / (111320 * Math.cos(CAMPUS.lat * Math.PI / 180));
  return [minLng - dLng, minLat - dLat, maxLng + dLng, maxLat + dLat];
}

function applyFrame(rect) {
  const [w, s, e, n] = rect;
  const hole = [[w, s], [e, s], [e, n], [w, n], [w, s]];
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  map.getSource("frame-mask").setData({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [world, hole] },
    properties: {}
  });
  // Kamera çerçevenin biraz dışına kadar gidebilsin ama uzaklaşamasın.
  const pad = 0.004;
  map.setMaxBounds([[w - pad, s - pad], [e + pad, n + pad]]);
  map.setMinZoom(13);
  map.fitBounds([[w, s], [e, n]], { pitch: 55, bearing: -15, duration: 1500 });
}

// ---- Overpass ----

async function overpass(query) {
  let lastErr = new Error("Overpass yanıt vermedi");
  for (const url of OVERPASS_MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          body: "data=" + encodeURIComponent(query),
          headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, 1200));
      }
    }
  }
  throw lastErr;
}

// Başıbüyük çevresindeki üniversite/hastane arazileri.
function groundsQuery() {
  return `[out:json][timeout:45];
(
  way["amenity"="university"](${BBOX});
  relation["amenity"="university"](${BBOX});
  way["amenity"="hospital"](${BBOX});
  relation["amenity"="hospital"](${BBOX});
  way["operator"~"armara"](${BBOX});
  relation["operator"~"armara"](${BBOX});
);
out geom;`;
}

function buildingsQuery(center, radiusM) {
  return `[out:json][timeout:60];
(
  way[building](around:${Math.round(radiusM)},${center.lat},${center.lng});
  relation[building](around:${Math.round(radiusM)},${center.lat},${center.lng});
);
out geom;`;
}

function parseHeight(tags) {
  const num = (v) => {
    const n = parseFloat(String(v).replace(",", ".").replace(/m$/i, ""));
    return Number.isFinite(n) ? n : null;
  };
  const h = tags.height != null ? num(tags.height) : null;
  if (h != null) return h;
  const levels = tags["building:levels"] != null ? num(tags["building:levels"]) : null;
  if (levels != null) return levels * 3.2;
  if (tags.building === "roof" || tags.building === "grandstand") return 5;
  return 9;
}

function parseMinHeight(tags) {
  const mh = parseFloat(tags.min_height);
  if (Number.isFinite(mh)) return mh;
  const ml = parseFloat(tags["building:min_level"]);
  if (Number.isFinite(ml)) return ml * 3.2;
  return 0;
}

function elementPolygons(el) {
  const rings = [];
  if (el.type === "way" && el.geometry && el.geometry.length >= 3) {
    rings.push(el.geometry.map(p => [p.lon, p.lat]));
  } else if (el.type === "relation" && el.members) {
    for (const m of el.members) {
      if (m.type === "way" && m.role !== "inner" && m.geometry && m.geometry.length >= 3) {
        rings.push(m.geometry.map(p => [p.lon, p.lat]));
      }
    }
  }
  return rings.map(ring => {
    const first = ring[0], last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    return ring;
  });
}

function buildingFeatures(elements) {
  const features = [];
  const seen = new Set();
  for (const el of elements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tags = el.tags || {};
    if (!tags.building || tags.building === "no") continue;
    for (const ring of elementPolygons(el)) {
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          height: parseHeight(tags),
          minHeight: parseMinHeight(tags),
          isRoof: tags.building === "roof" || tags.building === "grandstand",
          isHospital: tags.building === "hospital" || tags.amenity === "hospital",
          isMosque: tags.building === "mosque" || tags.amenity === "place_of_worship",
          isDorm: tags.building === "dormitory",
          name: tags.name || ""
        }
      });
    }
  }
  return features;
}

// RTE Külliyesi'ne ait arazi poligonlarını seçer: işaretçiyi içeren VEYA
// adı eşleşen VEYA Marmara'ya ait çok yakın büyük poligonlar.
function selectGrounds(allGrounds) {
  const mine = [];
  for (const f of allGrounds) {
    const ring = f.geometry.coordinates[0];
    if (f.properties.areaM2 < 20000) continue;
    const [clng, clat] = polyCentroid(ring);
    const d = distKm(CAMPUS, { lat: clat, lng: clng });
    const name = (f.properties.name || "").toLocaleLowerCase("tr");
    const nameHit = CAMPUS.match.some(k => name.includes(k)) ||
      (name.includes("marmara") && d < 1.5);
    const contains = pointInRing([CAMPUS.lng, CAMPUS.lat], ring);
    if (contains || (nameHit && d < 2.0) || (f.properties.marmara && d < 1.0)) {
      mine.push(f);
    }
  }
  return mine;
}

// ---- Kenar çubuğu: külliyedeki adlı binalar ----

const listEl = document.getElementById("campus-list");

function fillBuildingList(features) {
  listEl.innerHTML = "";
  const seen = new Set();
  const named = features
    .filter(f => f.properties.name)
    .filter(f => (seen.has(f.properties.name) ? false : seen.add(f.properties.name)))
    .sort((a, b) => a.properties.name.localeCompare(b.properties.name, "tr"));
  for (const f of named) {
    const centroid = polyCentroid(f.geometry.coordinates[0]);
    const li = document.createElement("li");
    li.innerHTML = `<span class="campus-name">${f.properties.name}</span>`;
    li.addEventListener("click", () => {
      stopRotation();
      map.flyTo({ center: centroid, zoom: 17.5, pitch: 60, bearing: -15, duration: 1800 });
      new maplibregl.Popup({ offset: 12 })
        .setLngLat(centroid)
        .setHTML(`<strong>${f.properties.name}</strong>`)
        .addTo(map);
      listEl.querySelectorAll("li").forEach(el => el.classList.remove("active"));
      li.classList.add("active");
    });
    listEl.appendChild(li);
  }
  if (named.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = '<span class="campus-district">OSM verisinde adlandırılmış bina bulunamadı.</span>';
    listEl.appendChild(li);
  }
}

// ---- Veri yükleme ----

function applyData(data) {
  map.getSource("campus-grounds").setData(data.grounds);
  map.getSource("campus-buildings").setData(data.buildings);
  if (data.markerPos) {
    CAMPUS.lng = data.markerPos[0];
    CAMPUS.lat = data.markerPos[1];
    marker.setLngLat(data.markerPos);
  }
  applyFrame(data.rect);
  fillBuildingList(data.buildings.features);
}

async function loadCampusData() {
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  } catch (e) { /* bozuk önbellek yok sayılır */ }
  if (cached) {
    applyData(cached);
    if (Date.now() - cached.time < CACHE_TTL_MS) return;
  }

  try {
    // 1) Külliye arazi poligonları.
    const groundsOsm = await overpass(groundsQuery());
    const allGrounds = [];
    for (const el of groundsOsm.elements || []) {
      const tags = el.tags || {};
      if (tags.building) continue;
      const text = `${tags.name || ""} ${tags.operator || ""}`.toLocaleLowerCase("tr");
      for (const ring of elementPolygons(el)) {
        allGrounds.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [ring] },
          properties: {
            name: tags.name || "",
            marmara: text.includes("marmara"),
            areaM2: ringAreaM2(ring)
          }
        });
      }
    }
    const selected = selectGrounds(allGrounds);
    const rings = selected.map(f => f.geometry.coordinates[0]);
    const grounds = { type: "FeatureCollection", features: selected };

    // İşaretçi en büyük poligonun merkezine oturur.
    let markerPos = null;
    if (selected.length > 0) {
      const biggest = selected.reduce((a, b) =>
        a.properties.areaM2 > b.properties.areaM2 ? a : b);
      markerPos = polyCentroid(biggest.geometry.coordinates[0]);
      CAMPUS.lng = markerPos[0];
      CAMPUS.lat = markerPos[1];
      marker.setLngLat(markerPos);
    }

    // 2) Binalar: poligonları kapsayan yarıçap, sonra kesin poligon filtresi.
    let radius = 800;
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        radius = Math.max(radius, distKm(CAMPUS, { lat, lng }) * 1000 + 80);
      }
    }
    const bldOsm = await overpass(buildingsQuery(CAMPUS, Math.min(radius, 2500)));
    let features = buildingFeatures(bldOsm.elements || []);
    if (rings.length > 0) {
      features = features.filter(f => {
        const centroid = polyCentroid(f.geometry.coordinates[0]);
        return rings.some(ring => pointInRing(centroid, ring));
      });
    } else {
      // Poligon hiç bulunamazsa külliye çekirdeğiyle sınırlı dar alan (600 m).
      features = features.filter(f => {
        const centroid = polyCentroid(f.geometry.coordinates[0]);
        return distKm(CAMPUS, { lat: centroid[1], lng: centroid[0] }) < 0.6;
      });
    }
    const buildings = { type: "FeatureCollection", features };
    const rect = frameRect(rings);
    const data = { time: Date.now(), grounds, buildings, markerPos, rect };
    applyData(data);

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) { /* önbelleğe sığmazsa sorun değil */ }
    console.log(`RTE Külliyesi: ${selected.length} arazi poligonu, ${features.length} bina`);
  } catch (err) {
    console.warn("Külliye verisi yüklenemedi:", err);
    // Veri gelmese bile çerçeve kurulsun ki sayfa boş kalmasın.
    applyFrame(frameRect([]));
  }
}

// ---- Görünüm düğmeleri ----

let rotating = false;
let rotateFrame = null;

function stopRotation() {
  rotating = false;
  if (rotateFrame) cancelAnimationFrame(rotateFrame);
  document.getElementById("btn-rotate").classList.remove("active");
}

document.getElementById("btn-3d").addEventListener("click", () => {
  map.easeTo({ pitch: 60, duration: 800 });
  document.getElementById("btn-3d").classList.add("active");
  document.getElementById("btn-2d").classList.remove("active");
});

document.getElementById("btn-2d").addEventListener("click", () => {
  stopRotation();
  map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
  document.getElementById("btn-2d").classList.add("active");
  document.getElementById("btn-3d").classList.remove("active");
});

document.getElementById("btn-sat").addEventListener("click", () => {
  const btn = document.getElementById("btn-sat");
  const on = btn.classList.toggle("active");
  if (map.getLayer("satellite")) {
    map.setLayoutProperty("satellite", "visibility", on ? "visible" : "none");
  }
});

document.getElementById("btn-rotate").addEventListener("click", () => {
  if (rotating) {
    stopRotation();
    return;
  }
  rotating = true;
  document.getElementById("btn-rotate").classList.add("active");
  const spin = () => {
    if (!rotating) return;
    map.setBearing(map.getBearing() + 0.08);
    rotateFrame = requestAnimationFrame(spin);
  };
  spin();
});

// Kullanıcı haritayı elle çevirmeye başlarsa otomatik dönüşü durdur.
map.on("dragstart", stopRotation);
