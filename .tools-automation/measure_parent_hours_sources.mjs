import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { nativeBounds } from './measure_parent_home_anchors.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = 'docs/verification/parent-hours-source-2026-10-12';
const geometryPath = 'docs/verification/ui-source-geometry-2026-10-10/psd-geometry-v2.json';
const sourceHash = '8C77A483A852E3F1D252D02FE24B3EC49FDC09820AC658A779A23E6245FD4EE4';
const round = (number) => Math.round(number * 1e6) / 1e6;
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const digest = (relative) => createHash('sha256').update(fs.readFileSync(path.join(root, relative)))
  .digest('hex').toUpperCase();
const textBasis = 'cached-text-vs-native-line-frame';
const mappings = [
  ['page-circle', 165, '.hours-shell >>> .page-mark__circle', 'shape', 'approved-common-control'],
  ['page-icon', 166, '.hours-shell >>> .page-mark__icon', 'pixel', 'raw-oversized-plane-vs-exported-icon'],
  ['page-title', 172, '.hours-shell >>> .page-mark__title', 'type', textBasis],
  ['account-title', 123, '.hours__title', 'type', textBasis],
  ['balance-frame', 104, '.balance-card', 'shape', 'nominal-shape-frame'],
  ['balance-label', 110, '.balance-card__label', 'type', textBasis],
  ['balance-number', 111, '.balance-card__value', 'type', textBasis],
  ['balance-unit', 111, '.balance-card__unit', 'type', textBasis],
  ['balance-meta', 109, '.balance-card__meta', 'type', 'cached-single-line-vs-two-native-rows'],
  ['fee-label', 109, '.balance-card__meta-label', 'type', textBasis, 0],
  ['fee-value', 109, '.balance-card__meta-value', 'type', textBasis, 0],
  ['validity-label', 109, '.balance-card__meta-label', 'type', textBasis, 1],
  ['validity-value', 109, '.balance-card__meta-value', 'type', textBasis, 1],
  ['balance-mascot-frame', 530, '.balance-card__mascot-frame', 'pixel', 'source-cache-vs-clipping-frame'],
  ['balance-mascot-image', 530, '.balance-card__mascot', 'pixel', 'source-cache-vs-full-widthFix-image'],
  ['renew-circle', 233, '.balance-card__renew >>> .primary-btn', 'shape', 'approved-common-control'],
  ['renew-first-line', 235, '.balance-card__renew >>> .primary-btn__line', 'type', textBasis, 0],
  ['renew-second-line', 235, '.balance-card__renew >>> .primary-btn__line', 'type', textBasis, 1],
  ['cards-row', 201, '.hour-cards', 'group', 'group-cache-vs-native-flex-frame'],
];
for (const [index, key, shape, label, number, sub] of [
  [0, 'paid', 190, 186, 184, 188], [1, 'gift', 195, 197, 196, 198],
]) {
  for (const [suffix, id, selector, kind, basis] of [
    ['frame', shape, '.hour-card', 'shape', 'nominal-shape-frame'],
    ['label', label, '.hour-card__label', 'type', textBasis],
    ['number', number, '.hour-card__value', 'type', textBasis],
    ['unit', number, '.hour-card__unit', 'type', textBasis],
    ['remaining', sub, '.hour-card__sub', 'type', textBasis],
  ]) mappings.push([`${key}-${suffix}`, id, selector, kind, basis, index]);
}
mappings.push(
  ['cards-plus', 200, '.hour-cards__plus', 'type', textBasis],
  ['ledger-title', 231, '.ledger__title', 'type', textBasis],
  ['ledger-filter', 205, '.ledger__filter-toggle', 'type', 'cached-text-vs-padded-button-frame'],
  ['ledger-panel', 206, '.ledger__panel', 'shape', 'dynamic-panel-vs-nominal-shape'],
  ['ledger-full-mascot', 532, '.ledger__mascot', 'pixel', 'raw-plane-vs-full-widthFix-image'],
  ['ledger-dim-mascot', 531, '.ledger__mascot', 'pixel', 'separate-dim-plane-vs-native-panel-composition'],
  ['ledger-divider-1', 213, '.ledger__divider', 'shape', 'nominal-shape-frame', 0],
  ['ledger-divider-2', 221, '.ledger__divider', 'shape', 'nominal-shape-frame', 1],
);
for (const [index, group, title, sub, dot, tag, delta] of [
  [0, 214, 211, 209, 212, 208, 210],
  [1, 222, 219, 217, 220, 216, 218],
  [2, 229, 227, 225, 228, 224, 226],
]) {
  for (const [key, id, suffix, kind, basis] of [
    ['row', group, '', 'group', 'positional-group-cache-vs-native-row'],
    ['title', title, '__title', 'type', textBasis],
    ['subtitle', sub, '__subtitle', 'type', textBasis],
    ['dot', dot, '__dot', 'type', 'cached-dot-glyph-vs-native-circle'],
    ['tag', tag, '__tag', 'shape', 'dynamic-tag-vs-nominal-shape'],
    ['delta', delta, '__tag', 'type', 'cached-delta-text-vs-padded-tag-frame'],
  ]) mappings.push([`ledger-${index + 1}-${key}`, id,
    `.ledger__panel >>> .record-card${suffix}`, kind, basis, index]);
}

