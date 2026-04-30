"""Generate Time's Hub management presentation as PPTX."""

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# ── Brand colours ──
BG = RGBColor(0x0B, 0x11, 0x20)
CARD = RGBColor(0x11, 0x18, 0x27)
ACCENT = RGBColor(0xF9, 0x73, 0x16)
ACCENT_DARK = RGBColor(0xEA, 0x58, 0x0C)
WHITE = RGBColor(0xE2, 0xE8, 0xF0)
MUTED = RGBColor(0x94, 0xA3, 0xB8)
DIM = RGBColor(0x64, 0x74, 0x8B)
BORDER = RGBColor(0x1E, 0x29, 0x3B)
GREEN = RGBColor(0x4A, 0xDE, 0x80)
BLUE = RGBColor(0x60, 0xA5, 0xFA)
PURPLE = RGBColor(0xC0, 0x84, 0xFC)
RED_WARN = RGBColor(0xEF, 0x44, 0x44)

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

FONT = "Calibri"


# ── Helpers ──
def set_bg(slide, color=BG):
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_text(slide, left, top, width, height, text, size=18, color=WHITE,
             bold=False, align=PP_ALIGN.LEFT, font=FONT):
    txBox = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = txBox.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(size)
    p.font.color.rgb = color
    p.font.bold = bold
    p.font.name = font
    p.alignment = align
    return tf


def add_para(tf, text, size=16, color=MUTED, bold=False, space_before=Pt(6)):
    p = tf.add_paragraph()
    p.text = text
    p.font.size = Pt(size)
    p.font.color.rgb = color
    p.font.bold = bold
    p.font.name = FONT
    p.space_before = space_before
    return p


def add_card(slide, left, top, width, height, fill_color=CARD):
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(left), Inches(top), Inches(width), Inches(height)
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    shape.line.color.rgb = BORDER
    shape.line.width = Pt(1)
    shape.shadow.inherit = False
    return shape


def add_accent_line(slide, left, top, width):
    shape = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(left), Inches(top), Inches(width), Pt(3)
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = ACCENT
    shape.line.fill.background()
    return shape


def add_tag(slide, left, top, text, color=ACCENT):
    w, h = 1.1, 0.32
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(w), Inches(h)
    )
    shape.fill.solid()
    r, g, b = color
    shape.fill.fore_color.rgb = RGBColor(r // 5, g // 5, b // 5)
    shape.line.fill.background()
    tf = shape.text_frame
    tf.paragraphs[0].text = text
    tf.paragraphs[0].font.size = Pt(10)
    tf.paragraphs[0].font.color.rgb = color
    tf.paragraphs[0].font.bold = True
    tf.paragraphs[0].font.name = FONT
    tf.paragraphs[0].alignment = PP_ALIGN.CENTER
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    return shape


def slide_number(slide, num, total=14):
    add_text(slide, 0.5, 7.0, 2, 0.35, f"{num} / {total}", size=10, color=DIM)


# ═══════════════════════════════════════════════
# SLIDE 1 — COVER
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0, 1.5, 13.333, 0.5, "TIME × GROWITY", size=14, color=DIM, align=PP_ALIGN.CENTER)
add_text(sl, 0, 2.3, 13.333, 1.0, "Time's Hub", size=52, color=WHITE, bold=True, align=PP_ALIGN.CENTER)
add_text(sl, 0, 3.3, 13.333, 0.6, "Attribution Intelligence", size=28, color=ACCENT, align=PP_ALIGN.CENTER)
tf = add_text(sl, 2, 4.3, 9.333, 1.2,
    "Multi-channel attribution modelling platformu.\n"
    "Dijital ve geleneksel medya bütçelerinin gerçek etkisini\n"
    "veri odaklı ölçen ve optimize eden karar destek sistemi.",
    size=16, color=MUTED, align=PP_ALIGN.CENTER)

for i, (tag, col) in enumerate([("MMM", BLUE), ("DDA", ACCENT), ("Incrementality", GREEN), ("Unified", PURPLE)]):
    add_tag(sl, 4.0 + i * 1.4, 5.8, tag, col)
slide_number(sl, 1)


# ═══════════════════════════════════════════════
# SLIDE 2 — PROBLEM
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0.8, 0.5, 4, 0.4, "PROBLEM", size=12, color=ACCENT, bold=True)
add_text(sl, 0.8, 1.0, 10, 0.7, "Bugün bütçe kararları nasıl veriliyor?", size=32, color=WHITE, bold=True)

