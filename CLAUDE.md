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
- Database: `DATABASE_URL` env var — Postgres in prod (Supabase), local SQLite file if unset
- Data Import: pandas ile CSV/Excel okuma + BigQuery GA4 export
- Auth: JWT (python-jose) + bcrypt
- Export: openpyxl ile Excel rapor, python-pptx ile PowerPoint

## Dizin Yapisi
```
attribution-intelligence-hub/
├── CLAUDE.md
├── README.md
├── package.json                 # Frontend bagimliliklari
├── requirements.txt             # Python bagimliliklari (prod)
├── requirements-dev.txt         # + pytest, ruff, httpx
├── playwright.config.js         # Tarayici duman testleri (e2e/)
├── .github/workflows/ci.yml     # CI: lint, pytest (SQLite+Postgres), build, e2e
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
│   │   ├── common.py            # Route'larin paylastigi yardimcilar (validasyon, DDA serialize/persist, demo sandbox)
│   │   ├── routes_auth.py       # Health + login/demo/me
│   │   ├── routes_workspace.py  # Client/Campaign CRUD
│   │   ├── routes_data.py       # Veri yukleme, ornek veri, sablonlar, satis/stok
│   │   ├── routes_dda.py        # DDA: journey/CSV calistirma, /dda/latest, /dda/status
│   │   ├── routes_bigquery.py   # BQ baglanti, onizleme, arka plan GA4/tablo DDA calismalari, client cache
│   │   ├── routes_mmm.py        # MMM, butce simulasyonu, reallocation, kanal config
│   │   ├── routes_benchmarks.py # Plan vs gerceklesme, kanal benchmark'lari
│   │   ├── routes_export.py     # Excel/PPTX export + trend endpoint'leri
│   │   ├── routes_alerts.py     # Alert endpoint'leri + DDA sonrasi degerlendirme
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
│   │   │   ├── AttributionPanel.jsx   # Attribution sekmesi: asagidaki parcalari birlestirir
│   │   │   ├── attribution/
│   │   │   │   ├── DataSourcePanel.jsx  # Kaynak secimi (BQ GA4, BQ tablo, CSV), onizleme, calistirma
│   │   │   │   ├── DdaResults.jsx       # KPI, grafikler, katki/asist tablolari, cikarimlar, trend, export
│   │   │   │   ├── BudgetSimulator.jsx  # Butce/gelir-lead simulasyonu + hedef CPL planlayici
│   │   │   │   ├── JourneyDetails.jsx   # En sik donusum yollari + yolculuk istatistikleri
│   │   │   │   └── organic.js           # Organik/direct kanal tespiti
│   │   │   ├── AlertsPanel.jsx        # Kampanya uyarilari (listele, okundu isaretle)
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
│       └── journeys_sample.csv
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
    ├── test_unified.py       # Reallocation
    └── test_alerts_api.py    # Alert degerlendirme + /alerts endpoint'leri
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

> **Kaynaktan bagimsiz motor:** DDA motoru `lead_id, timestamp, channel, converted, revenue`
> standart touchpoint semasi uzerinde calisir. GA4 yalnizca ilk konnektor (`ga4_to_touchpoints`);
> CSV (`loader`) ikinci adaptor. Generic BigQuery konnektoru (`query_generic_events` +
> `generic_to_touchpoints`) ile CRM, server-side GTM, app analytics, ad-cost export veya offline
> conversion gibi her BQ tablosu kolon eslemesiyle ayni motora akar.

### 1. BigQuery GA4 Export (Ilk konnektor)
- Session-scoped source/medium (COALESCE zinciri: collected_traffic_source > event_params > traffic_source)
- Otomatik channel mapping: GA4 source/medium -> hub kanal taksonomisi
- Dusuk frekansli kanallar otomatik birlestirilir (`consolidate_channels`, max 12)
- Conversion events parametrik (default: purchase)

### 2. Generic BigQuery (Kaynaktan bagimsiz)
- Herhangi bir BQ tablosu -> standart touchpoint semasi (`GenericBQMapping` kolon eslemesi)
- Kanal: `channel_col` VEYA `source_col`+`medium_col`
- Donusum: `converted_col` (bool) VEYA `event_col`+`conversion_values`
- Zaman damgasi: datetime / unix_micros / unix_seconds
- Identifier'lar SQL injection'a karsi dogrulanir, literal'ler query parametresiyle baglanir

### 3. CSV/Excel Upload
- CRM touchpoint CSV: lead_id, timestamp, channel, touchpoint_type, campaign, segment, converted
- Haftalik performans CSV: week, channel, spend, impressions, clicks, leads

### 4. Satis/Stok CSV
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
- `POST /api/dda/run-from-bigquery-table` — Herhangi bir BQ tablosundan (kolon eslemeli) DDA calistir
- `GET /api/dda/status/{result_id}` — Arka plan (BQ) calismasinin durumu/sonucu
- `GET /api/dda/latest?campaign_id=` — Kampanyanin son tamamlanmis DDA sonucu (`status: none` yoksa)

### BigQuery Entegrasyonu
- `POST /api/integrations/bigquery/connect` — BQ baglantisi test et
- `POST /api/integrations/bigquery/preview` — GA4 veri onizleme
- `POST /api/integrations/bigquery/preview-table` — Generic tablo onizleme (kolon eslemeli)

### MMM (Simulasyon icin)
- `GET /api/mmm/adstock/{channel}` — Adstock hesaplama
- `GET /api/mmm/saturation/{channel}` — Doygunluk egrisi
- `GET /api/mmm/decomposition` — Kanal katki kirilimi

### Unified / Reallocation
- `POST /api/unified/reallocation` — Butce reallocation onerisi

### Medya Planlama
- `POST /api/media-planning/simulate` — Dijital medya plan simulasyonu
- `POST /api/media-planning/save` — Plan kaydet
- `GET /api/media-planning/saved` — Kayitli planlari listele
- `GET /api/media-planning/saved/{sim_id}` — Plan detayi
- `DELETE /api/media-planning/saved/{sim_id}` — Plan sil
- `GET /api/media-planning/presets/{channel}` — Kanal preset harcamalari

### Benchmark & Saglama
- `GET /api/benchmarks/channel-metrics` — DDA'dan empirik kanal metrikleri
- `POST /api/benchmarks/plan-reconciliation` — Plan vs gerceklesme karsilastirmasi

### Export
- `GET /api/export/dda-report` — Excel DDA raporu indir
- `GET /api/export/dda-pptx` — PowerPoint DDA sunumu indir

### Trend & Insight
- `GET /api/insights/trend` — Snapshot karsilastirmali trend analizi

### Alert
- `GET /api/alerts?campaign_id=&include_acknowledged=` — Kampanya alert'leri
- `POST /api/alerts/{id}/acknowledge` — Alert okundu isaretle
- `GET /api/alerts/summary` — Okunmamis alert ozeti

### Konfigürasyon
- `GET /api/config/channels` — Kanal parametreleri ve agirliklar

## Kodlama Kurallari
- Python: type hints kullan, docstring yaz, pytest ile test et
- React: functional components + hooks, Tailwind utility classes
- Route modulleri birbirini import etmez; paylasilan yardimcilar `backend/api/common.py`'de
- Her model fonksiyonu saf (pure) olsun — side effect yok, test edilebilir
- Veri validasyonu Pydantic ile
- Error handling: kullaniciya anlamli hata mesajlari (Turkce)

## Komutlar
- Backend calistir (repo kokunden): `uvicorn backend.main:app --reload --port 8000`
- Frontend calistir: `cd frontend && npm run dev`
- Gelistirme bagimliliklari: `pip install -r requirements-dev.txt`
- Testleri calistir: `python -m pytest tests/ -v` (gecici SQLite; Postgres icin `TEST_DATABASE_URL=postgresql://...`)
- Lint: `ruff check backend/` ve `npm run lint` (ESLint: tanimsiz degisken/JSX bileseni hata sayilir)
- Frontend build: `npx vite build --config frontend/vite.config.js`
- Tarayici duman testleri: `npm run build && npx playwright test` (uygulamayi gecici SQLite ile kendisi baslatir;
  onceden kurulu Chromium icin `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`)

