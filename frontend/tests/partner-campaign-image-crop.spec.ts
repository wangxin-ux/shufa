import { cropRectangle, cropTarget, moveCrop } from '../pages/partner/runtime/campaign-image-crop';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('campaign crop coordinates', () => {
  it('centres a landscape photo into the exact cover and share proportions', () => {
    expect(cropTarget('cover')).toEqual({ width: 750, height: 1125 });
    expect(cropTarget('share')).toEqual({ width: 800, height: 600 });
    const cover = cropRectangle(1200, 800, 'cover', 1, .5, .5);
    expect(cover.x).toBeCloseTo((1200 - 800 * 2 / 3) / 2);
    expect(cover.width).toBeCloseTo(800 * 2 / 3);
    expect(cover).toMatchObject({ y: 0, height: 800 });
    const share = cropRectangle(1200, 800, 'share', 1, 1, 1);
    expect(share.x).toBeCloseTo(1200 - 800 * 4 / 3);
    expect(share.width).toBeCloseTo(800 * 4 / 3);
    expect(share).toMatchObject({ y: 0, height: 800 });
  });
  it('clamps zoom and movement to avoid blank edges on portrait, square and tiny sources', () => {
    for (const [width, height] of [[800, 1200], [1, 1], [2400, 1800], [4000, 4000]]) {
      for (const slot of ['cover', 'share'] as const) {
        const rect = cropRectangle(width, height, slot, 100, -20, 50);
        expect(rect.x).toBe(0);
        expect(rect.y + rect.height).toBeCloseTo(height);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
        expect(rect.width / rect.height).toBeCloseTo(cropTarget(slot).width / cropTarget(slot).height);
        expect(rect.width).toBeGreaterThan(0);
      }
    }
  });
  it('moves with the finger and leaves a dimension that already fits centred', () => {
    const rectangle = cropRectangle(1200, 800, 'share', 1, .5, .5);
    expect(moveCrop(1200, 800, rectangle, 320, .5, .5, 10000, -10000)).toEqual({ x: 0, y: .5 });
  });
  it.each([[0, 100], [100, NaN], [Infinity, 2], [6000, 6000], [4001, 4000]])(
    'rejects invalid or excessive decoded dimensions (%s,%s)', (width, height) => {
      expect(() => cropRectangle(width, height, 'cover', 1, .5, .5)).toThrow();
    },
  );
});

