// OpenFreeMap "bright": sade 2B temel harita (yollar aşağıda gri/beyaza boyanır).
const STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
// Esri World Imagery: ücretsiz uydu görüntüsü (atıf zorunlu).
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
// Yalnızca Marmara Üniversitesi yerleşkelerindeki binalar OSM'den çekilip
// 3B modellenir; şehrin geri kalanı sade 2B kalır.
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// Kampüs arazisi OSM'de çizilmemişse işaretçi çevresinde bu yarıçap kullanılır.
const FALLBACK_RADIUS_M = 500;
// İstanbul'da Marmara Üniversitesi yerleşkelerini kapsayan sınır kutusu.
const BBOX = "40.85,28.90,41.12,29.25";

const map = new maplibregl.Map({
  container: "map",
  style: STYLE_URL,
  center: [29.05, 40.99],
  zoom: 10.5,
  pitch: 55,
  bearing: -15,
  antialias: true,
  attributionControl: { compact: false }
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

map.on("load", () => {
  // Genel haritanın yollarını gri/beyaz tonlara çevir (Google Maps görünümü).
  for (const layer of map.getStyle().layers) {
    if (layer.type === "line" && layer["source-layer"] === "transportation") {
      const gray = layer.id.includes("casing") || layer.id.includes("tunnel");
      map.setPaintProperty(layer.id, "line-color", gray ? "#c9c9c9" : "#ffffff");
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

  // Kampüs arazisi sınırları (canlı yeşil).
  map.addSource("campus-grounds", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });
  map.addLayer({
    id: "campus-grounds-fill",
    type: "fill",
    source: "campus-grounds",
    paint: { "fill-color": "#00c853", "fill-opacity": 0.14 }
  });
  map.addLayer({
    id: "campus-grounds-line",
    type: "line",
    source: "campus-grounds",
    paint: { "line-color": "#00a844", "line-width": 2.5 }
  });

  // Kampüsler arası ince parabolik bağlantı hatları (Göztepe merkezli).
  map.addSource("campus-links", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });
  map.addLayer({
    id: "campus-links",
    type: "line",
    source: "campus-links",
    layout: { "line-cap": "round" },
    paint: { "line-color": "#ff2d78", "line-width": 1.2, "line-opacity": 0.85 }
  });
  map.addLayer({
    id: "campus-links-label",
    type: "symbol",
    source: "campus-links",
    layout: {
      "symbol-placement": "line-center",
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11
    },
    paint: {
      "text-color": "#c2185b",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2
    }
  });

  // Yalnızca yerleşke binaları: 3B modellenen tek katman budur.
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
        ["get", "isRoof"], "#cfd8dc",
        ["get", "isHospital"], "#ff1744",
        ["get", "isMosque"], "#00c853",
        ["get", "isDorm"], "#aa00ff",
        "#ff9100"
      ],
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": ["get", "minHeight"],
      "fill-extrusion-opacity": 0.95
    }
  });

  map.setLight({ anchor: "viewport", intensity: 0.4 });
  buildConnections();
  loadCampusData();
});

// ---- Kampüsler arası bağlantılar ----

function distKm(a, b) {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d2r, dLng = (b.lng - a.lng) * d2r;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// İki nokta arasında parabolik (kuadratik Bezier) yay üretir.
function arcCoords(a, b, steps = 48, bulge = 0.18) {
  const mx = (a.lng + b.lng) / 2, my = (a.lat + b.lat) / 2;
  const dx = b.lng - a.lng, dy = b.lat - a.lat;
  const cx = mx - dy * bulge, cy = my + dx * bulge;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([
      (1 - t) ** 2 * a.lng + 2 * (1 - t) * t * cx + t * t * b.lng,
      (1 - t) ** 2 * a.lat + 2 * (1 - t) * t * cy + t * t * b.lat
    ]);
  }
  return pts;
}

