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
- Sol üstteki **3B / 2B** düğmeleriyle perspektif ve kuş bakışı arasında geçiş yapın; **⟳** düğmesi kamerayı otomatik döndürür.

## Yerleşkeler

Yerleşke verileri `campuses.js` dosyasındadır. Koordinatlar yaklaşıktır; yeni yerleşke eklemek veya koordinat düzeltmek için bu dosyayı düzenleyin.

| Yerleşke | İlçe |
|---|---|
| Göztepe Yerleşkesi | Kadıköy |
| Recep Tayyip Erdoğan Külliyesi (Başıbüyük) | Maltepe |
| Anadoluhisarı Yerleşkesi | Beykoz |
| Haydarpaşa Yerleşkesi | Üsküdar |
| Sultanahmet Yerleşkesi | Fatih |
| Bağlarbaşı Yerleşkesi | Üsküdar |
| Acıbadem Yerleşkesi | Kadıköy |
| Dragos Yerleşkesi | Kartal |

## Notlar

- 3B binalar OpenStreetMap'in bina ayak izi + yükseklik verisinden üretilir; yükseklik verisi olmayan binalar için 8 m varsayılır. Fotogerçekçi (birebir doku kaplı) 3B için Google Photorealistic 3D Tiles veya Cesium ion gibi API anahtarı gerektiren servisler gerekir.
- MapLibre GL `vendor/` altında repoya gömülüdür; yalnızca harita tile'ları internetten yüklenir.
