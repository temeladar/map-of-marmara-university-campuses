# Map of Marmara University Campuses

Marmara Üniversitesi yerleşkelerini 3B (üç boyutlu) gösteren interaktif harita. [MapLibre GL JS](https://maplibre.org/) ve [OpenFreeMap](https://openfreemap.org/) vektör tile'ları kullanır; binalar OpenStreetMap verisindeki gerçek yüksekliklerine göre 3B olarak çizilir. API anahtarı ve derleme adımı gerektirmez — statik bir sayfadır.

## Çalıştırma

`index.html` dosyasını tarayıcıda açmanız yeterli. Veya basit bir sunucuyla:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## Kullanım

- Kenar çubuğundan bir yerleşkeye tıklayın — kamera 3B görünümde oraya uçar.
- Sağ tık (veya Ctrl + sürükle) ile kamerayı döndürüp eğebilirsiniz.
- Sol üstteki **3B / 2B** düğmeleriyle perspektif ve kuş bakışı arasında geçiş yapın; **Uydu** düğmesi Esri uydu görüntüsünü açar, **⟳** düğmesi kamerayı otomatik döndürür.

## Yerleşkeler

Yerleşke verileri `campuses.js` dosyasındadır. Haydarpaşa Yerleşkesi 2016'da Sağlık Bilimleri Üniversitesi'ne devredildiği için listede yer almaz.

| Yerleşke | İlçe | Koordinat kaynağı |
|---|---|---|
| Göztepe Yerleşkesi | Kadıköy | haritamap.com |
| Recep Tayyip Erdoğan Külliyesi | Maltepe (Başıbüyük) | tr.geoview.info |
| Mehmet Genç Külliyesi | Kartal (Dragos) | adresten türetildi (yaklaşık) |
| Anadoluhisarı Yerleşkesi | Beykoz | haritamap.com |
| Bağlarbaşı Yerleşkesi | Üsküdar (Altunizade) | haritamap.com |
| Acıbadem Yerleşkesi | Kadıköy | adresten türetildi (yaklaşık) |
| Sultanahmet Yerleşkesi | Fatih | adresten türetildi (yaklaşık) |

## Notlar

- Yalnızca Marmara Üniversitesi yerleşkelerindeki binalar 3B modellenir; şehrin geri kalanı modellenmez. Sayfa açılışında Overpass API'den, OSM'de "Marmara" adına kayıtlı üniversite arazilerinin içindeki bina ayak izleri canlı çekilir; yerleşke sınırları yeşil kesikli çizgiyle gösterilir. Hastane binaları kiremit, cami yapıları yeşil, diğer yerleşke binaları turuncu tonla çizilir.
- Yükseklik `height` → `building:levels × 3,2 m` → 9 m sırasıyla belirlenir. Fotogerçekçi (birebir doku kaplı) 3B için Google Photorealistic 3D Tiles veya Cesium ion gibi API anahtarı gerektiren servisler gerekir.
- MapLibre GL `vendor/` altında repoya gömülüdür; yalnızca harita tile'ları internetten yüklenir.
