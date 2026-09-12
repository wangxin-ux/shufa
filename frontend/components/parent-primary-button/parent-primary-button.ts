Component({
  properties: {
    text: { type: String, value: '' },
    topText: { type: String, value: '' },
    bottomText: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
    // 视觉变体：'' 默认橙底；deep 深橙（课时页“立即续费”）。
    theme: { type: String, value: '' },
  },
  methods: {
    onTap() {
      if (!this.data.disabled) {
        this.triggerEvent('tap');
      }
    },
  },
});
