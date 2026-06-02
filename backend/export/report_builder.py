"""Build formatted Excel workbooks from DDA attribution results."""

from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


_HEADER_FILL = PatternFill(start_color="1e293b", end_color="1e293b", fill_type="solid")
_HEADER_FONT = Font(bold=True, color="ffffff", size=10)
_THIN_BORDER = Border(
    bottom=Side(style="thin", color="334155"),
)
_PCT_FMT = "0.0%"
_NUM_FMT = "#,##0"
_DEC_FMT = "0.00"


def _auto_widths(ws) -> None:
    for col_cells in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col_cells[0].column)
        for cell in col_cells:
            val = str(cell.value) if cell.value is not None else ""
            max_len = max(max_len, len(val))
        ws.column_dimensions[col_letter].width = min(max_len + 4, 40)


def _write_header(ws, row: int, values: list[str]) -> None:
    for col, val in enumerate(values, 1):
        cell = ws.cell(row=row, column=col, value=val)
        cell.fill = _HEADER_FILL
        cell.font = _HEADER_FONT
        cell.alignment = Alignment(horizontal="center")
        cell.border = _THIN_BORDER


def _write_title(ws, campaign_name: str, run_date: str) -> None:
    ws.cell(row=1, column=1, value=f"Time's Hub — {campaign_name}").font = Font(bold=True, size=12)
    ws.cell(row=2, column=1, value=f"Rapor Tarihi: {run_date}").font = Font(size=9, color="64748b")


def _build_summary_sheet(wb: Workbook, result: dict, campaign_name: str, run_date: str) -> None:
    ws = wb.active
    ws.title = "Ozet"
    _write_title(ws, campaign_name, run_date)

    stats = result.get("journey_stats", {})
    _write_header(ws, 4, ["Metrik", "Deger"])

    rows = [
        ("Toplam Yolculuk", stats.get("total_journeys", 0), _NUM_FMT),
        ("Donusum Yapan", stats.get("converted", 0), _NUM_FMT),
        ("Donusum Orani", stats.get("conversion_rate", 0), _PCT_FMT),
        ("Ort. Temas Noktasi", stats.get("avg_path_length", stats.get("avg_touchpoints", 0)), _DEC_FMT),
        ("Tek Temas %", stats.get("single_touch_pct", 0), _PCT_FMT),
        ("Coklu Temas %", stats.get("multi_touch_pct", 0), _PCT_FMT),
    ]
    for i, (label, val, fmt) in enumerate(rows, 5):
        ws.cell(row=i, column=1, value=label)
        c = ws.cell(row=i, column=2, value=val)
        c.number_format = fmt
        c.alignment = Alignment(horizontal="right")

    markov = result.get("markov", {})
    conv_prob = markov.get("conversion_probability", 0)
    if conv_prob:
        r = len(rows) + 6
        ws.cell(row=r, column=1, value="Markov Donusum Olasiligi")
        c = ws.cell(row=r, column=2, value=conv_prob)
        c.number_format = _PCT_FMT

    _auto_widths(ws)


def _build_attribution_sheet(wb: Workbook, result: dict) -> None:
    ws = wb.create_sheet("Kanal Atfetme")
    hybrid = result.get("hybrid_attribution", {})
    markov_w = result.get("markov", {}).get("attribution_weights", {})
    shapley = result.get("shapley_dda", {})
    removal = result.get("markov", {}).get("removal_effects", {})

    _write_header(ws, 1, ["Kanal", "DDA Katki (%)", "Markov (%)", "Shapley (%)", "Kaldirim Etkisi"])

    channels = sorted(hybrid.keys(), key=lambda ch: -hybrid.get(ch, 0))
    for i, ch in enumerate(channels, 2):
        ws.cell(row=i, column=1, value=ch)
        for col, src in [(2, hybrid), (3, markov_w), (4, shapley)]:
            c = ws.cell(row=i, column=col, value=src.get(ch, 0))
            c.number_format = _PCT_FMT
            c.alignment = Alignment(horizontal="right")
        c = ws.cell(row=i, column=5, value=removal.get(ch, 0))
        c.number_format = _DEC_FMT
        c.alignment = Alignment(horizontal="right")

    _auto_widths(ws)