describe('native crop component output and cancellation', () => {
  let definition: any, component: any, native: any, canvas: any, image: any, context: any;
  let query: any;
  beforeEach(() => {
    context = { fillStyle: '', fillRect: jest.fn(), drawImage: jest.fn() };
    image = { width: 1200, height: 800, src: '' };
    canvas = { width: 0, height: 0, getContext: () => context, createImage: () => image };
    query = { select: () => query, fields: () => query, exec: jest.fn((cb: any) => cb([{ node: canvas }])) };
    native = {
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 680 }),
      getImageInfo: jest.fn((v: any) => v.success({ path: 'local-source', type: 'png', width: 1200, height: 800 })),
      canvasToTempFilePath: jest.fn((v: any) => v.success({ tempFilePath: 'wxfile://cropped.jpg' })),
      getFileInfo: jest.fn((v: any) => v.success({ size: 100000 })),
    };
    native.getFileSystemManager = () => native;
    (global as any).wx = native;
    (global as any).Component = (value: any) => {
      definition = value;
      component = {
        ...value.methods, data: { ...structuredClone(value.data),
          ...Object.fromEntries(Object.entries(value.properties).map(([key, property]: [string, any]) => [key, property.value])),
          src: 'original', imageSlot: 'cover' },
        setData(patch: object, callback?: () => void) { Object.assign(this.data, patch); callback?.(); },
        createSelectorQuery: () => query, triggerEvent: jest.fn(),
      };
    };
    jest.isolateModules(() => require('../pages/partner/components/campaign-image-crop/index'));
    definition.lifetimes.ready.call(component);
    image.onload();
  });
  afterEach(() => {
    definition?.lifetimes.detached.call(component);
    delete (global as any).wx; delete (global as any).Component;
  });
  it('draws the actual cropped image and exports an exact bounded JPEG only on confirmation', () => {
    expect(canvas).toMatchObject({ width: 750, height: 1125 });
    const args = context.drawImage.mock.calls.at(-1);
    expect(args[0]).toBe(image);
    expect(args[1]).toBeCloseTo((1200 - 800 * 2 / 3) / 2);
    expect(args[3]).toBeCloseTo(800 * 2 / 3);
    expect(args.slice(4)).toEqual([800, 0, 0, 750, 1125]);
    expect(native.canvasToTempFilePath).not.toHaveBeenCalled();
    component.onZoom({ detail: { value: 2 } });
    component.onConfirm(); component.onConfirm();
    expect(native.canvasToTempFilePath).toHaveBeenCalledTimes(1);
    expect(native.canvasToTempFilePath.mock.calls[0][0]).toMatchObject({
      canvas, width: 750, height: 1125, destWidth: 750, destHeight: 1125, fileType: 'jpg',
    });
    expect(component.triggerEvent).toHaveBeenCalledWith('confirm', {
      source: 'original', slot: 'cover', path: 'wxfile://cropped.jpg',
    });
  });
  it('waits for rendered crop dimensions and ready controls before the first draw', () => {
    const rendered: Array<() => void> = [];
    component.setData = (patch: object, callback?: () => void) => {
      Object.assign(component.data, patch);
      if (callback) rendered.push(callback);
    };
    native.getImageInfo.mockClear();
    context.drawImage.mockClear();
    component.loadImage();
    expect(native.getImageInfo).not.toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(rendered).toHaveLength(1);
    rendered.shift()!();
    expect(native.getImageInfo).toHaveBeenCalledTimes(1);
    image.onload();
    expect(component.data.ready).toBe(true);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(rendered).toHaveLength(1);
    rendered.shift()!();
    expect(context.drawImage).toHaveBeenCalledTimes(1);
  });
  it.each(['cover', 'share'] as const)('projects the visible %s image to the same rectangle as the exported canvas', slot => {
    component.data.imageSlot = slot;
    component.loadImage(); image.onload();
    const expectMatchingPreview = () => {
      expect(component.data.preview).toMatchObject({ src: 'local-source' });
      const preview = component.data.preview;
      const [, sx, sy, sw, sh] = context.drawImage.mock.calls.at(-1);
      expect(-preview.left / preview.width * image.width).toBeCloseTo(sx);
      expect(-preview.top / preview.height * image.height).toBeCloseTo(sy);
      expect(component.data.width / preview.width * image.width).toBeCloseTo(sw);
      expect(component.data.height / preview.height * image.height).toBeCloseTo(sh);
    };
    expectMatchingPreview();
    component.onZoom({ detail: { value: 2.35 } });
    component.onTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
    component.onTouchMove({ touches: [{ clientX: 142, clientY: 72 }] });
    expectMatchingPreview();
    native.getWindowInfo = () => ({ windowWidth: 430, windowHeight: 932 });
    definition.pageLifetimes.resize.call(component);
    expectMatchingPreview();
    component.onReset();
    expectMatchingPreview();
  });
  it('recovers a first frame interrupted by hiding before its rendered callback', () => {
    const rendered: Array<() => void> = [];
    component.setData = (patch: object, callback?: () => void) => {
      Object.assign(component.data, patch);
      if (callback) rendered.push(callback);
    };
    context.drawImage.mockClear();
    component.loadImage();
    rendered.shift()!();
    image.onload();
    definition.pageLifetimes.hide.call(component);
    rendered.shift()!();
    expect(context.drawImage).not.toHaveBeenCalled();
    definition.pageLifetimes.show.call(component);
    expect(rendered).toHaveLength(1);
    rendered.shift()!();
    expect(context.drawImage).toHaveBeenCalledTimes(1);
  });
  it('restores the visible crop after returning without resetting zoom or movement', () => {
    component.onZoom({ detail: { value: 2.5 } });
    component.onTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
    component.onTouchMove({ touches: [{ clientX: 117, clientY: 86 }] });
    const position = { zoom: component.data.zoom, x: component.data.x, y: component.data.y };
    context.drawImage.mockClear();
    definition.pageLifetimes.hide.call(component);
    definition.pageLifetimes.show.call(component);
    expect(component.data).toMatchObject(position);
    expect(context.drawImage).toHaveBeenCalledTimes(1);
  });
  it('blocks confirmation when the visible image cannot render', () => {
    expect(typeof component.onPreviewError).toBe('function');
    component.onPreviewError();
    component.onConfirm();
    expect(component.data.ready).toBe(false);
    expect(component.data.message).not.toBe('');
    expect(native.canvasToTempFilePath).not.toHaveBeenCalled();
  });
  it('discards a pending export if the visible image fails to render', () => {
    let complete!: (v: any) => void;
    native.canvasToTempFilePath.mockImplementationOnce((v: any) => { complete = v.success; });
    component.onConfirm();
    component.onPreviewError();
    complete({ tempFilePath: 'unseen-image.jpg' });
    expect(component.data).toMatchObject({ ready: false, busy: false });
    expect(component.triggerEvent).not.toHaveBeenCalled();
  });
  it('uses a clipped image for the visible crop and an offscreen canvas for export', () => {
    const template = readFileSync(join(__dirname, '../pages/partner/components/campaign-image-crop/index.wxml'), 'utf8');
    const styles = readFileSync(join(__dirname, '../pages/partner/components/campaign-image-crop/index.wxss'), 'utf8');
    expect(template).toMatch(/<image\b[^>]*id="campaign-crop-preview"/);
    expect(template).toContain('catchtouchstart="onTouchStart"');
    expect(styles).toMatch(/\.crop__viewport\s*\{[^}]*overflow:\s*hidden/);
    expect(styles).toMatch(/\.crop__canvas\s*\{[^}]*left:\s*-9999px/);
  });
  it.each(['hide', 'cancel', 'detach'])('ignores pending first-draw callbacks after %s', phase => {
    const rendered: Array<() => void> = [];
    component.setData = (patch: object, callback?: () => void) => {
      Object.assign(component.data, patch);
      if (callback) rendered.push(callback);
    };
    context.drawImage.mockClear();
    component.loadImage();
    expect(rendered).toHaveLength(1);
    rendered.shift()!();
    image.onload();
    expect(rendered).toHaveLength(1);
    if (phase === 'hide') definition.pageLifetimes.hide.call(component);
    else if (phase === 'cancel') component.onCancel();
    else definition.lifetimes.detached.call(component);
    rendered.shift()!();
    expect(context.drawImage).not.toHaveBeenCalled();
  });
  it('passes the image purpose without using the native reserved slot attribute', () => {
    expect(definition.properties.slot).toBeUndefined();
    expect(definition.properties.imageSlot).toBeDefined();
    const template = readFileSync(join(__dirname, '../pages/partner/campaign-editor/index.wxml'), 'utf8');
    expect(template).toContain('image-slot="{{imageCropSlot}}"');
  });
  it('cancels without exporting and ignores a delayed image result after detaching', () => {
    component.onCancel();
    expect(component.triggerEvent).toHaveBeenCalledWith('cancel', { source: 'original' });
    expect(native.canvasToTempFilePath).not.toHaveBeenCalled();
    definition.lifetimes.detached.call(component);
    image.onload();
    component.onConfirm();
    expect(native.canvasToTempFilePath).not.toHaveBeenCalled();
  });
  it('drags without exposing a blank edge, resets and exports the share ratio', () => {
    component.onTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
    component.onTouchMove({ touches: [{ clientX: 10000, clientY: 100 }] });
    expect(component.data.x).toBe(0);
    component.onReset();
    expect(component.data).toMatchObject({ x: .5, y: .5, zoom: 1 });
    component.data.imageSlot = 'share';
    component.loadImage(); image.onload();
    component.onZoom({ detail: { value: 3 } });
    component.onConfirm();
    expect(native.canvasToTempFilePath.mock.calls.at(-1)[0]).toMatchObject({
      width: 800, height: 600, destWidth: 800, destHeight: 600,
    });
  });
  it.each(['export', 'oversize', 'file-info'])('keeps the crop editable after %s failure', failure => {
    if (failure === 'export') native.canvasToTempFilePath.mockImplementationOnce((v: any) => v.fail({}));
    if (failure === 'oversize') native.getFileInfo.mockImplementationOnce((v: any) => v.success({ size: 3145729 }));
    if (failure === 'file-info') native.getFileInfo.mockImplementationOnce((v: any) => v.fail({}));
    component.onConfirm();
    expect(component.data.busy).toBe(false);
    expect(component.data.message).not.toBe('');
    expect(component.triggerEvent).not.toHaveBeenCalled();
    component.onConfirm();
    expect(component.triggerEvent).toHaveBeenCalledTimes(1);
  });
  it('ignores an export reply while hidden and can retry on return', () => {
    let complete!: (v: any) => void;
    native.canvasToTempFilePath.mockImplementationOnce((v: any) => { complete = v.success; });
    component.onConfirm();
    definition.pageLifetimes.hide.call(component);
    complete({ tempFilePath: 'old-hidden-file' });
    expect(component.triggerEvent).not.toHaveBeenCalled();
    definition.pageLifetimes.show.call(component);
    component.onConfirm();
    expect(component.triggerEvent).toHaveBeenCalledWith('confirm', expect.objectContaining({ path: 'wxfile://cropped.jpg' }));
  });
  it.each(['export', 'file-info'])('cancels during %s and ignores its delayed reply', phase => {
    let finish!: (v: any) => void;
    if (phase === 'export') native.canvasToTempFilePath.mockImplementationOnce((v: any) => { finish = v.success; });
    else native.getFileInfo.mockImplementationOnce((v: any) => { finish = v.success; });
    component.onConfirm();
    component.onCancel();
    finish(phase === 'export' ? { tempFilePath: 'cancelled.jpg' } : { size: 1000 });
    expect(component.triggerEvent.mock.calls).toEqual([['cancel', { source: 'original' }]]);
  });
});