# Left card — current state
add_card(sl, 0.8, 2.0, 5.6, 4.5)
add_text(sl, 1.1, 2.15, 5, 0.5, "Mevcut Durum", size=20, color=RED_WARN, bold=True)
problems = [
    "Last-click attribution — son tıklamaya tüm kredi",
    "Meta ile Google birbirinin kredisini çalıyor",
    "TV, radyo, DOOH etkisi hiç ölçülemiyor",
    "Bütçe dağılımı sezgisel, veri odaklı değil",
    "Hangi kanalın gerçek satış yarattığı bilinmiyor",
]
tf = add_text(sl, 1.1, 2.75, 5, 3.5, "", size=15, color=MUTED)
for prob in problems:
    add_para(tf, f"•  {prob}", size=15, color=MUTED, space_before=Pt(8))

# Right card — solution
add_card(sl, 6.9, 2.0, 5.6, 4.5)
add_accent_line(sl, 6.9, 2.0, 5.6)
add_text(sl, 7.2, 2.15, 5, 0.5, "Time's Hub ile", size=20, color=ACCENT, bold=True)
solutions = [
    "3 farklı model birbirini doğrular",
    "Online + offline tüm kanallar tek çatıda",
    "Kanal bazlı gerçek ROI ölçümü",
    "Veri odaklı bütçe reallocation önerisi",
    "Haftalık otomatik rapor ve erken uyarı",
]
tf = add_text(sl, 7.2, 2.75, 5, 3.5, "", size=15, color=MUTED)
for sol in solutions:
    add_para(tf, f"•  {sol}", size=15, color=WHITE, space_before=Pt(8))
slide_number(sl, 2)


# ═══════════════════════════════════════════════
# SLIDE 3 — THREE PILLARS
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0.8, 0.5, 4, 0.4, "METODOLOJİ", size=12, color=ACCENT, bold=True)
add_text(sl, 0.8, 1.0, 10, 0.7, "Üç model, tek unified skor", size=32, color=WHITE, bold=True)

pillars = [
    ("MMM", "Marketing Mix Model", BLUE,
     "Haftalık harcama verisinden kanal bazlı katkı ayrıştırması. "
     "Adstock (carry-over) + saturation (azalan verim) modeli ile "
     "her kanalın marjinal getirisini hesaplar.",
     "Online + Offline tüm kanallar",
     "Haftalık spend, impression, GRP"),
    ("DDA", "Data-Driven Attribution", ACCENT,
     "CRM touchpoint verisinden Markov Chain + Shapley Value blend. "
     "Her lead'in yolculuğunu analiz ederek kanallara adil kredi dağıtır.",
     "Online dijital kanallar",
     "CRM touchpoint logları"),
    ("INC", "Incrementality Testing", GREEN,
     "Geo-lift, holdout ve PSA testleri ile gerçek incremental etkiyi ölçer. "
     "Diğer modellerin ürettiği skorları kalibre eden doğrulama katmanı.",
     "Test edilen kanallar",
     "A/B test sonuçları"),
]

for i, (abbr, title, col, desc, covers, data) in enumerate(pillars):
    x = 0.8 + i * 4.1
    add_card(sl, x, 2.0, 3.7, 4.0)
    # Icon circle
    circ = sl.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x + 0.2), Inches(2.2), Inches(0.6), Inches(0.6))
    circ.fill.solid()
    r, g, b = col
    circ.fill.fore_color.rgb = RGBColor(r // 5, g // 5, b // 5)
    circ.line.fill.background()
    ctf = circ.text_frame
    ctf.paragraphs[0].text = abbr
    ctf.paragraphs[0].font.size = Pt(13)
    ctf.paragraphs[0].font.color.rgb = col
    ctf.paragraphs[0].font.bold = True
    ctf.paragraphs[0].font.name = FONT
    ctf.paragraphs[0].alignment = PP_ALIGN.CENTER
    ctf.vertical_anchor = MSO_ANCHOR.MIDDLE

    add_text(sl, x + 0.2, 3.0, 3.3, 0.4, title, size=16, color=WHITE, bold=True)
    tf = add_text(sl, x + 0.2, 3.45, 3.3, 1.5, desc, size=12, color=MUTED)
    add_para(tf, f"Kapsar: {covers}", size=11, color=WHITE, bold=False, space_before=Pt(10))
    add_para(tf, f"Veri: {data}", size=11, color=MUTED, space_before=Pt(4))

# Formula bar
add_card(sl, 0.8, 6.3, 11.7, 0.65)
add_text(sl, 0.8, 6.32, 11.7, 0.6,
    "Unified Skor  =  DDA × 0.50   +   MMM × 0.35   +   Incrementality × 0.15",
    size=17, color=ACCENT, bold=True, align=PP_ALIGN.CENTER, font="Consolas")
slide_number(sl, 3)


# ═══════════════════════════════════════════════
# SLIDE 4 — HOW IT WORKS
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0.8, 0.5, 4, 0.4, "NASIL ÇALIŞIR", size=12, color=ACCENT, bold=True)
add_text(sl, 0.8, 1.0, 10, 0.7, "Veri girişinden aksiyona, 4 adım", size=32, color=WHITE, bold=True)

