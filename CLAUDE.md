# CLAUDE.md — Attribution Intelligence Hub

## Proje Özeti
PO AutoMatic Filo kampanyası için multi-channel attribution modelling platformu.
MMM (Marketing Mix Modeling) + MTA (Multi-Touch Attribution) + Incrementality Testing hibrit framework.
Growity × Atlas tarafından geliştirilir.

## Kampanya Bağlamı
- Marka: Petrol Ofisi AutoMatic Filo (araç filo yönetim hizmeti)
- Hedef: B2B filo başvurusu (lead generation)
- Toplam dijital bütçe: 55M₺
- 4 segment: S1 Hızlı Ölçeklenen (33M), S2 Çalışanı Gözeten (13.75M), S3 Yaygın Filolu (5.5M), S4 Rakiple Çalışan (2.75M)
- Online kanallar: Meta, Google, TikTok, LinkedIn, DV360+Programatik, YouTube
- Offline kanallar: TV (maç sponsorluğu + haber), Radyo, DOOH

## Tech Stack
- Backend: Python 3.11+ / FastAPI
- MMM Engine: lightweight-mmm veya pymc-marketing (Google Meridian Python wrapper)
- MTA Engine: Custom Shapley value hesaplama (Python)
- Frontend: React 18 + Vite + Tailwind CSS
- Charts: Chart.js veya Recharts
- Database: SQLite (dev) → PostgreSQL (prod)
- Data Import: pandas ile CSV/Excel okuma

## Dizin Yapısı
```
attribution-intelligence-hub/
├── CLAUDE.md                    # Bu dosya
├── README.md                    # Proje dokümantasyonu
├── package.json                 # Frontend bağımlılıkları
├── requirements.txt             # Python bağımlılıkları
│
├── backend/
│   ├── main.py                  # FastAPI app entry
│   ├── config.py                # Ayarlar, sabitler
│   ├── models/
│   │   ├── mmm.py               # Marketing Mix Model (adstock, saturation, decomposition)
│   │   ├── mta.py               # Multi-Touch Attribution (Shapley value)
│   │   ├── incrementality.py    # Geo-lift, holdout, PSA test analizi
│   │   └── unified.py           # Unified scoring: MMM×0.50 + MTA×0.35 + INC×0.15
│   ├── data/
│   │   ├── loader.py            # CSV/Excel veri okuma ve validasyon
│   │   ├── schemas.py           # Pydantic data modelleri
│   │   └── sample_data/         # Örnek veri dosyaları
│   ├── api/
│   │   ├── routes.py            # API endpoint'leri
│   │   └── deps.py              # Dependency injection
│   └── db/
│       ├── database.py          # SQLite/PostgreSQL bağlantı
│       └── models.py            # SQLAlchemy ORM modelleri
│
├── frontend/
│   ├── index.html
│   ├── vite.config.js
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── components/
│   │   │   ├── Dashboard.jsx        # Ana dashboard layout
│   │   │   ├── KPICards.jsx          # Üst KPI satırı
│   │   │   ├── UnifiedChart.jsx      # Unified attribution stacked bar
│   │   │   ├── ChannelTable.jsx      # Kanal performans tablosu
│   │   │   ├── MMMPanel.jsx          # MMM çıktıları (adstock, saturation, decomp)
│   │   │   ├── MTAPanel.jsx          # MTA journey paths
│   │   │   ├── IncrementalityPanel.jsx
│   │   │   ├── DataUpload.jsx        # CSV/Excel yükleme
│   │   │   └── WeekSelector.jsx      # Hafta seçici
│   │   ├── hooks/
│   │   │   └── useAttribution.js     # API çağrıları
│   │   ├── utils/
│   │   │   ├── formatters.js         # Sayı formatlama
│   │   │   └── colors.js             # Renk paleti
│   │   └── styles/
│   │       └── globals.css
│   └── public/
│
├── data/
│   ├── templates/
│   │   ├── weekly_input_template.csv     # Haftalık veri giriş şablonu
│   │   └── crm_touchpoints_template.csv  # CRM touchpoint şablonu
│   └── sample/
│       ├── week_01.csv
│       └── week_02.csv
│
├── notebooks/                   # Analiz ve keşif
│   ├── 01_adstock_exploration.ipynb
│   ├── 02_saturation_fitting.ipynb
│   └── 03_shapley_mta.ipynb
│
└── tests/
    ├── test_mmm.py
    ├── test_mta.py
    └── test_unified.py
```

