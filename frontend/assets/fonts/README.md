# Parent display font

`parent-display-subset.woff` is a character subset of **Long Zhu Ti GB2312**
(标小智龙珠体 GB2312).
It replaces the unavailable commercial `eryamianhuatang` font only for the
current parent-client prototype.

- Source: <https://github.com/maoken-fonts/LongZhuTi>
- Upstream copyright: Copyright 2022-2023 Long Zhu Ti Project Authors;
  Copyright 2020 RocknRoll One Project Authors
- License: SIL Open Font License 1.1, included in `OFL.txt`
- Generator: `.tools-automation/subset_parent_font.py`

The subset contains the visible Chinese characters found in the parent client,
plus ASCII letters, digits, and common punctuation. Text containing other
characters falls back to the system font.

Run the generator again whenever dynamic fixture names or other display text
changes. The generated TypeScript also exports the exact character corpus so
tests can prevent known names from silently falling back to a system font.
