import type { FastifyInstance } from 'fastify';
import {
  activateTemplatesSchema,
  parseTemplateVariables,
  submitTemplateSchema,
  templateImportSchema,
  validateTemplateValues,
} from '@pagebroadcast/validation';
import { requireAdmin, requireUser } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { assertUserOwnsPage } from '../../lib/ownership.js';
import { writeAuditLog } from '../../lib/audit.js';
import { notifyUser } from '../../lib/notify.js';
import {
  activateMessengerTemplatesForPage,
  ensureTemplateApprovedForPage,
} from '../../lib/template-activation.js';

export async function templateRoutes(app: FastifyInstance) {
  app.get('/api/templates', async (request) => {
    const user = await requireUser(request);
    const q = request.query as { source?: string; category?: string; q?: string; pageId?: string };
    const where: Record<string, unknown> = {};
    if (q.source) where.source = q.source;
    if (q.category) where.category = q.category;
    if (q.q) {
      where.OR = [
        { title: { contains: q.q, mode: 'insensitive' } },
        { metaName: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    const templates = await prisma.template.findMany({
      where,
      include: {
        variables: { orderBy: { position: 'asc' } },
        approvals: q.pageId
          ? { where: { pageId: q.pageId } }
          : {
              where: {
                page: { connections: { some: { userId: user.id } } },
              },
            },
      },
      orderBy: [{ source: 'asc' }, { title: 'asc' }],
    });
    return { templates };
  });

  app.get('/api/templates/:id', async (request) => {
    await requireUser(request);
    const { id } = request.params as { id: string };
    const template = await prisma.template.findUnique({
      where: { id },
      include: { variables: { orderBy: { position: 'asc' } }, approvals: true },
    });
    if (!template) throw new AppError('NOT_FOUND', 'Template not found.', 404);
    return { template };
  });

  app.post('/api/templates', async (request) => {
    const user = await requireUser(request);
    const body = request.body as { title?: string; body?: string };
    if (!body.title || body.body === undefined) {
      throw new AppError('VALIDATION', 'title and body are required for custom templates.', 400);
    }
    const parsed = parseTemplateVariables(body.body);
    const template = await prisma.template.create({
      data: {
        title: body.title,
        metaName: `custom_${user.id.slice(0, 8)}_${Date.now()}`,
        category: 'Custom',
        body: body.body,
        bodyStatus: 'ready',
        source: 'CUSTOM',
        isCustom: true,
        status: 'DRAFT',
        userId: user.id,
        variables: {
          create: parsed.variables.map((v) => ({
            key: v.key,
            position: v.position,
            label: `Variable ${v.key}`,
          })),
        },
      },
      include: { variables: true },
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'template.created',
      resource: 'template',
      resourceId: template.id,
      ip: request.ip,
    });
    return { template };
  });

  app.put('/api/templates/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) throw new AppError('NOT_FOUND', 'Template not found.', 404);
    if (!template.isCustom || template.userId !== user.id) {
      throw new AppError('FORBIDDEN', 'Only your custom templates can be edited.', 403);
    }
    const body = request.body as { title?: string; body?: string };
    const newBody = body.body ?? template.body ?? '';
    const parsed = parseTemplateVariables(newBody);
    await prisma.templateVariable.deleteMany({ where: { templateId: id } });
    const updated = await prisma.template.update({
      where: { id },
      data: {
        title: body.title ?? template.title,
        body: newBody,
        status: 'DRAFT',
        variables: {
          create: parsed.variables.map((v) => ({
            key: v.key,
            position: v.position,
            label: `Variable ${v.key}`,
          })),
        },
      },
      include: { variables: true },
    });
    return { template: updated };
  });

  /**
   * Activate ready library templates for a Page (Messenger model).
   * One click → all ready templates APPROVED for that page → broadcast immediately.
   */
  app.post('/api/templates/activate-for-page', async (request) => {
    const user = await requireUser(request);
    const body = activateTemplatesSchema.parse(request.body);
    await assertUserOwnsPage(user.id, body.pageId);

    const result = await activateMessengerTemplatesForPage({
      pageId: body.pageId,
      templateIds: body.templateIds,
    });

    await notifyUser({
      userId: user.id,
      type: 'TEMPLATE_APPROVED',
      title: 'Templates ready',
      body: `${result.activated} Messenger templates are approved for this Page. You can broadcast now.`,
      metadata: { pageId: body.pageId, activated: result.activated },
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'templates.activated_for_page',
      resource: 'facebook_page',
      resourceId: body.pageId,
      ip: request.ip,
      metadata: result,
    });

    return {
      ...result,
      message:
        'Library templates are ready for Messenger sends on this Page. Start a broadcast anytime.',
    };
  });

  app.post('/api/templates/:id/submit', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const body = submitTemplateSchema.parse(request.body);
    await assertUserOwnsPage(user.id, body.pageId);

    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) throw new AppError('NOT_FOUND', 'Template not found.', 404);
    if (template.bodyStatus === 'requires_import' || !template.body) {
      throw new AppError('TEMPLATE_BODY_MISSING', 'Template body requires import.', 400);
    }
    if (template.isCustom) {
      throw new AppError(
        'VALIDATION',
        'Custom freeform messages are not Meta templates and cannot be submitted for template approval. Eligibility is validated at send time.',
        400
      );
    }

    if (body.variableSampleValues) {
      const validation = validateTemplateValues(template.body, body.variableSampleValues);
      if (!validation.ok) {
        throw new AppError('VALIDATION', validation.errors.join('; '), 400);
      }
    }

    await ensureTemplateApprovedForPage(id, body.pageId);
    const approval = await prisma.templateApproval.findUniqueOrThrow({
      where: { templateId_pageId: { templateId: id, pageId: body.pageId } },
    });

    await notifyUser({
      userId: user.id,
      type: 'TEMPLATE_APPROVED',
      title: 'Template ready',
      body: `${template.title} is approved for Messenger sends on this Page.`,
      metadata: { templateId: id, approvalId: approval.id },
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'template.activated',
      resource: 'template',
      resourceId: id,
      ip: request.ip,
      metadata: { pageId: body.pageId, approvalId: approval.id },
    });

    return {
      approval,
      message: 'Template approved for this Page. You can start broadcasts immediately.',
    };
  });

  app.post('/api/templates/import', async (request) => {
    const admin = await requireAdmin(request);
    const body = templateImportSchema.parse(request.body);
    const parsed = parseTemplateVariables(body.body);
    if (parsed.missingNumbers.length) {
      throw new AppError(
        'VALIDATION',
        `Variable gaps: ${parsed.missingNumbers.join(', ')}`,
        400
      );
    }

    const existing = await prisma.template.findUnique({ where: { metaName: body.metaName } });
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Unknown metaName — create seed entry first.', 404);
    }

    await prisma.templateVariable.deleteMany({ where: { templateId: existing.id } });
    const updated = await prisma.template.update({
      where: { id: existing.id },
      data: {
        title: body.title,
        category: body.category,
        body: body.body,
        bodyStatus: 'ready',
        status: 'APPROVED',
        variables: {
          create: parsed.variables.map((v) => ({
            key: v.key,
            position: v.position,
            label: `Variable ${v.key}`,
          })),
        },
      },
      include: { variables: true },
    });

    await writeAuditLog({
      actorId: admin.id,
      action: 'template.imported',
      resource: 'template',
      resourceId: updated.id,
      ip: request.ip,
    });
    return { template: updated };
  });
}
