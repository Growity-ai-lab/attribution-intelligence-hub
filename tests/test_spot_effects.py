"""TV/radio spot effects: measurement model, spot/traffic file readers, API."""

import io
from datetime import datetime, timedelta
from unittest.mock import patch

import pandas as pd
import pytest
from openpyxl import Workbook

from backend.api import routes_bigquery
from backend.auth import create_access_token
from backend.data.spot_loader import parse_spot_file, parse_traffic_file
from backend.data.spot_sample import generate_sample
from backend.db.database import SessionLocal
from backend.db.models import Campaign, Client, TrafficMinute, TvSpot
from backend.models.spot_effects import analyze_spots, day_timeline

T0 = datetime(2026, 10, 1)


def _flat_traffic(days: int, per_minute: float = 10.0) -> dict[datetime, float]:
    return {T0 + timedelta(minutes=i): per_minute for i in range(days * 1440)}


def _spot(at: datetime, **kw) -> dict:
    return {"aired_at": at, "station": kw.pop("station", "Kanal D"), "medium": kw.pop("medium", "tv"),
            "cost": kw.pop("cost", 100_000.0), "grp": kw.pop("grp", None), "creative": "", "program": "", **kw}


# --------------- Model ---------------

@pytest.mark.parametrize("seed", [42, 9])
def test_recovers_the_injected_effect(seed):
    spots, visits, conversions = generate_sample(seed=seed)
    res = analyze_spots(spots, visits, conversions)
    true = sum(s["true_visits"] for s in spots)
    assert res["totals"]["visits"] == pytest.approx(true, rel=0.05)
    assert res["placebo"]["ok"] and 0.005 < res["placebo"]["false_positive_rate"] < 0.06
    tv = next(g for g in res["by_medium"] if g["name"] == "tv")
    assert tv["significant_share"] > 0.9  # strong TV responses are all detected
    assert res["warnings"] == []


@pytest.mark.parametrize("seed", [7, 8])
def test_no_effect_measures_about_zero(seed):
    spots, visits, conversions = generate_sample(effect_scale=0.0, seed=seed)
    res = analyze_spots(spots, visits, conversions)
    noise = res["placebo"]["noise_sd_per_window"] * res["totals"]["blocks"] ** 0.5
    assert abs(res["totals"]["visits"]) < 2.5 * noise
    assert res["totals"]["significant_share"] < 0.08


def test_exact_effect_on_noise_free_traffic():
    visits = _flat_traffic(3)
    at = T0 + timedelta(days=2, hours=21)
    for k, add in enumerate([5, 20, 10, 5]):
        visits[at + timedelta(minutes=k)] += add
    res = analyze_spots([_spot(at)], visits, post_minutes=10)
    row = res["spots"][0]
    assert row["status"] == "measured" and row["visits"] == 40.0 and row["baseline_per_min"] == 10.0
    assert row["cost_per_visit"] == 2500.0
    assert row["daypart"] == "Prime time (20–24)"


def test_block_effect_is_split_by_grp():
    visits = _flat_traffic(3)
    at = T0 + timedelta(days=2, hours=21)
    for k in range(4):
        visits[at + timedelta(minutes=k)] += 15
    res = analyze_spots([_spot(at, station="Kanal D", grp=3.0), _spot(at + timedelta(minutes=2), station="ATV", grp=1.0)],
                        visits, post_minutes=10)
    by = {r["station"]: r for r in res["spots"]}
    assert by["Kanal D"]["block_size"] == 2 and by["Kanal D"]["block"] == by["ATV"]["block"]
    assert by["Kanal D"]["visits"] == 45.0 and by["ATV"]["visits"] == 15.0


def test_spots_outside_the_traffic_data_are_reported_not_measured():
    visits = _flat_traffic(2)
    res = analyze_spots([_spot(T0 + timedelta(days=1, hours=10)), _spot(T0 + timedelta(days=5))], visits)
    assert [r["status"] for r in res["spots"]] == ["measured", "no_data"]
    assert any("aralığın dışında" in w for w in res["warnings"])


def test_without_spot_free_days_significance_is_withheld():
    visits = _flat_traffic(1)
    res = analyze_spots([_spot(T0 + timedelta(hours=12))], visits)
    assert res["placebo"]["ok"] is False and res["spots"][0]["z"] is None
    assert any("Güven testi" in w for w in res["warnings"])


def test_low_traffic_warning():
    visits = _flat_traffic(15, per_minute=0.5)
    res = analyze_spots([_spot(T0 + timedelta(days=14, hours=21))], visits)
    assert any("gürültüden zor ayrılır" in w for w in res["warnings"])


def test_no_traffic():
    res = analyze_spots([_spot(T0)], {})
    assert res["totals"]["spots_measured"] == 0 and "Trafik verisi yok" in res["warnings"][0]


def test_day_timeline():
    visits = _flat_traffic(2)
    tl = day_timeline(visits, [_spot(T0 + timedelta(days=1, hours=20, minutes=30))], T0 + timedelta(days=1))
    assert tl["has_data"] and len(tl["visits"]) == 1440 and tl["spots"][0]["minute"] == 20 * 60 + 30