steps = [
    ("1", "Veri Yükleme", ACCENT,
     "Haftalık kanal bazlı harcama CSV'si ve CRM touchpoint verisini yükleyin. Sistem otomatik validasyon yapar."),
    ("2", "Model Çalıştırma", BLUE,
     "MMM (varsayılan parametrelerle) adstock/saturation + DDA Markov/Shapley modelleri otomatik çalışır. Parametreler veri yüklendikten sonra Phase B ile kalibre edilir. Incrementality testleri Phase 4 (Q4 2026) ile eklenir."),
    ("3", "Unified Scoring", GREEN,
     "Üç model birleştirilir. Cross-validation: DDA vs MMM sapması >%20 ise uyarı verilir."),
    ("4", "Bütçe Optimizasyonu", PURPLE,
     "Kanal bazlı ROI'ye göre bütçe reallocation önerisi. Düşük verimli kanallardan yüksek verimli kanallara kaydırma."),
]

for i, (num, title, col, desc) in enumerate(steps):
    row = i // 2
    colx = i % 2
    x = 0.8 + colx * 6.2
    y = 2.0 + row * 2.5
    add_card(sl, x, y, 5.7, 2.1)
    # Left accent stripe
    stripe = sl.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Pt(4), Inches(2.1))
    stripe.fill.solid()
    stripe.fill.fore_color.rgb = col
    stripe.line.fill.background()
    add_text(sl, x + 0.25, y + 0.15, 1, 0.3, f"ADIM {num}", size=11, color=col, bold=True)
    add_text(sl, x + 0.25, y + 0.5, 5, 0.4, title, size=18, color=WHITE, bold=True)
    add_text(sl, x + 0.25, y + 1.0, 5.1, 0.9, desc, size=13, color=MUTED)
slide_number(sl, 4)


# ═══════════════════════════════════════════════
# SLIDE 5 — PO FILO CASE
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0.8, 0.5, 4, 0.4, "CANLI ÖRNEK", size=12, color=ACCENT, bold=True)
add_text(sl, 0.8, 1.0, 11, 0.7, "PO AutoMatic Filo — 55M TL bütçe, 10 kanal", size=30, color=WHITE, bold=True)

# Left card — profile
add_card(sl, 0.8, 2.0, 5.6, 4.5)
add_text(sl, 1.2, 2.2, 4, 0.4, "Kampanya Profili", size=18, color=WHITE, bold=True)
metrics = [
    ("Toplam Bütçe", "55M ₺", ACCENT),
    ("Hedef", "B2B Filo Başvurusu", WHITE),
    ("Online Kanallar", "Meta, Google, TikTok, LinkedIn, DV360, YouTube", WHITE),
    ("Offline Kanallar", "TV (Maç + Haber), Radyo, DOOH", WHITE),
]
for j, (label, val, vcol) in enumerate(metrics):
    yy = 2.85 + j * 0.75
    add_text(sl, 1.2, yy, 2.5, 0.35, label, size=13, color=DIM)
    add_text(sl, 3.4, yy, 2.5, 0.35, val, size=13, color=vcol, bold=(vcol == ACCENT))

# Right card — segments
add_card(sl, 6.9, 2.0, 5.6, 4.5)
add_text(sl, 7.3, 2.2, 4, 0.4, "Segment Dağılımı", size=18, color=WHITE, bold=True)
# Table header
for hx, htxt in [(7.3, "Segment"), (9.8, "Bütçe"), (11.2, "Pay")]:
    add_text(sl, hx, 2.8, 1.8, 0.3, htxt, size=11, color=DIM, bold=True)

segments = [
    ("S1 Hızlı Ölçeklenen", "33M ₺", "%60", ACCENT),
    ("S2 Çalışanı Gözeten", "13.75M ₺", "%25", BLUE),
    ("S3 Yaygın Filolu", "5.5M ₺", "%10", GREEN),
    ("S4 Rakiple Çalışan", "2.75M ₺", "%5", PURPLE),
]
for j, (seg, bud, pct, col) in enumerate(segments):
    yy = 3.25 + j * 0.7
    add_text(sl, 7.3, yy, 2.4, 0.3, seg, size=13, color=WHITE)
    add_text(sl, 9.8, yy, 1.2, 0.3, bud, size=13, color=MUTED)
    add_tag(sl, 11.2, yy, pct, col)
slide_number(sl, 5)


# ═══════════════════════════════════════════════
# SLIDE 6 — PLATFORM MODULES
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0.8, 0.5, 5, 0.4, "PLATFORM EKRANLARI", size=12, color=ACCENT, bold=True)
add_text(sl, 0.8, 1.0, 10, 0.7, "Time's Hub — Ana modüller", size=32, color=WHITE, bold=True)

