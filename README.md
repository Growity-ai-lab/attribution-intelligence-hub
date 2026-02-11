# Time's Hub | Attribution Intelligence

Multi-channel attribution modelling platform by **Time x Growity**.
Combines **MMM** (Marketing Mix Modeling), **MTA** (Multi-Touch Attribution), and **Incrementality Testing** into a unified scoring framework.

## Deploy (Render.com — ucretsiz)

Hicbir kurulum gerektirmez. Render.com hesabi ile tek tikla deploy:

1. [render.com/register](https://render.com/register) adresinden ucretsiz hesap olusturun
2. Dashboard > **New** > **Blueprint** > bu GitHub repo'yu baglayin
3. Render otomatik olarak `render.yaml` dosyasini okuyup deploy eder
4. Birka dakika icinde URL'niz hazir olur: `https://times-hub.onrender.com`

> Giris: `admin` / `attribution2026`

---

## Quick Start (Docker)

**Tek komutla calistirin:**

```bash
git clone <repo-url> && cd attribution-intelligence-hub
./scripts/setup.sh
```

Bu komut:
1. `.env` dosyasini otomatik olusturur
2. Docker ile frontend + backend build eder
3. Health check yapar ve URL'leri gosterir

Uygulama: **http://localhost:8000** | API Docs: **http://localhost:8000/docs**

> Giris: `admin` / `attribution2026` (`.env` dosyasindan degistirilebilir)

### Yararli Docker komutlari

```bash
docker compose logs -f       # loglari izle
docker compose down           # durdur
docker compose restart        # yeniden baslat
docker compose up --build -d  # yeniden build et
```

### Otomatik guncelleme (opsiyonel)

Remote branch'e push yapildiginda otomatik pull + rebuild icin:

```bash
./scripts/auto-update.sh &              # arka planda izle (30sn aralik)
./scripts/auto-update.sh --interval 60  # 60sn aralik
kill $(cat .auto-update.pid)            # durdur
```

---

## Lokal Gelistirme (Docker'siz)

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
pytest tests/ -v
```

## Architecture

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+ / FastAPI |
| MMM Engine | Custom adstock + saturation + response model |
| MTA Engine | Shapley value attribution |
| Frontend | React 18 + Vite + Tailwind CSS |
| Database | SQLite (dev) / PostgreSQL (prod) |
| Data Import | CSV/Excel via pandas |

## Unified Scoring Formula

```
Final Attribution = (MTA × 0.50) + (MMM × 0.35) + (Incrementality × 0.15)
```

## Campaign Context

- **Brand**: Petrol Ofisi AutoMatic Filo
- **Objective**: B2B fleet application lead generation
- **Total Digital Budget**: 55M TL
- **Segments**: S1 (33M), S2 (13.75M), S3 (5.5M), S4 (2.75M)
- **Online Channels**: Meta, Google, TikTok, LinkedIn, DV360, YouTube
- **Offline Channels**: TV, Radio, DOOH

## Data Input

Weekly CSV files with channel spend, impressions, clicks, leads, GRP, and spot counts.
CRM touchpoint data for MTA Shapley calculations.

See `data/templates/` for input file templates.

## License

Proprietary — Time x Growity
