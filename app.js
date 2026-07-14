// OpenFreeMap: API anahtarı gerektirmeyen, OSM tabanlı ücretsiz vektör tile servisi.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// Esri World Imagery: ücretsiz uydu görüntüsü (atıf zorunlu).
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
// Kampüs binalarının gerçek ayak izi ve yükseklikleri çalışma anında OSM'den çekilir.
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const CAMPUS_RADIUS_M = 600;

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

  // Temel haritanın kendi binaları (OSM yükseklik verisiyle).
  map.addLayer({
    id: "3d-buildings",
    source: "openmaptiles",
    "source-layer": "building",
    type: "fill-extrusion",
    minzoom: 13,
    paint: {
      "fill-extrusion-color": [
        "interpolate", ["linear"],
        ["coalesce", ["get", "render_height"], 8],
        0, "#d8cfc0",
        30, "#b3a591",
        80, "#8d7f6d"
      ],
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.92
    }
  });

  // Kampüs binaları: Overpass'tan çekilen güncel OSM ayak izleri.
  // Temel haritanın tile'larında eksik/basit kalan yeni yapıları (ör. RTE
  // Külliyesi) da kapsar ve uydu görünümünde de 3B çizilir.
  map.addSource("campus-buildings", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });
  map.addLayer({
    id: "campus-buildings",
    type: "fill-extrusion",
    source: "campus-buildings",
    minzoom: 12,
    paint: {
      "fill-extrusion-color": [
        "case",
        ["get", "isCampus"], "#c98a4b",
        "#cfc5b4"
      ],
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": ["get", "minHeight"],
      "fill-extrusion-opacity": 0.95
    }
  });

  map.setLight({ anchor: "viewport", intensity: 0.4 });
  loadCampusBuildings();
});

// ---- Overpass: kampüs çevresindeki bina ayak izlerini getir ----

function overpassQuery() {
  const clauses = CAMPUSES.map(c =>
    `way[building](around:${CAMPUS_RADIUS_M},${c.lat},${c.lng});`
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

// Üniversiteye ait görünen binaları vurgulamak için basit sezgisel kontrol.
function isCampusBuilding(tags) {
  const t = `${tags.name || ""} ${tags.operator || ""}`.toLocaleLowerCase("tr");
  return t.includes("marmara") || t.includes("üniversite") ||
    ["university", "hospital", "dormitory", "college"].includes(tags.building) ||
    tags.amenity === "university" || tags.amenity === "hospital";
}

async function loadCampusBuildings() {
  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      body: "data=" + encodeURIComponent(overpassQuery()),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const osm = await res.json();

    const features = [];
    for (const el of osm.elements || []) {
      if (el.type !== "way" || !el.geometry || el.geometry.length < 3) continue;
      const ring = el.geometry.map(p => [p.lon, p.lat]);
      const first = ring[0], last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
      const tags = el.tags || {};
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          height: parseHeight(tags),
          minHeight: parseMinHeight(tags),
          isCampus: isCampusBuilding(tags)
        }
      });
    }
    map.getSource("campus-buildings").setData({ type: "FeatureCollection", features });
    console.log(`Kampüs binaları yüklendi: ${features.length} bina`);
  } catch (err) {
    // Overpass'a ulaşılamazsa temel haritanın kendi 3B binaları göstermeye devam eder.
    console.warn("Kampüs bina verisi yüklenemedi:", err);
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

CAMPUSES.forEach((campus) => {
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

  const li = document.createElement("li");
  li.innerHTML = `<span class="campus-name">${campus.name}</span>` +
                 `<span class="campus-district">${campus.district}</span>`;
  li.addEventListener("click", () => {
    stopRotation();
    map.flyTo({
      center: [campus.lng, campus.lat],
      zoom: 16.2,
      pitch: 60,
      bearing: -15,
      duration: 2500,
      essential: true
    });
    marker.togglePopup();
    listEl.querySelectorAll("li").forEach(el => el.classList.remove("active"));
    li.classList.add("active");
  });
  listEl.appendChild(li);
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
