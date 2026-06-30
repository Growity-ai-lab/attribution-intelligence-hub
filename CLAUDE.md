# CLAUDE.md — Time's Hub | Attribution Intelligence

## Proje Ozeti
Dijital kanal attribution platformu.
DDA (Data-Driven Attribution) motoru: Markov Chain (%65) + Shapley Value (%35) ensemble.
BigQuery GA4 entegrasyonu ile gercek kullanici yolculugu verisi uzerinde calısır.
Time x Growity tarafindan gelistirilir.

## Kampanya Baglami
- Marka: Petrol Ofisi AutoMatic Filo (arac filo yonetim hizmeti)
- Hedef: B2B filo basvurusu (lead generation)
- Toplam dijital butce: 55M TL
- 4 segment: S1 Hızlı Ölçeklenen (33M), S2 Çalışanı Gözeten (13.75M), S3 Yaygın Filolu (5.5M), S4 Rakiple Çalışan (2.75M)
- Dijital kanallar: Meta, Google, TikTok, LinkedIn, DV360+Programatik, YouTube
- Kampanya modlari: lead-focused veya revenue-focused (iki seviyeli miras: Client.objective -> Campaign.objective)

## Tech Stack
- Backend: Python 3.11+ / FastAPI
- DDA Engine: Custom Markov Chain + Shapley Value (Python)
- MMM Engine: Adstock/Saturation/Response model (medya planlama simulasyonu icin, attribution icin KULLANILMAZ)
- Frontend: React 18 + Vite + Tailwind CSS
- Charts: Chart.js (react-chartjs-2)
- Database: SQLite (dev) -> PostgreSQL (prod)
- Data Import: pandas ile CSV/Excel okuma + BigQuery GA4 export
- Auth: JWT (python-jose) + bcrypt
- Export: openpyxl ile Excel rapor, python-pptx ile PowerPoint

