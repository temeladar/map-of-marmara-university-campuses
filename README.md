# RTE Külliyesi Uydu Haritası

Marmara Üniversitesi **Recep Tayyip Erdoğan Külliyesi**'ne (Başıbüyük, Maltepe) odaklanmış interaktif harita. Külliyenin binaları, sentetik 3B modeller yerine **doğrudan gerçek uydu görüntüsüyle** (Esri World Imagery) gösterilir. [MapLibre GL JS](https://maplibre.org/) kullanır; API anahtarı ve derleme adımı gerektirmez — statik bir sayfadır.

## Çalıştırma

`index.html` dosyasını tarayıcıda açmanız yeterli. Veya basit bir sunucuyla:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## Özellikler

- Külliyenin binaları **gerçek uydu görüntüsünden** görünür (Esri World Imagery). Sentetik 3B kutular veya prosedürel bina modelleri yoktur — gördüğünüz binalar sahanın gerçek fotoğrafıdır.
- Harita, külliye sınırlarının **1 km çevresindeki dikdörtgen alanla** sınırlıdır: dışarısı beyaz maskeyle kapatılır, kamera bu çerçevenin dışına çıkamaz (pembe çizgi çerçeveyi, sarı çizgi kampüs sınırını gösterir).
- Varsayılan görünüm **kuş bakışı (2B)** ve uydu katmanı açıktır. **3B** düğmesi kamerayı eğerek arazi kabartmasını (Mapzen/AWS Terrain Tiles DEM) gösterir; **Uydu** düğmesi uydu katmanını açıp kapatır; **⟳** kamerayı otomatik döndürür.
- Kenar çubuğu, OSM'de adlandırılmış külliye binalarını listeler; bir bina seçince kamera oraya uçar ve o bina uydu görüntüsü üzerinde ince turkuaz bir çerçeveyle vurgulanır.
- Veri iki küçük Overpass sorgusuyla çekilir (arazi sınırları + bina adları/konumları), 4 aynada tekrar denenir ve 1 hafta `localStorage`'da önbelleklenir. İşaretçi, OSM'deki gerçek kampüs poligonunun merkezine otomatik oturur.

## Notlar

- Bina konumları/adları OSM/Overpass'tan gelir; yalnızca kenar çubuğu listesi ve seçili bina vurgusu için kullanılır. Binaların görünümü tamamen uydu görüntüsünden gelir.
- Daha da yakın/güncel fotogerçekçi görüntü için Esri yerine başka bir uydu tile sağlayıcısı (Google, Bing, Maxar vb.) kullanılabilir; çoğu API anahtarı ister.
- MapLibre GL `vendor/` altında repoya gömülüdür; yalnızca harita/uydu/DEM tile'ları ve OSM verisi internetten yüklenir.
