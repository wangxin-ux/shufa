'use strict';

async function assertRankingForeignKeys(client, additions) {
  const links = (
    await client.query(
      `SELECT fk.oid::text AS constraint_id, source.relname AS source,
              target.relname AS target,
              array_agg(source_column.attname::text ORDER BY link.ordinality) AS source_columns,
              array_agg(target_column.attname::text ORDER BY link.ordinality) AS target_columns
       FROM pg_constraint fk
       JOIN pg_class source ON source.oid = fk.conrelid
       JOIN pg_class target ON target.oid = fk.confrelid
       JOIN pg_namespace source_ns ON source_ns.oid = source.relnamespace
       JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
       JOIN LATERAL unnest(fk.conkey, fk.confkey) WITH ORDINALITY
         AS link(source_number, target_number, ordinality) ON true
       JOIN pg_attribute source_column ON source_column.attrelid = source.oid
         AND source_column.attnum = link.source_number
       JOIN pg_attribute target_column ON target_column.attrelid = target.oid
         AND target_column.attnum = link.target_number
       WHERE fk.contype = 'f' AND source_ns.nspname = 'public'
         AND target_ns.nspname = 'public'
       GROUP BY fk.oid, source.relname, target.relname`,
    )
  ).rows;
  for (const link of links) {
    if (!additions[link.source]?.length) continue;
    const columns = link.source_columns;
    const targetColumns = link.target_columns;
    if (
      !Array.isArray(columns) ||
      !Array.isArray(targetColumns) ||
      !columns.length ||
      columns.length !== targetColumns.length ||
      [link.source, link.target, ...columns, ...targetColumns].some(
        (name) => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name),
      ) ||
      targetColumns.filter((name) => name === 'id').length !== 1
    ) {
      throw new Error('Unexpected foreign key; review allocation before accepting');
    }
    const identityColumn = columns[targetColumns.indexOf('id')];
    // PostgreSQL enforces the complete tuple. MATCH SIMPLE ignores a tuple
    // containing NULL; MATCH FULL also forbids partial NULL tuples itself.
    const escaped = (
      await client.query(
        `SELECT count(*)::int AS count FROM "${link.source}"
         WHERE id::text = ANY($1::text[])
           AND ${columns.map((name) => `"${name}" IS NOT NULL`).join(' AND ')}
           AND NOT ("${identityColumn}"::text = ANY($2::text[]))`,
        [
          additions[link.source].map((row) => row.id),
          (additions[link.target] ?? []).map((row) => row.id),
        ],
      )
    ).rows[0].count;
    if (escaped) {
      throw new Error(`New ${link.source} foreign key references an older execution`);
    }
  }
}

module.exports = { assertRankingForeignKeys };
