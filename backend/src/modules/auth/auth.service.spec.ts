import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthService } from './auth.service';
import { StaffBindTokenService } from './staff-bind-token.service';

describe('AuthService Mock identity boundary', () => {
  it('rejects Mock identity login before querying identities outside the Mock driver', async () => {
    const findUnique = jest.fn();
    const service = new AuthService(
      {
        authIdentity: { findUnique },
      } as unknown as PrismaService,
      {} as JwtService,
      {
        get: jest.fn().mockReturnValue('wechat'),
      } as unknown as ConfigService,
      {} as StaffBindTokenService,
    );

    await expect(service.login('mock-demo-east-teacher')).rejects.toMatchObject(
      {
        code: ErrorCode.BAD_REQUEST,
        statusCode: 400,
      },
    );
    expect(findUnique).not.toHaveBeenCalled();
  });
});