## Dizin Yapisi
```
attribution-intelligence-hub/
├── CLAUDE.md
├── README.md
├── package.json                 # Frontend bagimliliklari
├── requirements.txt             # Python bagimliliklari
│
├── backend/
│   ├── main.py                  # FastAPI app entry
│   ├── config.py                # Ayarlar, sabitler, kanal parametreleri
│   ├── auth.py                  # JWT authentication
│   ├── crypto.py                # Fernet encrypt/decrypt (BQ credentials)
│   ├── models/
│   │   ├── dda/                 # DDA attribution motoru
│   │   │   ├── markov.py        # Markov Chain removal effect
│   │   │   ├── shapley_dda.py   # Shapley Value hesaplama
│   │   │   ├── ensemble.py      # Markov+Shapley blend + full pipeline
│   │   │   ├── data_prep.py     # Journey extraction, assist report
│   │   │   └── insights.py      # Otomatik cikarim motoru + trend karsilastirma
│   │   ├── alerts.py            # Proaktif alert kural motoru
│   │   ├── mmm.py               # Adstock, Saturation, Response (simulasyon icin)
│   │   ├── mmm_fit.py           # Non-linear MMM fitting
│   │   ├── mta.py               # Shapley value coalition motoru (shapley_dda.py bunu kullanir)
│   │   ├── simulation.py        # Butce simulasyonu
│   │   ├── uncertainty.py       # CI hesaplama
│   │   └── unified.py           # Budget reallocation (suggest_reallocation)
│   ├── data/
│   │   ├── loader.py            # CSV/Excel veri okuma ve validasyon
│   │   └── schemas.py           # Pydantic data modelleri
│   ├── integrations/
│   │   └── bigquery.py          # GA4 BQ connector, channel mapping
│   ├── export/
│   │   └── report_builder.py    # Excel/PowerPoint rapor olusturucu
│   ├── api/
│   │   ├── routes.py            # Core API (auth, data, DDA, BQ, unified, alerts, trends)
│   │   ├── routes_benchmarks.py # Plan vs gerceklesme, kanal benchmark'lari
│   │   ├── routes_export.py     # Excel/PPTX export endpoint'leri
│   │   ├── routes_media.py      # Dijital medya planlama simulasyonu
│   │   └── deps.py              # Dependency injection
│   └── db/
│       ├── database.py          # SQLite/PostgreSQL baglanti
│       ├── models.py            # SQLAlchemy ORM (Campaign, WeeklyData, TouchpointData, DDAResult, Alert, vb.)
│       └── seed.py              # Ornek veri seed
│
├── frontend/
│   ├── index.html
│   ├── vite.config.js
│   ├── src/
│   │   ├── App.jsx              # 3 tab: Unified Rapor, Medya Planlama, Veri Yukleme
│   │   ├── main.jsx
│   │   ├── components/
│   │   │   ├── Dashboard.jsx          # Ana dashboard (KPI + chart + tablo)
│   │   │   ├── AttributionPanel.jsx   # DDA analiz paneli (BQ baglanti, CSV, sonuclar)
│   │   │   ├── UnifiedChart.jsx       # DDA attribution bar chart
│   │   │   ├── UnifiedScoringTable.jsx # DDA kanal skor tablosu
│   │   │   ├── ReallocationPanel.jsx  # Butce reallocation onerisi
│   │   │   ├── DigitalPlanningPanel.jsx # Medya planlama (Excel import, simulasyon, 5 chart)
│   │   │   ├── DataUpload.jsx         # CSV/Excel yukleme
│   │   │   ├── WorkspaceSelector.jsx  # Client/Campaign secici
│   │   │   ├── LoginPage.jsx          # Giris ekrani
│   │   │   └── InfoTip.jsx            # Tooltip bilesen
│   │   ├── hooks/
│   │   │   ├── useAttribution.js      # Core API (DDA, export, trend, alerts)
│   │   │   ├── useDDA.js              # DDA-specific API calls
│   │   │   ├── useMediaPlanning.js    # Medya planlama API calls
│   │   │   ├── useMMM.js             # MMM/decomposition API (simulasyon icin)
│   │   │   ├── useFileOps.js          # Dosya yukleme/indirme
│   │   │   ├── useChannelConfig.js    # Kanal konfigurasyonu
│   │   │   ├── useWorkspace.js        # Client/Campaign yonetimi
│   │   │   └── useAuth.js             # Authentication
│   │   ├── utils/
│   │   │   ├── formatters.js          # Sayi/para formatlama
│   │   │   ├── colors.js             # Kanal renk paleti (6 dijital kanal)
│   │   │   └── objectiveLabels.js     # Lead/Revenue modu etiketleri
│   │   └── styles/
│   │       └── globals.css
│   └── public/
│
├── data/
│   ├── templates/
│   │   ├── weekly_input_template.csv
│   │   ├── crm_touchpoints_template.csv
│   │   ├── ga4_touchpoints_template.csv
│   │   └── sales_stock_template.csv
│   └── sample/
│       ├── week_01.csv
│       ├── week_02.csv
│       ├── journeys_sample.csv
│       ├── bitaksi_week_01.csv
│       ├── bitaksi_week_02.csv
│       └── bitaksi_journeys.csv
│
└── tests/
    ├── conftest.py
    ├── test_dda.py           # DDA pipeline, Markov, Shapley, ensemble
    ├── test_e2e.py           # API endpoint integration tests
    ├── test_mmm.py           # Adstock, Saturation, Response
    ├── test_mta.py           # Position-based Shapley
    ├── test_modules.py       # Loader, schemas, insights
    ├── test_modules2.py      # Export, alerts, simulation
    ├── test_security.py      # Auth, input validation, file upload
    └── test_unified.py       # Reallocation
```

## Attribution Modeli

### DDA (Data-Driven Attribution) — Tek Aktif Kaynak
- **Markov Chain (%65):** Kanalin yolculuktaki vazgecilmezligini olcer (removal effect)
- **Shapley Value (%35):** Kanalin adil marjinal katkisini hesaplar (koalisyon bazli)
- Ensemble blend: `unified_score = markov * 0.65 + shapley * 0.35`
- Bayesian smoothing: `MARKOV_PRIOR_ALPHA = 0.5` (gecis matrisi icin)

### Unified Scoring
`unified_score = dda_score` (MMM ve incrementality devre disi — gercek veriye fit edilmis model yok)

MMM altyapisi (adstock, saturation, response) kodda kalir — medya planlama simulasyonu icin kullanilir.
Attribution icin KULLANILMAZ. Ileride 8+ haftalik gercek veri + fit yapildiginda tekrar aktiflestirilir.

### Desteklenen Kanallar (dijital, 6 adet)
`meta`, `google`, `tiktok`, `linkedin`, `dv360`, `youtube`

Offline kanallar (TV, Radyo, DOOH) Haziran 2026'da tamamen kaldirildi.

## Veri Kaynaklari

