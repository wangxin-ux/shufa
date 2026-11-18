import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CourseProductMutationDto,
  VersionedCourseProductMutationDto,
  VersionedGroupActionDto,
} from './dto/group-buying.dto';

@Injectable()
export class CourseProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  create(user: AuthenticatedUser, dto: CourseProductMutationDto, key: string) {
    const route = '/management/course-products';
    return this.prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim(tx, {
        key, route, request: dto, campusId: dto.campusId, actorUserId: user.userId,
      });
      if (claim.replayed) return claim.responseBody;
      await this.requireCampus(tx, dto.campusId);
      const product = await tx.courseProduct.create({
        data: { ...dto, status: 'DRAFT', createdByUserId: user.userId },
      });
      return this.complete(tx, user, product.id, route, key, 'COURSE_PRODUCT_CREATED', null);
    });
  }

  update(user: AuthenticatedUser, id: string, dto: VersionedCourseProductMutationDto, key: string) {
    const route = `/management/course-products/${id}`;
    return this.prisma.$transaction(async (tx) => {
      const product = await this.requireProduct(tx, id);
      const claim = await this.idempotency.claim(tx, {
        key, route, request: dto, campusId: dto.campusId, actorUserId: user.userId,
      });
      if (claim.replayed) return claim.responseBody;
      await this.requireCampus(tx, dto.campusId);
      const { expectedVersion, ...data } = dto;
      const updated = await tx.courseProduct.updateMany({
        where: { id, status: 'DRAFT', version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (updated.count !== 1) this.conflict();
      return this.complete(tx, user, id, route, key, 'COURSE_PRODUCT_UPDATED', product);
    });
  }

  transition(user: AuthenticatedUser, id: string, action: 'activate' | 'retire', dto: VersionedGroupActionDto, key: string) {
    const route = `/management/course-products/${id}/${action}`;
    return this.prisma.$transaction(async (tx) => {
      const product = await this.requireProduct(tx, id);
      const claim = await this.idempotency.claim(tx, {
        key, route, request: dto, campusId: product.campusId, actorUserId: user.userId,
      });
      if (claim.replayed) return claim.responseBody;
      const updated = await tx.courseProduct.updateMany({
        where: {
          id, version: dto.expectedVersion,
          status: action === 'activate' ? 'DRAFT' : { in: ['DRAFT', 'ACTIVE'] },
        },
        data: { status: action === 'activate' ? 'ACTIVE' : 'RETIRED', version: { increment: 1 } },
      });
      if (updated.count !== 1) this.conflict();
      return this.complete(tx, user, id, route, key,
        action === 'activate' ? 'COURSE_PRODUCT_ACTIVATED' : 'COURSE_PRODUCT_RETIRED', product);
    });
  }

  private async complete(
    tx: Prisma.TransactionClient, user: AuthenticatedUser, id: string,
    route: string, key: string, action: string,
    previous: Prisma.InputJsonValue | null,
  ) {
    const { campus, ...product } = await tx.courseProduct.findUniqueOrThrow({
      where: { id }, include: { campus: { select: { name: true } } },
    });
    const result = {
      ...product, courseName: product.courseName ?? product.name,
      classType: product.classType ?? '常规班', campusName: campus.name,
      createdAt: product.createdAt.toISOString(), updatedAt: product.updatedAt.toISOString(),
    };
    await tx.auditLog.create({ data: {
      campusId: product.campusId, actorUserId: user.userId,
      action, resourceType: 'CourseProduct', resourceId: id, outcome: 'SUCCESS',
      details: { previous, current: {
        campusId: product.campusId, name: product.name, courseName: product.courseName,
        classType: product.classType, summary: product.summary, priceFen: product.priceFen,
        mainUnits: product.mainUnits, giftUnits: product.giftUnits, validityDays: product.validityDays,
        status: product.status, version: product.version,
      } },
    } });
    await this.idempotency.complete(tx, { key, route, responseBody: result as Prisma.InputJsonValue });
    return result;
  }

  private async requireCampus(tx: Prisma.TransactionClient, id: string) {
    if (!await tx.campus.findUnique({ where: { id }, select: { id: true } })) {
      throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, '校区不存在', 404);
    }
  }

  private async requireProduct(tx: Prisma.TransactionClient, id: string) {
    const product = await tx.courseProduct.findUnique({
      where: { id }, select: {
        campusId: true, status: true, version: true, name: true, courseName: true, classType: true,
        summary: true, priceFen: true, mainUnits: true, giftUnits: true, validityDays: true,
      },
    });
    if (!product) throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, '课程产品不存在', 404);
    return product;
  }

  private conflict(): never {
    throw new DomainError(ErrorCode.CONFLICT, '课程产品状态或版本已更新，请刷新后重试', 409);
  }
}
