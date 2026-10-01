"""Readers for TV/radio spot lists (Excel/CSV) and minute-level web traffic files.

Spot lists come from monitoring exports (Adjinn, Ad-alert, ...) or the agency's own
broadcast list, with varying Turkish/English headers. Columns are found by keyword;
only an airing date + time and a station are required.
"""

from __future__ import annotations

import math
import re
from datetime import date, datetime, time, timedelta
import csv
from io import BytesIO, StringIO

import pandas as pd

MAX_SPOT_ROWS = 20_000
MAX_TRAFFIC_ROWS = 200_000

# Most specific keyword first; a column is matched by the first keyword any header contains.
SPOT_COLUMNS: dict[str, list[str]] = {
    "datetime": ["yayın zamanı", "yayin zamani", "datetime", "timestamp", "tarih saat", "tarih/saat"],
    "date": ["yayın tarihi", "yayin tarihi", "tarih", "date"],
    "time": ["yayın saati", "yayin saati", "başlangıç saati", "baslangic saati", "saat", "start time", "time", "başlangıç"],
    "station": ["kanal", "istasyon", "station", "channel", "yayıncı", "yayinci", "radyo", "mecra"],
    "program": ["program", "kuşak", "kusak", "programme"],
    "creative": ["reklam adı", "reklam adi", "kreatif", "versiyon", "spot adı", "spot adi", "film", "creative", "copy", "reklam"],
    "duration": ["süre", "sure", "saniye", "duration", "length", "sn"],
    "cost": ["net tutar", "net maliyet", "maliyet", "tutar", "bütçe", "butce", "cost", "spend", "fiyat"],
    "grp": ["grp", "trp", "rating", "rtg"],
    # After "station": a "Mecra" column is the station only when there is no "Kanal" column.
    "medium": ["medya türü", "medya turu", "medya", "medium", "media type", "tür", "tur", "mecra"],
}
TRAFFIC_COLUMNS: dict[str, list[str]] = {
    "minute": ["minute", "dakika", "datetime", "timestamp", "zaman", "tarih saat", "time"],
    "sessions": ["sessions", "oturum", "ziyaret", "visits", "users", "kullanıcı"],
    "sessions_unpaid": ["unpaid", "direct", "organik", "organic", "ücretsiz"],
    "conversions": ["conversions", "dönüşüm", "donusum", "lead", "purchase"],
}
RADIO_RE = re.compile(r"\b(radyo|radio|fm)\b", re.IGNORECASE)


def _lower(v) -> str:
    return str(v if v is not None else "").replace("İ", "i").replace("I", "ı").lower().strip()


def _find_columns(headers: list[str], spec: dict[str, list[str]]) -> dict[str, int]:
    hs = [_lower(h) for h in headers]
    found: dict[str, int] = {}
    used: set[int] = set()
    for field, keywords in spec.items():
        for kw in keywords:
            hit = next((i for i, h in enumerate(hs) if kw in h and i not in used), None)
            if hit is not None:
                found[field] = hit
                used.add(hit)
                break
    return found


def _read_rows(content: bytes, filename: str) -> list[list]:
    name = filename.lower()
    if name.endswith(".csv"):
        text = content.decode("utf-8-sig", errors="replace")
        sep = ";" if text[:2000].count(";") > text[:2000].count(",") else ","
        # csv, not pandas: exports often start with title rows of a different width.
        return [[c if c != "" else None for c in r] for r in csv.reader(StringIO(text), delimiter=sep)]
    elif name.endswith(".xlsx"):
        df = pd.read_excel(BytesIO(content), header=None, dtype=object)
    else:
        raise ValueError("Desteklenmeyen dosya türü: .xlsx veya .csv yükleyin.")
    return df.where(pd.notna(df), None).values.tolist()


def _header_row(rows: list[list], spec: dict[str, list[str]], required: list[list[str]]) -> int:
    """First of the top rows that has one column for every required field group."""
    for i, row in enumerate(rows[:30]):
        cols = _find_columns([str(c or "") for c in row], spec)
        if all(any(f in cols for f in group) for group in required):
            return i
    return -1


def _to_number(v) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return None if isinstance(v, float) and math.isnan(v) else float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v))
    if not s:
        return None
    # Turkish "1.234.567,89" vs "1,234,567.89" vs "1234,5"
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".") if len(s.split(",")[-1]) != 3 else s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def _to_date(v) -> date | None:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)) and 20000 < v < 80000:  # Excel serial
        return (datetime(1899, 12, 30) + timedelta(days=int(v))).date()
    s = str(v).strip()
    for fmt in ("%d.%m.%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d.%m.%y", "%Y.%m.%d", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s[:19] if fmt.endswith("%S") else s[:10], fmt).date()
        except ValueError:
            continue
    return None