// Ana yerleşke Göztepe'den diğer yerleşkelere yay çizer (mesafe etiketli).
function buildConnections() {
  const hub = CAMPUSES[0];
  const features = CAMPUSES.slice(1).map(c => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: arcCoords(hub, c) },
    properties: { label: `${distKm(hub, c).toFixed(1)} km` }
  }));
  const src = map.getSource("campus-links");
  if (src) src.setData({ type: "FeatureCollection", features });
}

// ---- Overpass: yalnızca üniversite arazisindeki binaları getir ----

// Tek istekte hem "Marmara" üniversite arazilerinin içindeki binaları hem de
// her işaretçinin çevresindeki binaları alır. (İki ayrı istek Overpass'ın eş
// zamanlılık sınırına takılıp ikincisi sessizce düşebiliyordu; Göztepe'nin
// boş kalmasının nedeni buydu.) Arazisi çizili kampüslerde çevre binaları
// istemci tarafında poligon dışı ayıklanır.
function campusDataQuery() {
  const around = CAMPUSES.map(c =>
    `way[building](around:${FALLBACK_RADIUS_M},${c.lat},${c.lng});`
  ).join("\n  ");
  return `[out:json][timeout:120];
(
  way["amenity"="university"]["name"~"armara"](${BBOX});
  relation["amenity"="university"]["name"~"armara"](${BBOX});
  way["amenity"="university"]["operator"~"armara"](${BBOX});
  relation["amenity"="university"]["operator"~"armara"](${BBOX});
)->.unis;
.unis map_to_area ->.a;
(
  way[building](area.a);
  relation[building](area.a);
  ${around}
)->.bld;
.unis out geom;
.bld out geom;`;
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
  // Saha üstü çatı/tribün gibi yapılar yükseklik verisi yoksa alçak çizilir.
  if (tags.building === "roof" || tags.building === "grandstand") return 5;
  return 9; // diğer binalar için ~3 kat varsay
}

function parseMinHeight(tags) {
  const mh = parseFloat(tags.min_height);
  if (Number.isFinite(mh)) return mh;
  const ml = parseFloat(tags["building:min_level"]);
  if (Number.isFinite(ml)) return ml * 3.2;
  return 0;
}

// way → tek poligon; multipolygon relation → outer üyelerin poligonları.
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
  for (const el of elements) {
    const tags = el.tags || {};
    // building=no gerçek bina değildir; spor sahaları böyle işaretlenebiliyor.
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

function polyCentroid(ring) {
  let lng = 0, lat = 0;
  for (const [x, y] of ring) { lng += x; lat += y; }
  return [lng / ring.length, lat / ring.length];
}

// Işın sayma yöntemiyle nokta-poligon testi.
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

// İşaretçileri OSM'deki gerçek kampüs poligonunun merkezine oturtur;
// isim eşleşmesi olan poligonlara öncelik verir.
function snapMarkers(groundFeatures) {
  CAMPUSES.forEach((c, i) => {
    let best = null, bestScore = Infinity;
    for (const f of groundFeatures) {
      const [clng, clat] = polyCentroid(f.geometry.coordinates[0]);
      const d = distKm(c, { lat: clat, lng: clng });
      if (d > 2.0) continue;
      const name = (f.properties.name || "").toLocaleLowerCase("tr");
      const nameHit = (c.match || []).some(k => name.includes(k));
      const score = nameHit ? d * 0.3 : d;
      if (score < bestScore) { bestScore = score; best = [clng, clat]; }
    }
    if (best) {
      c.lng = best[0];
      c.lat = best[1];
      markers[i].setLngLat(best);
    }
  });
  buildConnections();
}

async function overpass(query) {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return res.json();
}

async function loadCampusData() {
  try {
    const osm = await overpass(campusDataQuery());
    const elements = osm.elements || [];

    const groundFeatures = [];
    const buildingEls = [];
    for (const el of elements) {
      const tags = el.tags || {};
      if (tags.building) {
        buildingEls.push(el);
      } else if (tags.amenity === "university") {
        for (const ring of elementPolygons(el)) {
          groundFeatures.push({
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [ring] },
            properties: { name: tags.name || "" }
          });
        }
      }
    }

    // Arazisi OSM'de çizili olan kampüslerde yalnızca poligon içi binalar
    // kalır; arazisi çizilmemiş kampüslerde işaretçi çevresi kullanılır.
    const grounds = groundFeatures.map(f => f.geometry.coordinates[0]);
    const campusHasGrounds = CAMPUSES.map(c =>
      grounds.some(ring => pointInRing([c.lng, c.lat], ring))
    );
    const features = buildingFeatures(buildingEls).filter(f => {
      const centroid = polyCentroid(f.geometry.coordinates[0]);
      if (grounds.some(ring => pointInRing(centroid, ring))) return true;
      return CAMPUSES.some((c, i) => !campusHasGrounds[i] &&
        distKm(c, { lat: centroid[1], lng: centroid[0] }) < FALLBACK_RADIUS_M / 1000);
    });

    map.getSource("campus-grounds").setData({ type: "FeatureCollection", features: groundFeatures });
    map.getSource("campus-buildings").setData({ type: "FeatureCollection", features });
    snapMarkers(groundFeatures);
    console.log(`Yerleşke verisi: ${groundFeatures.length} arazi, ${features.length} bina`);
  } catch (err) {
    console.warn("Yerleşke bina verisi yüklenemedi:", err);
  }
}

