import { cropRectangle, cropTarget, moveCrop } from '../../runtime/campaign-image-crop';
import { campaignImageSlot, type CampaignImageSlot } from '../../runtime/campaign-image';

interface CropState {
  generation: number; hidden: boolean; finished: boolean;
  canvas?: WechatMiniprogram.Canvas; image?: WechatMiniprogram.Image;
  touch?: { x: number; y: number };
}
const states = new WeakMap<object, CropState>();

Component({
  properties: { src: { type: String, value: '' }, imageSlot: { type: String, value: 'cover' } },
  data: {
    ready: false, busy: false, message: '', width: 200, height: 300, zoom: 1, x: .5, y: .5,
    preview: { src: '', width: 0, height: 0, left: 0, top: 0 },
  },
  lifetimes: {
    ready() {
      states.set(this, { generation: 0, hidden: false, finished: false });
      this.loadImage();
    },
    detached() { states.delete(this); },
  },
  pageLifetimes: {
    hide() {
      const state = states.get(this);
      if (!state) return;
      state.hidden = true; state.generation += 1; state.touch = undefined;
      this.setData({ busy: false });
    },
    show() {
      const state = states.get(this);
      if (!state) return;
      state.hidden = false;
      if (!this.data.ready && !state.finished) this.loadImage();
      else if (!state.finished) {
        const generation = state.generation;
        this.fitStage(() => { if (this.current(generation)) this.draw(); });
      }
    },
    resize() {
      const state = states.get(this);
      if (!state || state.hidden || state.finished) return;
      const generation = state.generation;
      this.fitStage(() => { if (this.current(generation)) this.draw(); });
    },
  },
  methods: {
    current(generation: number) {
      const state = states.get(this);
      return !!state && !state.hidden && !state.finished && state.generation === generation;
    },
    fitStage(onRendered?: () => void) {
      const info = wx.getWindowInfo();
      const target = cropTarget(this.data.imageSlot as CampaignImageSlot);
      const width = Math.max(60, Math.min(info.windowWidth - 48, (info.windowHeight - 280) * target.width / target.height));
      this.setData({ width, height: width * target.height / target.width }, onRendered);
    },
    loadImage() {
      const state = states.get(this);
      if (!state || state.hidden || state.finished || !campaignImageSlot(this.data.imageSlot)) return;
      const generation = ++state.generation;
      this.setData({ ready: false, busy: false, message: '', 'preview.src': '' });
      const fail = () => {
        if (this.current(generation)) this.setData({ ready: false, busy: false, message: '图片读取失败，请重试或取消' });
      };
      try {
        this.fitStage(() => {
          if (!this.current(generation)) return;
          try {
            wx.getImageInfo({ src: this.data.src, success: info => {
              if (!this.current(generation)) return;
              try {
                if (!['png', 'jpeg', 'jpg'].includes(info.type)) throw new Error('Invalid image type');
                cropRectangle(info.width, info.height, this.data.imageSlot as CampaignImageSlot, 1, .5, .5);
                this.createSelectorQuery().select('#campaign-crop-canvas').fields({ node: true }).exec(results => {
                  if (!this.current(generation)) return;
                  try {
                    const canvas: WechatMiniprogram.Canvas | undefined = results?.[0]?.node;
                    if (!canvas) throw new Error('Canvas unavailable');
                    const target = cropTarget(this.data.imageSlot as CampaignImageSlot);
                    canvas.width = target.width; canvas.height = target.height;
                    const image = canvas.createImage();
                    state.canvas = canvas; state.image = image;
                    image.onload = () => {
                      if (!this.current(generation)) return;
                      try {
                        cropRectangle(image.width, image.height, this.data.imageSlot as CampaignImageSlot, 1, .5, .5);
                        this.setData({ ready: true, zoom: 1, x: .5, y: .5 }, () => {
                          if (this.current(generation)) this.draw();
                        });
                      } catch { fail(); }
                    };
                    image.onerror = fail;
                    image.src = info.path;
                  } catch { fail(); }
                });
              } catch { fail(); }
            }, fail });
          } catch { fail(); }
        });
      } catch { fail(); }
    },
    draw() {
      const state = states.get(this);
      if (!state?.canvas || !state.image || state.hidden || state.finished || !this.data.ready) return;
      try {
        const { canvas, image } = state;
        const rect = cropRectangle(image.width, image.height, this.data.imageSlot as CampaignImageSlot,
          this.data.zoom, this.data.x, this.data.y);
        const scale = this.data.width / rect.width;
        this.setData({ preview: {
          src: image.src, width: image.width * scale, height: image.height * scale,
          left: -rect.x * scale, top: -rect.y * scale,
        } });
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
      } catch { this.setData({ ready: false, message: '图片绘制失败，请重试或取消' }); }
    },
    onPreviewError(event?: WechatMiniprogram.CustomEvent) {
      const state = states.get(this);
      const source = event?.currentTarget.dataset.source;
      if (!state || state.hidden || state.finished || !this.data.ready ||
        (source && source !== this.data.preview.src)) return;
      state.generation += 1;
      this.setData({ ready: false, busy: false, message: '图片读取失败，请重试或取消' });
    },
    canEdit() {
      const state = states.get(this);
      return !!state && !state.hidden && !state.finished && this.data.ready && !this.data.busy;
    },
    onTouchStart(event: WechatMiniprogram.TouchEvent) {
      if (!this.canEdit()) return;
      const touch = event.touches[0];
      if (touch) states.get(this)!.touch = { x: touch.clientX, y: touch.clientY };
    },
    onTouchMove(event: WechatMiniprogram.TouchEvent) {
      if (!this.canEdit()) return;
      const state = states.get(this)!, touch = event.touches[0], previous = state.touch;
      if (!previous || !touch || !state.image) return;
      const { image } = state;
      const rect = cropRectangle(image.width, image.height, this.data.imageSlot as CampaignImageSlot,
        this.data.zoom, this.data.x, this.data.y);
      this.setData(moveCrop(image.width, image.height, rect, this.data.width, this.data.x, this.data.y,
        touch.clientX - previous.x, touch.clientY - previous.y));
      state.touch = { x: touch.clientX, y: touch.clientY };
      this.draw();
    },
    onTouchEnd() { const state = states.get(this); if (state) state.touch = undefined; },
    onZoom(event: WechatMiniprogram.SliderChange) {
      if (!this.canEdit() || !Number.isFinite(event.detail.value)) return;
      this.setData({ zoom: Math.max(1, Math.min(4, event.detail.value)) }); this.draw();
    },
    onReset() {
      if (!this.canEdit()) return;
      this.setData({ zoom: 1, x: .5, y: .5 }); this.draw();
    },
    onCancel() {
      const state = states.get(this);
      if (!state || state.hidden || state.finished) return;
      state.finished = true; state.generation += 1;
      this.triggerEvent('cancel', { source: this.data.src });
    },
    onConfirm() {
      if (!this.canEdit()) return;
      const state = states.get(this)!;
      const generation = ++state.generation;
      const fail = () => {
        if (this.current(generation)) this.setData({ busy: false, message: '裁切未成功，请重试或取消' });
      };
      this.setData({ busy: true, message: '' });
      try {
        const target = cropTarget(this.data.imageSlot as CampaignImageSlot);
        wx.canvasToTempFilePath({
          canvas: state.canvas, x: 0, y: 0, width: target.width, height: target.height,
          destWidth: target.width, destHeight: target.height, fileType: 'jpg', quality: .92,
          success: ({ tempFilePath }) => {
            if (!this.current(generation)) return;
            try {
              wx.getFileSystemManager().getFileInfo({ filePath: tempFilePath, success: ({ size }) => {
                if (!this.current(generation)) return;
                if (!Number.isFinite(size) || size <= 0 || size > 3145728) { fail(); return; }
                state.finished = true;
                this.triggerEvent('confirm', { source: this.data.src, slot: this.data.imageSlot, path: tempFilePath });
              }, fail });
            } catch { fail(); }
          }, fail,
        }, this);
      } catch { fail(); }
    },
  },
});
