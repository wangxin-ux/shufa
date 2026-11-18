import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compileFunction } from 'node:vm';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import type { Prisma } from '@prisma/client';

// Decode the installed schema WASM directly; never execute the Prisma CLI.
export function readAccountAdapterDmmf(): Prisma.DMMF.Datamodel {
  const directory = dirname(
    realpathSync(
      resolve(__dirname, '../../node_modules/prisma/build/index.js'),
    ),
  );
  const source = ts.createSourceFile(
    'cli.js',
    readFileSync(resolve(directory, 'cli.js'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const matches: ts.ArrowFunction[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isArrowFunction(node) &&
      node.parameters.length === 2 &&
      node.getText(source).includes('prisma_schema_build_bg.wasm') &&
      node.getText(source).includes('.get_dmmf=function')
    )
      matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (matches.length !== 1) throw new Error('Full DMMF decoder unavailable');
  const evaluate = compileFunction(`return (${matches[0].getText(source)});`, [
    'require',
    '__dirname',
  ]) as unknown as (
    require: (name: string) => unknown,
    dir: string,
  ) => (exports: object, module: { exports: object }) => void;
  const exports: { get_dmmf?: (input: string) => string } = {};
  evaluate((name) => {
    if (name !== 'fs') throw new Error('Unexpected DMMF decoder dependency');
    return { readFileSync };
  }, directory)(exports, { exports });
  if (!exports.get_dmmf) throw new Error('DMMF decoder missing');
  return (
    JSON.parse(
      exports.get_dmmf(
        JSON.stringify({
          prismaSchema: readFileSync(
            resolve(__dirname, '../../prisma/schema.prisma'),
            'utf8',
          ),
          noColor: true,
        }),
      ),
    ) as { datamodel: Prisma.DMMF.Datamodel }
  ).datamodel;
}

export type AdapterRow = Record<string, unknown>;
export interface AdapterRecord {
  table: string;
  key: string;
  data: AdapterRow;
}
export function accountClone<T>(value: T): T {
  if (Object.prototype.toString.call(value) === '[object Date]')
    return new Date((value as Date).getTime()) as T;
  if (Array.isArray(value))
    return value.map((item: unknown) => accountClone(item)) as T;
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]: [string, unknown]) => [
        key,
        accountClone(item),
      ]),
    ) as T;
  return value;
}
export const accountJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? String(item) : item,
  );
export function accountFixtureId(...keys: string[]) {
  const bytes = createHash('sha256')
    .update(JSON.stringify(keys))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function accountFixtureOrder(
  records: readonly AdapterRecord[],
  dmmf: Prisma.DMMF.Datamodel,
) {
  if (
    !dmmf.models.length ||
    dmmf.models.some((model) =>
      model.fields.some(
        (field) =>
          typeof field.isRequired !== 'boolean' ||
          (field.kind === 'object' && !field.relationFromFields),
      ),
    )
  )
    throw new Error('Full DMMF required');
  const keys = new Set<string>();
  const dependencies = new Map<AdapterRecord, AdapterRecord[]>();
  for (const record of records) {
    const model = dmmf.models.find((item) => item.name === record.table);
    if (!model || typeof record.data.id !== 'string')
      throw new Error('Unknown table or missing fixture ID');
    const key = `${record.table}:${record.data.id}`;
    if (keys.has(key)) throw new Error('Duplicate fixture identity');
    keys.add(key);
    for (const name of Object.keys(record.data))
      if (
        !model.fields.some(
          (field) => field.name === name && field.kind !== 'object',
        )
      )
        throw new Error(`Unknown scalar ${record.table}.${name}`);
    for (const field of model.fields.filter(
      (field) => field.kind !== 'object',
    )) {
      const value = record.data[field.name];
      if (value === undefined) {
        if (field.isRequired && !field.hasDefaultValue && !field.isUpdatedAt)
          throw new Error(`Missing scalar ${record.table}.${field.name}`);
        continue;
      }
      if (value === null) {
        if (field.isRequired)
          throw new Error(`Null scalar ${record.table}.${field.name}`);
        continue;
      }
      const items = field.isList ? value : [value];
      if (!Array.isArray(items)) throw new Error('Invalid scalar list');
      for (const item of items as unknown[]) {
        const valid =
          field.kind === 'enum'
            ? dmmf.enums
                .find((entry) => entry.name === field.type)
                ?.values.some((entry) => entry.name === item)
            : field.type === 'Int'
              ? typeof item === 'number' &&
                Number.isInteger(item) &&
                item >= -2147483648 &&
                item <= 2147483647
              : field.type === 'String'
                ? typeof item === 'string'
                : field.type === 'Boolean'
                  ? typeof item === 'boolean'
                  : field.type === 'DateTime'
                    ? item instanceof Date && Number.isFinite(item.getTime())
                    : field.type === 'Json';
        if (!valid)
          throw new Error(`Invalid scalar ${record.table}.${field.name}`);
      }
    }
    const targets: AdapterRecord[] = [];
    for (const field of model.fields.filter(
      (field) => field.relationFromFields?.length,
    )) {
      const values = field.relationFromFields!.map((name) => {
        if (!Object.hasOwn(record.data, name))
          throw new Error(`Explicit FK required ${record.table}.${name}`);
        return record.data[name];
      });
      if (values.includes(null)) continue;
      const target = records.find(
        (row) =>
          row.table === field.type &&
          field.relationToFields!.every(
            (name, index) => row.data[name] === values[index],
          ),
      );
      if (!target)
        throw new Error(`FK outside fixture: ${record.table}.${field.name}`);
      targets.push(target);
    }
    dependencies.set(record, targets);
  }
  const ordered: AdapterRecord[] = [],
    done = new Set<AdapterRecord>();
  while (done.size < records.length) {
    const next = records.find(
      (row) =>
        !done.has(row) &&
        dependencies.get(row)!.every((target) => done.has(target)),
    );
    if (!next) throw new Error('Cyclic fixture FK graph');
    ordered.push(next);
    done.add(next);
  }
  return ordered;
}
