import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const round = (value) => Math.round(value * 1e6) / 1e6;
const eventData = (report, label) => {
  const event = report.events.find((item) => item.label === label);
  if (!event?.response?.ok || event.response.result.success !== true) {
    throw new Error(`Missing successful ${label}`);
  }
  return event.response.result.result.result;
};

export function nativeBounds(node, capture) {
  const width = capture.window?.windowWidth;
  if (!Number.isFinite(width) || width <= 0) throw new Error('Invalid window width');
  if (!node) return null;
  const values = [node.left, node.top + (capture.viewport?.scrollTop ?? 0), node.width, node.height];
  if (!values.every(Number.isFinite) || node.width <= 0 || node.height <= 0) return null;
  return values.map((value) => round(value * 750 / width));
}

const mappings = [
  ['page-circle', 84, '.home-shell >>> .page-mark__circle', 'shape-frame'],
  ['page-icon', 85, '.home-shell >>> .page-mark__icon', 'clipped-image-not-native-ink'],
  ['page-title', 92, '.home-shell >>> .page-mark__title', 'cached-text-not-native-ink'],
  ['wave', 76, '.home-shell >>> .shell__wave', 'vector-plane-not-export-frame'],
  ['course-title', 30, '.course__title', 'cached-text-not-native-ink'],
  ['course-more', 38, '.course__more', 'shape-frame'],
  ['course-day', 31, '.course__day', 'cached-text-not-native-ink'],
  ['course-weekday', 32, '.course__weekday', 'cached-text-not-native-ink'],
  ['course-campus', 33, '.course__campus', 'cached-text-not-native-ink'],
  ['course-name', 36, '.course__name', 'cached-text-not-native-ink'],
  ['course-time', 35, '.course__time', 'cached-text-not-native-ink'],
  ['course-divider', 37, '.course__divider', 'shape-frame'],
  ['mascot', 527, '.stage__mascot', 'raw-image-plane-not-export-frame'],
  ['student-name', 82, '.stage__student-name', 'cached-text-not-native-ink'],
  ['student-age', 82, '.stage__student-age', 'cached-combined-text-not-native-ink'],
  ['metric-frame', 11, '.stage__metrics', 'shape-frame'],
  ['metric-glass', 528, '.stage__metrics >>> .metric-card__glass', 'clipped-image-not-native-ink'],
  ['metric-divider-1', 12, '.stage__metrics >>> .metric-card__divider', 'shape-frame', 0],
  ['metric-divider-2', 13, '.stage__metrics >>> .metric-card__divider', 'shape-frame', 1],
  ['nav-capsule', 59, '.quickbar__capsule', 'shape-frame'],
  ['nav-reminder', 49, '.quickbar__remind', 'shape-frame'],
  ['nav-reminder-icon', 51, '.quickbar__remind-icon', 'image-frame-not-native-ink'],
  ['nav-reminder-label', 50, '.quickbar__remind-label', 'cached-text-not-native-ink'],
  ['nav-more', 71, '.quickbar__more', 'shape-frame'],
];
for (const [index, labelId, valueId, subId] of [[0, 16, 17, 15], [1, 21, 22, 20], [2, 26, 27, 25]]) {
  for (const [kind, id] of [['label', labelId], ['value', valueId], ['unit', valueId], ['sub', subId]]) {
    mappings.push([`metric-${index + 1}-${kind}`, id,
      `.stage__metrics >>> .metric-card__${kind}`, 'cached-text-not-native-ink', index]);
  }
}
for (const [index, key, iconId, textId] of [[0, 'leave', 56, 55], [1, 'hours', 61, 60], [2, 'team', 66, 65]]) {
  mappings.push([`nav-${key}-icon`, iconId, '.quickbar__icon', 'image-frame-not-native-ink', index]);
  mappings.push([`nav-${key}-label`, textId, '.quickbar__label', 'cached-text-not-native-ink', index]);
}

