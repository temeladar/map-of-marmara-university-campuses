# RTE Külliyesi 3B Harita

Marmara Üniversitesi **Recep Tayyip Erdoğan Külliyesi**'ne (Başıbüyük, Maltepe) odaklanmış interaktif 3B harita. [MapLibre GL JS](https://maplibre.org/) + [three.js](https://threejs.org/) kullanır; API anahtarı ve derleme adımı gerektirmez — statik bir sayfadır.

## Çalıştırma

`index.html` dosyasını tarayıcıda açmanız yeterli. Veya basit bir sunucuyla:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## Özellikler

- Harita, külliye sınırlarının **1 km çevresindeki dikdörtgen alanla** sınırlıdır: dışarısı beyaz maskeyle kapatılır, kamera bu çerçevenin dışına çıkamaz (pembe çizgi çerçeveyi gösterir).
- Harita **3B arazi (terrain)** içerir: yükseklik verisi açık Mapzen/AWS Terrain Tiles DEM'inden yüklenir, hafif hillshade gölgelemesiyle desteklenir.
- Külliyenin binaları OSM ayak izlerinden **three.js ile gerçek 3B model** olarak (özel MapLibre katmanında ekstrüde edilmiş geometriler) arazi üzerine çizilir; her bina `queryTerrainElevation` ile bulunduğu noktadaki zemine oturtulur, yamaçlarda altı açık kalmasın diye zemine gömülü bir temel eklenir. Apple Maps benzeri açık krem/pastel stil korunur (hastane, cami ve yurt binaları pastel tonlarla ayrışır). Kampüs poligonu dışındaki hiçbir bina modellenmez.
- Kenar çubuğu, OSM'de adlandırılmış külliye binalarını listeler; tıklayınca kamera binaya uçar.
- **3B / 2B** perspektif geçişi, **Uydu** (Esri) katmanı ve **⟳** otomatik kamera dönüşü.
- Veri iki küçük Overpass sorgusuyla çekilir, 4 aynada tekrar denenir ve 1 hafta `localStorage`'da önbelleklenir. İşaretçi, OSM'deki gerçek kampüs poligonunun merkezine otomatik oturur.

## Notlar

- Bina yükseklikleri `height` → `building:levels × 3,2 m` → 9 m sırasıyla belirlenir; saha üstü çatı/tribün yapıları alçak ve açık gri çizilir.
- Fotogerçekçi (birebir doku kaplı) 3B için Google Photorealistic 3D Tiles veya Cesium ion gibi API anahtarı gerektiren servisler gerekir.
- MapLibre GL ve three.js `vendor/` altında repoya gömülüdür; yalnızca harita/DEM tile'ları ve OSM verisi internetten yüklenir. three.js yüklenemezse binalar eski `fill-extrusion` görünümüne geri döner.
