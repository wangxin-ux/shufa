# 教师端素材说明

本清单素材全部来自甲方源稿 `素材/该/改版/教师端/教师端.psd` 的独立图层导出（透明背景 PNG），未使用网络图片，也未复制整张效果图。`home-mascot.png` 与 `home-stat-glass.png` 因公共首页组件直接引用而保留在本目录；其余表内 PNG 位于 `frontend/pages/teacher/assets/`。

| 文件 | PSD 来源图层 | 用途 | 状态 |
|---|---|---|---|
| `home-mascot.png` | 首页画板完整 `图层 17`，仅裁掉画板外部分，保留人物服装胸前徽章及完整交叉手臂 | 首页教师人物装饰 | final |
| `home-stat-glass.png` | `home-mascot.png` 胸前区域按原稿统计框比例裁切、模糊并保留透明度 | 首页统计框专用人物磨砂层 | final |
| `profile-card-mascot.png` | 我的画板 `图层 14` | 个人资料卡人物装饰 | final |
| `profile-footer-mascot.png` | 我的画板 `图层 13 拷贝 2` | 我的页底部人物装饰 | final |
| `icon-student-record.png` | 首页画板 `讨论` | 学员档案入口 | final |
| `icon-confirm.png` | 首页画板 `练习` | 上课确认入口 | final |
| `icon-students.png` | 首页画板 `男同学` | 我的学员入口 | final |
| `icon-schedule.png` | 首页画板 `课堂` | 我的课表入口 | final |

约束：

- 单张图片 ≤ 500 KB；五角色图片与字体合计 ≤ 5 MB，由 `frontend/scripts/check-asset-budget.mjs` 强制检查。
- 页面标题、业务数据、按钮、表单和列表使用 WXML/WXSS 实现，素材只承担人物或图标展示。
- 页面角落的独立品牌 logo、中文品牌名和英文副标题不得使用；按用户 2026-08-29 最新决定，教师人物服装自带的胸前圆形徽章必须保留。
