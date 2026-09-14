Component({
  properties: {
    actionKey: { type: String, value: '' },
    label: { type: String, value: '' },
    description: { type: String, value: '' },
    icon: { type: String, value: '' },
    commandLabel: { type: String, value: '' },
    bullet: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    onTap() {
      if (this.data.disabled) {
        return;
      }
      this.triggerEvent('action', { key: this.data.actionKey });
    },
  },
});
