# Map of Marmara University Campuses

Marmara Üniversitesi yerleşkelerini gösteren interaktif harita. [Leaflet](https://leafletjs.com/) ve OpenStreetMap kullanır — derleme adımı yok, statik bir sayfadır.

## Çalıştırma

`index.html` dosyasını tarayıcıda açmanız yeterli. Veya basit bir sunucuyla:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

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
