"""Build an offline review from the approved PSD cache and existing IDE screenshots."""

import hashlib
import html
import json
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageCms, ImageDraw, ImageFont
from psd_tools import PSDImage


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs/verification/partner-pdf-2026-10-08/2026-10-18-source-comparison"
SCREENSHOTS = ROOT / "docs/verification/screenshots"
GEOMETRY = ROOT / "docs/verification/ui-source-geometry-2026-10-10/psd-geometry-v2.json"
PSD = ROOT / (
    "\u7d20\u6750/744d4760802762ec45611935fa516fd9_3359126753859121857_m(1)/"
    "\u5bb6\u957f+\u5408\u4f5c\u65b9/\u5408\u4f5c\u65b9\u7aef/\u5408\u4f5c\u65b9\u7aef.psd"
)
PSD_HASH = "A009715BC119E42AC2C680A994BC4B5A7FFD463D792488419874F3A037C97FFF"
GEOMETRY_HASH = "01E527CD7ED4BBB0621CBC88311224B3851892BD004DAE11F10813463ECE94BD"
DATE = "2026-10-18"
WIDTHS = (375, 390, 430)
TITLES = ["首页", "学员", "课时账户", "申请入驻", "活动中心", "活动编辑", "教师", "我的"]
CURRENT = {
    "P1": ("normal", "normal", "normal-weight"),
    "P2": ("shadow-expanded", "shadow-after", "shadow-expanded"),
    "P3": ("normal", "normal", "title-badges"),
    "P4": ("order-documents", "order-final-documents", "order-documents"),
    "P5": ("normal", "normal", "final"),
    "P6": ("top", "top", "continuous-top"),
    "P7": ("metrics-ratings",) * 3,
    "P8": ("normal", "normal", "final"),
}
NOTES = {
    "P1": "保留完整人物、磨砂和底部导航。新增报名实收/已退与班级、教师、出勤信息，首屏文字密度高于原稿；公共页标沿用批准基线。",
    "P2": "科目/余额筛选和姓名搜索使首卡下移；长班型及待核对报名摘要撑高卡片。展开底色/圆角/投影已按原层校准，名单条数随实际数据变化。",
    "P3": "标题、橙色账户、黄色流水及三榜分区保留。原稿大人物和卡高与现役批准的288/192rpx人物、内部滚动布局有明显差别；没有上月事实时显示未知比较。",
    "P4": "已有申请采用证件、银行、环境、基础信息/位置顺序。身份/状态/审核区使黄框下移；首次申请仍基础优先。原稿底部人物及半透明副本尚未接入；材料、环境和底部另附现有证据。",
    "P5": "橙色创建入口和底部完整人物保留。五类筛选/阶段把活动条下移；实际标题、描述、日期及审核提示使条目高于原稿，不能为静态高度隐藏业务内容。",
    "P6": "完整长画板保留；现役首屏仅覆盖上部，不能拉伸成全页。原稿底部人物及半透明副本尚未接入；两列类型和保存提示使表单更长，复杂交易按批准范围后置。",
    "P7": "搜索区使教师条下移；月度选择、口径提示、独立半星、指导输入/保存/历史使展开区长于原稿。三指标和评分同行保留，页底有独立证据。",
    "P8": "身份卡、四项菜单、上下完整人物和独立入驻入口保留。身份卡/菜单边界及人物大小与原稿有小幅差异；更多展开另附证据，入驻目标仍缺Mock API地址。",
}
ANCHOR_IDS = {
    "P1": [30, 32, 552, 11, 59, 49, 1606],
    "P2": [1468, 1526, 1539, 1962],
    "P3": [123, 104, 559, 231, 206, 1017, 1001, 560, 1920],
    "P4": [697, 672, 957, 959, 724, 730, 732, 668, 1927],
    "P5": [1134, 415, 566, 1934],
    "P6": [1202, 1149, 1183, 1173, 1275, 1281, 1147, 1955],
    "P7": [764, 768, 821, 769, 1941],
    "P8": [1108, 1109, 1056, 1054, 1555, 1948],
}
# Visible raster edges, read from the selected 557px screenshots; not DOM boxes.
# x/y/width/height include the visible surface but exclude its shadow.
RASTER_BOXES = {
    "P1": {11: [33, 830, 486, 129]},
    "P2": {1468: [35, 311, 486, 175], 1526: [35, 503, 486, 337]},
    "P3": {104: [33, 264, 489, 331], 206: [33, 715, 489, 154]},
    "P4": {957: [66, 460, 213, 158], 959: [290, 460, 215, 158]},
    "P5": {1134: [35, 164, 486, 113], 415: [35, 556, 486, 183]},
    "P6": {1183: [59, 391, 125, 24]},
    "P7": {764: [35, 284, 486, 122]},
    "P8": {1108: [33, 333, 489, 200], 1056: [33, 570, 489, 261]},
}
DETAIL_ANCHOR = {"P1": 11, "P2": 1526, "P3": 104, "P4": 957,
                 "P5": 1134, "P6": 1183, "P7": 764, "P8": 1056}
