export type RosterKind = 'customers' | 'teachers';
export type RosterRowStatus = 'VALID' | 'CREATED' | 'DUPLICATE' | 'ERROR';

export interface RosterRowResult {
  rowNumber: number;
  status: RosterRowStatus;
  reason: string;
  values: string[];
}

export interface RosterPreview {
  templateVersion: 'CUSTOMER_V1' | 'TEACHER_V1';
  fileHash: string;
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: RosterRowResult[];
}

export interface RosterImportResult {
  templateVersion: 'CUSTOMER_V1' | 'TEACHER_V1';
  fileHash: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: RosterRowResult[];
  errorReceiptFileName: string | null;
  errorReceiptBase64: string | null;
}

export interface TeacherRosterItem {
  id: string;
  teacherName: string;
  maskedPhone: string;
  campusId: string;
  campusName: string;
  status: 'ACTIVE' | 'DISABLED';
}

export interface TeacherRosterPage {
  data: TeacherRosterItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
