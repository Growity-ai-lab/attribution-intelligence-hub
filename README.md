# Attribution Intelligence Hub

Multi-channel attribution modelling platform for PO AutoMatic Filo campaign.
Combines **MMM** (Marketing Mix Modeling), **MTA** (Multi-Touch Attribution), and **Incrementality Testing** into a unified scoring framework.

## Quick Start

### Backend
```bash
cd backend
pip install -r ../requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
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

Proprietary — Growity x Atlas
