"""Generate real Office/ODF/RTF fixtures for the viewer tests.

Requires python-pptx, python-docx and LibreOffice (soffice) on PATH.
Usage: python3 scripts/make-office-fixtures.py
Writes fixtures/sample.{pptx,ppt,odp,doc,odt,rtf,xls,ods}.
"""
import os
import shutil
import subprocess
import tempfile

from docx import Document
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt

OUT = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def make_pptx(path):
    prs = Presentation()
    s1 = prs.slides.add_slide(prs.slide_layouts[0])
    s1.shapes.title.text = "Quarterly Review"
    s1.placeholders[1].text = "Paperwren fixture deck"
    s2 = prs.slides.add_slide(prs.slide_layouts[1])
    s2.shapes.title.text = "Highlights"
    body = s2.placeholders[1].text_frame
    body.text = "Revenue up 12%"
    p = body.add_paragraph()
    p.text = "Churn down"
    p.level = 1
    box = s2.shapes.add_shape(1, Inches(6), Inches(5), Inches(3), Inches(1))
    box.fill.solid()
    box.fill.fore_color.rgb = RGBColor(0x1F, 0x8A, 0x4C)
    box.text_frame.text = "Green box"
    run = box.text_frame.paragraphs[0].runs[0]
    run.font.size = Pt(20)
    run.font.bold = True
    s3 = prs.slides.add_slide(prs.slide_layouts[5])
    s3.shapes.title.text = "Table"
    table = s3.shapes.add_table(2, 2, Inches(1), Inches(2), Inches(6), Inches(1.5)).table
    for r in range(2):
        for c in range(2):
            table.cell(r, c).text = f"R{r + 1}C{c + 1}"
    s3.notes_slide.notes_text_frame.text = "Speaker note text"
    prs.save(path)


def make_docx(path):
    doc = Document()
    doc.add_heading("Paperwren Legacy Fixture", 1)
    doc.add_paragraph("The quick brown fox jumps over the lazy dog.")
    doc.add_paragraph("Second paragraph with ünïcödé.")
    doc.save(path)


def convert(src, fmt, dest):
    tmp = tempfile.mkdtemp()
    subprocess.run(
        ["soffice", "--headless", "--convert-to", fmt, "--outdir", tmp, src],
        check=True,
        capture_output=True,
    )
    produced = [f for f in os.listdir(tmp)][0]
    shutil.move(os.path.join(tmp, produced), dest)


def main():
    work = tempfile.mkdtemp()
    pptx = os.path.join(OUT, "sample.pptx")
    make_pptx(pptx)
    docx = os.path.join(work, "legacy.docx")
    make_docx(docx)
    convert(pptx, "ppt", os.path.join(OUT, "sample.ppt"))
    convert(pptx, "odp", os.path.join(OUT, "sample.odp"))
    convert(docx, "doc", os.path.join(OUT, "sample.doc"))
    convert(docx, "odt", os.path.join(OUT, "sample.odt"))
    convert(docx, "rtf", os.path.join(OUT, "sample.rtf"))
    xlsx = os.path.join(OUT, "sample.xlsx")
    convert(xlsx, "xls", os.path.join(OUT, "sample.xls"))
    convert(xlsx, "ods", os.path.join(OUT, "sample.ods"))


if __name__ == "__main__":
    main()