modules = [
    ("Unified Rapor", ACCENT,
     "Kanal bazlı DDA + MMM + INC unified skorları, stacked bar grafik ve cross-validation uyarıları tek sayfada."),
    ("MMM Çıktıları", BLUE,
     "Her kanal için adstock carry-over, saturation eğrisi, response model ve decomposition raporu."),
    ("MTA Paths", GREEN,
     "Top conversion yolculukları, Markov removal effect ve Shapley value atıf dağılımı."),
]
for i, (mod, col, desc) in enumerate(modules):
    x = 0.8 + i * 4.1
    add_card(sl, x, 2.0, 3.7, 2.6)
    add_text(sl, x + 0.3, 2.2, 3.1, 0.4, mod, size=17, color=col, bold=True, align=PP_ALIGN.CENTER)
    add_text(sl, x + 0.3, 2.75, 3.1, 1.5, desc, size=13, color=MUTED, align=PP_ALIGN.CENTER)

modules2 = [
    ("Bütçe Reallocation", PURPLE,
     "Unified skora göre kanal bazlı bütçe kaydırma önerisi. Düşük ROI kanallardan yüksek ROI kanallara otomatik öneri."),
    ("Incrementality Testing", GREEN,
     "Geo-lift, holdout, PSA test sonuçları. p-value bazlı anlamlılık testi ve düzeltme faktörleri."),
]
for i, (mod, col, desc) in enumerate(modules2):
    x = 2.85 + i * 4.1
    add_card(sl, x, 5.0, 3.7, 2.1)
    add_text(sl, x + 0.3, 5.15, 3.1, 0.4, mod, size=17, color=col, bold=True, align=PP_ALIGN.CENTER)
    add_text(sl, x + 0.3, 5.6, 3.1, 1.2, desc, size=13, color=MUTED, align=PP_ALIGN.CENTER)
slide_number(sl, 6)


# ═══════════════════════════════════════════════
# SLIDE 7 — MMM EXAMPLE
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0.8, 0.5, 6, 0.4, "PLATFORM ÖRNEĞİ — MMM", size=12, color=ACCENT, bold=True)
add_text(sl, 0.8, 1.0, 11, 0.7, "Kanal bazlı adstock & saturation analizi", size=30, color=WHITE, bold=True)

# Left — adstock table
add_card(sl, 0.8, 2.0, 5.6, 4.8)
add_text(sl, 1.2, 2.15, 4, 0.4, "Adstock (Carry-over) Oranları", size=17, color=WHITE, bold=True)
add_text(sl, 1.2, 2.6, 5, 0.35, "Her kanalın reklam harcamasının sonraki haftalara taşan etkisi:", size=12, color=MUTED)

# Table header
for hx, htxt in [(1.2, "Kanal"), (3.5, "Decay (λ)"), (4.8, "Etki Süresi")]:
    add_text(sl, hx, 3.1, 1.5, 0.3, htxt, size=11, color=DIM, bold=True)

adstock_rows = [
    ("TV (Maç)", "0.75", "2-3 hafta"),
    ("YouTube", "0.40", "1+ hafta"),
    ("Meta", "0.35", "3-5 gün"),
    ("Google Search", "0.10", "Anlık"),
    ("DOOH", "0.05", "Anlık"),
]
for j, (ch, decay, dur) in enumerate(adstock_rows):
    yy = 3.5 + j * 0.55
    add_text(sl, 1.2, yy, 2, 0.3, ch, size=13, color=WHITE)
    add_text(sl, 3.5, yy, 1, 0.3, decay, size=13, color=ACCENT, bold=True)
    add_text(sl, 4.8, yy, 1.5, 0.3, dur, size=13, color=MUTED)

# Formula
add_card(sl, 1.0, 6.1, 5.2, 0.5)
add_text(sl, 1.0, 6.12, 5.2, 0.45, "adstock[t] = spend[t] + λ × adstock[t-1]",
    size=14, color=ACCENT, bold=True, align=PP_ALIGN.CENTER, font="Consolas")

# Right — insights
add_card(sl, 6.9, 2.0, 5.6, 4.8)
add_text(sl, 7.3, 2.15, 5, 0.4, "Bu ne anlama geliyor?", size=17, color=WHITE, bold=True)
insights = [
    "TV maç sponsorluğunun etkisi 2-3 hafta devam ediyor — tek haftalık raporlara bakarak TV'nin düşük performans gösterdiğini düşünmek yanıltıcı",
    "Google Search anlık dönüşüm kanalı — carry-over neredeyse sıfır, ama last-click'te haksız yere tüm krediyi alıyor",
    "YouTube video etkisi Meta'dan daha uzun sürüyor — video içerik yatırımı gecikmeli ama kalıcı sonuç veriyor",
]
tf = add_text(sl, 7.3, 2.75, 5, 4, "", size=14)
for ins in insights:
    add_para(tf, f"•  {ins}", size=14, color=MUTED, space_before=Pt(12))
slide_number(sl, 7)


