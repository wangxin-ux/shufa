import {
  buildTeacherRecordPageModel,
  mergeTeacherRecordItems,
} from '../../../services/teacher-records.presenter';
import { createTeacherRecordPage } from '../runtime/teacher-record-page';

Page({
  ...createTeacherRecordPage(
    buildTeacherRecordPageModel, mergeTeacherRecordItems,
    (runtime, query) => runtime.loadTeachingRecords(query),
  ),
});
