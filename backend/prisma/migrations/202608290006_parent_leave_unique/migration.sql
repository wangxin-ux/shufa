CREATE UNIQUE INDEX "ParentLeaveRequest_parentUserId_studentId_lessonSessionId_key"
ON "ParentLeaveRequest"("parentUserId", "studentId", "lessonSessionId");