### 1. BigQuery GA4 Export (Birincil)
- Session-scoped source/medium (COALESCE zinciri: collected_traffic_source > event_params > traffic_source)
- Otomatik channel mapping: GA4 source/medium -> hub kanal taksonomisi
- Dusuk frekansli kanallar otomatik birlestirilir (`consolidate_channels`, max 12)
- Conversion events parametrik (default: purchase)

### 2. CSV/Excel Upload
- CRM touchpoint CSV: lead_id, timestamp, channel, touchpoint_type, campaign, segment, converted
- Haftalik performans CSV: week, channel, spend, impressions, clicks, leads

### 3. Satis/Stok CSV
- Haftalik satis/stok verileri: revenue, units, stock, returns, new/repeat customers

## API Endpoint'leri

### Auth
- `POST /api/auth/login` — JWT token al
- `POST /api/auth/demo` — Demo kullanici girisi

### Veri Yukleme
- `POST /api/data/upload` — Haftalik CSV yukle
- `POST /api/sales-stock/upload` — Satis/stok CSV yukle
- `GET /api/data/template/{type}` — Sablon indir

### DDA Attribution
- `POST /api/dda/run-from-csv` — CSV'den DDA calistir
- `POST /api/dda/run-from-bigquery` — BQ GA4'ten DDA calistir

### BigQuery Entegrasyonu
- `POST /api/integrations/bigquery/connect` — BQ baglantisi test et
- `POST /api/integrations/bigquery/preview` — Veri onizleme

### MMM (Simulasyon icin)
- `GET /api/mmm/adstock/{channel}` — Adstock hesaplama
- `GET /api/mmm/saturation/{channel}` — Doygunluk egrisi
- `GET /api/mmm/decomposition` — Kanal katki kirilimi

### Unified / Reallocation
- `POST /api/unified/reallocation` — Butce reallocation onerisi

### Medya Planlama
- `POST /api/media-planning/simulate` — Dijital medya plan simulasyonu
- `POST /api/media-planning/save` — Plan kaydet
- `GET /api/media-planning/list` — Kayitli planlari listele
- `GET /api/media-planning/get/{id}` — Plan detayi
- `DELETE /api/media-planning/{id}` — Plan sil
- `GET /api/media-planning/presets` — Kanal preset harcamalari

### Benchmark & Saglama
- `GET /api/benchmarks/channel-metrics` — DDA'dan empirik kanal metrikleri
- `POST /api/benchmarks/plan-reconciliation` — Plan vs gerceklesme karsilastirmasi

### Export
- `GET /api/export/dda-report` — Excel DDA raporu indir

### Trend & Insight
- `GET /api/insights/trend` — Snapshot karsilastirmali trend analizi

### Alert
- `GET /api/alerts` — Kampanya alert'leri
- `POST /api/alerts/{id}/acknowledge` — Alert okundu isaretle
- `GET /api/alerts/summary` — Okunmamis alert ozeti

### Konfigürasyon
- `GET /api/config/channels` — Kanal parametreleri ve agirliklar

## Kodlama Kurallari
- Python: type hints kullan, docstring yaz, pytest ile test et
- React: functional components + hooks, Tailwind utility classes
- Her model fonksiyonu saf (pure) olsun — side effect yok, test edilebilir
- Veri validasyonu Pydantic ile
- Error handling: kullaniciya anlamli hata mesajlari (Turkce)

## Komutlar
- Backend calistir: `cd backend && uvicorn main:app --reload --port 8000`
- Frontend calistir: `cd frontend && npm run dev`
- Testleri calistir: `python -m pytest tests/ -v`
- Lint: `ruff check backend/`
- Frontend build: `npx vite build --config frontend/vite.config.js`

## Onemli Teknik Notlar
- `UNIFIED_WEIGHTS = {"dda": 1.0, "mmm": 0.0, "incrementality": 0.0}` — DDA tek kaynak
- `DDA_BLEND_WEIGHTS = {"markov": 0.65, "shapley": 0.35}` — DDA icinde Markov agirlikli
- MediaPlanSimulation DB sutunu `weekly_grps` adini tasir (SQLite rename kisitlamasi) ama API'de `weekly_spends` olarak kullanilir
- BQ credentials in-memory cache: TTL = 3600s, key = `{project}:{dataset}`
- Campaign modeli BQ config alanlari tasir: `bq_project`, `bq_dataset`, `bq_credentials_enc` (Fernet sifrelenmis)
- DDA sonuclari `DDAResult` tablosuna persist edilir (benchmark, trend, export icin)
- Alert sistemi 5 kural: conversion_drop, volume_drop, channel_concentration, channel_disappeared, sustained_decline
