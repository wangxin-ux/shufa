import {
  buildTeacherLedgerPageModel,
  mergeTeacherLedgerItems,
} from '../../../services/teacher-ledger.presenter';
import { createTeacherRecordPage } from '../runtime/teacher-record-page';

Page({
  ...createTeacherRecordPage(
    buildTeacherLedgerPageModel, mergeTeacherLedgerItems,
    (runtime, query) => runtime.loadLessonLedger(query), '扣课流水',
  ),

  loadLedger(reset: boolean) { return this.loadRecords(reset); },
});