## CI (`.github/workflows/ci.yml`)
- Her push ve PR'da: ruff + pytest (SQLite ve Postgres 16 matrisi) ve ESLint + frontend build + Playwright duman testleri
- Duman testleri `vite build`'in yakalayamadigi render cokmelerini ("Bir hata olustu" ErrorBoundary ekrani)
  ve yakalanmamis sayfa hatalarini yakalar; hata olursa rapor artifact olarak yuklenir
- Yeni bir ekran/akis eklerken `e2e/smoke.spec.js`'e en az bir acilis testi ekle

## Onemli Teknik Notlar
- `UNIFIED_WEIGHTS = {"dda": 1.0, "mmm": 0.0, "incrementality": 0.0}` — DDA tek kaynak
- `DDA_BLEND_WEIGHTS = {"markov": 0.65, "shapley": 0.35}` — DDA icinde Markov agirlikli
- MediaPlanSimulation DB sutunu `weekly_grps` adini tasir (SQLite rename kisitlamasi) ama API'de `weekly_spends` olarak kullanilir
- BQ credentials in-memory cache: TTL = 3600s, key = `{project}:{dataset}`
- Campaign modeli BQ config alanlari tasir: `bq_project`, `bq_dataset`, `bq_credentials_enc` (Fernet sifrelenmis)
- DDA sonuclari `DDAResult` tablosuna persist edilir (benchmark, trend, export, rapor sayfasi icin)
  - Rapor sayfasi kampanya acilinca `/dda/latest` ile son kayitli sonucu yukler
  - Snapshot'a yalnizca dolu alanlar yazilir (bos `{}` JS'te truthy; CSV sonucunda BQ KPI'larini cizip cokertiyordu)
- Demo kullanicinin calismalari "Demo Sandbox" altinda ayni adli kampanyaya yazilir; okuma endpoint'leri
  (latest, alerts, trend, export) `resolve_read_campaign_id` ile oraya yonlenir (sandbox'i olusturmaz)
- Alert sistemi 5 kural: conversion_drop, volume_drop, channel_concentration, channel_disappeared, sustained_decline
  - Her tamamlanan DDA calismasindan sonra otomatik degerlendirilir (CSV: sonuc kaydindan sonra; BQ: sonucla ayni commit'te)
  - Karsilastirma yalnizca `status == "complete"` calismalarla yapilir; ayni calisma icin ayni kural tekrar yazilmaz
- Veritabani: `DATABASE_URL` yoksa `./attribution_hub.db` (SQLite). Render'da disk kalici degil, prod'da mutlaka Postgres URL'i verilmeli
  - `postgres://` onekli URL'ler otomatik `postgresql://`'e cevrilir; Postgres havuzu 512MB instance icin kucuk tutulur
  - `ENCRYPTION_KEY` kalici olmali, yoksa DB'de sakli BQ kimlik bilgileri yeniden baslatmadan sonra cozulemez
  - Semaya yeni kolonlar `migrate_add_columns()` ile eklenir (Alembic yok)