SUPPLEMENT_STEMS = {
    "P1": ["long"],
    "P2": ["shadow-photo-long"],
    "P3": ["long-feedback-badges"],
    "P4": ["order-first-application", "order-nine-environment", "order-long-bottom",
           "review-long-rejection-reopen"],
    "P5": ["long-draft"],
    "P6": ["image-pair-empty", "image-pair-filled", "bottom"],
    "P7": ["long-metrics", "bottom"],
    "P8": ["more"],
}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest().upper()


def relative(path):
    return path.relative_to(ROOT).as_posix()


def open_srgb(path):
    with Image.open(path) as image:
        profile = image.info.get("icc_profile")
        if profile:
            return ImageCms.profileToProfile(
                image, ImageCms.ImageCmsProfile(BytesIO(profile)),
                ImageCms.createProfile("sRGB"), outputMode="RGB",
            )
        return image.convert("RGB")


def scaled(image, width=750):
    return image.resize(
        (width, round(image.height * width / image.width)), Image.Resampling.LANCZOS,
    )


def save_new(image, path):
    if path.exists():
        raise FileExistsError(path)
    if path.suffix == ".jpg":
        image.save(path, quality=94, subsampling=0)
    else:
        image.save(path)


def pair(left, right, label_left, label_right, width=500):
    left, right = scaled(left, width), scaled(right, width)
    canvas = Image.new("RGB", (width * 2 + 36, max(left.height, right.height) + 44), "#eceeed")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 15)
    draw.text((12, 10), label_left, fill="#151b18", font=font)
    draw.text((width + 24, 10), label_right, fill="#151b18", font=font)
    canvas.paste(left, (12, 36))
    canvas.paste(right, (width + 24, 36))
    return canvas


def supplement_paths(page, width):
    paths = []
    for stem in SUPPLEMENT_STEMS[page]:
        if page == "P4" and width == 390 and stem.startswith("order-"):
            stem = stem.replace("order-", "order-final-")
        if page == "P6" and width == 430 and stem == "bottom":
            stem = "continuous-bottom"
        if page == "P8" and width == 430 and stem == "more":
            # The 430 image records the application icon; expanded menus exist at other widths.
            stem = "application"
        path = SCREENSHOTS / f"partner-{page.lower()}-ui-{stem}-{width}-{DATE}.jpg"
        if path.is_file():
            paths.append(path)
    return paths