# --------------- File readers ---------------

def test_turkish_csv_spot_list():
    csv = (
        "Ad-alert Spot Raporu;;;;;\n"
        "Tarih;Saat;Kanal;Program;Reklam Adı;Süre;Net Tutar;GRP\n"
        "12.10.2026;20:47:10;Kanal D;Ana Haber;Lansman 30sn;30;185.000,50;2,4\n"
        "12.10.2026;25:10;Show TV;Gece Kuşağı;Lansman 30sn;30;90000;1,1\n"
        "13.10.2026;08:12;Power FM;Sabah;Kampanya 15sn;15;12000;\n"
        ";;;;;;;\n"
    ).encode("utf-8")
    spots, warnings = parse_spot_file(csv, "liste.csv")
    assert warnings == []
    assert [s["aired_at"] for s in spots] == [
        datetime(2026, 10, 12, 20, 47), datetime(2026, 10, 13, 1, 10), datetime(2026, 10, 13, 8, 12)]
    assert spots[0]["cost"] == 185000.5 and spots[0]["grp"] == 2.4 and spots[0]["creative"] == "Lansman 30sn"
    assert [s["medium"] for s in spots] == ["tv", "tv", "radio"]  # "FM" → radio


def test_excel_spot_list_with_date_and_time_cells():
    wb = Workbook()
    ws = wb.active
    ws.append(["Yayın Tarihi", "Başlangıç Saati", "Mecra", "Kanal", "Versiyon", "Maliyet"])
    ws.append([datetime(2026, 10, 12), datetime(1900, 1, 1, 21, 5).time(), "Radyo", "Süper FM", "A", 9000])
    ws.append([datetime(2026, 10, 12), 0.875, "TV", "ATV", "B", 150000])  # 21:00 as an Excel fraction
    buf = io.BytesIO()
    wb.save(buf)
    spots, _ = parse_spot_file(buf.getvalue(), "liste.xlsx")
    assert [(s["aired_at"].hour, s["aired_at"].minute, s["station"], s["medium"]) for s in spots] == [
        (21, 5, "Süper FM", "radio"), (21, 0, "ATV", "tv")]


def test_spot_list_without_cost_warns_and_without_time_fails():
    spots, warnings = parse_spot_file(b"Tarih,Saat,Kanal\n12.10.2026,20:00,TV8\n", "x.csv")
    assert len(spots) == 1 and any("Maliyet" in w for w in warnings)
    with pytest.raises(ValueError, match="saati"):
        parse_spot_file(b"Tarih,Kanal\n12.10.2026,TV8\n", "x.csv")
    with pytest.raises(ValueError, match="başlık"):
        parse_spot_file(b"a,b\n1,2\n", "x.csv")


def test_traffic_file():
    rows, warnings = parse_traffic_file(
        b"minute;sessions;conversions\n2026-10-12 20:45;14;0\n2026-10-12 20:46;13;1\n", "t.csv")
    assert warnings == [] and rows[1]["sessions"] == 13 and rows[1]["conversions"] == 1
    rows, warnings = parse_traffic_file(b"minute,sessions\n2026-10-12 20:00,100\n2026-10-12 21:00,90\n", "t.csv")
    assert any("dakikalık değil" in w for w in warnings)


# --------------- API ---------------

def _new_campaign(name: str) -> int:
    db = SessionLocal()
    try:
        now = datetime.now().isoformat()
        cl = Client(name=f"{name} Co", year=2026, created_at=now)
        db.add(cl)
        db.flush()
        camp = Campaign(client_id=cl.id, name=name, created_at=now)
        db.add(camp)
        db.commit()
        return camp.id
    finally:
        db.close()


def test_sample_then_analysis(client, auth_headers):
    cid = _new_campaign("Spot Sample")
    st = client.post("/api/spots/sample", params={"campaign_id": cid}, headers=auth_headers).json()
    assert st["spots"]["count"] > 50 and st["traffic"]["minutes"] > 20_000 and st["spots"]["source"] == "sample"
    res = client.get("/api/spots/analysis", params={"campaign_id": cid}, headers=auth_headers).json()
    assert res["is_sample"] and res["totals"]["spots_measured"] == st["spots"]["count"]
    assert res["totals"]["visits"] > 0 and res["totals"]["conversions"] > 0
    assert {g["name"] for g in res["by_medium"]} == {"tv", "radio"}
    radio = client.get("/api/spots/analysis", params={"campaign_id": cid, "medium": "radio", "metric": "sessions_unpaid"},
                       headers=auth_headers).json()
    assert {g["name"] for g in radio["by_medium"]} == {"radio"} and radio["metric"]["key"] == "sessions_unpaid"
    day = res["spots"][0]["aired_at"][:10]
    tl = client.get("/api/spots/timeline", params={"campaign_id": cid, "date": day}, headers=auth_headers).json()
    assert tl["has_data"] and tl["spots"]


