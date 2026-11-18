"""Create fresh sRGB native comparisons and corrected source-plane contact."""

import hashlib
import json
import math
from pathlib import Path

from PIL import Image

from audit_parent_growth_stars import contact, star_plane_contact
from compare_parent_hours_font import open_srgb, sheet


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs/verification/parent-growth-source-2026-10-11"
NATIVE = ROOT / "docs/verification/parent-growth-font-2026-10-11"
DIRECTORIES = [NATIVE / "star-before-375-v1", NATIVE / "star-after-375-v1"]


def main():
    directory = BASE / "native-contacts-v1"
    if directory.exists():
        raise FileExistsError("Preserve existing comparison evidence")
    reports = [json.loads((value / "runtime.json").read_text(encoding="utf-8"))
               for value in DIRECTORIES]
    if any(report["failure"] for report in reports):
        raise ValueError("Incomplete native capture")
    inputs = [value / "runtime.json" for value in DIRECTORIES]
    directory.mkdir()
    for filename, names in [
        ("standard-contact.png", ["standard-top", "standard-bottom"]),
        ("long-contact.png", ["long-top", "long-bottom"]),
        ("reversed-contact.png", ["reversed-top", "reversed-bottom"]),
        ("states-contact.png", ["no-photo-top", "empty-top", "no-student-top"]),
        ("error-and-restore-contact.png", ["error-top", "restored-parent-home"]),
    ]:
        rows = []
        for name in names:
            row = []
            for label, source in zip(("Before", "After"), DIRECTORIES):
                image_path = source / f"{name}.png"
                inputs.append(image_path)
                row.append((f"{label}: {name}", open_srgb(image_path)))
            rows.append(row)
        sheet(directory / filename, rows)
    panels = []
    for label, source, report in zip(("Before", "After"), DIRECTORIES, reports):
        capture = next(event for event in report["events"]
                       if event["label"] == "nodes:standard-top")["response"]["result"]["result"]["result"]
        image = open_srgb(source / "standard-top.png")
        factor = image.width / capture["window"]["windowWidth"]
        if abs(image.height / image.width - capture["window"]["windowHeight"]
               / capture["window"]["windowWidth"]) > 0.005:
            raise ValueError("Screenshot does not match measured window")
        rows = capture["nodes"][capture["selectors"].index(".growth-stars")]
        for name, node in zip(("performance", "teaching", "communication", "environment", "overall"), rows):
            crop = [math.floor((node["left"] - 2) * factor), math.floor((node["top"] - 2) * factor),
                    math.ceil((node["right"] + 2) * factor), math.ceil((node["bottom"] + 2) * factor)]
            if min(crop[:2]) < 0 or crop[2] > image.width or crop[3] > image.height:
                raise ValueError("Rating row is outside the actual captured window")
            panels.append((f"{label} native: {name} (screenshot pixels)", image.crop(crop)))
    ordered = [panels[index] for row in range(5) for index in (row, row + 5)]
    with (directory / "native-rating-crops.png").open("xb") as stream:
        contact(ordered, cell=(440, 110)).save(stream, format="PNG")
    original = BASE / "rating-star-before-original.png"
    candidate = BASE / "source-v1/candidate-rating-star.png"
    inputs.extend([original, candidate, Path(__file__), Path(__file__).with_name("audit_parent_growth_stars.py")])
    with Image.open(original) as old, Image.open(candidate) as new:
        corrected = star_plane_contact(old.convert("RGBA"), new.convert("RGBA"))
    with (directory / "source-planes-actual-3x.png").open("xb") as stream:
        corrected.save(stream, format="PNG")
    metadata = {
        "scope": "Fresh native screenshots converted from embedded ICC to sRGB; source contact at actual 3x",
        "limits": "Rating crops are screenshot pixels; source contact is not a native rendering or complete page acceptance",
        "inputs": [{"path": value.relative_to(ROOT).as_posix(),
                    "sha256": hashlib.sha256(value.read_bytes()).hexdigest().upper()} for value in inputs],
    }
    with (directory / "comparison.json").open("x", encoding="utf-8") as stream:
        json.dump(metadata, stream, ensure_ascii=True, indent=2)
        stream.write("\n")
    print(directory.relative_to(ROOT).as_posix())


if __name__ == "__main__":
    main()