def _build_assist_sheet(wb: Workbook, result: dict) -> None:
    ws = wb.create_sheet("Asist Raporu")
    report = result.get("assist_report", [])
    _write_header(ws, 1, ["Kanal", "Son Temas", "Ilk Temas", "Asist", "Asist Orani", "Toplam Katilim"])

    for i, row in enumerate(report, 2):
        ws.cell(row=i, column=1, value=row.get("channel", ""))
        ws.cell(row=i, column=2, value=row.get("last_touch", 0)).number_format = _NUM_FMT
        ws.cell(row=i, column=3, value=row.get("first_touch", 0)).number_format = _NUM_FMT
        ws.cell(row=i, column=4, value=row.get("assists", 0)).number_format = _NUM_FMT
        ws.cell(row=i, column=5, value=row.get("assist_ratio", 0)).number_format = _PCT_FMT
        ws.cell(row=i, column=6, value=row.get("total_involvement", 0)).number_format = _NUM_FMT

    _auto_widths(ws)


def _build_paths_sheet(wb: Workbook, result: dict) -> None:
    paths = result.get("top_paths", [])
    if not paths:
        return
    ws = wb.create_sheet("Donusum Yollari")
    _write_header(ws, 1, ["#", "Yol", "Sayi", "Donusum Orani"])

    for i, p in enumerate(paths[:20], 2):
        ws.cell(row=i, column=1, value=i - 1)
        path_parts = p.get("path", [])
        if isinstance(path_parts, list):
            path_str = " → ".join(str(s) for s in path_parts)
        else:
            path_str = str(path_parts)
        ws.cell(row=i, column=2, value=path_str)
        ws.cell(row=i, column=3, value=p.get("count", p.get("total", 0))).number_format = _NUM_FMT
        ws.cell(row=i, column=4, value=p.get("conversion_rate", p.get("rate", 0))).number_format = _PCT_FMT

    _auto_widths(ws)


def _build_insights_sheet(wb: Workbook, result: dict) -> None:
    insights = result.get("insights", [])
    if not insights:
        return
    ws = wb.create_sheet("Cikarimlar")

    type_fills = {
        "warning": PatternFill(start_color="451a03", end_color="451a03", fill_type="solid"),
        "success": PatternFill(start_color="052e16", end_color="052e16", fill_type="solid"),
        "info": PatternFill(start_color="0c1a3d", end_color="0c1a3d", fill_type="solid"),
    }
    type_fonts = {
        "warning": Font(color="fbbf24", size=10),
        "success": Font(color="34d399", size=10),
        "info": Font(color="60a5fa", size=10),
    }

    _write_header(ws, 1, ["Tip", "Kategori", "Cikarim"])

    for i, ins in enumerate(insights, 2):
        t = ins.get("type", "info")
        ws.cell(row=i, column=1, value=t.capitalize())
        ws.cell(row=i, column=2, value=ins.get("category", ""))
        c = ws.cell(row=i, column=3, value=ins.get("text", ""))
        fill = type_fills.get(t)
        font = type_fonts.get(t)
        if fill:
            for col in range(1, 4):
                ws.cell(row=i, column=col).fill = fill
        if font:
            c.font = font

    _auto_widths(ws)


def build_dda_report(result: dict, campaign_name: str = "", run_date: str = "") -> Workbook:
    """Build a multi-sheet Excel workbook from a DDA result snapshot."""
    wb = Workbook()
    _build_summary_sheet(wb, result, campaign_name, run_date)
    _build_attribution_sheet(wb, result)
    _build_assist_sheet(wb, result)
    _build_paths_sheet(wb, result)
    _build_insights_sheet(wb, result)
    return wb


def workbook_to_bytes(wb: Workbook) -> BytesIO:
    """Serialize a Workbook to a BytesIO buffer ready for streaming."""
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
