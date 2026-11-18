import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(__dirname, '../..');
const metrics = JSON.parse(fs.readFileSync(path.resolve(
  root, '../docs/verification/parent-course-price-2026-10-11/font-metrics-free-campaign-2026-10-13-v2.json',
), 'utf8')).font as {
  source: string;
  sha256: string;
  unitsPerEm: number;
  glyphs: Record<string, { advance: number }>;
};
const font = fs.readFileSync(path.resolve(root, '..', metrics.source));
if (createHash('sha256').update(font).digest('hex') !== metrics.sha256) {
  throw new Error('Remeasure the current private WOFF before testing number fit.');
}

export function privateNumberAdvance(label: string, size: number): number {
  return [...label].reduce((total, character) => {
    const glyph = metrics.glyphs[character];
    if (!glyph) throw new Error(`Missing measured numeric glyph: ${character}`);
    return total + glyph.advance;
  }, 0) * size / metrics.unitsPerEm;
}
