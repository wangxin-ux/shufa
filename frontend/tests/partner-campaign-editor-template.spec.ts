import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';

const template = readFileSync(join(__dirname, '../pages/partner/campaign-editor/index.wxml'), 'utf8');
const submitTag = template.match(/<button\b[^>]*\bid="free-submit"[^>]*>/)?.[0];
const disabledExpression = submitTag?.match(/\bdisabled="\{\{(.+?)\}\}"/)?.[1];
const idle = {
  saving: false, freeSaving: false, submitting: false, freeSaveUnknown: false,
  submitRefreshNeeded: false, reading: false, dirty: false, freeDirty: false,
  needsVersionRefresh: false, lifecycle: 'OPEN', hasPendingReview: false, submitUncertain: false,
  savingAll: false, draftId: 'synthetic-draft', freeReady: true, createUncertain: false,
  contentDirty: false, contentSaveUnknown: false,
  registrationDirty: false, registrationSaveUnknown: false,
  imageChoosing: false, imageDirty: false, imageSaveUnknown: false,
};

function submitDisabled(changes: Partial<typeof idle> = {}): boolean {
  if (!disabledExpression) throw new Error('Missing free submission disabled expression');
  return new Script(`(${disabledExpression})`).runInNewContext({ ...idle, ...changes });
}

