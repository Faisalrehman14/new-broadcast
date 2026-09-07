import type { FastifyInstance } from 'fastify';
import {
  parseTemplateVariables,
  submitTemplateSchema,
  templateImportSchema,
  validateTemplateValues,
} from '@pagebroadcast/validation';
import { requireAdmin, requireUser } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { assertUserOwnsPage } from '../../lib/ownership.js';
import { decryptSecret } from '../../lib/crypto.js';
import { metaProvider } from '../../lib/meta.js';
import { enqueue, QUEUE_NAMES } from '../../lib/queues.js';
import { writeAuditLog } from '../../lib/audit.js';
import { notifyUser } from '../../lib/notify.js';
import { mapMetaError } from '../../lib/errors.js';

export async function templateRoutes(app: FastifyInstance) {
  app.get('/api/templates', async (request) => {
    await requireUser(request);
    const q = request.query as { source?: string; category?: string; q?: string };
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
      include: { variables: { orderBy: { position: 'asc' } }, approvals: true },
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

    const page = await prisma.facebookPage.findUniqueOrThrow({ where: { id: body.pageId } });
    const pageToken = decryptSecret(page.encryptedPageToken);

    let externalTemplateId: string;
    try {
      const submitted = await metaProvider.submitTemplate({
        pageId: page.platformPageId,
        pageAccessToken: pageToken,
        name: template.metaName,
        category: template.category,
        language: 'en_US',
        body: template.body,
        exampleValues: body.variableSampleValues
          ? Object.keys(body.variableSampleValues)
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => body.variableSampleValues![k]!)
          : undefined,
      });
      externalTemplateId = submitted.externalTemplateId;
    } catch (err) {
      throw mapMetaError(err);
    }

    const approval = await prisma.templateApproval.upsert({
      where: { templateId_pageId: { templateId: id, pageId: body.pageId } },
      create: {
        templateId: id,
        pageId: body.pageId,
        externalTemplateId,
        status: 'PENDING',
        submittedAt: new Date(),
        nextPollAt: new Date(Date.now() + 5000),
        pollBackoffSeconds: 5,
      },
      update: {
        externalTemplateId,
        status: 'PENDING',
        submittedAt: new Date(),
        approvedAt: null,
        rejectedAt: null,
        rejectionReason: null,
        nextPollAt: new Date(Date.now() + 5000),
        pollBackoffSeconds: 5,
      },
    });

    await prisma.template.update({ where: { id }, data: { status: 'PENDING' } });
    await enqueue(
      QUEUE_NAMES.TEMPLATE_STATUS,
      { approvalId: approval.id },
      { delay: 5000, jobId: `tpl-status-${approval.id}-0` }
    );

    await notifyUser({
      userId: user.id,
      type: 'TEMPLATE_SUBMITTED',
      title: 'Template submitted',
      body: `${template.title} was submitted for Meta approval.`,
      metadata: { templateId: id, approvalId: approval.id },
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'template.submitted',
      resource: 'template',
      resourceId: id,
      ip: request.ip,
      metadata: { pageId: body.pageId, approvalId: approval.id },
    });

    return { approval };
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
