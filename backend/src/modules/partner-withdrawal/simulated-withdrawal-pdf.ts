// Minimal single-page synthetic evidence. No bank receipt or payment is represented.
export function simulatedWithdrawalPdf(
  requestNo: string,
  amountFen: number,
  accountVersion: number,
  outcome: 'PAID' | 'UNPAID',
) {
  const lines = [
    'SIMULATION ONLY - NO REAL PAYMENT',
    `Request: ${requestNo}`,
    `Amount (CNY fen): ${amountFen}`,
    `Account snapshot version: ${accountVersion}`,
    `Synthetic reconciliation outcome: ${outcome}`,
    'Synthetic evidence for local testing. Not a bank receipt.',
  ];
  const stream = `BT /F1 14 Tf 40 780 Td ${lines.map((s, i) => `${i ? '0 -28 Td ' : ''}(${s.replace(/[\\()]/g, '\\$&')}) Tj`).join('\n')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content));
    content += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