# ═══════════════════════════════════════════════
# SLIDE 8 — DDA EXAMPLE
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0.8, 0.5, 6, 0.4, "PLATFORM ÖRNEĞİ — DDA", size=12, color=ACCENT, bold=True)
add_text(sl, 0.8, 1.0, 11, 0.7, "Data-Driven Attribution sonuçları", size=30, color=WHITE, bold=True)

# Left — paths
add_card(sl, 0.8, 2.0, 5.6, 4.8)
add_text(sl, 1.2, 2.15, 4, 0.4, "Top Conversion Paths", size=17, color=WHITE, bold=True)
add_text(sl, 1.2, 2.6, 5, 0.35, "Lead'lerin dönüşüm öncesi izlediği en sık kanal sıraları:", size=12, color=MUTED)
paths = [
    ("#1   Meta → Google → Meta", "45 lead", "%72"),
    ("#2   Google → LinkedIn → Google", "32 lead", "%65"),
    ("#3   TikTok → Meta → Google", "28 lead", "%58"),
    ("#4   YouTube → Meta", "22 lead", "%55"),
    ("#5   DV360 → Google → Meta → Google", "18 lead", "%48"),
]
for j, (path, leads, rate) in enumerate(paths):
    yy = 3.15 + j * 0.65
    add_text(sl, 1.2, yy, 3.3, 0.3, path, size=13, color=WHITE)
    add_text(sl, 4.5, yy, 0.8, 0.3, leads, size=13, color=GREEN, bold=True)
    add_text(sl, 5.4, yy, 0.7, 0.3, rate, size=13, color=DIM)

# Right — why blend
add_card(sl, 6.9, 2.0, 5.6, 4.8)
add_text(sl, 7.3, 2.15, 5, 0.4, "Neden iki model birleşiyor?", size=17, color=WHITE, bold=True)
blend_points = [
    "Markov Chain (×0.65): Kanalı yolculuktan çıkarınca dönüşüm ne kadar düşer? Sıraya duyarlı, kritik geçiş noktasını yakalar.",
    "Shapley Value (×0.35): Tüm olası koalisyonlardaki marjinal katkı ortalaması. Oyun teorisi bazlı, matematiksel olarak adil.",
    "Blend neden? Markov tek başına sıra bağımlı, Shapley tek başına sıra görmez. İkisinin birleşimi hem sıra etkisini hem adil dağılımı dengeler.",
]
tf = add_text(sl, 7.3, 2.75, 5, 3.2, "", size=14)
for bp in blend_points:
    add_para(tf, f"•  {bp}", size=13, color=MUTED, space_before=Pt(12))

add_card(sl, 7.1, 5.8, 5.2, 0.5)
add_text(sl, 7.1, 5.82, 5.2, 0.45, "DDA = Markov × 0.65 + Shapley × 0.35",
    size=14, color=ACCENT, bold=True, align=PP_ALIGN.CENTER, font="Consolas")
slide_number(sl, 8)


# ═══════════════════════════════════════════════
# SLIDE 9 — UNIFIED SCORING
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0.8, 0.5, 7, 0.4, "PLATFORM ÖRNEĞİ — UNIFIED", size=12, color=ACCENT, bold=True)
add_text(sl, 0.8, 1.0, 11, 0.7, "Unified Scoring & Cross-Validation", size=30, color=WHITE, bold=True)

# Left — comparison table
add_card(sl, 0.8, 2.0, 5.6, 3.8)
add_text(sl, 1.2, 2.15, 4, 0.4, "Neden tek model yetmiyor?", size=17, color=WHITE, bold=True)
for hx, htxt in [(1.2, "Model"), (3.0, "Güçlü Yanı"), (5.0, "Zayıf Yanı")]:
    add_text(sl, hx, 2.7, 1.8, 0.3, htxt, size=11, color=DIM, bold=True)
models = [
    ("MMM", "Online + offline", "Bireysel journey görmez"),
    ("DDA", "User-level attribution", "Sadece online"),
    ("INC", "Gerçek causal etki", "Her kanal test edilemez"),
]
for j, (m, strong, weak) in enumerate(models):
    yy = 3.1 + j * 0.6
    add_text(sl, 1.2, yy, 1.5, 0.3, m, size=13, color=WHITE, bold=True)
    add_text(sl, 3.0, yy, 1.8, 0.3, strong, size=12, color=GREEN)
    add_text(sl, 5.0, yy, 1.8, 0.3, weak, size=12, color=RED_WARN)
add_text(sl, 1.2, 5.0, 5, 0.5,
    "Her modelin kör noktasını diğeri kapatır.\nUnified skor üçünün güçlü yanlarını birleştirir.",
    size=13, color=MUTED)

