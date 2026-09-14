export type RosterKind = 'customers' | 'teachers';
export type RosterScope = 'GLOBAL' | 'CAMPUS';
export type RosterTemplateVersion = 'CUSTOMER_V1' | 'TEACHER_V1';
export type RosterRowStatus = 'VALID' | 'CREATED' | 'DUPLICATE' | 'ERROR';

export interface ParsedRosterRow {
  rowNumber: number;
  values: string[];
}

export interface ParsedRoster {
  version: RosterTemplateVersion;
  headers: string[];
  rows: ParsedRosterRow[];
  fileHash: string;
}

export interface RosterRowResult {
  rowNumber: number;
  status: RosterRowStatus;
  reason: string;
  values: string[];
}

export interface RosterPreview {
  templateVersion: RosterTemplateVersion;
  fileHash: string;
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: RosterRowResult[];
}

export interface RosterImportResult {
  templateVersion: RosterTemplateVersion;
  fileHash: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: RosterRowResult[];
  errorReceiptFileName: string | null;
  errorReceiptBase64: string | null;
}

export interface UploadedRosterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface CustomerRosterInput {
  studentName: string;
  parentPhone: string;
}

export interface TeacherRosterInput {
  teacherName: string;
  phone: string;
}
