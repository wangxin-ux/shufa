import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CampusManagerScopeService } from '../../common/auth/campus-manager-scope.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { StoredFileService } from '../file/stored-file.service';
import { CampusManagerStudentArchiveService } from './campus-manager-student-archive.service';

describe('campus student archive access', () => {
  const transaction = jest.fn();
  const files = { readPrivateFile: jest.fn() };
  const service = () =>
    new CampusManagerStudentArchiveService(
      { $transaction: transaction } as unknown as PrismaService,
      new CampusManagerScopeService(),
      files as unknown as StoredFileService,
    );

  beforeEach(() => jest.clearAllMocks());

  it.each(['PARENT', 'PARTNER', 'TEACHER', 'OPERATOR', 'SUPER_ADMIN'])(
    'rejects %s before loading student or media data',
    async (role) => {
      const user = {
        userId: 'actor',
        roles: [{ code: role, campusId: 'campus' }],
      } as AuthenticatedUser;
      await expect(service().getArchive(user, 'student')).rejects.toMatchObject(
        {
          statusCode: 403,
        },
      );
      expect(transaction).not.toHaveBeenCalled();
      expect(files.readPrivateFile).not.toHaveBeenCalled();
    },
  );

  it('does not allow an account with combined role scopes', async () => {
    const user = {
      userId: 'actor',
      roles: [
        { code: 'CAMPUS_MANAGER', campusId: 'campus' },
        { code: 'PARTNER', campusId: 'campus' },
      ],
    } as AuthenticatedUser;
    await expect(service().getArchive(user, 'student')).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
