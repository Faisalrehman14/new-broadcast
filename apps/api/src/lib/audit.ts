import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

export async function writeAuditLog(input: {
  actorId?: string | null;
  action: string;
  resource: string;
  resourceId?: string;
  ip?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      ip: input.ip,
      metadata: input.metadata ?? undefined,
    },
  });
}
