import * as fs from 'node:fs';
import * as path from 'node:path';
import { Script } from 'node:vm';

const root = path.resolve(__dirname, '../pages/partner/components/campaign-registration-form');
const defaults = jest.fn(() => [
  { id: 'name', kind: 'TEXT', label: '姓名', hint: '', required: true, options: [] },
  { id: 'phone', kind: 'MOBILE', label: '电话', hint: '', required: true, options: [] },
]);
jest.mock('../pages/partner/runtime/campaign-registration-form', () => ({
  defaultRegistrationForm: () => defaults(),
}), { virtual: true });
const question = (patch: object = {}) => ({
  id: 'first', kind: 'TEXT', label: '合成问题', hint: '合成备注', required: false, options: [], ...patch,
});
const event = (dataset: object = {}, value?: unknown) => ({ currentTarget: { dataset }, detail: { value } });

describe('controlled partner campaign registration form component', () => {
  let config: any, component: any;
  const feed = (questions: unknown[]) => {
    component.data.questions = structuredClone(questions);
    config.properties.questions.observer.call(component, component.data.questions);
  };
  const next = () => {
    expect(component.triggerEvent).toHaveBeenLastCalledWith('change', { questions: expect.any(Array) });
    return component.triggerEvent.mock.calls.at(-1)[1].questions;
  };
  beforeEach(() => {
    defaults.mockClear();
    (global as any).Component = (definition: any) => {
      config = definition;
      component = {
        ...definition.methods,
        data: { ...structuredClone(definition.data), questions: [], disabled: false, preview: false },
        triggerEvent: jest.fn(),
        setData(patch: object) { Object.assign(this.data, patch); },
      };
    };
    expect(fs.existsSync(path.join(root, 'index.ts'))).toBe(true);
    jest.isolateModules(() => require(path.join(root, 'index.ts')));
    config.lifetimes.attached.call(component);
  });
  afterEach(() => { delete (global as any).Component; });
  it('starts empty with the three controlled properties and emits nothing on external updates', () => {
    expect(config.properties.questions.value).toEqual([]);
    expect(config.properties.disabled.value).toBe(false);
    expect(config.properties.preview.value).toBe(false);
    feed([question({ label: '外部更新' })]);
    expect(component.data.rows[0].label).toBe('外部更新');
    expect(component.triggerEvent).not.toHaveBeenCalled();
  });
  it.each(['label', 'hint'])('emits an immutable %s draft without trimming unfinished input', (field) => {
    feed([question()]);
    const before = structuredClone(component.data.questions);
    component.onTextInput(event({ id: 'first', field }, ' 首行\n次行 <b>纯文本</b> '));
    expect(next()[0][field]).toBe(' 首行\n次行 <b>纯文本</b> ');
    expect(component.data.questions).toEqual(before);
    expect(component.data.rows[0][field]).toBe(before[0][field]);
  });
  it('updates required and all seven native picker kinds without retaining options on other types', () => {
    feed([question()]);
    component.onRequiredChange(event({ id: 'first' }, true));
    expect(next()[0].required).toBe(true);
    for (const [index, kind] of ['TEXT', 'NUMBER', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'AGE', 'DATE', 'MOBILE'].entries()) {
      component.onKindChange(event({ id: 'first' }, String(index)));
      expect(next()[0]).toMatchObject({ kind, options: kind.includes('CHOICE') ? ['选项1', '选项2'] : [] });
    }
    feed([question({ kind: 'MULTI_CHOICE', options: ['甲', '乙', '丙'] })]);
    component.onKindChange(event({ id: 'first' }, '0'));
    expect(next()[0].options).toEqual([]);
    component.onKindChange(event({ id: 'first' }, '2'));
    expect(next()[0].options).toEqual(['甲', '乙', '丙']);
  });
  it('edits choice options immutably and enforces the 2..20 limits', () => {
    feed([question({ kind: 'SINGLE_CHOICE', options: ['甲', '乙'] })]);
    component.onRemoveOption(event({ id: 'first', option: 0 }));
    expect(component.triggerEvent).not.toHaveBeenCalled();
    component.onOptionInput(event({ id: 'first', option: 1 }, ' 新选项 '));
    expect(next()[0].options).toEqual(['甲', ' 新选项 ']);
    component.onAddOption(event({ id: 'first' }));
    expect(next()[0].options).toHaveLength(3);
    feed(next());
    component.onRemoveOption(event({ id: 'first', option: 1 }));
    expect(next()[0].options).toEqual(['甲', '选项3']);
    feed([question({ kind: 'MULTI_CHOICE', options: Array.from({ length: 20 }, (_, i) => `选项${i}`) })]);
    component.triggerEvent.mockClear();
    component.onAddOption(event({ id: 'first' }));
    expect(component.triggerEvent).not.toHaveBeenCalled();
    expect(component.data.questions[0].options).toHaveLength(20);
  });
  it('adds unique TEXT questions up to 20, removes and reorders without changing the input', () => {
    feed([question(), question({ id: 'second' })]);
    component.onMove(event({ id: 'first', direction: -1 }));
    component.onMove(event({ id: 'second', direction: 1 }));
    expect(component.triggerEvent).not.toHaveBeenCalled();
    component.onMove(event({ id: 'second', direction: -1 }));
    expect(next().map((q: any) => q.id)).toEqual(['second', 'first']);
    expect(component.data.questions.map((q: any) => q.id)).toEqual(['first', 'second']);
    component.onRemove(event({ id: 'first' }));
    expect(next().map((q: any) => q.id)).toEqual(['second']);
    component.onAdd();
    expect(next()[2]).toMatchObject({ kind: 'TEXT', label: '', hint: '', required: false, options: [] });
    const firstId = next()[2].id;
    feed(next());
    component.onAdd();
    expect(next()[3].id).not.toBe(firstId);
    feed(Array.from({ length: 20 }, (_, i) => question({ id: `q-${i}` })));
    component.triggerEvent.mockClear();
    component.onAdd();
    expect(component.triggerEvent).not.toHaveBeenCalled();
  });
  it('keeps choice list keys stable and generates a distinct option after deleting a middle entry', () => {
    feed([question({ kind: 'SINGLE_CHOICE', options: ['选项1', '选项3'] })]);
    expect(component.data.rows[0].optionRows).toEqual([
      { index: 0, value: '选项1' }, { index: 1, value: '选项3' },
    ]);
    component.onAddOption(event({ id: 'first' }));
    expect(next()[0].options).toEqual(['选项1', '选项3', '选项4']);
    const wxml = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
    expect(wxml.match(/wx:for="{{item\.optionRows}}"/g)).toHaveLength(2);
  });
  it('calls defaultRegistrationForm only for an empty editable form', () => {
    component.onDefaults();
    expect(defaults).toHaveBeenCalledTimes(1);
    expect(next()).toEqual(defaults.mock.results[0].value);
    expect(component.data.questions).toEqual([]);
    feed(next());
    component.onDefaults();
    expect(defaults).toHaveBeenCalledTimes(1);
  });
  it.each(['disabled', 'preview'])('blocks every edit handler while %s is true', (flag) => {
    feed([question({ kind: 'SINGLE_CHOICE', options: ['甲', '乙', '丙'] }), question({ id: 'second' })]);
    component.data[flag] = true;
    component.onTextInput(event({ id: 'first', field: 'label' }, '修改'));
    component.onRequiredChange(event({ id: 'first' }, true));
    component.onKindChange(event({ id: 'first' }, '0'));
    component.onOptionInput(event({ id: 'first', option: 0 }, '修改'));
    component.onAddOption(event({ id: 'first' }));
    component.onRemoveOption(event({ id: 'first', option: 0 }));
    component.onMove(event({ id: 'first', direction: 1 }));
    component.onRemove(event({ id: 'first' }));
    component.onAdd();
    feed([]);
    component.onDefaults();
    expect(component.triggerEvent).not.toHaveBeenCalled();
    expect(defaults).not.toHaveBeenCalled();
  });
  it('ignores stale identifiers, invalid fields, malformed picker values and invalid option indices', () => {
    feed([question()]);
    component.onTextInput(event({ id: 'missing', field: 'label' }, '修改'));
    component.onTextInput(event({ id: 'first', field: 'answers' }, '修改'));
    for (const value of ['-1', '7', '0oops', undefined]) component.onKindChange(event({ id: 'first' }, value));
    component.onRequiredChange(event({ id: 'first' }, 'false'));
    component.onRemove(event({ id: 'missing' }));
    component.onMove(event({ id: 'first', direction: 8 }));
    component.onAddOption(event({ id: 'first' }));
    component.onOptionInput(event({ id: 'first', option: 0 }, '修改'));
    feed([question({ kind: 'SINGLE_CHOICE', options: ['甲', '乙', '丙'] })]);
    component.onOptionInput(event({ id: 'first', option: -1 }, '修改'));
    component.onRemoveOption(event({ id: 'first', option: 3 }));
    expect(component.triggerEvent).not.toHaveBeenCalled();
  });
  it('uses class-only styles, bounded tools and disabled native preview controls without answer bindings', () => {
    const wxml = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
    const wxss = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');
    const source = fs.readFileSync(path.join(root, 'index.ts'), 'utf8');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8')).component).toBe(true);
    expect(wxml).toContain('wx:if="{{preview}}"');
    const preview = wxml.slice(0, wxml.indexOf('<block wx:else>'));
    for (const tag of ['input', 'picker', 'radio', 'checkbox']) {
      const nodes = [...preview.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))];
      expect(nodes.length).toBeGreaterThan(0);
      nodes.forEach(([node]) => { expect(node).toMatch(/\sdisabled(?:="[^"]*")?/); expect(node).not.toMatch(/bind(?:input|change)/); });
    }
    expect(wxml).toContain('aria-label="上移问题"');
    expect(wxml).toContain('aria-label="下移问题"');
    expect(wxml).toContain('aria-label="删除问题"');
    expect(wxml).toContain("index === questions.length - 1");
    expect(wxml).not.toMatch(/rich-text|身份证|answer/i);
    expect(source).not.toMatch(/\bwx\.|setStorage|request\(/);
    expect(wxss).not.toContain('@import');
    for (const match of wxss.matchAll(/([^{}]+)\{/g)) {
      match[1].trim().split(',').forEach(selector => expect(selector.trim()).toMatch(/^\.[a-z][a-z0-9_-]*$/i));
    }
    expect(wxss).toContain('minmax(0, 1fr)');
    expect(wxss).toContain('overflow-wrap: anywhere');
    expect(wxss).toContain('width: 72rpx');
    expect(wxss).toContain('height: 72rpx');
  });
  it('parses every WXML interpolation without decoding HTML entities', () => {
    const template = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
    const expressions = [...template.matchAll(/\{\{([\s\S]*?)\}\}/g)];
    expect(expressions.length).toBeGreaterThan(0);
    for (const [, expression] of expressions) {
      expect(() => new Script(`(${expression})`)).not.toThrow();
    }
  });
});
