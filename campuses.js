// Marmara Üniversitesi yerleşkeleri (güncel resmi liste; Haydarpaşa 2016'da
// Sağlık Bilimleri Üniversitesi'ne devredildiği için yer almaz).
// Koordinat kaynakları: haritamap.com / tr.geoview.info; "approximate" işaretliler
// resmi adresten türetilmiştir — düzeltmek için lat/lng değerlerini güncelleyin.
const CAMPUSES = [
  {
    name: "Göztepe Yerleşkesi",
    district: "Kadıköy",
    lat: 40.989307,
    lng: 29.054993,
    info: "Ana yerleşke. Hukuk, İşletme, İktisat, Mühendislik, Fen-Edebiyat, Teknoloji ve Atatürk Eğitim fakülteleri ile rektörlük birimleri ve merkez kütüphane."
  },
  {
    name: "Recep Tayyip Erdoğan Külliyesi",
    district: "Maltepe (Başıbüyük)",
    lat: 40.95170,
    lng: 29.13848,
    info: "Sağlık yerleşkesi: Tıp, Diş Hekimliği, Eczacılık, Sağlık Bilimleri ve Hemşirelik fakülteleri ile üniversite hastanesi. Alan olarak en büyük yerleşke (2,6 milyon m²)."
  },
  {
    name: "Mehmet Genç Külliyesi",
    district: "Kartal (Dragos)",
    lat: 40.9081,
    lng: 29.1590,
    approximate: true,
    info: "Eski Tekel Cevizli / İstanbul Şehir Üniversitesi yerleşkesi. Meslek yüksekokulları, öğrenci yurtları ve kongre merkezi; Marmara Denizi kıyısında."
  },
  {
    name: "Anadoluhisarı Yerleşkesi",
    district: "Beykoz",
    lat: 41.080917,
    lng: 29.071083,
    info: "Spor Bilimleri Fakültesi. Boğaz kıyısında, Göksu Deresi yakınında."
  },
  {
    name: "Bağlarbaşı Yerleşkesi",
    district: "Üsküdar (Altunizade)",
    lat: 41.020912,
    lng: 29.036346,
    info: "İlahiyat Fakültesi ve fakülte camisi (Mahir İz Cad. No:2)."
  },
  {
    name: "Acıbadem Yerleşkesi",
    district: "Kadıköy",
    lat: 41.0100,
    lng: 29.0450,
    approximate: true,
    info: "Güzel Sanatlar Fakültesi (Acıbadem Cad. No:117, Küçükçamlıca)."
  },
  {
    name: "Sultanahmet Yerleşkesi",
    district: "Fatih",
    lat: 41.0047,
    lng: 28.9740,
    approximate: true,
    info: "Tarihi rektörlük binası, At Meydanı (Hipodrom) No:1 — Sultanahmet Meydanı'nın güney ucunda."
  }
];
