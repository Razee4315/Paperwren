"""Explain the mixed-shared regression and controlled, unsigned diff probes.

Usage: python scripts/diagnose-digital-id-diff.py old-mixed-shared.pdf
The probes deliberately invalidate the newest signature; only the original
signed revision is compared with the resulting object graph. No files are saved.
"""
import io
import sys

from pyhanko.pdf_utils import generic
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.diff_analysis import DEFAULT_DIFF_POLICY


def report(label, data, certification=True):
    reader = PdfFileReader(io.BytesIO(data))
    sig = reader.embedded_signatures[0]
    old = reader.get_historical_resolver(sig.signed_revision)
    new = reader.get_historical_resolver(reader.total_revisions - 1)
    try:
        result = DEFAULT_DIFF_POLICY.apply(
            old, new, doc_mdp=sig.docmdp_level if certification else None
        )
        print(f"{label}: {result}")
    except Exception as error:
        print(f"{label}: {type(error).__name__}: {error}")


def probe(data, mode):
    if mode == 'page-only':
        reader = PdfFileReader(io.BytesIO(data))
        sig = reader.embedded_signatures[0]
        end = sig.byte_range[2] + sig.byte_range[3]
        writer = IncrementalPdfFileWriter(io.BytesIO(data[:end]))
        page_ref = writer.root['/Pages']['/Kids'].raw_get(1)
        page = page_ref.get_object()
        page['/Annots'] = writer.add_object(generic.ArrayObject(list(page['/Annots'])))
        writer.mark_update(page_ref)
        output = io.BytesIO()
        writer.write(output)
        return output.getvalue()
    writer = IncrementalPdfFileWriter(io.BytesIO(data))
    reader = writer.prev
    old = reader.get_historical_resolver(reader.embedded_signatures[0].signed_revision)
    page_ref = writer.root['/Pages']['/Kids'].raw_get(1)
    page = page_ref.get_object()
    original_page = old.root['/Pages']['/Kids'][1].get_object()
    shared_ref = original_page.raw_get('/Annots')
    widget_ref = writer.root['/AcroForm']['/Fields'].raw_get(-1)
    if mode == 'append-shared':
        page['/Annots'] = generic.IndirectObject(shared_ref.idnum, shared_ref.generation, writer)
        page['/Annots'].append(widget_ref)
        writer.mark_update(page.raw_get('/Annots'))
    elif mode == 'invisible-unattached':
        page['/Annots'] = generic.IndirectObject(shared_ref.idnum, shared_ref.generation, writer)
        widget = widget_ref.get_object()
        widget['/Rect'] = generic.ArrayObject([generic.NumberObject(0)] * 4)
        writer.mark_update(widget_ref)
    writer.mark_update(page_ref)
    # Fold the probe into the existing final revision, so apply() checks every
    # changed xref against the original (rather than only a third revision).
    sig = reader.embedded_signatures[0]
    end = sig.byte_range[2] + sig.byte_range[3]
    compact = IncrementalPdfFileWriter(io.BytesIO(data[:end]))
    latest = reader.get_historical_resolver(reader.total_revisions - 1)
    for ref in latest.explicit_refs_in_revision():
        compact.objects[(ref.generation, ref.idnum)] = writer.get_object(ref)
    compact.objects.update(writer.objects)
    compact._lastobj_id = writer._lastobj_id
    output = io.BytesIO()
    compact.write(output)
    return output.getvalue()


data = open(sys.argv[1], 'rb').read()
print('Default SigFieldCreationRule: allow_new_visible_after_certify=False')
report('a current copied array', data)
report('a with approval policy', data, certification=False)
for mode in ('append-shared', 'page-only', 'invisible-unattached'):
    variant = probe(data, mode)
    report(mode, variant)
    report(mode + ' with approval policy', variant, certification=False)
