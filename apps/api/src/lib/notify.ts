import { NotificationType, type Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { enqueue, QUEUE_NAMES } from './queues.js';

export async function notifyUser(input: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const n = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      metadata: input.metadata ?? undefined,
    },
  });
  await enqueue(QUEUE_NAMES.NOTIFICATIONS, { notificationId: n.id });
  return n;
}