# Right — cross-validation
add_card(sl, 6.9, 2.0, 5.6, 3.8)
add_accent_line(sl, 6.9, 2.0, 5.6)
add_text(sl, 7.3, 2.2, 5, 0.4, "Cross-Validation Uyarısı", size=17, color=WHITE, bold=True)
add_text(sl, 7.3, 2.75, 5, 0.7,
    "DDA ile MMM arasındaki sapma >%20 olduğunda sistem otomatik uyarı verir:",
    size=13, color=MUTED)

add_card(sl, 7.1, 3.6, 5.2, 1.2, fill_color=RGBColor(0x1F, 0x15, 0x10))
add_text(sl, 7.4, 3.7, 4.8, 1.0,
    "⚠ Meta: DDA skoru %28, MMM skoru %15 — %13 sapma tespit edildi.\n"
    "Olası neden: last-click inflation veya adstock parametresi kalibrasyonu gerekli.",
    size=12, color=ACCENT)

add_text(sl, 7.3, 5.0, 5, 0.6,
    "Bu mekanizma, modellerin birbirini doğrulamasını sağlar\nve hatalı bütçe kararı riskini azaltır.",
    size=13, color=MUTED)

# Formula
add_card(sl, 0.8, 6.3, 11.7, 0.65)
add_text(sl, 0.8, 6.32, 11.7, 0.6,
    "Unified  =  DDA × 0.50   +   MMM × 0.35   +   INC × 0.15",
    size=17, color=ACCENT, bold=True, align=PP_ALIGN.CENTER, font="Consolas")
slide_number(sl, 9)


# ═══════════════════════════════════════════════
# SLIDE 10 — COMPETITIVE COMPARISON
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0.8, 0.5, 8, 0.4, "REKABET ANALİZİ", size=12, color=ACCENT, bold=True)
add_text(sl, 0.8, 1.0, 11, 0.7, "Google Meridian / Meta Robyn vs Time's Hub", size=30, color=WHITE, bold=True)

# Left card — Meridian/Robyn problems
add_card(sl, 0.8, 2.0, 5.6, 3.0)
add_text(sl, 1.2, 2.15, 5, 0.4, "Meridian / Robyn Problemi", size=17, color=RED_WARN, bold=True)
meridian_problems = [
    "Sadece MMM katmanı — DDA ve Incrementality yok",
    "Platform yanlılığı: kendi kanalını iyi gösterir",
    "Offline (TV, radyo, DOOH) entegrasyonu sınırlı",
    "CRM journey verisi kullanmaz",
    "Cross-validation mekanizması yok",
]
tf = add_text(sl, 1.2, 2.7, 5, 2.2, "", size=13)
for prob in meridian_problems:
    add_para(tf, f"•  {prob}", size=13, color=MUTED, space_before=Pt(6))

# Right card — Time's Hub difference
add_card(sl, 6.9, 2.0, 5.6, 3.0)
add_accent_line(sl, 6.9, 2.0, 5.6)
add_text(sl, 7.3, 2.15, 5, 0.4, "Time's Hub Farkı", size=17, color=ACCENT, bold=True)
hub_diffs = [
    "3 model katmanı: MMM + DDA + Incrementality",
    "Platform bağımsız, tarafsız ölçüm",
    "Online + offline tüm kanallar tek çatıda",
    "CRM touchpoint verisiyle user-level attribution",
    "Cross-validation: DDA vs MMM sapma uyarısı",
]
tf = add_text(sl, 7.3, 2.7, 5, 2.2, "", size=13)
for diff in hub_diffs:
    add_para(tf, f"•  {diff}", size=13, color=WHITE, space_before=Pt(6))

# Bottom — comparison table
add_card(sl, 0.8, 5.2, 11.7, 2.0)
# Table header
for hx, htxt in [(1.2, "Özellik"), (4.5, "Meridian"), (7.0, "Robyn"), (9.5, "Time's Hub")]:
    add_text(sl, hx, 5.3, 2.5, 0.3, htxt, size=11, color=DIM, bold=True)

comp_rows = [
    ("MMM", "✓ Bayesian", "✓ Ridge", "✓ Adstock + Hill"),
    ("DDA (Markov + Shapley)", "✗", "✗", "✓"),
    ("Incrementality", "✗", "✗", "✓ (Faz 4)"),
    ("Cross-Validation", "✗", "✗", "✓ >%20 uyarı"),
    ("CRM Journey Analizi", "✗", "✗", "✓"),
    ("Tarafsızlık", "Google yanlı", "Meta yanlı", "✓ Bağımsız"),
]
for j, (feat, mer, rob, hub) in enumerate(comp_rows):
    yy = 5.65 + j * 0.23
    add_text(sl, 1.2, yy, 3, 0.23, feat, size=10, color=WHITE)
    add_text(sl, 4.5, yy, 2, 0.23, mer, size=10, color=MUTED if "✗" not in mer else RED_WARN)
    add_text(sl, 7.0, yy, 2, 0.23, rob, size=10, color=MUTED if "✗" not in rob else RED_WARN)
    add_text(sl, 9.5, yy, 2.5, 0.23, hub, size=10, color=GREEN if "✓" in hub else MUTED)