export function measureAnchors(geometry, report) {
  if (report.failure) throw new Error('Cannot measure failed capture');
  const page = geometry.pages.find((item) => item.role === 'parent' && item.page === 'P1');
  if (!page) throw new Error('Missing source P1');
  const standard = eventData(report, 'nodes:source-standard-top');
  const menu = eventData(report, 'nodes:source-standard-menu');
  for (const capture of [standard, menu]) {
    if (capture.route !== 'pages/parent/home/index' || capture.viewState !== 'ready') {
      throw new Error('Expected ready home route');
    }
  }
  if (!menu.menuExpanded || menu.activeSheet) throw new Error('Expected expanded menu without sheet');
  const restored = eventData(report, 'restore-original-reader-and-home');
  if (restored.viewState !== 'ready' || !['runtimeUnchanged', 'readerRestored', 'studentRestored',
    'courseRestored', 'metricsRestored', 'timerRestored', 'markerRemoved'].every((key) => restored[key])) {
    throw new Error('Incomplete original restoration');
  }
  const anchors = mappings.map(([key, layerId, selector, basis, index]) => {
    const layer = page.layers.find((item) => item.layerId === layerId);
    if (!layer?.visibleEffective) throw new Error(`Missing visible source layer ${layerId}`);
    const capture = key.startsWith('nav-') ? menu : standard;
    const value = capture.nodes[selector];
    const node = index === undefined ? value : value?.[index];
    const bounds = nativeBounds(node, capture);
    return {
      key, layerId, selector, nativeIndex: index ?? null, basis,
      sourceBoundsRpx: layer.bounds.rpx,
      nativeBoundsRpx: bounds,
      frameDeltaRpx: basis === 'shape-frame' && bounds
        ? bounds.map((value, i) => round(value - layer.bounds.rpx[i])) : null,
      status: bounds ? 'measured-not-accepted' : 'missing-native-node',
      material: {
        opacity255: layer.opacity255, clipping: layer.clipping,
        rasterMask: layer.hasRasterMask, vectorMask: layer.hasVectorMask, effects: layer.effects,
      },
      nativeStyle: node ? Object.fromEntries(Object.entries(node)
        .filter(([field]) => field.includes('-') || field === 'filter')) : null,
    };
  });
  const byKey = (key) => anchors.find((item) => item.key === key);
  const gaps = [['metric-to-reminder', 'metric-frame', 'nav-reminder'],
    ['metric-to-capsule', 'metric-frame', 'nav-capsule']].map(([key, from, to]) => {
    const a = byKey(from), b = byKey(to);
    const source = b.sourceBoundsRpx[1] - a.sourceBoundsRpx[1] - a.sourceBoundsRpx[3];
    const native = a.nativeBoundsRpx && b.nativeBoundsRpx
      ? b.nativeBoundsRpx[1] - a.nativeBoundsRpx[1] - a.nativeBoundsRpx[3] : null;
    return { key, sourceRpx: round(source), nativeRpx: native === null ? null : round(native),
      deltaRpx: native === null ? null : round(native - source) };
  });
  return {
    schemaVersion: 1, page: 'parent/P1', acceptance: 'diagnostic-only',
    coordinates: 'Native px scaled by actual windowWidth; scroll offset retained; no fitted translation',
    source: geometry.sources.find((item) => item.role === 'parent' && item.version === 'new'),
    window: standard.window, anchors, gaps,
    pending: [
      'Text ink and native line boxes are not interchangeable; source caches remain references only.',
      'Image alpha, clipping mask and shadow composite require separate source/render provenance.',
      'Native chrome offset and approved common controls are not automatic acceptance or repair decisions.',
      standard.window.windowWidth === 375
        ? '390/430, real API, font fallback and broader glyphs remain outside this diagnostic.'
        : 'Other viewport widths, real API, font fallback and broader glyphs remain outside this diagnostic.',
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  if (!name || !/^runtime-(375|390|430)-(anchors-)?v\d+$/.test(name)) {
    throw new Error('Expected bounded evidence name');
  }
  const directory = path.join(root, 'docs/verification/parent-home-font-2026-10-11', name);
  const geometry = JSON.parse(fs.readFileSync(path.join(root,
    'docs/verification/ui-source-geometry-2026-10-10/psd-geometry-v2.json'), 'utf8'));
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'runtime.json'), 'utf8'));
  const result = measureAnchors(geometry, report);
  fs.writeFileSync(path.join(directory, 'semantic-anchors.json'), `${JSON.stringify(result, null, 2)}\n`,
    { flag: 'wx' });
  console.log(`${result.anchors.length} source mappings; ${result.anchors.filter((item) =>
    item.nativeBoundsRpx).length} native frames; diagnostic only`);
}
