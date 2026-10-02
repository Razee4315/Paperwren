"""Generate the styled-workbook and chart-deck regression fixtures.

Requires openpyxl (with Pillow, for the embedded picture), python-pptx,
reportlab (for the locked PDF) and msoffcrypto-tool (for the locked Office
files).
Usage: python3 scripts/make-rich-fixtures.py
Writes fixtures/viewer-regressions/{styled.xlsx,charts.pptx,rtl.pptx,grid.xlsx,
effects.pptx,locked.pdf,locked-agile.xlsx,locked-standard.docx}.
"""
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.styles.colors import Color
from pptx import Presentation
from pptx.chart.data import CategoryChartData, XyChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.util import Inches

OUT = os.path.join(os.path.dirname(__file__), "..", "fixtures", "viewer-regressions")


def make_styled_xlsx(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Budget & Plan"
    ws.append(["Item", "Owner", "Planned", "Actual", "Status"])
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1F4E78")
        cell.alignment = Alignment(horizontal="center")
    rows = [
        ("Design", "Aisha", 1200, 1150, "Done"),
        ("Build", "Ravi", 4800, 5300, "Over"),
        ("Launch", "Mei", 900, None, "Planned"),
    ]
    for row in rows:
        ws.append(row)
    ws["E2"].font = Font(color="2E7D32", bold=True)
    ws["E3"].font = Font(color="C62828", italic=True)
    ws["E3"].fill = PatternFill("solid", fgColor="FDE9E7")
    ws["A4"].font = Font(underline="single", strike=True)
    ws["B4"].alignment = Alignment(horizontal="right", wrap_text=True)
    # A filled band of cells that hold no value.
    for col in "ABCDE":
        ws[f"{col}6"].fill = PatternFill("solid", fgColor="FFF2CC")
    # Theme colour with a tint, as Excel's own palette writes them.
    ws["A7"] = "Themed"
    ws["A7"].fill = PatternFill("solid", fgColor=Color(theme=4, tint=0.6))
    plain = wb.create_sheet("Plain")
    plain.append(["No", "styles", "here"])
    wb.save(path)


def make_grid_xlsx(path):
    """What the grid must lay out: frozen panes, borders, text that
    runs over empty neighbours, a picture and a chart, two sheets."""
    from openpyxl.chart import BarChart, Reference
    from openpyxl.drawing.image import Image as SheetImage
    from openpyxl.styles import Border, Side
    from PIL import Image as Picture

    wb = Workbook()
    ws = wb.active
    ws.title = "Sales"
    ws.append(["Region", "Rep", "Q1", "Q2", "Q3", "Q4", "Notes"])
    people = ["Aisha", "Ravi", "Mei", "Omar", "Lena"]
    for i in range(60):
        ws.append(
            [
                f"Region {i + 1}",
                people[i % 5],
                100 + i,
                120 + i * 2,
                90 + i,
                150 + i * 3,
                None,
            ]
        )
    ws.freeze_panes = "C2"  # one header row, two columns
    ws["A64"] = "This remark is far longer than its column and runs on"
    ws["A65"] = "Blocked by a neighbour, so it is cut off"
    ws["B65"] = "stop"
    edge = Side(style="medium", color="FF0000")
    ws["C2"].border = Border(left=edge, right=edge, top=edge, bottom=edge)
    ws.column_dimensions["G"].width = 18

    chart = BarChart()
    chart.title = "First regions"
    chart.add_data(Reference(ws, min_col=3, max_col=4, min_row=1, max_row=6), titles_from_data=True)
    chart.set_categories(Reference(ws, min_col=1, min_row=2, max_row=6))
    ws.add_chart(chart, "I3")

    picture_path = os.path.join(OUT, "_grid-picture.png")
    Picture.new("RGB", (120, 80), (43, 110, 102)).save(picture_path)
    ws.add_image(SheetImage(picture_path), "I22")

    other = wb.create_sheet("Targets")
    other.append(["Region", "Target"])
    other.append(["Region 7", 900])
    other.append(["Elsewhere", 100])
    wb.save(path)
    os.remove(picture_path)


def make_charts_pptx(path):
    prs = Presentation()
    blank = prs.slide_layouts[5]
    box = (Inches(1), Inches(1.5), Inches(8), Inches(5))

    def slide(title):
        s = prs.slides.add_slide(blank)
        s.shapes.title.text = title
        return s

    data = CategoryChartData()
    data.categories = ["Q1", "Q2", "Q3", "Q4"]
    data.add_series("Revenue", (120, 150, 170, 210))
    data.add_series("Costs", (90, 100, 130, 140))

    chart = slide("Columns").shapes.add_chart(
        XL_CHART_TYPE.COLUMN_CLUSTERED, *box, data
    ).chart
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    chart.has_title = True
    chart.chart_title.text_frame.text = "Quarterly results"

    slide("Stacked bars").shapes.add_chart(XL_CHART_TYPE.BAR_STACKED, *box, data)
    slide("Lines").shapes.add_chart(XL_CHART_TYPE.LINE_MARKERS, *box, data)

    pie = CategoryChartData()
    pie.categories = ["Mobile", "Desktop", "Tablet"]
    pie.add_series("Share", (0.62, 0.3, 0.08))
    slide("Pie").shapes.add_chart(XL_CHART_TYPE.PIE, *box, pie)

    xy = XyChartData()
    series = xy.add_series("Trials")
    for x, y in ((1, 2.1), (2, 3.9), (3, 6.2), (4, 7.8)):
        series.add_data_point(x, y)
    slide("Scatter").shapes.add_chart(XL_CHART_TYPE.XY_SCATTER, *box, xy)

    # A type the viewer does not draw: must fall back to the labelled box.
    slide("Radar").shapes.add_chart(XL_CHART_TYPE.RADAR, *box, data)
    prs.save(path)


def make_rtl_pptx(path):
    """Urdu and Arabic text: one paragraph flagged right-to-left, one
    left for the viewer to detect from the text itself."""
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "اردو پیشکش"  # no direction flag: detected
    body = s.placeholders[1].text_frame
    body.text = "پہلا نکتہ"
    body.paragraphs[0]._p.get_or_add_pPr().set("rtl", "1")
    p = body.add_paragraph()
    p.text = "English stays left to right"
    p = body.add_paragraph()
    p.text = "مرحبا بالعالم"
    prs.save(path)


A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
DGM_NS = "http://schemas.openxmlformats.org/drawingml/2006/diagram"
DSP_NS = "http://schemas.microsoft.com/office/drawing/2008/diagram"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"

GRADIENT = (
    '<a:gradFill xmlns:a="%s" rotWithShape="1"><a:gsLst>'
    '<a:gs pos="0"><a:srgbClr val="2B6E66"/></a:gs>'
    '<a:gs pos="100000"><a:srgbClr val="F2C14E"/></a:gs>'
    '</a:gsLst><a:lin ang="%d" scaled="0"/></a:gradFill>'
)
RADIAL = (
    '<a:gradFill xmlns:a="%s" rotWithShape="1"><a:gsLst>'
    '<a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs>'
    '<a:gs pos="100000"><a:srgbClr val="C62828"/></a:gs>'
    '</a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>'
) % A_NS
SHADOW = (
    '<a:effectLst xmlns:a="%s"><a:outerShdw blurRad="76200" dist="57150" dir="2700000" algn="tl" rotWithShape="0">'
    '<a:srgbClr val="000000"><a:alpha val="45000"/></a:srgbClr></a:outerShdw></a:effectLst>'
) % A_NS


def _diagram_shape(i, x, y, w, h, text):
    """One shape of a saved SmartArt layout, as PowerPoint writes it."""
    return (
        '<dsp:sp modelId="{00000000-0000-0000-0000-00000000000%d}">'
        '<dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr>'
        "<dsp:spPr>"
        '<a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
        '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst></a:prstGeom>'
        '<a:solidFill><a:srgbClr val="2B6E66"/></a:solidFill>'
        '<a:ln w="25400"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>'
        "</dsp:spPr>"
        '<dsp:style><a:lnRef idx="2"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef>'
        '<a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef>'
        '<a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef>'
        '<a:fontRef idx="minor"><a:srgbClr val="FFFFFF"/></a:fontRef></dsp:style>'
        '<dsp:txBody><a:bodyPr lIns="38100" tIns="38100" rIns="38100" bIns="38100" anchor="ctr"/><a:lstStyle/>'
        '<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="2000"/><a:t>%s</a:t></a:r></a:p></dsp:txBody>'
        '<dsp:txXfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></dsp:txXfrm>'
        "</dsp:sp>"
    ) % (i, x, y, w, h, text, x, y, w, h)


def make_effects_pptx(path):
    """Shadows, gradients on shapes that are not rectangles, and a
    SmartArt diagram stored the way PowerPoint stores one: a data
    model that names the drawing part holding its laid-out shapes."""
    from lxml import etree
    from PIL import Image as Picture
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.opc.package import Part
    from pptx.opc.packuri import PackURI

    prs = Presentation()
    blank = prs.slide_layouts[6]

    def restyle(shape, *fragments):
        """Replace a shape's fill and effects with raw DrawingML."""
        sp_pr = shape._element.spPr
        for tag in ("solidFill", "gradFill", "noFill", "effectLst"):
            for old in sp_pr.findall("{%s}%s" % (A_NS, tag)):
                sp_pr.remove(old)
        geom = sp_pr.find("{%s}prstGeom" % A_NS)
        if geom is None:
            geom = sp_pr.find("{%s}custGeom" % A_NS)
        at = list(sp_pr).index(geom) + 1
        ln = sp_pr.find("{%s}ln" % A_NS)
        for fragment in fragments:
            node = etree.fromstring(fragment)
            if node.tag.endswith("effectLst") and ln is not None:
                sp_pr.insert(list(sp_pr).index(ln) + 1, node)
            else:
                sp_pr.insert(at, node)
                at += 1

    s1 = prs.slides.add_slide(blank)
    card = s1.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.6), Inches(0.6), Inches(2.6), Inches(1.6)
    )
    card.text_frame.text = "Shadowed card"
    card.fill.solid()
    restyle(card, '<a:solidFill xmlns:a="%s"><a:srgbClr val="FFFFFF"/></a:solidFill>' % A_NS, SHADOW)
    card.line.fill.background()
    card.text_frame.paragraphs[0].runs[0].font.color.rgb = __import__(
        "pptx.dml.color", fromlist=["RGBColor"]
    ).RGBColor(0x1B, 0x1B, 0x1F)

    triangle = s1.shapes.add_shape(
        MSO_SHAPE.ISOSCELES_TRIANGLE, Inches(3.8), Inches(0.6), Inches(2.2), Inches(1.8)
    )
    restyle(triangle, GRADIENT % (A_NS, 5400000))
    triangle.line.fill.background()

    ball = s1.shapes.add_shape(
        MSO_SHAPE.OVAL, Inches(6.6), Inches(0.6), Inches(1.8), Inches(1.8)
    )
    restyle(ball, RADIAL)
    ball.line.fill.background()

    builder = s1.shapes.build_freeform(Inches(0.8), Inches(3.2))
    builder.add_line_segments(
        [
            (Inches(3.0), Inches(3.0)),
            (Inches(3.4), Inches(4.6)),
            (Inches(1.6), Inches(5.2)),
            (Inches(0.6), Inches(4.4)),
        ]
    )
    blob = builder.convert_to_shape()
    restyle(blob, GRADIENT % (A_NS, 0), SHADOW)
    blob.line.fill.background()

    picture_path = os.path.join(OUT, "_effects-picture.png")
    Picture.new("RGB", (160, 110), (43, 110, 102)).save(picture_path)
    photo = s1.shapes.add_picture(picture_path, Inches(4.2), Inches(3.2), Inches(2.4))
    photo._element.spPr.append(etree.fromstring(SHADOW))
    os.remove(picture_path)

    # --- SmartArt ---
    s2 = prs.slides.add_slide(blank)
    package = s2.part.package
    steps = ["Plan", "Build", "Ship"]
    w, h, gap = 1524000, 914400, 381000
    shapes = "".join(
        _diagram_shape(i + 1, i * (w + gap), 762000, w, h, text)
        for i, text in enumerate(steps)
    )
    drawing_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<dsp:drawing xmlns:dgm="%s" xmlns:dsp="%s" xmlns:a="%s"><dsp:spTree>'
        '<dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>'
        "%s</dsp:spTree></dsp:drawing>"
    ) % (DGM_NS, DSP_NS, A_NS, shapes)
    drawing = Part(
        PackURI("/ppt/diagrams/drawing1.xml"),
        "application/vnd.ms-office.drawingml.diagramDrawing+xml",
        package,
        drawing_xml.encode("utf-8"),
    )
    drawing_id = s2.part.relate_to(
        drawing, "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing"
    )
    points = "".join(
        '<dgm:pt modelId="{00000000-0000-0000-0000-00000000000%d}"><dgm:prSet/><dgm:spPr/>'
        '<dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>%s</a:t></a:r></a:p></dgm:t></dgm:pt>'
        % (i + 1, text)
        for i, text in enumerate(steps)
    )
    data_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<dgm:dataModel xmlns:dgm="%s" xmlns:a="%s"><dgm:ptLst>%s</dgm:ptLst><dgm:cxnLst/><dgm:bg/><dgm:whole/>'
        '<dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram">'
        '<dsp:dataModelExt xmlns:dsp="%s" relId="%s" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/>'
        "</a:ext></dgm:extLst></dgm:dataModel>"
    ) % (DGM_NS, A_NS, points, DSP_NS, drawing_id)
    data = Part(
        PackURI("/ppt/diagrams/data1.xml"),
        "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml",
        package,
        data_xml.encode("utf-8"),
    )
    data_id = s2.part.relate_to(data, R_NS + "/diagramData")
    frame = etree.fromstring(
        (
            '<p:graphicFrame xmlns:p="%s" xmlns:a="%s" xmlns:r="%s">'
            '<p:nvGraphicFramePr><p:cNvPr id="9" name="Diagram 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
            '<p:xfrm><a:off x="1905000" y="1905000"/><a:ext cx="5334000" cy="2438400"/></p:xfrm>'
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">'
            '<dgm:relIds xmlns:dgm="%s" r:dm="%s"/>'
            "</a:graphicData></a:graphic></p:graphicFrame>"
        )
        % (P_NS, A_NS, R_NS, DGM_NS, data_id)
    )
    s2.shapes._spTree.append(frame)

    # A third slide, so the full-screen mode has somewhere to go.
    s3 = prs.slides.add_slide(prs.slide_layouts[5])
    s3.shapes.title.text = "The end"
    prs.save(path)


