import hashlib
import json
from pathlib import Path

from compare_parent_hours_font import open_srgb, sheet


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs/verification/parent-profile-font-2026-10-11"
BEFORE = BASE / "before-375-v3"
AFTER = BASE / "after-375-v2"
REFERENCE = ROOT / "tmp/pdfs/ui-source-audit-20261010-01a1258e/new/page-06.png"
PDF = ROOT / "\u7d20\u6750/UI\u66f4\u65b0\u5bb6\u957f+\u5408\u4f5c\u65b9(1).pdf"


def main():
    inputs = [REFERENCE, PDF, BEFORE / "runtime.json", AFTER / "runtime.json"]
    for directory in (BEFORE, AFTER):
        if json.loads((directory / "runtime.json").read_text(encoding="utf-8"))["failure"]:
            raise ValueError("Incomplete capture")
    crop = [92, 170, 552, 1166]
    standard = []
    for directory in (BEFORE, AFTER):
        filename = directory / "standard-top.png"
        inputs.append(filename)
        standard.append(open_srgb(filename))
    sheet(AFTER / "source-before-after.png", [[
        ("New PDF P5 (reference)", open_srgb(REFERENCE).crop(crop)),
        ("Before: old size / bold", standard[0]),
        ("After: source size / regular", standard[1]),
    ]])
    for output, names in (
        ("long-name-contact.png", ["long-top", "extreme-top"]),
        ("state-contact.png", ["standard-bottom", "empty-top", "error-top"]),
        ("long-bottom-contact.png", ["long-bottom", "extreme-bottom"]),
    ):
        rows = []
        for name in names:
            row = []
            for label, directory in (("Before", BEFORE), ("After", AFTER)):
                filename = directory / f"{name}.png"
                inputs.append(filename)
                row.append((f"{label}: {name}", open_srgb(filename)))
            rows.append(row)
        sheet(AFTER / output, rows)
    metadata = {
        "scope": "sRGB contacts; source crop is not a native viewport or full-page acceptance",
        "referencePhysicalPage": 6,
        "referenceCropPixels": crop,
        "inputs": [{"path": filename.relative_to(ROOT).as_posix(),
                    "sha256": hashlib.sha256(filename.read_bytes()).hexdigest()}
                   for filename in inputs],
    }
    with (AFTER / "comparison.json").open("x", encoding="utf-8") as output:
        json.dump(metadata, output, ensure_ascii=True, indent=2)
        output.write("\n")
    print(AFTER / "source-before-after.png")


if __name__ == "__main__":
    main()
