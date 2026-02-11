"""Seed default clients and campaigns for demo/showcase purposes."""

from datetime import datetime, timezone

from backend.db.database import SessionLocal
from backend.db.models import Campaign, Client

SEED_DATA: dict[str, list[dict]] = {
    "Petrol Ofisi": [
        {"name": "Premium Market", "budget": 12_000_000, "channels": "meta,google,youtube,dv360,dooh"},
        {"name": "AutoMatic Filo", "budget": 55_000_000, "channels": "meta,google,tiktok,linkedin,dv360,youtube,tv_match,tv_news,radio,dooh"},
    ],
    "EnerjiSA": [
        {"name": "30.Yil Iletisimi", "budget": 8_500_000, "channels": "meta,google,youtube,tv_match,tv_news,radio,dooh"},
    ],
    "Uludag Icecek": [
        {"name": "Limonata", "budget": 15_000_000, "channels": "meta,google,tiktok,youtube,tv_match,tv_news,radio,dooh"},
        {"name": "Premium Su", "budget": 7_000_000, "channels": "meta,google,youtube,dv360,dooh"},
        {"name": "Soda", "budget": 6_500_000, "channels": "meta,google,tiktok,youtube,tv_match,radio"},
        {"name": "Frutti", "budget": 10_000_000, "channels": "meta,google,tiktok,youtube,tv_match,tv_news,radio"},
        {"name": "Portakalli", "budget": 4_500_000, "channels": "meta,google,tiktok,youtube,radio"},
    ],
    "UNICEF": [
        {"name": "6 Subat Deprem", "budget": 3_000_000, "channels": "meta,google,youtube,dv360,linkedin"},
        {"name": "Dunya Kiz Cocuklari Gunu", "budget": 1_500_000, "channels": "meta,google,youtube,linkedin"},
        {"name": "Dunya Gunu", "budget": 2_000_000, "channels": "meta,google,youtube,linkedin,dv360"},
    ],
    "Hayhay": [
        {"name": "POS Cihazi", "budget": 5_000_000, "channels": "meta,google,linkedin,dv360,youtube"},
        {"name": "Dijital Cuzdan", "budget": 4_000_000, "channels": "meta,google,tiktok,youtube,dv360"},
        {"name": "Tuketici Finansmani", "budget": 6_000_000, "channels": "meta,google,linkedin,youtube,dv360,dooh"},
    ],
    "TLC/Gree Klima": [
        {"name": "Sevgililer Gunu", "budget": 3_500_000, "channels": "meta,google,tiktok,youtube"},
        {"name": "Yaz'a Merhaba", "budget": 8_000_000, "channels": "meta,google,tiktok,youtube,tv_match,tv_news,radio,dooh"},
        {"name": "Kis Kampanyasi", "budget": 5_500_000, "channels": "meta,google,youtube,dv360,tv_news,radio"},
    ],
}

SEED_YEAR = 2026


def seed_clients_and_campaigns() -> bool:
    """Insert seed clients/campaigns if the DB is empty for SEED_YEAR.

    Returns True if seed data was inserted, False if data already exists.
    """
    db = SessionLocal()
    try:
        existing = db.query(Client).filter(Client.year == SEED_YEAR).count()
        if existing > 0:
            return False

        now = datetime.now(timezone.utc).isoformat()
        for client_name, campaigns in SEED_DATA.items():
            client = Client(name=client_name, year=SEED_YEAR, created_at=now)
            db.add(client)
            db.flush()  # get client.id

            for camp in campaigns:
                db.add(Campaign(
                    client_id=client.id,
                    name=camp["name"],
                    budget=camp["budget"],
                    channels=camp["channels"],
                    status="active",
                    created_at=now,
                ))

        db.commit()
        return True
    finally:
        db.close()
