# 合作方端素材说明

本清单素材来自 `素材/该/改版/合作方端/合作方端.psd` 首页、课时账户和“我的”画板的独立图层，不使用网络图片或整张效果图。`home-stat-glass.png` 因公共统计组件直接引用而保留在本目录；表内其余 PNG 位于 `frontend/pages/partner/assets/`。

| 文件 | PSD 来源 | 输出 | SHA256 |
|---|---|---:|---|
| `home-character.png` | 完整 `图层 20`，只裁去首页画板外区域 | 720 x 1196 | `C7628F1E2181E8816B2F106BFE2D8DFDA834953BD1BD08E866386481266C9442` |
| `home-stat-glass.png` | `图层 20 拷贝` 的原始统计框区域 | 654 x 181 | `77D1E8F17AE4D5ACEC244609CDC62DEFFD58B594AC5A608032C28E1597008640` |
| `home-mark.png` | 首页导航标记区域 | 137 x 137 | `359C6DB6AFF72ABFA49D563B70F01823537D225518ED5325FE7197E9301E2D98` |
| `icon-warnings.png` | `讨论` | 54 x 40 | `416B092CA708C861C34566D47ABFBB6CE1B49DC674935504F512F06C8C89C852` |
| `icon-attendance.png` | `练习` | 48 x 54 | `629635BB17E51B12B4432B6357427E1B4F7764C9E3D626458EA9B7DD99F01024` |
| `icon-teachers.png` | `男同学` | 43 x 53 | `37DD048AC3314E4CDC9A8135791DAE931484F4DA87B09629EC7E61559524E7BE` |
| `icon-students.png` | `课堂` | 81 x 85 | `4383FF684C8164FE56C58A1D1C1EA2B35B518F631A2EA741AB430D3770FA2D05` |
| `lesson-account-top-character.png` | 课时账户完整 `图层 23` | 520 x 620 | `0E1F509966CC1F24B1A9497EB9B745C3F4040631FE31A2EC3338C85595766931` |
| `lesson-account-lower-character.png` | 课时账户完整可见 `图层 13 拷贝 3` | 500 x 585 | `718405E16AA69511A4623DBB425A8E44EC0990F1A595C3ED770DF04188020D0A` |
| `lesson-account-mark.png` | 课时账户左上页标区域 | 137 x 137 | `B609C4463B1E8517BBAF12DED6D69B1B8E8FF71BE1675356DD722A0F533BB698` |
| `profile-top-character.png` | “我的”完整 `图层 14` | 480 x 601 | `51B9C1CF7C95DFAAF1622EE0D1B9D4C61541F9089E4DDADB2BFA6233D37698FD` |
| `profile-lower-character.png` | “我的”完整 `图层 25` | 500 x 629 | `EA713F34559EE7F1ACDC6E3CEAAC93AB53312FCD8C8C9257516242C51CDEFF09` |
| `profile-mark.png` | “我的”左上页标区域 | 137 x 137 | `5DE8FE25844556197B12262037E919E4F5F87BDD3E79872C8664CA1F01994A5B` |

约束：

- 三个画板的页面右上独立 `logo`/像素 Logo 及中英文品牌文字未导出。
- 人物保持 PSD 单一完整图层，不拆分、不重绘，只裁去各自画板外区域；课时账户下方使用同位置的可见完整副本。
- 磨砂素材来自同一角色人物副本，不借用家长、教师或管理员人物。
- 单张 PNG 不超过 500 KB；姓名、校区、课时、出勤率和统计均由 WXML 动态展示。
