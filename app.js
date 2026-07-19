// Odak: yalnızca RTE Külliyesi. Harita, kampüs sınırlarının 1 km çevresindeki
// dikdörtgen alanla sınırlıdır; dışarısı beyaz maskeyle kapatılır ve kamera
// bu alanın dışına çıkamaz.
const STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
// Açık yükseklik (DEM) tile'ları — anahtar gerektirmez (Mapzen/AWS Terrain Tiles).
const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
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
const CACHE_KEY = "marmara-rte-data-v4";
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

// ---- three.js: binaları arazi üzerinde gerçek 3B model olarak çizen özel katman ----
// MapLibre'nin "Adding 3D models with three.js on terrain" örneğindeki kalıp:
// sahne merkezi bir kampüs noktasına sabitlenir, her karede queryTerrainElevation
// ile merkezin araziye göre yüksekliği alınıp sahne matrisine eklenir.
//
// Görsel hedef: külliyenin gerçek mimarisi (Selçuklu-Osmanlı çizgili, avlu
// merkezli, az katlı BEJ TAŞ cepheler). Cephelere kat başına pencere sıralı
// prosedürel taş doku, çatılara Esri uydu görüntüsünden GERÇEK çatı dokusu
// giydirilir; cami kubbe + minare ile modellenir.

// Cephe duvar tonları (bej taş; kategoriye göre çok hafif ayrım).
const WALL_COLORS = {
  roof: "#d5d2cb",
  hospital: "#eadfd3",
  mosque: "#f2ece0",
  dorm: "#e5decf",
  default: "#eae2d0"
};
const ROOF_FALLBACK = "#b8b0a4"; // uydu dokusu yüklenene kadarki çatı rengi
const FLOOR_M = 3.2;             // bir kat / pencere modülü yüksekliği (m)
const WINDOW_W_M = 3.0;          // bir pencere modülü genişliği (m)
// Yamaçta binanın altı açık kalmasın diye zeminin altına inen temel derinliği (m).
const FOUNDATION_M = 8;