// ---- Kenar çubuğu ve kamera ----

const listEl = document.getElementById("campus-list");
let rotating = false;
let rotateFrame = null;

function stopRotation() {
  rotating = false;
  if (rotateFrame) cancelAnimationFrame(rotateFrame);
  document.getElementById("btn-rotate").classList.remove("active");
}

const selectEl = document.getElementById("campus-select");
const markers = [];
const listItems = [];

function focusCampus(i) {
  const campus = CAMPUSES[i];
  stopRotation();
  map.flyTo({
    center: [campus.lng, campus.lat],
    zoom: 16.2,
    pitch: 60,
    bearing: -15,
    duration: 2500,
    essential: true
  });
  markers[i].togglePopup();
  listItems.forEach(el => el.classList.remove("active"));
  listItems[i].classList.add("active");
  selectEl.value = String(i);
}

function showAllCampuses() {
  stopRotation();
  const bounds = new maplibregl.LngLatBounds();
  CAMPUSES.forEach(c => bounds.extend([c.lng, c.lat]));
  map.fitBounds(bounds, { padding: 60, pitch: 55, bearing: -15, duration: 2000 });
  listItems.forEach(el => el.classList.remove("active"));
  selectEl.value = "all";
}

CAMPUSES.forEach((campus, i) => {
  const approxNote = campus.approximate
    ? '<br><small>(konum yaklaşıktır)</small>' : "";
  const popup = new maplibregl.Popup({ offset: 32 }).setHTML(
    `<strong>${campus.name}</strong><br>` +
    `<em>${campus.district}</em><br>` +
    `${campus.info}${approxNote}`
  );

  const marker = new maplibregl.Marker({ color: "#c2185b" })
    .setLngLat([campus.lng, campus.lat])
    .setPopup(popup)
    .addTo(map);
  markers.push(marker);

  const li = document.createElement("li");
  li.innerHTML = `<span class="campus-name">${campus.name}</span>` +
                 `<span class="campus-district">${campus.district}</span>`;
  li.addEventListener("click", () => focusCampus(i));
  listEl.appendChild(li);
  listItems.push(li);

  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = `${campus.name} (${campus.district})`;
  selectEl.appendChild(opt);
});

selectEl.addEventListener("change", () => {
  if (selectEl.value === "all") showAllCampuses();
  else if (selectEl.value !== "") focusCampus(Number(selectEl.value));
});

// ---- Görünüm düğmeleri ----

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
