Component({
  properties: {
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    tagText: { type: String, value: '' },
    tagTone: { type: String, value: 'green' }, // green | orange | red | gray
    dotColor: { type: String, value: '#23b574' },
    // flat：去掉卡片底，嵌入整版列表容器（课时流水）；hideDot：隐藏左侧圆点（请假记录）；
    // tagPlain：标签用纯色加粗文字而非胶囊底（请假记录状态）。
    flat: { type: Boolean, value: false },
    hideDot: { type: Boolean, value: false },
    tagPlain: { type: Boolean, value: false },
  },
});
