# Time's Hub | Attribution Intelligence

Dijital kanal attribution platformu — **Time x Growity**.
**DDA (Data-Driven Attribution)** motoru: Markov Chain (%65) + Shapley Value (%35) ensemble.
BigQuery GA4 entegrasyonu ile gerçek kullanıcı yolculuğu verisi üzerinde çalışır.

## Deploy (Render.com — ücretsiz)

Hiçbir kurulum gerektirmez. Render.com hesabı ile tek tıkla deploy:

1. [render.com/register](https://render.com/register) adresinden ücretsiz hesap oluşturun
2. Dashboard > **New** > **Blueprint** > bu GitHub repo'yu bağlayın
3. Render otomatik olarak `render.yaml` dosyasını okuyup deploy eder
4. Birkaç dakika içinde URL'niz hazır olur: `https://times-hub.onrender.com`

> Giriş: `admin` / `attribution2026`

---

## Quick Start (Docker)

**Tek komutla çalıştırın:**

```bash
git clone <repo-url> && cd attribution-intelligence-hub
./scripts/setup.sh
```

Bu komut:
1. `.env` dosyasını otomatik oluşturur
2. Docker ile frontend + backend build eder
3. Health check yapar ve URL'leri gösterir

Uygulama: **http://localhost:8000** | API Docs: **http://localhost:8000/docs**

> Giriş: `admin` / `attribution2026` (`.env` dosyasından değiştirilebilir)

### Yararlı Docker komutları

```bash
docker compose logs -f       # logları izle
docker compose down           # durdur
docker compose restart        # yeniden başlat
docker compose up --build -d  # yeniden build et
```

---

## Lokal Geliştirme (Docker'sız)

### Backend
```bash
cd backend
pip install -r ../requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
npm install
npm run dev
```

### Tests
```bash
python -m pytest tests/ -v
```

---

## Mimari

| Katman | Teknoloji |
|--------|-----------|
| Backend | Python 3.11+ / FastAPI |
| DDA Engine | Custom Markov Chain + Shapley Value (Python) |
| MMM Engine | Adstock/Saturation/Response (medya planlama simülasyonu için) |
| Frontend | React 18 + Vite + Tailwind CSS |
| Charts | Chart.js (react-chartjs-2) |
| Database | SQLite (dev) / PostgreSQL (prod) |
| Veri Import | CSV/Excel (pandas) + BigQuery GA4 export |
| Auth | JWT (python-jose) + bcrypt |
| Export | Excel (openpyxl) + PowerPoint (python-pptx) |

## Attribution Modeli

```
DDA Attribution = Markov Chain × 0.65 + Shapley Value × 0.35
Unified Score  = DDA Score (tek kaynak)
```

MMM ve incrementality katmanları şu an devre dışıdır — gerçek veriye fit edilmiş model bulunmadığı için.
8+ haftalık kalibrasyon verisi toplandığında tekrar aktifleştirilecektir.

## Özellikler

- **DDA Attribution:** CSV veya BigQuery'den kullanıcı yolculukları çıkarır, Markov + Shapley ensemble ile kanal katkı paylarını hesaplar
- **Kaynaktan Bağımsız Motor:** DDA motoru `lead_id, timestamp, channel, converted, revenue` standart şeması üzerinde çalışır. GA4 yalnızca ilk konnektör; CRM, server-side GTM, app analytics, ad-cost export veya offline conversion gibi **her BigQuery tablosu** kolon eşlemesiyle aynı motora akar
- **BigQuery GA4 Entegrasyonu:** Session-scoped source/medium ile gerçek multi-touch yolculuklar
- **Medya Planlama Simülasyonu:** Haftalık harcama planı gir, adstock/saturation modeli ile tahmini lead çıktısı al
- **Benchmark & Sağlama:** DDA sonuçlarından empirik kanal metrikleri, plan vs gerçekleşme karşılaştırması
- **Otomatik Çıkarım Motoru:** DDA sonuçlarından veri kalitesi ve kanal performansı insight'ları
- **Trend Analizi:** Ardışık DDA çalıştırmalarını karşılaştır, değişimleri tespit et
- **Proaktif Alert Sistemi:** Dönüşüm düşüşü, hacim kaybı, kanal yoğunlaşması gibi anormallikleri otomatik tespit
- **Excel/PowerPoint Export:** DDA sonuçlarını formatlanmış rapor olarak indir
- **Bütçe Reallocation:** Attribution skorlarına göre bütçe dağılım önerisi

## Kampanya Bağlamı

- **Marka:** Petrol Ofisi AutoMatic Filo (araç filo yönetim hizmeti)
- **Hedef:** B2B filo başvurusu (lead generation)
- **Toplam Dijital Bütçe:** 55M TL
- **Segmentler:** S1 Hızlı Ölçeklenen (33M), S2 Çalışanı Gözeten (13.75M), S3 Yaygın Filolu (5.5M), S4 Rakiple Çalışan (2.75M)
- **Dijital Kanallar:** Meta, Google, TikTok, LinkedIn, DV360+Programatik, YouTube

## Veri Girişi

Haftalık CSV dosyaları: kanal harcama, impression, click, lead verileri.
CRM touchpoint CSV: kullanıcı yolculuğu verileri (DDA Markov + Shapley hesaplaması için).
BigQuery GA4 export: otomatik veri çekimi ve kanal haritalama.

Şablonlar için: `data/templates/`

## API Dokümantasyonu

Backend çalışırken: **http://localhost:8000/docs** (Swagger UI)

### Ana Endpoint'ler

| Endpoint | Açıklama |
|----------|----------|
| `POST /api/dda/run-from-csv` | CSV'den DDA çalıştır |
| `POST /api/dda/run-from-bigquery` | BQ GA4'ten DDA çalıştır |
| `POST /api/dda/run-from-bigquery-table` | Herhangi bir BQ tablosundan (kolon eşlemeli) DDA çalıştır |
| `POST /api/media-planning/simulate` | Medya plan simülasyonu |
| `GET /api/export/dda-report` | Excel rapor indir |
| `GET /api/insights/trend` | Trend analizi |
| `GET /api/alerts` | Proaktif alert'ler |
| `POST /api/unified/reallocation` | Bütçe reallocation önerisi |

Tüm endpoint listesi için `CLAUDE.md` dosyasına bakın.

## Lisans

Proprietary — Time x Growity