## MMM Model Detayları

### Adstock (Carry-over)
Her kanal için ayrı decay parametresi:
- Meta: λ = 0.35 (3-5 gün etki)
- Google Search: λ = 0.10 (anlık, hemen sönümlenir)
- TikTok: λ = 0.30 (kısa süreli)
- LinkedIn: λ = 0.25
- DV360: λ = 0.20
- YouTube: λ = 0.40 (video etkisi daha uzun)
- TV: λ = 0.75 (2-3 hafta carry-over)
- Radyo: λ = 0.45 (1 hafta)
- DOOH: λ = 0.05 (anlık)

Formula: `adstock[t] = spend[t] + λ × adstock[t-1]`

### Saturation (Hill Function)
Her kanal için ayrı alpha (half-saturation) ve gamma (eğri şekli):
Formula: `saturation(x) = x^γ / (α^γ + x^γ)`

### Response Model
`response[t] = baseline + max_lift × saturation(adstock[t])`

## MTA Model Detayları

### Shapley Value Attribution
- Her lead'in CRM'deki touchpoint sırası alınır
- Shapley value hesaplanarak her touchpoint'e adil kredi dağıtılır
- Position-based ağırlıklandırma: ilk temas %30, son temas %35, ara temaslar %35 paylaşır

### Data-Driven Calibration
- İlk 4 hafta last-click + assisted raporlarla başla
- 8+ hafta sonra data-driven position weights'e geç

## Unified Scoring
`Final Atıf = (MTA × 0.50) + (MMM × 0.35) + (INC Düzeltme × 0.15)`

## Veri Giriş Formatı

### Haftalık Input CSV
```csv
week,channel,spend,impressions,clicks,leads,grp,spot_count
2026-W06,meta,2600000,4500000,85000,1050,0,0
2026-W06,google,300000,800000,24000,520,0,0
2026-W06,tv_match,0,0,0,0,450,12
2026-W06,tv_news,0,0,0,0,180,24
2026-W06,radio,0,0,0,0,0,36
```

### CRM Touchpoint CSV
```csv
lead_id,timestamp,channel,touchpoint_type,campaign,segment
L001,2026-01-15 10:23,meta,impression,S1_lead_campaign,S1
L001,2026-01-16 14:05,google,click,brand_search,S1
L001,2026-01-16 14:08,landing_page,form_submit,lp_filo,S1
```

## Segment Tanımları
- S1 (Hızlı Ölçeklenen): 8 alt segment, %60 bütçe, 33M₺
- S2 (Çalışanı Gözeten): 3 alt segment, %25 bütçe, 13.75M₺
- S3 (Yaygın Filolu): 3 alt segment, %10 bütçe, 5.5M₺
- S4 (Rakiple Çalışan): 2 alt segment, %5 bütçe, 2.75M₺

## API Endpoint'leri
- `POST /api/data/upload` — haftalık CSV yükle
- `GET /api/mmm/run` — MMM modeli çalıştır
- `GET /api/mmm/adstock/{channel}` — kanal adstock değerleri
- `GET /api/mmm/saturation/{channel}` — saturation curve
- `GET /api/mmm/decomposition` — channel contribution breakdown
- `GET /api/mta/paths` — top conversion paths
- `GET /api/mta/shapley` — Shapley value attribution
- `GET /api/unified/report/{week}` — haftalık unified rapor
- `GET /api/unified/reallocation` — bütçe reallocation önerisi

## Kodlama Kuralları
- Python: type hints kullan, docstring yaz, pytest ile test et
- React: functional components + hooks, Tailwind utility classes
- Her model fonksiyonu saf (pure) olsun — side effect yok, test edilebilir
- Veri validasyonu Pydantic ile
- Error handling: kullanıcıya anlamlı hata mesajları

## Komutlar
- Backend çalıştır: `cd backend && uvicorn main:app --reload --port 8000`
- Frontend çalıştır: `cd frontend && npm run dev`
- Testleri çalıştır: `pytest tests/ -v`
- Lint: `ruff check backend/`

## Mevcut Referanslar
- TV Analyzer (önceki proje): tek kanal MMM, adstock/saturation/response model
- Bu projenin HTML mock-up'ı: attribution-intelligence-hub.html (5 tab'lı dashboard)
- PO Filo Segmentasyon sunumu: po-filo-segmentasyon-v2.pptx
