// OpenFreeMap: API anahtarı gerektirmeyen, OSM tabanlı ücretsiz vektör tile servisi.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// Esri World Imagery: ücretsiz uydu görüntüsü (atıf zorunlu).
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
// Yalnızca Marmara Üniversitesi yerleşkelerindeki binalar OSM'den çekilip
// 3B modellenir; şehrin geri kalanı modellenmez.
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// OSM'de kampüs arazisi çizilmemişse yedek olarak kullanılacak yarıçap.
const FALLBACK_RADIUS_M = 350;
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

  // Kampüs arazisi sınırları.
  map.addSource("campus-grounds", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });
  map.addLayer({
    id: "campus-grounds-fill",
    type: "fill",
    source: "campus-grounds",
    paint: { "fill-color": "#2e7d32", "fill-opacity": 0.12 }
  });
  map.addLayer({
    id: "campus-grounds-line",
    type: "line",
    source: "campus-grounds",
    paint: { "line-color": "#2e7d32", "line-width": 2, "line-dasharray": [3, 2] }
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
        ["get", "isHospital"], "#b46a55",
        ["get", "isMosque"], "#7d8f6b",
        "#c98a4b"
      ],
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": ["get", "minHeight"],
      "fill-extrusion-opacity": 0.95
    }
  });

  map.setLight({ anchor: "viewport", intensity: 0.4 });
  loadCampusData();
});

// ---- Overpass: yalnızca üniversite arazisindeki binaları getir ----

// OSM'de "Marmara" adlı/işletmeli üniversite arazilerini bulur, bu arazilerin
// İÇİNDEKİ binaları döndürür. Şehrin geri kalanındaki binalar sorguya girmez.
function campusAreaQuery() {
  return `[out:json][timeout:90];
(
  way["amenity"="university"]["name"~"armara"](${BBOX});
  relation["amenity"="university"]["name"~"armara"](${BBOX});
  way["operator"~"Marmara Üniversitesi"](${BBOX});
  relation["operator"~"Marmara Üniversitesi"](${BBOX});
)->.unis;
.unis map_to_area ->.a;
(
  way[building](area.a);
  relation[building](area.a);
)->.bld;
.unis out geom;
.bld out geom;`;
}

// Arazi poligonu çizilmemiş yerleşkeler için yedek: nokta çevresindeki binalar.
function fallbackQuery(campuses) {
  const clauses = campuses.map(c =>
    `way[building](around:${FALLBACK_RADIUS_M},${c.lat},${c.lng});`
  ).join("");
  return `[out:json][timeout:60];(${clauses});out geom;`;
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
  return 9; // yükseklik verisi yoksa ~3 kat varsay
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
    if (!tags.building) continue;
    for (const ring of elementPolygons(el)) {
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          height: parseHeight(tags),
          minHeight: parseMinHeight(tags),
          isHospital: tags.building === "hospital" || tags.amenity === "hospital",
          isMosque: tags.building === "mosque" || tags.amenity === "place_of_worship",
          name: tags.name || ""
        }
      });
    }
  }
  return features;
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
    const osm = await overpass(campusAreaQuery());
    const elements = osm.elements || [];

    const groundFeatures = [];
    const buildingEls = [];
    for (const el of elements) {
      const tags = el.tags || {};
      if (tags.building) {
        buildingEls.push(el);
      } else if (tags.amenity === "university" || tags.operator) {
        for (const ring of elementPolygons(el)) {
          groundFeatures.push({
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [ring] },
            properties: { name: tags.name || "" }
          });
        }
      }
    }

    let features = buildingFeatures(buildingEls);

    // Arazi poligonu OSM'de eksikse (çok az bina döndüyse) nokta çevresi yedeği.
    if (features.length < 10) {
      const fb = await overpass(fallbackQuery(CAMPUSES));
      features = buildingFeatures(fb.elements || []);
    }

    map.getSource("campus-grounds").setData({ type: "FeatureCollection", features: groundFeatures });
    map.getSource("campus-buildings").setData({ type: "FeatureCollection", features });
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

  const marker = new maplibregl.Marker({ color: "#10314b" })
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
