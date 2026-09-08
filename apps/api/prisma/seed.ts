import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { parseTemplateVariables } from '@pagebroadcast/validation';
import { SEED_TEMPLATES } from './seed-templates.js';
import { FREE_TRIAL, PAID_PLANS, addDays } from '../src/lib/plans.js';

// ESM + tsx can fail named import from CJS @prisma/client when client was just generated.
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

async function upsertUser(email: string, name: string, password: string, role: 'USER' | 'ADMIN') {
  const passwordHash = await bcrypt.hash(password, 12);
  const expires = addDays(new Date(), FREE_TRIAL.trialDays || 7);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name,
      passwordHash,
      role,
      emailVerifiedAt: new Date(),
      planKey: 'free',
      planExpiresAt: expires,
      settings: { create: {} },
    },
    update: { name, passwordHash, role },
  });
  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, broadcastSend: true },
    update: {},
  });
  await prisma.userQuota.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      creditsRemaining: FREE_TRIAL.messageLimit,
      creditsMonthly: FREE_TRIAL.messageLimit,
      resetAt: expires,
    },
    update: {},
  });
  return user;
}

async function seedPlans() {
  for (const plan of PAID_PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { key: plan.key },
      create: {
        key: plan.key,
        name: plan.name,
        amountCents: plan.amountCents,
        messageLimit: plan.messageLimit,
        interval: plan.interval,
        active: true,
        sortOrder: plan.sortOrder,
      },
      update: {
        name: plan.name,
        amountCents: plan.amountCents,
        messageLimit: plan.messageLimit,
        sortOrder: plan.sortOrder,
      },
    });
  }
}

async function main() {
  await seedPlans();

  for (const t of SEED_TEMPLATES) {
    const existing = await prisma.template.findUnique({ where: { metaName: t.metaName } });
    const data = {
      title: t.title,
      category: t.category,
      body: t.body,
      bodyStatus: t.bodyStatus,
      source: t.source,
      isCustom: t.isCustom,
      status:
        t.bodyStatus === 'ready' && !t.isCustom
          ? ('APPROVED' as const)
          : ('DRAFT' as const),
    };

    const template = existing
      ? await prisma.template.update({ where: { id: existing.id }, data })
      : await prisma.template.create({ data: { ...data, metaName: t.metaName } });

    await prisma.templateVariable.deleteMany({ where: { templateId: template.id } });
    if (t.body) {
      const parsed = parseTemplateVariables(t.body);
      if (parsed.variables.length) {
        await prisma.templateVariable.createMany({
          data: parsed.variables.map((v) => ({
            templateId: template.id,
            key: v.key,
            position: v.position,
            label: `Variable ${v.key}`,
          })),
        });
      }
    }
  }

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@pagebroadcast.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMeAdmin123!';
  const demoEmail = process.env.SEED_DEMO_USER_EMAIL || 'demo@pagebroadcast.local';
  const demoPassword = process.env.SEED_DEMO_USER_PASSWORD || 'DemoPassword123!';

  await upsertUser(adminEmail, 'CastMe Pro Admin', adminPassword, 'ADMIN');
  await upsertUser(demoEmail, 'Demo Owner', demoPassword, 'USER');

  console.log(`Seeded ${SEED_TEMPLATES.length} templates + plans + users`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
