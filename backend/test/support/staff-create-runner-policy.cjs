const fs = require('node:fs');
const path = require('node:path');

const evidenceRoot = path.resolve(__dirname, '../../../docs/verification');

function evidencePath(input, exists = fs.existsSync) {
  const output = path.resolve(input || '');
  if (
    path.dirname(output) !== evidenceRoot ||
    !/^staff-create-tcp-2026-10-15-[a-z0-9-]+\.log$/.test(
      path.basename(output),
    ) ||
    exists(output)
  )
    throw new Error('A new staff creation verification log is required');
  return output;
}

async function databaseReady(client, expectedDatabase) {
  try {
    await client.connect();
    const result = await client.query('SELECT current_database() AS database');
    return (
      result.rows.length === 1 && result.rows[0].database === expectedDatabase
    );
  } catch {
    return false;
  } finally {
    await client.end();
  }
}

function safeDiagnostics(text) {
  return !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer |postgres(?:ql)?:\/\/[^/]*@/.test(
    text,
  );
}

module.exports = { evidencePath, databaseReady, safeDiagnostics };
