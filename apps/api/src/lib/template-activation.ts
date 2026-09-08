import { prisma } from './prisma.js';

/**
 * Messenger Page broadcasts (like MyAimMyDream) do not wait on WhatsApp HSM
 * template review. Ready library templates are activated per Page so broadcasts
 * can start immediately. Sends still must follow Meta messaging windows / tags.
 */
export async function activateMessengerTemplatesForPage(options: {
  pageId: string;
  templateIds?: string[];
}): Promise<{ activated: number; templateIds: string[] }> {
  const where: {
    isCustom: boolean;
    bodyStatus: 'ready';
    body: { not: null };
    id?: { in: string[] };
  } = {
    isCustom: false,
    bodyStatus: 'ready',
    body: { not: null },
  };
  if (options.templateIds?.length) {
    where.id = { in: options.templateIds };
  }

  const templates = await prisma.template.findMany({
    where,
    select: { id: true, metaName: true },
  });

  const now = new Date();
  for (const t of templates) {
    await prisma.templateApproval.upsert({
      where: { templateId_pageId: { templateId: t.id, pageId: options.pageId } },
      create: {
        templateId: t.id,
        pageId: options.pageId,
        externalTemplateId: `messenger_lib_${t.metaName}`,
        status: 'APPROVED',
        submittedAt: now,
        approvedAt: now,
        rejectedAt: null,
        rejectionReason: null,
        nextPollAt: null,
      },
      update: {
        externalTemplateId: `messenger_lib_${t.metaName}`,
        status: 'APPROVED',
        submittedAt: now,
        approvedAt: now,
        rejectedAt: null,
        rejectionReason: null,
        nextPollAt: null,
      },
    });
  }

  if (templates.length) {
    await prisma.template.updateMany({
      where: { id: { in: templates.map((t) => t.id) } },
      data: { status: 'APPROVED' },
    });
  }

  return {
    activated: templates.length,
    templateIds: templates.map((t) => t.id),
  };
}

export async function ensureTemplateApprovedForPage(
  templateId: string,
  pageId: string
): Promise<{ status: 'APPROVED' | 'SKIPPED'; reason?: string }> {
  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) return { status: 'SKIPPED', reason: 'not_found' };
  if (template.isCustom) return { status: 'SKIPPED', reason: 'custom' };
  if (template.bodyStatus !== 'ready' || !template.body) {
    return { status: 'SKIPPED', reason: 'body_missing' };
  }

  await activateMessengerTemplatesForPage({ pageId, templateIds: [templateId] });
  return { status: 'APPROVED' };
}
