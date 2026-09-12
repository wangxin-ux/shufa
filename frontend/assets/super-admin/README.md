# 总端素材说明

总端素材来自 `素材/该/改版/总端/总端.psd` 的独立图层，不使用网络图片或整张效果图。

2026-08-31 普通分包完成后，公共统计组件直接引用的 `home-stat-glass.png` 保留在本目录；其余总端人物、页标和入口图标位于 `frontend/pages/super-admin/assets/`。重新运行 `frontend/scripts/extract-super-admin-assets.py` 时必须保持该输出归属，不得把角色专用 PNG 写回主包。

总端首页原始 `home-mark.png` 自带白色圆底和“首页”文字，只保留为 PSD 来源产物；运行页面使用同一导出脚本生成的透明 `home-mark-glyph.png`，标题由页壳动态渲染，避免双重文字并统一教师端页标尺寸。

约束：

- 页面右上独立 Logo、中文品牌名和英文副标题不得导出或展示。
- 人物保持 PSD 单一完整图层，不拆分、不重绘，不裁掉画板内组成部分；服装自带徽章保持原图。
- 单张 PNG 不超过 500 KB；姓名、校区、课时、金额和状态由 WXML 动态展示。
- 新增总端专用 PNG 写入 `frontend/pages/super-admin/assets/`，并运行 `pnpm --dir frontend assets:check` 与分包结构测试。
