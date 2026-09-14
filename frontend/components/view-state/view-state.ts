Component({
  properties: {
    state: { type: String, value: 'loading' },
    loadingText: { type: String, value: '加载中…' },
    emptyText: { type: String, value: '暂无数据' },
    errorText: { type: String, value: '加载失败，请重试' },
    retryText: { type: String, value: '重新加载' },
    variant: { type: String, value: '' },
  },
  methods: {
    onRetry() {
      this.triggerEvent('retry');
    },
  },
});
