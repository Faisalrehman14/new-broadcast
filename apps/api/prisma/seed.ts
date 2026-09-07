import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { parseTemplateVariables } from '@pagebroadcast/validation';
import { SEED_TEMPLATES } from './seed-templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

async function upsertUser(email: string, name: string, password: string, role: 'USER' | 'ADMIN') {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, role, settings: { create: {} } },
    update: { name, passwordHash, role },
  });
  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });
  return user;
}

async function main() {
  for (const t of SEED_TEMPLATES) {
    const existing = await prisma.template.findUnique({ where: { metaName: t.metaName } });
    const data = {
      title: t.title,
      category: t.category,
      body: t.body,
      bodyStatus: t.bodyStatus,
      source: t.source,
      isCustom: t.isCustom,
      status: 'DRAFT' as const,
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

  console.log(`Seeded ${SEED_TEMPLATES.length} templates + users`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