const selectors = [
  '.hours', '.hours__title', '.balance-card', '.balance-card__label',
  '.balance-card__value-row', '.balance-card__value', '.balance-card__unit',
  '.balance-card__meta', '.balance-card__meta-label', '.balance-card__meta-value',
  '.balance-card__mascot-frame', '.balance-card__mascot', '.balance-card__renew',
  '.balance-card__renew >>> .primary-btn', '.balance-card__renew >>> .primary-btn__line',
  '.hour-cards', '.hour-card', '.hour-card__label', '.hour-card__value-row',
  '.hour-card__value', '.hour-card__unit', '.hour-card__sub', '.hour-cards__plus',
  '.ledger', '.ledger__title', '.ledger__filter-toggle', '.ledger__card', '.ledger__panel',
  '.ledger__mascot', '.ledger__divider', '.ledger__panel >>> .record-card',
  '.ledger__panel >>> .record-card__dot', '.ledger__panel >>> .record-card__title',
  '.ledger__panel >>> .record-card__subtitle', '.ledger__panel >>> .record-card__tag',
  '.hours-shell >>> .page-mark__circle', '.hours-shell >>> .page-mark__icon',
  '.hours-shell >>> .page-mark__title',
];
const counts = [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 2, 1, 2, 2, 2,
  2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 3, 3, 3, 1, 1, 1];
const inputPaths = [
  'frontend/app.wxss', 'frontend/pages/parent/hours/index.ts',
  'frontend/pages/parent/hours/index.wxml', 'frontend/pages/parent/hours/index.wxss',
  'frontend/pages/parent/styles/pdf-typography.wxss', 'frontend/styles/parent-pdf.wxss',
  'frontend/styles/tokens.wxss',
  ...['parent-page-shell', 'parent-page-mark', 'parent-primary-button', 'parent-record-card']
    .flatMap((name) => ['ts', 'wxml', 'wxss'].map((ext) => `frontend/components/${name}/${name}.${ext}`)),
  'frontend/services/parent-hours.presenter.ts', 'frontend/services/parent-runtime.ts',
  'frontend/pages/parent/runtime/parent-pdf-font.ts',
  'frontend/pages/parent/assets/fonts/pdf-display-font.ts',
  'frontend/pages/parent/assets/fonts/pdf-display-subset.woff',
  'frontend/pages/parent/assets/hours-mascot.png',
  'frontend/pages/parent/assets/hours-ledger-mascot.png',
  'frontend/pages/parent/assets/icon-mark-hours.png',
  '.tools-automation/verify_parent_hours_sources.ps1',
];

export function verifyRuntimeInputs(report, getDigest) {
  if (!Array.isArray(report.inputs) || report.inputs.length !== inputPaths.length
    || new Set(report.inputs.map((input) => input.path)).size !== inputPaths.length) {
    throw new Error('Runtime input set is incomplete or duplicated');
  }
  for (const input of report.inputs) {
    if (!inputPaths.includes(input.path) || !/^[A-F0-9]{64}$/.test(input.sha256)
      || (getDigest && getDigest(input.path) !== input.sha256)) {
      throw new Error(`Runtime input changed or invalid: ${input.path}`);
    }
  }
}

