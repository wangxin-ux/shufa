import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function xlsxResponse(response: Response, buffer: Buffer, fileName: string) {
  response.setHeader('Content-Type', XLSX_MIME);
  response.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  response.setHeader('Cache-Control', 'private, no-store');
  return new StreamableFile(buffer, { type: XLSX_MIME });
}
