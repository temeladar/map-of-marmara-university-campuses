// OpenFreeMap: API anahtarı gerektirmeyen, OSM tabanlı ücretsiz vektör tile servisi.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

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

// OSM bina ayak izlerini gerçek yüksekliklerine göre 3B olarak yükseltir.
map.on("load", () => {
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

  map.setLight({ anchor: "viewport", intensity: 0.4 });
});

const listEl = document.getElementById("campus-list");
let rotating = false;
let rotateFrame = null;

function stopRotation() {
  rotating = false;
  if (rotateFrame) cancelAnimationFrame(rotateFrame);
  document.getElementById("btn-rotate").classList.remove("active");
}

CAMPUSES.forEach((campus) => {
  const popup = new maplibregl.Popup({ offset: 32 }).setHTML(
    `<strong>${campus.name}</strong><br>` +
    `<em>${campus.district}</em><br>` +
    `${campus.info}`
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
      zoom: 16.5,
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