def test_upload_spots_and_traffic(client, auth_headers):
    cid = _new_campaign("Spot Upload")
    up = client.post("/api/spots/upload", params={"campaign_id": cid},
                     files={"file": ("l.csv", b"Tarih;Saat;Kanal;Net Tutar\n03.10.2026;21:00;Kanal D;100000\n", "text/csv")},
                     headers=auth_headers)
    assert up.status_code == 200, up.text
    assert up.json()["spots"]["count"] == 1
    lines = ["minute;sessions"] + [f"{(T0 + timedelta(minutes=i)).strftime('%Y-%m-%d %H:%M')};{10 + (20 if 3 * 1440 - 180 <= i < 3 * 1440 - 177 else 0)}"
                                   for i in range(4 * 1440)]
    tr = client.post("/api/spots/traffic/upload", params={"campaign_id": cid},
                     files={"file": ("t.csv", "\n".join(lines).encode(), "text/csv")}, headers=auth_headers)
    assert tr.status_code == 200, tr.text
    res = client.get("/api/spots/analysis", params={"campaign_id": cid}, headers=auth_headers).json()
    assert res["spots"][0]["visits"] == 60.0 and not res["is_sample"]
    # Re-upload replaces; delete clears.
    client.delete("/api/spots", params={"campaign_id": cid, "what": "traffic"}, headers=auth_headers)
    assert client.get("/api/spots/status", params={"campaign_id": cid}, headers=auth_headers).json()["traffic"]["minutes"] == 0


def test_bad_files_get_turkish_errors(client, auth_headers):
    cid = _new_campaign("Spot Bad")
    r = client.post("/api/spots/upload", params={"campaign_id": cid},
                    files={"file": ("l.csv", b"a,b\n1,2\n", "text/csv")}, headers=auth_headers)
    assert r.status_code == 422 and "başlık" in r.json()["detail"]
    r = client.get("/api/spots/analysis", params={"campaign_id": cid}, headers=auth_headers)
    assert r.status_code == 404 and "spot listesi yok" in r.json()["detail"]


def test_templates(client):
    r = client.get("/api/spots/template/spots")
    spots, _ = parse_spot_file(r.content, "t.csv")
    assert len(spots) == 3 and spots[2]["medium"] == "radio"
    assert client.get("/api/spots/template/nope").status_code == 404


def test_demo_user_writes_to_the_sandbox(client, auth_headers):
    cid = _new_campaign("Spot Demo")
    demo = {"Authorization": f"Bearer {create_access_token(data={'sub': 'demo', 'role': 'demo'})}"}
    st = client.post("/api/spots/sample", params={"campaign_id": cid}, headers=demo).json()
    assert st["campaign_id"] != cid
    db = SessionLocal()
    try:
        assert db.query(TvSpot).filter(TvSpot.campaign_id == cid).count() == 0
    finally:
        db.close()
    assert client.get("/api/spots/status", params={"campaign_id": cid}, headers=demo).json()["spots"]["count"] > 0
    assert client.get("/api/spots/status", params={"campaign_id": cid}, headers=auth_headers).json()["spots"]["count"] == 0


def test_bigquery_minute_traffic(client, auth_headers):
    cid = _new_campaign("Spot BQ")
    r = client.post("/api/spots/traffic/from-bigquery", params={"campaign_id": cid}, headers=auth_headers)
    assert r.status_code == 404 and "BigQuery" in r.json()["detail"]

    db = SessionLocal()
    try:
        camp = db.get(Campaign, cid)
        camp.bq_project, camp.bq_dataset = "my-proj-1", "analytics_123"
        db.commit()
    finally:
        db.close()
    client.post("/api/spots/upload", params={"campaign_id": cid},
                files={"file": ("l.csv", b"Tarih;Saat;Kanal\n20.10.2026;21:00;Kanal D\n", "text/csv")}, headers=auth_headers)
    df = pd.DataFrame({"minute": ["2026-10-06T00:00", "2026-10-06T00:01"], "sessions": [3, 4],
                       "sessions_unpaid": [2, 3], "conversions": [0, 1]})
    routes_bigquery._bq_clients["my-proj-1:analytics_123"] = {"client": object(), "_ts": 1e18}
    try:
        with patch.object(routes_bigquery, "query_minute_traffic", return_value=df) as q:
            r = client.post("/api/spots/traffic/from-bigquery", params={"campaign_id": cid}, headers=auth_headers)
    finally:
        routes_bigquery._bq_clients.pop("my-proj-1:analytics_123", None)
    assert r.status_code == 200, r.text
    # Default range: 14 spot-free days before the first spot through the last spot's day.
    assert q.call_args.args[3:5] == ("2026-10-06", "2026-10-20")
    assert r.json()["minutes"] == 2
    db = SessionLocal()
    try:
        rows = db.query(TrafficMinute).filter(TrafficMinute.campaign_id == cid).order_by(TrafficMinute.minute).all()
        assert [(m.minute, m.sessions, m.conversions, m.source) for m in rows] == [
            ("2026-10-06T00:00", 3, 0, "bigquery"), ("2026-10-06T00:01", 4, 1, "bigquery")]
    finally:
        db.close()