const threeBuildings = {
  id: "threejs-buildings",
  type: "custom",
  renderingMode: "3d",
  origin: [CAMPUS.lng, CAMPUS.lat],
  pendingFeatures: null,
  meshes: [],

  onAdd(mapInstance, gl) {
    this.map = mapInstance;
    this.camera = new THREE.Camera();
    // Sahne ekseni: x = doğu (m), y = kuzey (m), z = yukarı (m).
    this.scene = new THREE.Scene();

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(0.6, -0.5, 1).normalize();
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.2);
    fill.position.set(-0.7, 0.6, 0.6).normalize();
    this.scene.add(fill);

    // Pencere sıralı cephe dokusu: beyaz zemin materyal rengiyle boyanır.
    this.facadeTexture = this.makeFacadeTexture();
    this.wallMaterials = {};
    for (const [kind, color] of Object.entries(WALL_COLORS)) {
      this.wallMaterials[kind] = new THREE.MeshLambertMaterial({
        color,
        map: kind === "roof" ? null : this.facadeTexture,
        side: THREE.DoubleSide
      });
    }
    this.customWallMaterials = {}; // OSM building:colour değerleri için
    this.roofMaterial = new THREE.MeshLambertMaterial({
      color: ROOF_FALLBACK,
      side: THREE.DoubleSide
    });
    this.domeMaterial = new THREE.MeshLambertMaterial({ color: "#8fa0a8" });   // kurşun
    this.minaretMaterial = new THREE.MeshLambertMaterial({ color: "#efe9dd" });

    this.renderer = new THREE.WebGLRenderer({
      canvas: mapInstance.getCanvas(),
      context: gl,
      antialias: true
    });
    this.renderer.autoClear = false;

    if (this.pendingFeatures) {
      const features = this.pendingFeatures;
      this.pendingFeatures = null;
      this.setBuildings(features);
    }
  },

  // Tek pencere modülü (WINDOW_W_M × FLOOR_M) — tekrarlanarak cepheyi kaplar.
  makeFacadeTexture() {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 128, 128);
    // Kat hizasında ince taş derz bandı.
    g.fillStyle = "rgba(90,75,55,0.10)";
    g.fillRect(0, 0, 128, 5);
    // Dikey derz.
    g.fillStyle = "rgba(90,75,55,0.05)";
    g.fillRect(0, 0, 3, 128);
    // Pencere: koyu camlı, açık söveli.
    const w = 56, h = 66, x = (128 - w) / 2, y = (128 - h) / 2 + 8;
    g.fillStyle = "rgba(120,105,80,0.25)"; // söve
    g.fillRect(x - 6, y - 6, w + 12, h + 12);
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "#46586a");
    grad.addColorStop(1, "#7d92a3");
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    g.strokeStyle = "rgba(255,255,255,0.75)";
    g.lineWidth = 3;
    g.strokeRect(x, y, w, h);
    g.beginPath();
    g.moveTo(x + w / 2, y);
    g.lineTo(x + w / 2, y + h);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  },

  // (lng, lat) → sahne merkezine göre metre (x = doğu, y = kuzey) ve tersi.
  toLocal(lng, lat) {
    const d2r = Math.PI / 180, R = 6378137;
    return [
      (lng - this.origin[0]) * d2r * R * Math.cos(this.origin[1] * d2r),
      (lat - this.origin[1]) * d2r * R
    ];
  },
  fromLocal(x, y) {
    const d2r = Math.PI / 180, R = 6378137;
    return [
      this.origin[0] + x / (R * Math.cos(this.origin[1] * d2r) * d2r),
      this.origin[1] + y / (R * d2r)
    ];
  },

  // Tüm binaları kapsayan tek bir uydu görüntüsü kanvası hazırlar; çatılar bu
  // dokudan coğrafi konumlarına göre UV alır (gerçek çatı görünümü).
  buildRoofTexture(features) {
    if (!features.length || typeof Image === "undefined") return;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const f of features) {
      for (const [lng, lat] of f.geometry.coordinates[0]) {
        minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
    }
    const xOf = (lng, z) => (lng + 180) / 360 * Math.pow(2, z);
    const yOf = (lat, z) => {
      const r = lat * Math.PI / 180;
      return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
    };
    let z = 18, tx0, ty0, tx1, ty1;
    for (; z >= 15; z--) {
      tx0 = Math.floor(xOf(minLng, z)); tx1 = Math.floor(xOf(maxLng, z));
      ty0 = Math.floor(yOf(maxLat, z)); ty1 = Math.floor(yOf(minLat, z));
      if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= 100) break;
    }
    const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1;
    const canvas = document.createElement("canvas");
    canvas.width = nx * 256;
    canvas.height = ny * 256;
    const ctx = canvas.getContext("2d");
    this.roofUV = (lng, lat) => [
      (xOf(lng, z) - tx0) / nx,
      1 - (yOf(lat, z) - ty0) / ny
    ];
    let pending = nx * ny, loaded = 0;
    const done = () => {
      if (!loaded) return; // hiç tile gelmediyse düz renkte kal
      const tex = new THREE.CanvasTexture(canvas);
      tex.anisotropy = 4;
      this.roofMaterial.map = tex;
      this.roofMaterial.color.set("#ffffff");
      this.roofMaterial.needsUpdate = true;
      if (this.map) this.map.triggerRepaint();
    };
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          ctx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256);
          loaded++;
          if (--pending === 0) done();
        };
        img.onerror = () => { if (--pending === 0) done(); };
        img.src = SATELLITE_TILES
          .replace("{z}", z).replace("{y}", ty).replace("{x}", tx);
      }
    }
  },

  // Kapalı halkadan (son nokta tekrarı olmadan) saat yönünün tersine yerel
  // koordinat listesi üretir.
  localRing(ring) {
    const pts = [];
    for (let i = 0; i < ring.length - 1; i++) {
      pts.push(this.toLocal(ring[i][0], ring[i][1]));
    }
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area < 0) pts.reverse();
    return pts;
  },

  // Dış duvarlar: kenar başına quad; UV metre cinsinden (u: pencere modülü,
  // v: kat). Temel derinliği kadar zemin altına iner, terrain altta kalanı örter.
  wallGeometry(pts, height, foundation) {
    const pos = [], norm = [], uv = [];
    const vTop = Math.max(1, Math.round(height / FLOOR_M));
    const vBottom = -foundation / FLOOR_M;
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      const nxv = dy / len, nyv = -dx / len; // CCW halkada dışa bakan normal
      const u0 = dist / WINDOW_W_M, u1 = (dist + len) / WINDOW_W_M;
      pos.push(
        a[0], a[1], -foundation, b[0], b[1], -foundation, b[0], b[1], height,
        a[0], a[1], -foundation, b[0], b[1], height, a[0], a[1], height
      );
      for (let k = 0; k < 6; k++) norm.push(nxv, nyv, 0);
      uv.push(u0, vBottom, u1, vBottom, u1, vTop, u0, vBottom, u1, vTop, u0, vTop);
      dist += len;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    return g;
  },

  // Çatı: ayak izi poligonu, UV'leri uydu kanvasındaki coğrafi konumdan alır.
  roofGeometry(pts) {
    const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
    const geom = new THREE.ShapeGeometry(shape);
    if (this.roofUV) {
      const posAttr = geom.attributes.position, uvAttr = geom.attributes.uv;
      for (let i = 0; i < posAttr.count; i++) {
        const [lng, lat] = this.fromLocal(posAttr.getX(i), posAttr.getY(i));
        const [u, v] = this.roofUV(lng, lat);
        uvAttr.setXY(i, u, v);
      }
    }
    return geom;
  },

  wallMaterialFor(p, kind) {
    if (p.wallColour && /^#?[0-9a-z]+$/i.test(p.wallColour)) {
      if (!this.customWallMaterials[p.wallColour]) {
        this.customWallMaterials[p.wallColour] = new THREE.MeshLambertMaterial({
          color: new THREE.Color(p.wallColour),
          map: this.facadeTexture,
          side: THREE.DoubleSide
        });
      }
      return this.customWallMaterials[p.wallColour];
    }
    return this.wallMaterials[kind];
  },

  setBuildings(features) {
    if (!this.scene) {
      this.pendingFeatures = features;
      return;
    }
    for (const group of this.meshes) {
      this.scene.remove(group);
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    this.meshes = [];
    this.origin = [CAMPUS.lng, CAMPUS.lat];
    this.buildRoofTexture(features); // roofUV'yi hemen kurar, doku sonradan gelir

    for (const f of features) {
      const ring = f.geometry.coordinates[0];
      const p = f.properties;
      const pts = this.localRing(ring);
      if (pts.length < 3) continue;
      const kind = p.isRoof ? "roof"
        : p.isHospital ? "hospital"
        : p.isMosque ? "mosque"
        : p.isDorm ? "dorm"
        : "default";
      // Köprü/saçak gibi min_height'lı parçalarda temel yok (altı görünür kalır).
      const foundation = p.minHeight > 0 ? 0 : FOUNDATION_M;
      const bodyH = Math.max(p.height - p.minHeight, 2);

      const group = new THREE.Group();
      group.add(new THREE.Mesh(
        this.wallGeometry(pts, bodyH, foundation),
        this.wallMaterialFor(p, kind)
      ));
      const roof = new THREE.Mesh(this.roofGeometry(pts), this.roofMaterial);
      roof.position.z = bodyH;
      group.add(roof);

      if (p.isMosque) this.addMosqueDetails(group, pts, bodyH);

      group.userData.centroid = polyCentroid(ring);
      group.userData.zBase = p.minHeight;
      group.position.z = p.minHeight;
      this.scene.add(group);
      this.meshes.push(group);
    }
    this.updateElevations();
    if (this.map) this.map.triggerRepaint();
  },

  // Cami: çatı merkezine kurşun kaplı kubbe, en uzak köşeye minare.
  addMosqueDetails(group, pts, bodyH) {
    let cx = 0, cy = 0;
    for (const [x, y] of pts) { cx += x; cy += y; }
    cx /= pts.length; cy /= pts.length;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    area = Math.abs(area / 2);
    const radius = Math.min(Math.max(Math.sqrt(area / Math.PI) * 0.6, 4), 16);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      this.domeMaterial
    );
    dome.position.set(cx, cy, bodyH);
    group.add(dome);

    let far = pts[0], best = 0;
    for (const pt of pts) {
      const d = (pt[0] - cx) ** 2 + (pt[1] - cy) ** 2;
      if (d > best) { best = d; far = pt; }
    }
    const minaretH = bodyH + radius + 18;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.7, minaretH, 12),
      this.minaretMaterial
    );
    shaft.rotation.x = Math.PI / 2; // silindir ekseni z'ye (yukarı) çevrilir
    shaft.position.set(far[0], far[1], minaretH / 2);
    group.add(shaft);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 6, 12), this.domeMaterial);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(far[0], far[1], minaretH + 3);
    group.add(cap);
  },

  // Her binayı bulunduğu noktadaki arazi yüksekliğine oturtur. Yükseklikler
  // sahne merkezine göre farktır; terrain tile'ları geldikçe yeniden çağrılır.
  updateElevations() {
    if (!this.map || this.meshes.length === 0) return;
    const base = this.map.queryTerrainElevation(this.origin);
    if (base == null) return;
    let changed = false;
    for (const mesh of this.meshes) {
      const elev = this.map.queryTerrainElevation(mesh.userData.centroid);
      const z = (elev == null ? 0 : elev - base) + mesh.userData.zBase;
      if (Math.abs(mesh.position.z - z) > 0.05) {
        mesh.position.z = z;
        changed = true;
      }
    }
    if (changed) this.map.triggerRepaint();
  },

  render(gl, matrix) {
    if (!this.renderer || this.meshes.length === 0) return;
    // queryTerrainElevation, kamera merkezinin arazi yüksekliğine GÖRE fark
    // döndürür; bu ofset eklenmezse sahne havada/yerin altında görünür.
    const centerOffset = this.map.queryTerrainElevation(this.origin) || 0;
    const originMerc = maplibregl.MercatorCoordinate.fromLngLat(this.origin, centerOffset);
    const s = originMerc.meterInMercatorCoordinateUnits();
    const m = new THREE.Matrix4().fromArray(matrix);
    // scale(s, -s, s): sahnedeki (doğu, kuzey, yukarı) → mercator (x, -y, z).
    const l = new THREE.Matrix4()
      .makeTranslation(originMerc.x, originMerc.y, originMerc.z)
      .scale(new THREE.Vector3(s, -s, s));
    this.camera.projectionMatrix = m.multiply(l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }
};

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

  // 3B arazi: DEM kaynağı + hafif gölgeleme (hillshade).
  map.addSource("terrain-dem", {
    type: "raster-dem",
    tiles: [TERRAIN_TILES],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 13,
    attribution: "Yükseklik verisi © Mapzen, AWS Terrain Tiles"
  });
  map.addSource("hillshade-dem", {
    type: "raster-dem",
    tiles: [TERRAIN_TILES],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 13
  });
  map.setTerrain({ source: "terrain-dem", exaggeration: 1 });

  // Hillshade uydunun ALTINA eklenir: uydu açıkken kendi gölgeleri yeter.
  map.addLayer({
    id: "hillshade",
    type: "hillshade",
    source: "hillshade-dem",
    paint: {
      "hillshade-shadow-color": "#5a4f3f",
      "hillshade-exaggeration": 0.35
    }
  });

  // Gerçekçi görünüm için uydu zemini varsayılan olarak AÇIK başlar.
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
    layout: { visibility: "visible" }
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

  // Külliye binaları — three.js ile arazi üzerinde gerçek 3B modeller.
  // GeoJSON kaynağı zemin izi (footprint) altlığı için tutulur; hacimler
  // yukarıdaki threeBuildings özel katmanında çizilir.
  map.addSource("campus-buildings", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });
  map.addLayer({
    id: "campus-buildings-footprint",
    type: "fill",
    source: "campus-buildings",
    minzoom: 11,
    paint: { "fill-color": "#d8d4cc", "fill-opacity": 0.25 }
  });

  if (window.THREE) {
    map.addLayer(threeBuildings);
    // Terrain tile'ları geldikçe binaları zemine yeniden oturt.
    map.on("idle", () => threeBuildings.updateElevations());
  } else {
    // three.js yüklenemezse eski fill-extrusion görünümüne dön.
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
  }

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
          wallColour: tags["building:colour"] || "",
          roofColour: tags["roof:colour"] || "",
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
  // three.js bina modelleri (sahne merkezi güncel CAMPUS konumuna kurulur).
  threeBuildings.setBuildings(data.buildings.features);
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