def _to_minutes(v) -> int | None:
    """Minutes after midnight of an airing time. Broadcast-day times past 24:00 ("25:30") are allowed."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.hour * 60 + v.minute
    if isinstance(v, time):
        return v.hour * 60 + v.minute
    if isinstance(v, timedelta):
        return int(v.total_seconds() // 60)
    if isinstance(v, (int, float)) and 0 <= v < 2:  # Excel time fraction
        return int(round(v * 1440 * 60) // 60)
    m = re.match(r"^\s*(\d{1,2})[:.](\d{2})", str(v))
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    m = re.match(r"^\s*(\d{3,4})\s*$", str(v))  # "2015"
    if m:
        hhmm = int(m.group(1))
        return (hhmm // 100) * 60 + hhmm % 100
    return None


def _to_datetime(v) -> datetime | None:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v
    if isinstance(v, pd.Timestamp):
        return v.to_pydatetime()
    if isinstance(v, (int, float)) and 20000 < v < 80000:
        return datetime(1899, 12, 30) + timedelta(days=float(v))
    s = str(v).strip().replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M",
                "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%Y%m%d%H%M"):
        try:
            return datetime.strptime(s[:19], fmt)
        except ValueError:
            continue
    return None


def parse_spot_file(content: bytes, filename: str, default_medium: str = "tv") -> tuple[list[dict], list[str]]:
    """Spots of a TV/radio broadcast list: (spots, warnings).

    Each spot: aired_at (naive local datetime, minute precision), medium, station,
    program, creative, duration_sec, cost, grp. Raises ValueError with a Turkish
    message when the file has no usable date/time/station columns.
    """
    rows = _read_rows(content, filename)
    h = _header_row(rows, SPOT_COLUMNS, [["datetime", "date"], ["station"]])
    if h < 0:
        raise ValueError(
            "Spot listesinde başlık satırı bulunamadı. Gerekli sütunlar: yayın tarihi (\"Tarih\"), "
            "yayın saati (\"Saat\") ve kanal/istasyon (\"Kanal\")."
        )
    cols = _find_columns([str(c or "") for c in rows[h]], SPOT_COLUMNS)
    if "datetime" not in cols and "time" not in cols:
        raise ValueError("Spot listesinde yayın saati sütunu bulunamadı (\"Saat\" / \"Başlangıç Saati\").")

    spots: list[dict] = []
    skipped = 0
    for row in rows[h + 1:h + 1 + MAX_SPOT_ROWS]:
        get = lambda f: row[cols[f]] if f in cols and cols[f] < len(row) else None  # noqa: E731
        station = str(get("station") or "").strip()
        if "datetime" in cols:
            aired = _to_datetime(get("datetime"))
        else:
            d, mins = _to_date(get("date")), _to_minutes(get("time"))
            aired = datetime.combine(d, time()) + timedelta(minutes=mins) if d and mins is not None else None
        if not aired or not station:
            if any(c not in (None, "") for c in row):
                skipped += 1
            continue
        medium_raw = _lower(get("medium"))
        if "radyo" in medium_raw or "radio" in medium_raw:
            medium = "radio"
        elif medium_raw.startswith("tv") or "televizyon" in medium_raw:
            medium = "tv"
        else:
            medium = "radio" if RADIO_RE.search(station) else default_medium
        duration = _to_number(get("duration"))
        spots.append({
            "aired_at": aired.replace(second=0, microsecond=0),
            "medium": medium,
            "station": station,
            "program": str(get("program") or "").strip(),
            "creative": str(get("creative") or "").strip(),
            "duration_sec": int(duration) if duration else None,
            "cost": _to_number(get("cost")) or 0.0,
            "grp": _to_number(get("grp")),
        })
    warnings = []
    if skipped:
        warnings.append(f"{skipped} satır tarih/saat veya kanal okunamadığı için atlandı.")
    if len(rows) - h - 1 > MAX_SPOT_ROWS:
        warnings.append(f"Dosya {MAX_SPOT_ROWS} spot sınırında kesildi.")
    if "cost" not in cols:
        warnings.append("Maliyet sütunu bulunamadı: ziyaret başı maliyet hesaplanamayacak.")
    if not spots:
        raise ValueError("Spot listesinde okunabilir satır yok (tarih, saat ve kanal dolu olmalı).")
    return spots, warnings


def parse_traffic_file(content: bytes, filename: str) -> tuple[list[dict], list[str]]:
    """Minute-level web traffic: (rows, warnings); each row minute (datetime), sessions,
    sessions_unpaid (or None) and conversions (or None)."""
    rows = _read_rows(content, filename)
    h = _header_row(rows, TRAFFIC_COLUMNS, [["minute"], ["sessions"]])
    if h < 0:
        raise ValueError("Trafik dosyasında \"minute\" (tarih-saat) ve \"sessions\" (oturum) sütunları gerekli.")
    cols = _find_columns([str(c or "") for c in rows[h]], TRAFFIC_COLUMNS)
    out: dict[datetime, dict] = {}
    for row in rows[h + 1:h + 1 + MAX_TRAFFIC_ROWS]:
        get = lambda f: row[cols[f]] if f in cols and cols[f] < len(row) else None  # noqa: E731
        ts = _to_datetime(get("minute"))
        sessions = _to_number(get("sessions"))
        if ts is None or sessions is None:
            continue
        ts = ts.replace(second=0, microsecond=0)
        r = out.setdefault(ts, {"minute": ts, "sessions": 0.0, "sessions_unpaid": None, "conversions": None})
        r["sessions"] += sessions
        for f in ("sessions_unpaid", "conversions"):
            v = _to_number(get(f)) if f in cols else None
            if v is not None:
                r[f] = (r[f] or 0.0) + v
    if not out:
        raise ValueError("Trafik dosyasında okunabilir satır yok.")
    data = sorted(out.values(), key=lambda r: r["minute"])
    warnings = []
    if len(data) > 1:
        gaps = sorted((b["minute"] - a["minute"]).total_seconds() / 60 for a, b in zip(data, data[1:]))
        if gaps[len(gaps) // 2] > 1:
            warnings.append(
                "Trafik verisi dakikalık değil gibi görünüyor (satırlar arası tipik aralık "
                f"{gaps[len(gaps) // 2]:.0f} dk). Spot etkisi dakika düzeyinde ölçülür."
            )
    return data, warnings