def make_html(manifest):
    escape = html.escape
    parts = []
    for page in manifest["pages"]:
        page_id = page["page"]
        figure = (
            f'<figure><figcaption>新版PSD完整画板</figcaption>'
            f'<a href="{page_id}-reference.png"><img src="{page_id}-reference.png" '
            f'width="750" height="{page["referenceSize"][1]}" alt="{page_id}新版原稿"></a></figure>'
            f'<figure><figcaption class="current-caption">现有截图 · 430px逻辑窗口</figcaption>'
            f'<a class="current-link" href="{page["screenshots"]["430"]["url"]}">'
            f'<img class="current-image" src="{page["screenshots"]["430"]["url"]}" '
            f'width="557" height="1203" alt="{page_id}现有页面截图"></a></figure>'
        )
        rows = []
        for anchor in page["anchors"]:
            current = anchor["currentRasterRpx"]
            source = ", ".join(f"{v:.1f}" for v in anchor["sourceRpx"])
            measured = ", ".join(f"{v:.1f}" for v in current) if current else "未测；见图和专项"
            rows.append(
                f'<tr><td>{anchor["layerId"]} · {escape(anchor["name"])}</td>'
                f'<td>{source}</td><td>{measured}</td></tr>'
            )
        parts.append(
            f'<section id="{page_id}" data-page="{page_id}"><h2>{page_id} {escape(page["title"])}</h2>'
            f'<p>{escape(page["note"])}</p><div class="comparison">{figure}</div>'
            '<details><summary>叠图和局部放大</summary>'
            '<p>叠图只按宽度等比缩放，左上对齐；不移动业务区、不拉伸、不遮盖差异。'
            '长原稿超出截图的部分没有现有图覆盖。</p>'
            f'<label>现有图透明度 <input type="range" min="0" max="100" value="50" '
            f'aria-label="{page_id}现有图透明度"></label>'
            f'<div class="overlay"><img src="{page_id}-reference.png" width="750" '
            f'height="{page["referenceSize"][1]}" alt="原稿底图">'
            f'<img class="overlay-current" src="{page["screenshots"]["430"]["url"]}" '
            f'alt="半透明现有图"></div>'
            f'<a href="{page_id}-detail.jpg"><img class="detail" src="{page_id}-detail.jpg" '
            f'alt="{page_id}同一元素局部对照"></a>'
            f'<p><a href="{page_id}-pair.jpg">430并排图</a> · '
            f'<a href="{page_id}-overlay.jpg">430固定50%叠图</a></p></details>'
            '<details><summary>430主图锚点 · rpx [x,y,w,h]</summary>'
            '<p>源值来自PSD层边界；现值为截图可见边缘人工读数，约±2截图像素，'
            '不是DOM行框，不能用于宣称≤4rpx通过。未测项不冒填。</p>'
            '<div class="table-scroll"><table><thead><tr><th>源层</th><th>原稿</th>'
            f'<th>现有430主图估读</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>'
            '</details><details><summary>已有补充截图</summary><div class="supplements"></div></details>'
            '</section>'
        )
    data = json.dumps(manifest, ensure_ascii=True).replace("</", "<\\/")
    return """<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>合作方八页原稿对照 · 2026-10-18</title>
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:#202925;background:#fff;font:15px/1.7 "Microsoft YaHei",sans-serif;letter-spacing:0}
header,main{max-width:1120px;margin:auto;padding:22px}header{border-bottom:1px solid #dce2df}
h1{font-size:26px;margin:0 0 12px}h2{font-size:23px;margin:0 0 8px}p{margin:8px 0 16px}
a{color:#176b53}nav{display:flex;flex-wrap:wrap;gap:8px 22px;margin:16px 0}
.controls{position:sticky;top:0;z-index:3;background:#f2f7f4;border-bottom:1px solid #c9d8cf;padding:12px 22px;display:flex;gap:20px;align-items:center;justify-content:center}
select{font:inherit;padding:6px 12px;border:1px solid #90a79a;border-radius:4px;background:white}
section{border-bottom:1px solid #cad3ce;padding:30px 0;scroll-margin-top:78px}
.comparison{display:grid;grid-template-columns:1fr 1fr;align-items:start;gap:22px}
figure{margin:0;min-width:0}figcaption{font-weight:600;padding:8px 0}
img{display:block;width:100%;height:auto}figure img{border:1px solid #c7ceca}
details{margin-top:18px;border-top:1px solid #dce2df;padding-top:12px}summary{cursor:pointer;color:#176b53}
.overlay{position:relative;max-width:650px;margin:15px auto;background:#e8edea}
.overlay-current{position:absolute;left:0;top:0;opacity:.5}
input[type=range]{vertical-align:middle;width:220px}.detail{margin-top:18px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #dce2df}
td:nth-child(n+2){white-space:nowrap}.table-scroll{overflow-x:auto}
.supplements{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:14px}
.supplements a{overflow-wrap:anywhere;font-size:12px}.supplements img{margin-top:6px}
.status{color:#835b0a}.legend{font-size:13px;color:#54645b}
@media(max-width:620px){header,main{padding:15px}h1{font-size:22px}.comparison{gap:10px}.supplements{grid-template-columns:repeat(2,minmax(0,1fr))}.controls{justify-content:flex-start;padding:9px 15px}figcaption{font-size:12px}}
</style>
<header><h1>合作方八页原稿对照</h1>
<p>2026-10-18 · 最新PSD画板与已有微信模拟器截图。图可点开看大图。</p>
<p class="status">这是一份差异报告：八页均有对照，不代表整页已完全对齐或真机验收通过。</p>
<nav>""" + "".join(
        f'<a href="#P{i}">P{i} {escape(title)}</a>' for i, title in enumerate(TITLES, 1)
    ) + """</nav>
<p class="legend">系统栏、公共返回/页标、字体、动态业务数据和长表单差异均保留可见。
原稿仅用于核对，含旧品牌的参考图不进入小程序。P6保留完整长稿，现有截图各段分别查看，不拼成伪造整页。</p>
<p><a href="../../2026-10-08-partner-pdf-ui-comparison.md">报告</a> · <a href="manifest.json">来源与锚点JSON</a> · <a href="overview.jpg">八页总览</a></p></header>
<div class="controls"><label>现有截图宽度 <select id="width"><option>375</option><option>390</option><option selected>430</option></select></label>
<span id="window-size">430 × 932 逻辑px</span></div><main>""" + "".join(parts) + """</main>
<script>
const evidence = """ + data + """;
const widthSelect = document.getElementById('width');
function render(){
  const width = widthSelect.value;
  document.getElementById('window-size').textContent = `${width} × ${evidence.windows[width].height} 逻辑px`;
  evidence.pages.forEach(page=>{
    const section = document.getElementById(page.page), shot = page.screenshots[width];
    section.querySelector('.current-caption').textContent = `现有截图 · ${width}px逻辑窗口`;
    section.querySelector('.current-link').href = shot.url;
    const image = section.querySelector('.current-image');
    image.src = shot.url; image.width = shot.size[0]; image.height = shot.size[1];
    section.querySelector('.overlay-current').src = shot.url;
    const supplements = section.querySelector('.supplements');
    supplements.replaceChildren(...shot.supplements.map(item=>{
      const link = document.createElement('a'), thumb = document.createElement('img');
      link.href = item.url; link.textContent = item.name; thumb.src = item.url;
      thumb.alt = item.name; thumb.loading = 'lazy'; link.append(thumb); return link;
    }));
  });
}
widthSelect.addEventListener('change', render);
document.querySelectorAll('section input[type=range]').forEach(control=>{
  control.addEventListener('input', ()=>control.closest('details').querySelector('.overlay-current').style.opacity=control.value/100);
});
render();
</script></html>
"""


