# 管理员端素材说明

本清单素材来自 `素材/该/改版/管理员端/管理员端.psd` 首页画板的独立图层，不使用网络图片或整张效果图。`home-stat-glass.png` 因公共统计组件直接引用而保留在本目录；表内其余 PNG 位于 `frontend/pages/campus-manager/assets/`。

| 文件 | PSD 来源 | 输出 | SHA256 |
|---|---|---:|---|
| `home-character.png` | 完整 `图层 20`，只裁去首页画板外区域 | 720 x 1196 | `C7628F1E...C9442` |
| `home-stat-glass.png` | `图层 20 拷贝` 的原始统计框区域 | 654 x 181 | `77D1E8F1...08640` |
| `home-mark.png` | 首页活动导航标记区域 | 137 x 137 | `359C6DB6...E2D98` |
| `icon-schedule.png` | `讨论` | 54 x 40 | `416B092C...C852` |
| `icon-approvals.png` | `练习` | 48 x 54 | `629635BB...01024` |
| `icon-warnings.png` | `男同学` | 43 x 53 | `37DD048A...E7BE` |
| `icon-student-create.png` | `课堂` | 81 x 85 | `4383FF68...2D05` |
| `profile-top-character.png` | “我的”画板完整 `图层 14`，只裁去画板外区域 | 600 x 751 | `8744D05E56E3021A21FB94BB0A546817F2814B3A6BA1829448A6D30DBFE05ACA` |
| `profile-lower-character.png` | “我的”画板完整 `图层 13 拷贝 2`，只裁去画板外区域 | 720 x 934 | `65DEA922F940AF4D1ECF7A01A3629D8DD133A20205DBD2EE502330BC1F167A9E` |
| `profile-mark.png` | “我的”画板选中导航标记区域 | 137 x 137 | `5DE8FE25844556197B12262037E919E4F5F87BDD3E79872C8664CA1F01994A5B` |
| `profile-mark-glyph.png` | 从上述 PSD 页标中仅保留橙色图形并转为透明底 | 62 x 61 | `7D640348F19F194B308665F9B9237B98A5F8DE931074555A9A1AF084B51FEC92` |

约束：

- 页面右上独立 `logo` 组、中文品牌名和英文副标题未导出。
- 人物保持 PSD 单一完整图层，不拆分、不重绘、不裁掉画板内组成部分。
- 磨砂副本和首页标记读取像素层原始 RGBA，再按 PSD 全局坐标裁切，避免蒙版被重复应用后导出全透明图。
- 单张 PNG 不超过 500 KB；动态姓名、校区、统计和审批信息均由 WXML 展示。