def make_locked_pdf(path):
    """A two-page PDF that needs the password "wren" to open."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    page = canvas.Canvas(path, pagesize=A4, encrypt="wren", invariant=1)
    for n in (1, 2):
        page.setFont("Helvetica-Bold", 28)
        page.drawString(72, 740, "Locked fixture, page %d" % n)
        page.showPage()
    page.save()


def make_cjk_pdf(path):
    """A Chinese page whose font is named, not embedded: the reader must
    bring its own character maps to make sense of the text."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfgen import canvas

    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    page = canvas.Canvas(path, pagesize=A4, invariant=1)
    page.setFont("STSong-Light", 28)
    page.drawString(72, 740, "季度报告")
    page.setFont("STSong-Light", 16)
    page.drawString(72, 700, "打开任何文档")
    page.showPage()
    page.save()


FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures")
PASSWORD = "wren"


def make_picture(path):
    """A 320 x 200 picture with a mark in one corner, for the picture
    viewer (a scanned page or a photo of a document is a document)."""
    from PIL import Image as Picture
    from PIL import ImageDraw

    picture = Picture.new("RGB", (320, 200), (243, 241, 236))
    draw = ImageDraw.Draw(picture)
    draw.rectangle((16, 16, 96, 72), fill=(43, 110, 102))
    draw.line((16, 120, 304, 120), fill=(27, 27, 31), width=3)
    draw.line((16, 150, 240, 150), fill=(27, 27, 31), width=3)
    picture.save(path)


