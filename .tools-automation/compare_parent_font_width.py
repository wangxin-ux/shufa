import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

from compare_parent_hours_font import open_srgb, sheet


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs/verification"
REFERENCE = ROOT / "tmp/pdfs/ui-source-audit-20261010-01a1258e/new"
PDF = ROOT / "\u7d20\u6750/UI\u66f4\u65b0\u5bb6\u957f+\u5408\u4f5c\u65b9(1).pdf"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--width", type=int, choices=[390, 430], required=True)
    parser.add_argument("--evidence", default="v1")
    parser.add_argument("--pages", nargs="+", choices=["P1", "P2", "P3", "P4", "P5", "P6"],
                        default=["P1", "P2", "P3", "P4", "P5", "P6"])
    parser.add_argument("--include-menu", action="store_true")
    args = parser.parse_args()
    if not args.evidence.isalnum():
        raise ValueError("Expected simple evidence version")
    output = BASE / "parent-font-width-2026-10-11" / f"{args.width}-{args.evidence}"
    if output.exists():
        raise ValueError("Preserve existing contact directory")
    output.mkdir(parents=True)
    cases = [
        ("P1", 2, f"parent-home-font-2026-10-11/runtime-{args.width}-v1", "source-standard-top"),
        ("P2", 3, f"parent-course-price-2026-10-11/quote-font-{args.width}-v1", "prices-top"),
        ("P3", 4, f"parent-hours-font-2026-10-11/grant-after-{args.width}-v1", "standard-top"),
        ("P4", 5, f"parent-leave-font-2026-10-11/after-{args.width}-v1", "standard-top"),
        ("P5", 6, f"parent-profile-font-2026-10-11/after-{args.width}-v1", "standard-top"),
        ("P6", 7, f"parent-growth-font-2026-10-11/after-{args.width}-v1", "standard-top"),
    ]
    inputs = [PDF]
    crop = [98, 180, 586, 1238]
    for label, page, directory_name, standard in cases:
        if label not in args.pages:
            continue
        directory = BASE / directory_name
        report_path = directory / "runtime.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if report["failure"] or report["expectedWidth"] != args.width:
            raise ValueError("Incomplete or wrong-width capture")
        reference_path = REFERENCE / f"page-{page:02}.png"
        inputs.extend([report_path, reference_path])
        reference = open_srgb(reference_path)
        if reference.width < crop[2] or reference.height < crop[3]:
            raise ValueError("Reference crop outside source")
        image_path = directory / f"{standard}.png"
        inputs.append(image_path)
        sheet(output / f"{label.lower()}-source-native.png", [[
            (f"New PDF {label}: reference", reference.crop(crop)),
            (f"{label}: actual {args.width}px", open_srgb(image_path)),
        ]])
        captures = [event["label"][11:] for event in report["events"]
                    if event["label"].startswith("screenshot:")]
        for batch_start in range(0, len(captures), 6):
            rows = []
            for start in range(batch_start, min(batch_start + 6, len(captures)), 3):
                row = []
                for name in captures[start:min(start + 3, batch_start + 6)]:
                    filename = directory / f"{name}.png"
                    inputs.append(filename)
                    row.append((f"{label}: {name}", open_srgb(filename)))
                while len(row) < 3:
                    row.append(("", Image.new("RGB", (320, 690), "white")))
                rows.append(row)
            sheet(output / f"{label.lower()}-states-{batch_start // 6 + 1}.png", rows)
    if args.include_menu:
        anchor_version = "v2" if args.width == 390 else "v1"
        anchor_dir = BASE / f"parent-home-font-2026-10-11/runtime-{args.width}-anchors-{anchor_version}"
        anchor_path = anchor_dir / "runtime.json"
        anchor = json.loads(anchor_path.read_text(encoding="utf-8"))
        if anchor["failure"] or anchor["expectedWidth"] != args.width:
            raise ValueError("Incomplete anchor capture")
        inputs.append(anchor_path)
        menu_images = []
        for name in ["source-standard-top", "source-standard-bottom", "source-standard-menu",
                     "source-standard-menu-bottom", "restored-parent-home"]:
            filename = anchor_dir / f"{name}.png"
            inputs.append(filename)
            menu_images.append((f"P1 anchors: {name}", open_srgb(filename)))
        menu_rows = []
        for start in range(0, len(menu_images), 3):
            row = menu_images[start:start + 3]
            while len(row) < 3:
                row.append(("", Image.new("RGB", (320, 690), "white")))
            menu_rows.append(row)
        sheet(output / "p1-menu-restoration.png", menu_rows)
    inputs = list(dict.fromkeys(inputs))
    with (output / "comparison.json").open("x", encoding="utf-8") as target:
        json.dump({
            "scope": "Fresh native width contacts and sRGB reference comparison; not whole-page acceptance",
            "width": args.width,
            "pages": args.pages,
            "includesMenu": args.include_menu,
            "referenceCropPixels": crop,
            "inputs": [{"path": filename.relative_to(ROOT).as_posix(),
                        "sha256": hashlib.sha256(filename.read_bytes()).hexdigest()} for filename in inputs],
        }, target, ensure_ascii=True, indent=2)
        target.write("\n")
    print(json.dumps({"output": str(output), "inputs": len(inputs)}, ensure_ascii=True))


if __name__ == "__main__":
    main()
