"""CI-only independent PDF integrity and incremental-change checks, without network access."""

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.diff_analysis import ModificationLevel
from pyhanko.sign.validation import async_validate_pdf_signature
from pyhanko.sign.validation.status import SignatureCoverageLevel
from pyhanko_certvalidator import ValidationContext


async def check(directory):
    files = sorted(Path(directory).glob("*.pdf"))
    if not files:
        raise RuntimeError("No signed samples")
    for name in (
        "mixed-existing.pdf",
        "mixed-shared.pdf",
        "shared-approval-visible.pdf",
        "shared-approval-invisible.pdf",
        "shared-unsigned-visible.pdf",
        "annots-absent-direct-form.pdf",
        "annots-direct-direct-form.pdf",
        "annots-indirect-direct-form.pdf",
        "annots-direct-fields-direct-form.pdf",
    ):
        if not (Path(directory) / name).is_file():
            raise RuntimeError(f"Missing required sample: {name}")
    total = 0
    for path in files:
        with path.open("rb") as stream:
            reader = PdfFileReader(stream, strict=True)
            signatures = reader.embedded_signatures
            if not signatures:
                raise RuntimeError(f"{path.name}: no signatures")
            if (
                path.name.startswith(("mixed-", "shared-approval-", "annots-", "twice-"))
                and len(signatures) < 2
            ):
                raise RuntimeError(f"{path.name}: missing earlier signature")
            for index, signature in enumerate(signatures):
                context = ValidationContext(
                    trust_roots=[],
                    allow_fetching=False,
                    revocation_mode="soft-fail",
                    moment=datetime(2026, 11, 14, tzinfo=timezone.utc),
                )
                status = await async_validate_pdf_signature(
                    signature, signer_validation_context=context, skip_diff=False
                )
                # Trust and revocation status are deliberately not pass criteria.
                if not status.intact or not status.valid:
                    raise RuntimeError(f"{path.name}: broken signature {index + 1}")
                last = index == len(signatures) - 1
                coverage = (
                    SignatureCoverageLevel.ENTIRE_FILE
                    if last
                    else SignatureCoverageLevel.ENTIRE_REVISION
                )
                if status.coverage != coverage:
                    raise RuntimeError(f"{path.name}: incomplete signature coverage")
                if not last and status.modification_level not in (
                    ModificationLevel.NONE,
                    ModificationLevel.LTA_UPDATES,
                    ModificationLevel.FORM_FILLING,
                ):
                    raise RuntimeError(
                        f"{path.name}: unexpected changes: {status.modification_level}"
                    )
                if status.docmdp_ok is False:
                    raise RuntimeError(f"{path.name}: document policy violated")
                print(
                    f"{path.name} #{index + 1}: INTACT, VALID, "
                    f"{status.coverage.name}, {status.modification_level}"
                )
                total += 1
    print(f"pyHanko verified {len(files)} PDFs and {total} signatures")


asyncio.run(check(sys.argv[1]))
