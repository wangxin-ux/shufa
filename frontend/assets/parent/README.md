# 家长端素材说明

本清单素材全部来自甲方源稿 `素材/该/改版/家长端/家长端.psd` 的独立图层导出（透明背景 PNG），未使用网络图片，未复制整张效果图。2026-08-31 普通分包完成后，表内 PNG 均位于 `frontend/pages/parent/assets/`；本目录只保留来源说明，不再存放家长运行图片。

| 文件 | PSD 来源图层 | 用途 | 状态 |
|---|---|---|---|
| `home-mascot.png` | 画板 1 `图层 11`（裁掉超出画板部分） | 首页戴眼镜白狗装饰图 | final |
| `home-metric-glass.png` | 画板 1 `学员展示/图层 11 拷贝`，按统计卡形状边界裁切 | 首页统计卡内的放大磨砂人物背景；文字和数据仍为 WXML | final |
| `hours-mascot.png` | 画板 1-1 `图层 12` | 课时页挥手狗装饰图 | final |
| `leave-mascot.png` | 画板 1-2 `图层 14` | 请假页西装狗装饰图 | final |
| `profile-mascot.png` | 画板 1 拷贝 `图层 15` | 我的页牛仔相机狗装饰图 | final |
| `profile-backdrop.png` | 画板 1 拷贝 `图层 16` | 我的页下半页绿衣背包狗背景装饰 | final |
| `hours-ledger-mascot.png` | 画板 1-1 `图层 13 拷贝` | 课时流水卡背面露出的眼镜狗装饰 | final |
| `icon-mark-home.png` | 画板 1 `下部按钮/首 页…11` 层裁切（白色蒙版已抠除） | 页面标识圆钮：首页（铅笔） | final |
| `icon-mark-hours.png` | 同上 | 页面标识圆钮：课时（读书） | final |
| `icon-mark-leave.png` | 同上 | 页面标识圆钮：请假（日历） | final |
| `icon-mark-profile.png` | 同上 | 页面标识圆钮：我的（人像） | final |
| `icon-qa-leave.png` | 画板 1 `我的服务/请假/讨论` | 首页快捷入口：申请请假 | final |
| `icon-qa-hours.png` | 画板 1 `我的服务/课时/练习` | 首页快捷入口：课时明细 | final |
| `icon-qa-team.png` | 画板 1 `我的服务/团队/男同学` | 首页快捷入口：教研团队 | final |
| `icon-qa-remind.png` | 画板 1 `我的服务/上课/课堂` | 首页快捷入口：上课提醒 | final |

约束：

- 单张图片 ≤ 500 KB；五角色图片与字体合计 ≤ 5 MB，由 `frontend/scripts/check-asset-budget.mjs` 强制检查（`pnpm --dir frontend assets:check`）。
- 素材为装饰用途，页面标题、数据、按钮、表单、列表一律用 WXML/WXSS 实现。
- 2026-08-28 用户决定：右上角狗头 logo 整体移除，`brand-dog-head.png` 与 `parent-brand-mark` 组件已删除，各页不得再使用该 logo。
- 禁止联网下载相似狗形象替代；如需替换素材，只能从甲方 UI/PSD 重新导出或由用户补充。