describe('partner campaign editor template expressions', () => {
  it('explains retained free edits in both editing and previewing another type', () => {
    const tag = template.match(/<view\b[^>]*\bid="campaign-free-unsaved"[^>]*>/)?.[0] ?? '';
    const expression = tag.match(/\bwx:if="\{\{(.+?)\}\}"/)?.[1];
    if (!expression) throw new Error('Missing retained free settings feedback');
    const condition = new Script(`(${expression})`);
    for (const editorTab of ['edit', 'preview']) {
      expect(condition.runInNewContext({
        editorTab, form: { campaignType: 'FLASH_SALE' }, freeDirty: true,
      })).toBe(true);
      expect(condition.runInNewContext({
        editorTab, form: { campaignType: 'FLASH_SALE' }, freeDirty: false,
      })).toBe(false);
      expect(condition.runInNewContext({
        editorTab, form: { campaignType: 'FREE_REGISTRATION' }, freeDirty: true,
      })).toBe(false);
    }
    expect(template.indexOf(tag)).toBeLessThan(template.indexOf('id="campaign-draft-preview"'));
  });
  it('edits and previews a separate plain-text body and includes it in the save commands', () => {
    const input = template.match(/<textarea\b[^>]*\bid="campaign-content"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('value="{{content}}"');
    expect(input).toContain('bindinput="onContentInput"');
    expect(input).toContain('contentSaveUnknown');
    expect(template).toContain('{{contentCount}}/10000');
    expect(template).toContain('id="campaign-preview-content"');
    const save = template.match(/<button\b[^>]*\bid="campaign-save"[^>]*>/)?.[0] ?? '';
    expect(save).toContain('bindtap="onSaveAll"');
    expect(submitDisabled({ contentDirty: true })).toBe(true);
    expect(submitDisabled({ contentSaveUnknown: true })).toBe(true);
  });
  it('shows an explicitly private text preview without exposing any registration or sharing action', () => {
    const preview = template.match(/<view\b[^>]*\bid="campaign-draft-preview"[^>]*>([\s\S]*?)<view\b[^>]*\bid="campaign-editor-form"/)?.[1];
    expect(preview).toBeDefined();
    expect(preview).toContain('草稿预览');
    expect(preview).toContain('{{form.title');
    expect(preview).toContain('{{form.shareDescription');
    expect(preview).toContain('{{form.contactPhone');
    expect(preview).toContain('freeTimes.startsAt.date');
    expect(preview).not.toContain('<rich-text');
    expect(preview).not.toContain('open-type="share"');
    expect(preview).not.toMatch(/bindtap="on(?:Save|Submit|Register)/);
  });
  it('offers a complete new free form and a single save-all command', () => {
    const gate = template.match(/<view\b[^>]*wx:if="\{\{!freeReady[^"]*\}\}"[^>]*>/)?.[0] ?? '';
    const condition = gate.match(/\bwx:if="\{\{(.+?)\}\}"/)?.[1];
    if (!condition) throw new Error('Missing free configuration read gate');
    const state = { freeReady: false, draftId: '', needsVersionRefresh: false };
    expect(new Script(`(${condition})`).runInNewContext(state)).toBe(false);
    expect(new Script(`(${condition})`).runInNewContext({ ...state, draftId: 'existing' })).toBe(false);
    expect(new Script(`(${condition})`).runInNewContext({
      ...state, draftId: 'existing', needsVersionRefresh: true,
    })).toBe(true);
    const save = template.match(/<button\b[^>]*\bid="free-save"[^>]*>/)?.[0] ?? '';
    expect(save).toContain('bindtap="onSaveAll"');
    const disabled = save.match(/\bdisabled="\{\{(.+?)\}\}"/)?.[1];
    if (!disabled) throw new Error('Missing save-all disabled binding');
    expect(new Script(`(${disabled})`).runInNewContext({ ...idle, draftId: '', freeReady: false })).toBe(false);
    expect(new Script(`(${disabled})`).runInNewContext({ ...idle, savingAll: true })).toBe(true);
  });
  it('keeps historical management outside the current FREE configuration partition', () => {
    const configuration = template.match(/<view\b[^>]*\bid="free-campaign-partition"[^>]*>/)?.[0] ?? '';
    expect(configuration).toContain('wx:if="{{form.campaignType === \'FREE_REGISTRATION\'}}"');
    const tag = template.match(/<view\b[^>]*\bid="free-campaign-management"[^>]*>/)?.[0] ?? '';
    const expression = tag.match(/\bwx:if="\{\{(.+?)\}\}"/)?.[1];
    if (!expression) throw new Error('Missing independent free campaign management gate');
    const condition = new Script(`(${expression})`);
    const evaluate = (type: string, hasFreeCampaign: boolean, freeReady: boolean) =>
      condition.runInNewContext({ form: { campaignType: type }, hasFreeCampaign, freeReady });
    expect(evaluate('REGULAR_GROUP', true, false)).toBe(true);
    expect(evaluate('FREE_REGISTRATION', true, false)).toBe(true);
    expect(evaluate('FREE_REGISTRATION', false, true)).toBe(true);
    expect(evaluate('REGULAR_GROUP', false, false)).toBe(false);
    const start = template.indexOf(configuration);
    const management = template.indexOf(tag);
    // Track nesting to prove the management view is a sibling, not hidden by the editor's type gate.
    let depth = 0;
    for (const match of template.slice(start, management).matchAll(/<\/?view\b[^>]*>/g)) {
      depth += match[0].startsWith('</') ? -1 : 1;
    }
    expect(depth).toBe(0);
    expect(template.indexOf('id="free-copy-path"')).toBeGreaterThan(management);
    expect(template.indexOf('id="free-share"')).toBeGreaterThan(management);
    expect(template.indexOf('id="free-registration-filter"')).toBeGreaterThan(management);
  });
  it('parses every actual binding without HTML entity decoding', () => {
    const expressions = [...template.matchAll(/\{\{([\s\S]*?)\}\}/g)];
    expect(expressions.length).toBeGreaterThan(0);
    for (const [, expression] of expressions) {
      expect(() => new Script(`(${expression})`)).not.toThrow();
    }
  });

  it('only renders the native share command for a validated publication', () => {
    const tag = template.match(/<button\b[^>]*\bid="free-share"[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('open-type="share"');
    const expression = tag.match(/\bwx:if="\{\{(.+?)\}\}"/)?.[1];
    expect(expression).toBeDefined();
    if (!expression) return;
    const condition = new Script(`(${expression})`);
    expect(condition.runInNewContext({ canSharePublished: true })).toBe(true);
    expect(condition.runInNewContext({ canSharePublished: false })).toBe(false);
  });
  it.each([
    ['free-start-date', 'startsAt', 'date'], ['free-start-time', 'startsAt', 'time'],
    ['free-end-date', 'endsAt', 'date'], ['free-end-time', 'endsAt', 'time'],
  ])('uses a bound native picker with write/read locks for %s', (id, field, part) => {
    const tag = template.match(new RegExp(`<picker\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';
    expect(tag).toContain(`mode="${part}"`);
    expect(tag).toContain(`data-field="${field}"`);
    expect(tag).toContain(`data-part="${part}"`);
    expect(tag).toContain(`value="{{freeTimes.${field}.${part}}}"`);
    expect(tag).toContain('bindchange="onFreeTimeChange"');
    const expression = tag.match(/\bdisabled="\{\{(.+?)\}\}"/)?.[1];
    if (!expression) throw new Error(`Missing ${id} disabled binding`);
    const condition = new Script(`(${expression})`);
    expect(condition.runInNewContext(idle)).toBe(false);
    for (const state of ['saving', 'freeSaving', 'submitting', 'freeSaveUnknown', 'submitUncertain', 'submitRefreshNeeded', 'reading', 'imageChoosing', 'imageSaveUnknown']) {
      expect(condition.runInNewContext({ ...idle, [state]: true })).toBe(true);
    }
    expect(template).not.toMatch(/<input\b[^>]*id="free-(?:start|end)"/);
    expect(template).not.toContain('YYYY-MM-DDTHH:mm:ss+08:00');
  });

  it('allows a saved open draft to submit when no review is pending', () => {
    expect(submitDisabled()).toBe(false);
  });
  it('offers an enabled reread and locks both save commands when the loaded version needs refreshing', () => {
    const reload = template.match(/<button\b[^>]*\bid="campaign-reload"[^>]*>/)?.[0] ?? '';
    expect(reload).toContain('bindtap="onReload"');
    const condition = reload.match(/\bwx:if="\{\{(.+?)\}\}"/)?.[1];
    const disabled = reload.match(/\bdisabled="\{\{(.+?)\}\}"/)?.[1];
    if (!condition || !disabled) throw new Error('Missing reload bindings');
    const state = { ...idle, needsVersionRefresh: true };
    expect(new Script(`(${condition})`).runInNewContext(state)).toBe(true);
    expect(new Script(`(${disabled})`).runInNewContext(state)).toBe(false);
    for (const id of ['campaign-save', 'free-save']) {
      const tag = template.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';
      const expression = tag.match(/\bdisabled="\{\{(.+?)\}\}"/)?.[1];
      if (!expression) throw new Error(`Missing ${id} save binding`);
      expect(new Script(`(${expression})`).runInNewContext(state)).toBe(true);
    }
  });
  it('binds the registration selector and only shows a count after a successful read', () => {
    const tag = template.match(/<picker\b[^>]*\bid="free-registration-filter"[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('mode="selector"');
    expect(tag).toContain('range="{{registrationFilters}}"');
    expect(tag).toContain('range-key="label"');
    expect(tag).toContain('value="{{registrationFilterIndex}}"');
    expect(tag).toContain('bindchange="onRegistrationFilterChange"');
    const count = template.match(/<text\b[^>]*\bid="free-registration-count"[^>]*>/)?.[0] ?? '';
    const expression = count.match(/\bwx:if="\{\{(.+?)\}\}"/)?.[1];
    if (!expression) throw new Error('Missing registration count success gate');
    const condition = new Script(`(${expression})`);
    expect(condition.runInNewContext({ listLoading: false, listError: '' })).toBe(true);
    expect(condition.runInNewContext({ listLoading: true, listError: '' })).toBe(false);
    expect(condition.runInNewContext({ listLoading: false, listError: '读取失败' })).toBe(false);
  });

  it('locks a pending review while allowing the original uncertain submission to retry', () => {
    expect(submitDisabled({ hasPendingReview: true })).toBe(true);
    expect(submitDisabled({ hasPendingReview: true, submitUncertain: true })).toBe(false);
  });

  it.each([
    'saving', 'freeSaving', 'submitting', 'freeSaveUnknown', 'submitRefreshNeeded',
    'reading', 'dirty', 'freeDirty', 'needsVersionRefresh',
    'imageChoosing', 'imageDirty', 'imageSaveUnknown',
  ] as const)('keeps submission locked when %s is true', (flag) => {
    expect(submitDisabled({ [flag]: true })).toBe(true);
  });

  it('keeps a closed activity locked even when retrying an uncertain submission', () => {
    expect(submitDisabled({ lifecycle: 'CLOSED', submitUncertain: true })).toBe(true);
  });

  it.each([
    ['history', '暂无审核记录'],
    ['registrations', '暂无报名记录'],
  ])('shows the %s empty state only after a successful empty read', (list, label) => {
    const expression = template.match(
      new RegExp(`<view\\s+wx:if="\\{\\{([^"]+)\\}\\}"[^>]*>${label}</view>`),
    )?.[1];
    if (!expression) throw new Error(`Missing ${list} empty state binding`);
    const condition = new Script(`(${expression})`);
    const evaluate = (rows: unknown[], loading = false, error = '') => condition.runInNewContext({
      [list]: rows, listLoading: loading, listError: error,
    });
    expect(evaluate([])).toBe(true);
    expect(evaluate([{}])).toBe(false);
    expect(evaluate([], true)).toBe(false);
    expect(evaluate([], false, '读取失败')).toBe(false);
  });
});