slide_number(sl, 10)


# ═══════════════════════════════════════════════
# SLIDE 11 — VALUE
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0.8, 0.5, 6, 0.4, "KATMA DEĞER", size=12, color=ACCENT, bold=True)
add_text(sl, 0.8, 1.0, 10, 0.7, "Time's Hub ne kazandırır?", size=32, color=WHITE, bold=True)

values = [
    ("₺", "Bütçe Optimizasyonu", ACCENT,
     "Düşük ROI kanallardan yüksek ROI kanallara veri odaklı kaydırma. Aynı bütçeyle daha fazla lead."),
    ("🔍", "Şeffaflık", BLUE,
     "Her kanalın gerçek katkısı veri ile kanıtlanır. Platform raporlarına bağımlılık azalır."),
    ("⚡", "Hız", GREEN,
     "Haftalık otomatik rapor. Manuel Excel analizi yerine gerçek zamanlı dashboard."),
]
for i, (icon, title, col, desc) in enumerate(values):
    x = 0.8 + i * 4.1
    add_card(sl, x, 2.0, 3.7, 2.6)
    add_accent_line(sl, x, 2.0, 3.7) if i == 0 else None
    add_text(sl, x + 0.2, 2.2, 3.3, 0.4, f"{icon}  {title}", size=17, color=col, bold=True)
    add_text(sl, x + 0.2, 2.75, 3.3, 1.5, desc, size=13, color=MUTED)

# Bottom — for agency / for client
add_card(sl, 0.8, 5.0, 5.6, 2.2)
add_text(sl, 1.2, 5.1, 4, 0.4, "Ajans için", size=17, color=WHITE, bold=True)
agency = [
    "Müşteriye veri destekli strateji sunma kapasitesi",
    "Platform bağımsız, tarafsız ölçüm",
    "Yeni müşteri pitch'lerinde rekabet avantajı",
    "Birden fazla müşteri/kampanyayı tek platformda yönetme",
]
tf = add_text(sl, 1.2, 5.55, 5, 1.5, "", size=12)
for a in agency:
    add_para(tf, f"•  {a}", size=12, color=MUTED, space_before=Pt(4))

add_card(sl, 6.9, 5.0, 5.6, 2.2)
add_text(sl, 7.3, 5.1, 4, 0.4, "Müşteri (Reklamveren) için", size=17, color=WHITE, bold=True)
client = [
    "Bütçe israfının veri ile tespiti",
    "Online ve offline birlikte ölçüm",
    "Incrementality test ile kanıtlanmış ROI",
    "Haftalık karar desteği ile çevik kampanya yönetimi",
]
tf = add_text(sl, 7.3, 5.55, 5, 1.5, "", size=12)
for c in client:
    add_para(tf, f"•  {c}", size=12, color=MUTED, space_before=Pt(4))
slide_number(sl, 11)


# ═══════════════════════════════════════════════
# SLIDE 12 — MULTI-CLIENT
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0.8, 0.5, 6, 0.4, "ÖLÇEKLENEBİLİRLİK", size=12, color=ACCENT, bold=True)
add_text(sl, 0.8, 1.0, 11, 0.7, "Tek platform, tüm müşteriler", size=32, color=WHITE, bold=True)
add_text(sl, 0.8, 1.8, 9, 0.5,
    "Time's Hub sadece tek bir kampanya için değil — tüm müşteri portföyünü yönetmek için tasarlandı.",
    size=15, color=MUTED)

add_card(sl, 0.8, 2.6, 7.0, 4.5)
add_text(sl, 1.2, 2.75, 4, 0.4, "Aktif Müşteriler", size=17, color=WHITE, bold=True)
clients = [
    ("Petrol Ofisi", "Premium Market, AutoMatic Filo"),
    ("EnerjiSA", "30.Yıl İletişimi"),
    ("Uludağ İçecek", "Limonata, Premium Su, Soda, Frutti, Portakallı"),
    ("UNICEF", "6 Şubat Deprem, Dünya Kız Çocukları Günü, Dünya Günü"),
    ("Hayhay", "POS Cihazı, Dijital Cüzdan, Tüketici Finansmanı"),
    ("TLC/Gree Klima", "Sevgililer Günü, Yaz'a Merhaba, Kış Kampanyası"),
]
for hx, htxt in [(1.2, "Müşteri"), (3.5, "Kampanyalar")]:
    add_text(sl, hx, 3.3, 2, 0.3, htxt, size=11, color=DIM, bold=True)
for j, (cl, camps) in enumerate(clients):
    yy = 3.7 + j * 0.55
    add_text(sl, 1.2, yy, 2, 0.3, cl, size=13, color=WHITE, bold=True)
    add_text(sl, 3.5, yy, 4.2, 0.3, camps, size=12, color=MUTED)

