import { prisma } from './prisma.js';
import { AppError } from './errors.js';

export async function assertUserOwnsPage(userId: string, pageId: string) {
  const conn = await prisma.pageConnection.findFirst({
    where: { userId, pageId },
    include: { page: true },
  });
  if (!conn) throw new AppError('FORBIDDEN', 'You do not have access to this Page.', 403);
  return conn;
}

export async function assertUserOwnsBroadcast(userId: string, broadcastId: string) {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId } });
  if (!broadcast) throw new AppError('NOT_FOUND', 'Broadcast not found.', 404);
  return broadcast;
}

export async function assertUserOwnsContact(userId: string, contactId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, page: { connections: { some: { userId } } } },
  });
  if (!contact) throw new AppError('NOT_FOUND', 'Contact not found.', 404);
  return contact;
}
