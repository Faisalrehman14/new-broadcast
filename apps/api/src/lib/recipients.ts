import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

export type RecipientSelection = {
  mode: 'ALL_ELIGIBLE' | 'SELECTED' | 'TAGS' | 'FILTERS';
  contactIds?: string[];
  tagIds?: string[];
  filters?: {
    status?: 'ACTIVE' | 'INACTIVE';
    neverContacted?: boolean;
    previouslyContacted?: boolean;
    newSinceDays?: number;
  };
};

export function buildContactWhere(
  pageId: string,
  selection: RecipientSelection
): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = {
    pageId,
    status: 'ACTIVE',
  };

  if (selection.mode === 'SELECTED' && selection.contactIds?.length) {
    where.id = { in: selection.contactIds };
  }

  if (selection.mode === 'TAGS' && selection.tagIds?.length) {
    where.tags = { some: { tagId: { in: selection.tagIds } } };
  }

  const f = selection.filters;
  if (selection.mode === 'FILTERS' && f) {
    if (f.status) where.status = f.status;
    if (f.neverContacted) where.broadcastsReceived = 0;
    if (f.previouslyContacted) where.broadcastsReceived = { gt: 0 };
    if (f.newSinceDays) {
      where.firstSeenAt = {
        gte: new Date(Date.now() - f.newSinceDays * 24 * 60 * 60 * 1000),
      };
    }
  }

  return where;
}

export async function estimateRecipients(pageId: string, selection: RecipientSelection) {
  return prisma.contact.count({ where: buildContactWhere(pageId, selection) });
}

export async function listEligibleContactIds(pageId: string, selection: RecipientSelection) {
  const rows = await prisma.contact.findMany({
    where: buildContactWhere(pageId, selection),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