# Right card
add_card(sl, 8.3, 2.6, 4.2, 4.5)
add_accent_line(sl, 8.3, 2.6, 4.2)
add_text(sl, 8.6, 2.8, 3.6, 0.4, "Her workspace'te", size=17, color=WHITE, bold=True)
ws_features = [
    "Ayrı veri yükleme ve model çalıştırma",
    "Kampanyaya özel bütçe ve kanal seti",
    "İzole unified scoring ve rapor",
    "Müşteriler arası karşılaştırma imkanı",
]
tf = add_text(sl, 8.6, 3.35, 3.6, 2.5, "", size=13)
for wf in ws_features:
    add_para(tf, f"•  {wf}", size=13, color=MUTED, space_before=Pt(8))
add_text(sl, 8.6, 5.8, 3.6, 0.7,
    "6 müşteri × 16 kampanya halihazırda tanımlı. Yeni müşteri eklemek tek tıklama.",
    size=11, color=DIM)
slide_number(sl, 12)


# ═══════════════════════════════════════════════
# SLIDE 13 — ROADMAP
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0.8, 0.5, 4, 0.4, "YOL HARİTASI", size=12, color=ACCENT, bold=True)
add_text(sl, 0.8, 1.0, 10, 0.7, "Geliştirme fazları", size=32, color=WHITE, bold=True)

phases = [
    ("FAZ 1", "Veri Altyapısı + MMM", GREEN, "✓ Tamamlandı",
     "Haftalık CSV yükleme, adstock/saturation/response model, kanal decomposition."),
    ("FAZ 2", "DDA Markov + Shapley", GREEN, "✓ Tamamlandı",
     "CRM touchpoint analizi, Markov chain, Shapley value, DDA blend."),
    ("FAZ 3", "Unified Scoring Dashboard", GREEN, "✓ Tamamlandı",
     "Unified rapor, cross-validation, bütçe reallocation, multi-client workspace, güvenlik."),
    ("FAZ 4", "Incrementality Testing Framework", ACCENT, "Sırada",
     "Geo-lift, holdout, PSA test motoru, otomatik kalibrasyon."),
    ("FAZ 5", "Gerçek Veri Entegrasyonu & API", DIM, "Planlanıyor",
     "Meta/Google/DV360 API bağlantısı, otomatik veri çekme, canlı rapor."),
]
for j, (phase, title, col, status, desc) in enumerate(phases):
    yy = 1.9 + j * 1.05
    add_card(sl, 1.5, yy, 10.3, 0.85)
    stripe = sl.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1.5), Inches(yy), Pt(4), Inches(0.85))
    stripe.fill.solid()
    stripe.fill.fore_color.rgb = col
    stripe.line.fill.background()
    add_tag(sl, 1.8, yy + 0.27, phase, col)
    add_text(sl, 3.2, yy + 0.1, 4, 0.35, title, size=16, color=WHITE, bold=True)
    add_text(sl, 3.2, yy + 0.47, 5.5, 0.3, desc, size=11, color=MUTED)
    add_text(sl, 9.3, yy + 0.27, 2.2, 0.3, status, size=13, color=col, bold=True)
slide_number(sl, 13)


# ═══════════════════════════════════════════════
# SLIDE 14 — CLOSING
# ═══════════════════════════════════════════════
sl = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(sl)
add_text(sl, 0, 2.0, 13.333, 1.0, "Time's Hub", size=52, color=WHITE, bold=True, align=PP_ALIGN.CENTER)
add_text(sl, 0, 3.0, 13.333, 0.6, "Attribution Intelligence", size=28, color=ACCENT, align=PP_ALIGN.CENTER)
add_text(sl, 2, 4.0, 9.333, 1.0,
    "Medya bütçenizin her kuruşunun nereye gittiğini bilin.\nSezgi yerine veri, tahmin yerine model.",
    size=18, color=MUTED, align=PP_ALIGN.CENTER)

# Big numbers
for i, (num, label) in enumerate([("3", "Model Katmanı"), ("10", "Kanal Desteği"), ("1", "Unified Skor")]):
    x = 4.0 + i * 2.0
    cols = [ACCENT, BLUE, GREEN]
    add_text(sl, x, 5.2, 1.5, 0.6, num, size=36, color=cols[i], bold=True, align=PP_ALIGN.CENTER)
    add_text(sl, x, 5.75, 1.5, 0.4, label, size=12, color=MUTED, align=PP_ALIGN.CENTER)

add_text(sl, 0, 6.6, 13.333, 0.4, "TIME × GROWITY", size=12, color=DIM, align=PP_ALIGN.CENTER)
slide_number(sl, 14)


# ── Save ──
out = "/home/user/attribution-intelligence-hub/docs/Times_Hub_Sunum.pptx"
prs.save(out)
print(f"✓ Saved: {out}")