def make_locked_agile(path):
    """sample.xlsx as Office 2010+ protects it ("agile" encryption:
    AES-256-CBC, SHA-512, 100,000 rounds). Salts are random, so the
    bytes differ on every run."""
    import msoffcrypto

    with open(os.path.join(FIXTURES, "sample.xlsx"), "rb") as plain:
        with open(path, "wb") as out:
            msoffcrypto.OfficeFile(plain).encrypt(PASSWORD, out)


def make_locked_standard(path):
    """sample.docx as Office 2007 protected it ("standard" encryption:
    AES-128-ECB, SHA-1, 50,000 rounds). msoffcrypto only writes the
    agile kind, so this one is assembled here from [MS-OFFCRYPTO] 2.3.4,
    then read back with msoffcrypto to prove it is a real one."""
    import io
    from hashlib import sha1
    from struct import pack

    import msoffcrypto
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from msoffcrypto.method.container.ecma376_encrypted import ECMA376Encrypted
    from msoffcrypto.method.ecma376_standard import ECMA376Standard

    with open(os.path.join(FIXTURES, "sample.docx"), "rb") as f:
        plain = f.read()
    salt = bytes(range(16, 32))
    key = ECMA376Standard.makekey_from_password(
        PASSWORD, 0x660E, 0x8004, 0x18, 128, 16, salt
    )

    def ecb(data):
        data += b"\0" * (-len(data) % 16)
        enc = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
        return enc.update(data) + enc.finalize()

    verifier = bytes(range(64, 80))
    csp = "Microsoft Enhanced RSA and AES Cryptographic Provider\0".encode("utf-16-le")
    header = pack("<8I", 0x24, 0, 0x660E, 0x8004, 128, 0x18, 0, 0) + csp
    info = (
        pack("<HHI", 3, 2, 0x24)
        + pack("<I", len(header))
        + header
        + pack("<I", 16)
        + salt
        + ecb(verifier)
        + pack("<I", 20)
        + ecb(sha1(verifier).digest())
    )
    # The stream may run past the size it declares, and msoffcrypto's
    # container writer only places streams larger than 4096 bytes
    # correctly: pad this small file's cipher text beyond that.
    package = pack("<Q", len(plain)) + ecb(plain + b"\0" * max(0, 4112 - len(plain)))
    with open(path, "wb") as out:
        ECMA376Encrypted(package, info).write_to(out)

    with open(path, "rb") as f:
        check = msoffcrypto.OfficeFile(f)
        check.load_key(password=PASSWORD)
        opened = io.BytesIO()
        check.decrypt(opened)
        assert opened.getvalue() == plain, "standard fixture does not round-trip"


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    make_styled_xlsx(os.path.join(OUT, "styled.xlsx"))
    make_charts_pptx(os.path.join(OUT, "charts.pptx"))
    make_rtl_pptx(os.path.join(OUT, "rtl.pptx"))
    make_grid_xlsx(os.path.join(OUT, "grid.xlsx"))
    make_effects_pptx(os.path.join(OUT, "effects.pptx"))
    make_locked_pdf(os.path.join(OUT, "locked.pdf"))
    make_cjk_pdf(os.path.join(OUT, "cjk.pdf"))
    make_picture(os.path.join(FIXTURES, "sample.png"))
    make_locked_agile(os.path.join(OUT, "locked-agile.xlsx"))
    make_locked_standard(os.path.join(OUT, "locked-standard.docx"))
    print(
        "wrote styled.xlsx, charts.pptx, rtl.pptx, grid.xlsx, effects.pptx, "
        "locked.pdf, cjk.pdf, locked-agile.xlsx, locked-standard.docx"
    )
