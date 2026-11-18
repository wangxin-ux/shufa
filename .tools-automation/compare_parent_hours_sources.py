"""Create P3 sRGB source/native contacts from fingerprint-bound evidence."""

import hashlib
import json
from pathlib import Path

from compare_parent_hours_font import open_srgb, sheet


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs/verification/parent-hours-source-2026-10-12"
RUNTIME = BASE / "runtime-390-v4"
REFERENCE = ROOT / "tmp/pdfs/ui-source-audit-20261010-01a1258e/new/page-04.png"
PDF = ROOT / "\u7d20\u6750/UI\u66f4\u65b0\u5bb6\u957f+\u5408\u4f5c\u65b9(1).pdf"
HISTORY = ROOT / "docs/verification/parent-hours-font-2026-10-11/width-after-390-v2/comparison.json"
CROP = [98, 180, 586, 1238]


def digest(filename):
    return hashlib.sha256(filename.read_bytes()).hexdigest().upper()


def verify_inputs(inputs):
    if len({item["path"] for item in inputs}) != len(inputs):
        raise ValueError("Duplicate evidence input")
    for item in inputs:
        filename = (ROOT / item["path"]).resolve()
        if not filename.is_relative_to(ROOT) or digest(filename) != item["sha256"].upper():
            raise ValueError(f"Evidence input changed: {item['path']}")


def main():
    mapping_file = RUNTIME / "semantic-anchors-v1.json"
    mapping = json.loads(mapping_file.read_text(encoding="utf-8"))
    verify_inputs(mapping["inputs"])
    report = json.loads((RUNTIME / "runtime.json").read_text(encoding="utf-8"))
    verify_inputs(report["inputs"])
    if report["failure"] or mapping["acceptance"] != "diagnostic-only" or mapping["page"] != "parent/P3":
        raise ValueError("Expected complete diagnostic P3 evidence")
    historical = json.loads(HISTORY.read_text(encoding="utf-8"))
    reused = []
    for filename in (PDF, REFERENCE):
        matches = [item for item in historical["inputs"] if item["path"] == filename.relative_to(ROOT).as_posix()]
        if len(matches) != 1:
            raise ValueError("Missing unique PDF/reference history")
        reused.append(matches[0])
    verify_inputs(reused)
    images = []
    for name in ("standard-top", "standard-bottom", "restored-parent-home"):
        filename = RUNTIME / f"{name}.png"
        events = [event for event in report["events"] if event["label"] == f"screenshot:{name}"]
        if len(events) != 1 or not events[0]["response"].get("ok"):
            raise ValueError("Missing successful screenshot event")
        result = events[0]["response"]["result"]
        image = open_srgb(filename)
        if result["success"] is not True or Path(result["path"]).resolve() != filename.resolve() \
                or list(image.size) != [result["imageWidth"], result["imageHeight"]]:
            raise ValueError("Screenshot path/size mismatch")
        images.append(image)
    reference = open_srgb(REFERENCE)
    if not (0 <= CROP[0] < CROP[2] <= reference.width and 0 <= CROP[1] < CROP[3] <= reference.height):
        raise ValueError("Full phone crop lies outside reference")
    output = RUNTIME / "contacts-v1"
    output.mkdir(exist_ok=False)
    source = reference.crop(CROP)
    with (output / "source-phone.png").open("xb") as stream:
        source.save(stream, format="PNG")
    sheet(output / "source-native.png", [[
        ("New PDF P3 - full phone", source),
        ("Current native 390 - top", images[0]),
        ("Current native 390 - bottom", images[1]),
    ]])
    inputs = [mapping_file, HISTORY, PDF, REFERENCE, Path(__file__),
              ROOT / ".tools-automation/compare_parent_hours_font.py"]
    receipt = {
        "scope": "sRGB diagnostic contacts; no fitted geometry, text-ink or material acceptance",
        "referencePhysicalPage": 4,
        "referenceCropPixels": CROP,
        "reusedReferenceInputs": reused,
        "inputs": [{"path": filename.relative_to(ROOT).as_posix(), "sha256": digest(filename)}
                   for filename in inputs],
        "outputs": [{"path": filename.relative_to(ROOT).as_posix(), "sha256": digest(filename)}
                    for filename in (output / "source-phone.png", output / "source-native.png")],
    }
    with (output / "comparison.json").open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, ensure_ascii=True, indent=2)
        stream.write("\n")
    print(output / "source-native.png")


if __name__ == "__main__":
    main()