def main():
    if OUTPUT.exists():
        raise FileExistsError(f"Evidence output already exists: {OUTPUT}")
    if digest(PSD) != PSD_HASH or digest(GEOMETRY) != GEOMETRY_HASH:
        raise ValueError("Approved source fingerprint mismatch")
    geometry = json.loads(GEOMETRY.read_text(encoding="utf-8"))
    boards = [p for p in geometry["pages"] if p["role"] == "partner"]
    psd = PSDImage.open(PSD)
    cached = psd.topil(apply_icc=True)
    if cached is None or cached.size != (9700, 3580):
        raise ValueError("Expected the full Photoshop merged preview, not a recomposite")
    if cached.mode == "RGBA":
        background = Image.new("RGBA", cached.size, "white")
        cached = Image.alpha_composite(background, cached).convert("RGB")
    else:
        cached = cached.convert("RGB")
    output_pages = []
    products = []
    for board in boards:
        page = board["page"]
        if list(psd[board["stackIndex"]].bbox) != board["bboxDocumentPx"]:
            raise ValueError(f"Artboard mismatch: {page}")
        source = scaled(cached.crop(board["bboxDocumentPx"]))
        screenshots = {}
        for index, width in enumerate(WIDTHS):
            shot = SCREENSHOTS / f"partner-{page.lower()}-ui-{CURRENT[page][index]}-{width}-{DATE}.jpg"
            image = open_srgb(shot)
            supplements = [
                {"name": path.name, "url": "../../screenshots/" + path.name,
                 "path": relative(path), "sha256": digest(path)}
                for path in supplement_paths(page, width)
            ]
            screenshots[str(width)] = {
                "path": relative(shot), "url": "../../screenshots/" + shot.name,
                "sha256": digest(shot), "size": list(image.size), "supplements": supplements,
            }
        current = scaled(open_srgb(ROOT / screenshots["430"]["path"]))
        overlap_height = min(source.height, current.height)
        overlay = Image.blend(
            source.crop((0, 0, 750, overlap_height)),
            current.crop((0, 0, 750, overlap_height)), 0.5,
        )
        layer_map = {layer["layerId"]: layer for layer in board["layers"]}
        anchors = []
        for layer_id in ANCHOR_IDS[page]:
            layer = layer_map[layer_id]
            raster = RASTER_BOXES[page].get(layer_id)
            measured = [round(v * 750 / screenshots["430"]["size"][0], 3) for v in raster] if raster else None
            anchors.append({
                "layerId": layer_id, "name": layer["pathNames"][-1], "kind": layer["kind"],
                "sourceRpx": layer["bounds"]["rpx"], "sourceOpacity255": layer["opacity255"],
                "currentScreenshotPx": raster, "currentRasterRpx": measured,
                "deltaRpx": [round(b - a, 3) for a, b in zip(layer["bounds"]["rpx"], measured)] if measured else None,
                "measurement": "manual visible raster edge; approximate +/-2 screenshot px" if raster else "not measured",
            })
        detail_id = DETAIL_ANCHOR[page]
        detail_anchor = next(a for a in anchors if a["layerId"] == detail_id)
        x, y, w, h = detail_anchor["sourceRpx"]
        source_crop = source.crop((round(x), round(y), round(x+w), round(y+h)))
        x, y, w, h = detail_anchor["currentRasterRpx"]
        current_crop = current.crop((round(x), round(y), round(x+w), round(y+h)))
        # Preserve the common rpx scale in local crops; never fit each card to its own width.
        local = Image.new("RGB", (1400, round(max(source_crop.height, current_crop.height)) + 44), "#eceeed")
        draw = ImageDraw.Draw(local)
        draw.text((12, 10), f"{page} PSD layer {detail_id}", fill="black")
        draw.text((712, 10), f"{page} current 430: same rpx scale", fill="black")
        local.paste(source_crop, (12, 36))
        local.paste(current_crop, (712, 36))
        products.extend([
            (source, OUTPUT / f"{page}-reference.png"),
            (pair(source, current, f"{page}: NEW PSD, full board", f"{page}: current 430, viewport only"), OUTPUT / f"{page}-pair.jpg"),
            (overlay, OUTPUT / f"{page}-overlay.jpg"),
            (local, OUTPUT / f"{page}-detail.jpg"),
        ])
        output_pages.append({
            "page": page, "title": TITLES[int(page[1:])-1], "sourceStackIndex": board["stackIndex"],
            "sourceCropPx": board["bboxDocumentPx"], "referenceSize": list(source.size),
            "scrollMode": "single screen with internal scroll" if page in ("P1", "P3", "P8") else "page scroll",
            "currentCoverage": "viewport only; supplements are separate states, not a stitched full page",
            "overlayCoverageRpx": overlap_height, "screenshots": screenshots, "anchors": anchors,
            "note": NOTES[page], "status": "有差异；指定布局已验，完整验收未通过",
        })
    manifest = {
        "schemaVersion": 1, "executedOn": DATE, "coordinateUnit": "750rpx normalized full screen",
        "source": {"path": relative(PSD), "sha256": PSD_HASH, "sizePx": list(cached.size),
                   "method": "Photoshop saved merged preview, ICC to sRGB, exact artboard crop, proportional resize"},
        "geometry": {"path": relative(GEOMETRY), "sha256": GEOMETRY_HASH},
        "windows": {"375": {"height": 812, "dpr": 3, "safeArea": [47, 778]},
                    "390": {"height": 844, "dpr": 3, "safeArea": [47, 810]},
                    "430": {"height": 932, "dpr": 3, "safeArea": [54, 898]}},
        "limits": [
            "Screenshot pixels do not equal logical pixels. Current boxes only use 430 primary screenshots.",
            "Full-screen width normalization only; no business masks, y-offset compensation or vertical stretching.",
            "P6 keeps its full long source; no invented current pixels below the primary viewport.",
            "PSD layer bounds are not rendered contours. Raster estimates do not prove a 4rpx tolerance.",
            "Original brand remains visible in review sources only; not exported as product assets.",
        ],
        "pages": output_pages,
    }
    OUTPUT.mkdir(parents=True, exist_ok=False)
    overview = Image.new("RGB", (1320, 900), "#eceeed")
    for index, page in enumerate(output_pages):
        source = products[index*4][0]
        current = open_srgb(ROOT / page["screenshots"]["430"]["path"])
        tile = pair(source, current, page["page"]+" PSD", page["page"]+" 430", width=145)
        # Keep P6 visibly longer at the same thumbnail scale.
        overview.paste(tile, ((index % 4)*330, (index // 4)*380))
    products.append((overview, OUTPUT / "overview.jpg"))
    for image, path in products:
        save_new(image, path)
    manifest["outputs"] = [
        {"path": relative(path), "size": list(image.size), "sha256": digest(path)}
        for image, path in products
    ]
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    (OUTPUT / "index.html").write_text(make_html(manifest), encoding="utf-8")
    print(json.dumps({"pages": len(output_pages), "sourceAnchors": sum(len(p["anchors"]) for p in output_pages),
                      "screenshots": sum(len(p["screenshots"]) for p in output_pages),
                      "output": relative(OUTPUT)}, ensure_ascii=True))


if __name__ == "__main__":
    main()