export function measureSources(geometry, report) {
  if (report.failure) throw new Error('Cannot measure failed capture');
  verifyRuntimeInputs(report);
  const pages = geometry.pages.filter((entry) => entry.role === 'parent' && entry.page === 'P3');
  const page = pages[0];
  if (pages.length !== 1 || page.stackIndex !== 1
    || JSON.stringify(page.bboxDocumentPx) !== '[1225,0,2350,2436]'
    || JSON.stringify(page.sizeRpx) !== '[750,1624]') throw new Error('Source artboard mismatch');
  const sources = geometry.sources.filter((entry) => entry.role === 'parent' && entry.version === 'new');
  if (sources.length !== 1 || sources[0].sha256 !== sourceHash) throw new Error('Source identity mismatch');
  if (new Set(page.layers.map((entry) => entry.layerId)).size !== page.layers.length) {
    throw new Error('Source layer duplicate');
  }
  const labels = ['original-home-baseline', 'navigate-hours', 'load-original-hours-and-font', 'scroll-top',
    'nodes:standard-top', 'screenshot:standard-top', 'scroll-bottom', 'nodes:standard-bottom',
    'screenshot:standard-bottom', 'restoration-owned-baseline', 'restoration-navigation-state', 'return-original-home',
    'original-home-restored', 'verification-marker-removed', 'nodes:restored-parent-home',
    'screenshot:restored-parent-home'];
  if (report.events.length !== labels.length
    || report.events.some((event, index) => event.label !== labels[index]
      || event.response?.ok !== true || event.response.result?.success !== true)) {
    throw new Error('Capture event missing, duplicated, failed or out of order');
  }
  const eventData = (label) => report.events.find((event) => event.label === label).response.result.result.result;
  const original = eventData('original-home-baseline'), restored = eventData('original-home-restored');
  const ownership = eventData('restoration-owned-baseline');
  const cleanup = eventData('verification-marker-removed');
  const restoredNodes = eventData('nodes:restored-parent-home');
  if (original.route !== 'pages/parent/home/index' || original.viewState !== 'ready'
    || original.driver !== 'mock' || original.appid !== 'wx7322535713ec37e0'
    || original.window.windowWidth !== report.expectedWidth
    || !/^[a-f0-9]{32}$/.test(original.owner) || ownership.ownedBaseline !== true
    || ownership.owner !== original.owner || cleanup.owner !== original.owner
    || !['sameHome', 'timerRunning', 'readerUnchanged', 'runtimeUnchanged']
      .every((key) => restored[key] === true)
    || restored.viewState !== 'ready' || cleanup.markerRemoved !== true
    || restoredNodes.route !== original.route || restoredNodes.viewState !== 'ready') {
    throw new Error('Incomplete original home restoration');
  }
  if (eventData('load-original-hours-and-font').fontLoaded !== true) throw new Error('Capture event font failed');
  const captures = ['nodes:standard-top', 'nodes:standard-bottom'].map(eventData);
  const frame = (capture, node) => nativeBounds(node,
    { window: capture.window, viewport: capture.nodes[capture.selectors.length] });
  const select = (capture, selector, index = 0) => capture.nodes[capture.selectors.indexOf(selector)][index];
  for (const capture of captures) {
    if (![375, 390, 430].includes(report.expectedWidth)
      || capture.route !== 'pages/parent/hours/index' || capture.viewState !== 'ready'
      || capture.window.windowWidth !== report.expectedWidth || capture.balance !== 37
      || capture.cards?.length !== 2 || capture.cards[0].grantedLabel !== '48'
      || capture.cards[1].grantedLabel !== '12' || capture.entries?.length !== 3) {
      throw new Error('Expected standard Mock P3 route, state, width and facts');
    }
    if (capture.selectors.length !== selectors.length || new Set(capture.selectors).size !== selectors.length
      || !selectors.every((selector) => capture.selectors.includes(selector))
      || capture.nodes.length !== selectors.length + 1) throw new Error('Native selector set mismatch');
    const viewport = capture.nodes[capture.selectors.length];
    if (!Number.isFinite(viewport?.scrollTop) || viewport.scrollTop < 0
      || viewport.width !== capture.window.windowWidth) throw new Error('Native frame viewport invalid');
    selectors.forEach((selector, index) => {
      const nodes = capture.nodes[capture.selectors.indexOf(selector)];
      if (!Array.isArray(nodes) || nodes.length !== counts[index]) {
        throw new Error(`Native selector cardinality mismatch: ${selector}`);
      }
      if (nodes.some((node) => !frame(capture, node))) throw new Error(`Native frame invalid: ${selector}`);
    });
  }
  const anchors = mappings.map(([key, layerId, selector, kind, comparisonBasis, index = 0]) => {
    const layer = page.layers.find((entry) => entry.layerId === layerId);
    if (!layer?.visibleEffective || layer.kind !== kind || layer.bounds.rpx.length !== 4
      || !layer.bounds.rpx.every(Number.isFinite) || Math.min(...layer.bounds.rpx.slice(2)) <= 0) {
      throw new Error(`Source layer missing, hidden, invalid or wrong kind: ${layerId}`);
    }
    const node = select(captures[0], selector, index), native = frame(captures[0], node);
    const runs = layer.text?.runs.map(({ font, fontSizeVerticalRpx, leadingVerticalRpx }) =>
      ({ font, fontSizeVerticalRpx, leadingVerticalRpx }));
    return {
      key, layerId, selector, nodeIndex: index, comparisonBasis, status: 'measured-not-accepted',
      source: { path: layer.path, kind, boundsRpx: layer.bounds.rpx, opacity255: layer.opacity255,
        clipping: layer.clipping, rasterMaskPresent: layer.hasRasterMask,
        vectorMaskPresent: layer.hasVectorMask, effects: layer.effects,
        ...(layer.text ? { text: { text: layer.text.text, runs } } : {}) },
      nativeBoundsRpx: native, nativeBottomBoundsRpx: frame(captures[1], select(captures[1], selector, index)),
      geometryDeltaRpx: comparisonBasis === 'nominal-shape-frame'
        ? native.map((value, axis) => round(value - layer.bounds.rpx[axis])) : null,
      nativeStyle: Object.fromEntries(Object.entries(node).filter(([name]) => name.includes('-')
        || ['opacity', 'color', 'overflow'].includes(name))),
    };
  });
  for (const [key, number, unit, index] of [
    ['balance-number', '.balance-card__value', '.balance-card__unit', 0],
    ['paid-number', '.hour-card__value', '.hour-card__unit', 0],
    ['gift-number', '.hour-card__value', '.hour-card__unit', 1],
  ]) {
    const a = select(captures[0], number, index), b = select(captures[0], unit, index);
    anchors.find((anchor) => anchor.key === key).nativeCombinedLineSpanRpx = frame(captures[0], {
      left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
      width: Math.max(a.left + a.width, b.left + b.width) - Math.min(a.left, b.left),
      height: Math.max(a.top + a.height, b.top + b.height) - Math.min(a.top, b.top),
    });
  }
  return {
    schemaVersion: 1, page: 'parent/P3', acceptance: 'diagnostic-only', source: sources[0],
    artboard: { stackIndex: page.stackIndex, bboxDocumentPx: page.bboxDocumentPx, sizeRpx: page.sizeRpx },
    coordinateBasis: 'Actual windowWidth and viewport scroll retained; no fitted translation',
    captures: Object.fromEntries(captures.map((capture, index) => [index ? 'bottom' : 'top',
      { window: capture.window, scrollTopPx: capture.nodes[capture.selectors.length].scrollTop }])),
    anchors, nativeLayout: selectors.map((selector) => ({
      selector, boundsRpx: captures[0].nodes[captures[0].selectors.indexOf(selector)]
        .map((node) => frame(captures[0], node)),
    })),
    layerCoverage: page.layers.map((layer) => ({
      layerId: layer.layerId, path: layer.path, kind: layer.kind,
      status: [177, 178, 179, 180].includes(layer.layerId) ? 'excluded-approved-brand-rule'
        : !layer.visibleEffective ? 'hidden-source-layer'
          : mappings.some((mapping) => mapping[1] === layer.layerId) ? 'diagnostic-mapped'
            : layer.kind === 'group' ? 'structural-group-cache' : 'unmapped-composition-plane',
    })),
    limits: [
      'Source text caches, native line frames and combined line spans do not measure visible text ink.',
      'Fee/date are one source line and two native rows; approved white alpha and dynamic facts remain.',
      'Source balance mascot cache and current full image have different planes; clipping requires visible-alpha review.',
      'Source 532 and 531 are separate full/dim layers; native yellow base and 84% foreground differ in composition.',
      'Source raster/vector mask presence does not prove mask content, final radius or material equivalence.',
      'Ledger rows are mapped by position for layout diagnostics, not matched business records or content.',
      'Approved common controls, ledger weights/stroke, colors, shadows and full mascots are retained.',
      'Raw oversized background, hidden layers and independent brand exclusions are tracked separately.',
      'No full P3, R0/R2, real API, fallback font, native keyboard or production acceptance.',
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtimeName = process.argv[2] || 'runtime-390-v4';
  if (!/^runtime-(375|390|430)-v\d+$/.test(runtimeName)) throw new Error('Invalid capture name');
  const runtimePath = `${base}/${runtimeName}/runtime.json`, report = read(runtimePath);
  if (!runtimeName.startsWith(`runtime-${report.expectedWidth}-`)) throw new Error('Capture width/name mismatch');
  verifyRuntimeInputs(report, digest);
  const geometry = read(geometryPath), result = measureSources(geometry, report);
  if (digest(result.source.path) !== result.source.sha256) throw new Error('Changed PSD source');
  const inputs = [runtimePath, geometryPath, result.source.path,
    '.tools-automation/measure_parent_hours_sources.mjs', '.tools-automation/measure_parent_home_anchors.mjs',
    ...['standard-top', 'standard-bottom', 'restored-parent-home'].map((name) => `${base}/${runtimeName}/${name}.png`)];
  result.inputs = inputs.map((relative) => ({ path: relative, sha256: digest(relative) }));
  const target = path.join(root, base, runtimeName, 'semantic-anchors-v1.json');
  fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(`${result.anchors.length} P3 source/native diagnostics; ${result.layerCoverage.length} source layers tracked`);
}
