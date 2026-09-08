/**
 * Auto-create + poll Instant plain UTILITY (castme_plain_utility_v1) per Page.
 * Meta still decides APPROVED; we submit and wait so every connected Page gets ready without manual Prepare.
 */

import type { PrismaClient } from '@prisma/client';

export const PLAIN_UTILITY_TEMPLATE_NAME = 'castme_plain_utility_v1';
export const PLAIN_UTILITY_BODY = '{{1}}';

type MetaLike = {
  remintPageTokensFromUserToken?: (userAccessToken: string) => Promise<
    Array<{ id: string; accessToken?: string; name?: string }>
  >;
  listMessageTemplates: (params: {
    pageId: string;
    pageAccessToken: string;
    name?: string;
  }) => Promise<Array<{ id?: string; name: string; status: string; language?: string }>>;
  createUtilityTemplate: (input: {
    pageId: string;
    pageAccessToken: string;
    name: string;
    category: string;
    language: string;
    body: string;
    exampleValues: string[];
  }) => Promise<{ externalTemplateId: string; status: string }>;
  waitForUtilityTemplateApproved: (params: {
    pageId: string;
    pageAccessToken: string;
    templateName: string;
    retries?: number;
    intervalMs?: number;
  }) => Promise<{ externalTemplateId: string; status: string; name?: string }>;
};

export async function ensurePlainUtilityForPage(params: {
  prisma: PrismaClient;
  meta: MetaLike;
  pageId: string;
  decryptSecret: (payload: string) => string;
  encryptSecret: (plaintext: string) => string;
  waitForApproved?: boolean;
  log?: (obj: object, msg: string) => void;
}): Promise<{
  pageId: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'error';
  language: string;
  externalId: string;
  error?: string;
}> {
  const {
    prisma,
    meta,
    pageId,
    decryptSecret,
    encryptSecret,
    waitForApproved = true,
    log,
  } = params;

  const page = await prisma.facebookPage.findUnique({
    where: { id: pageId },
    include: { facebookAccount: true },
  });
  if (!page?.encryptedPageToken) {
    return {
      pageId,
      status: 'error',
      language: 'en',
      externalId: '',
      error: 'Missing page token — reconnect Facebook',
    };
  }

  let token = decryptSecret(page.encryptedPageToken);
  try {
    if (page.facebookAccount?.encryptedAccessToken && meta.remintPageTokensFromUserToken) {
      const pages = await meta.remintPageTokensFromUserToken(
        decryptSecret(page.facebookAccount.encryptedAccessToken)
      );
      const hit = pages.find((p) => p.id === page.platformPageId);
      if (hit?.accessToken) {
        token = hit.accessToken;
        await prisma.facebookPage.update({
          where: { id: page.id },
          data: { encryptedPageToken: encryptSecret(token) },
        });
      }
    }
  } catch (err) {
    log?.({ err, pageId }, 'utility ensure: remint skipped');
  }

  const name = PLAIN_UTILITY_TEMPLATE_NAME;
  const tplBody = PLAIN_UTILITY_BODY;
  const langs = ['en', 'en_US'] as const;

  const persist = async (
    status: 'APPROVED' | 'PENDING' | 'REJECTED',
    language: string,
    externalId: string
  ) => {
    const row = await prisma.pageUtilityTemplate.upsert({
      where: {
        pageId_templateName_language: {
          pageId: page.id,
          templateName: name,
          language,
        },
      },
      create: {
        pageId: page.id,
        templateName: name,
        language,
        externalId,
        status,
        body: tplBody,
        category: 'UTILITY',
      },
      update: {
        externalId,
        status,
        body: tplBody,
      },
    });
    return row;
  };

  // 1) Prefer existing APPROVED / any listed template
  for (const language of langs) {
    const listed = await meta.listMessageTemplates({
      pageId: page.platformPageId,
      pageAccessToken: token,
      name,
    });
    const hit =
      listed.find((t) => t.name === name && t.status === 'APPROVED') ||
      listed.find((t) => t.name === name) ||
      listed.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!hit) continue;

    let status: 'APPROVED' | 'PENDING' | 'REJECTED' =
      hit.status === 'APPROVED'
        ? 'APPROVED'
        : hit.status === 'REJECTED'
          ? 'REJECTED'
          : 'PENDING';
    const lang = hit.language || language;
    let externalId = hit.id || `utility_${name}`;

    if (status === 'PENDING' && waitForApproved) {
      const waited = await meta.waitForUtilityTemplateApproved({
        pageId: page.platformPageId,
        pageAccessToken: token,
        templateName: name,
        retries: 40,
        intervalMs: 3000,
      });
      status =
        waited.status === 'APPROVED'
          ? 'APPROVED'
          : waited.status === 'REJECTED'
            ? 'REJECTED'
            : 'PENDING';
      externalId = waited.externalTemplateId || externalId;
    }

    await persist(status, lang, externalId);
    return { pageId, status, language: lang, externalId };
  }

  // 2) Create then optionally wait
  let lastErr = 'create failed';
  for (const language of langs) {
    try {
      const created = await meta.createUtilityTemplate({
        pageId: page.platformPageId,
        pageAccessToken: token,
        name,
        category: 'UTILITY',
        language,
        body: tplBody,
        exampleValues: ['Hello from CastMe Pro'],
      });
      let status: 'APPROVED' | 'PENDING' | 'REJECTED' =
        created.status === 'APPROVED'
          ? 'APPROVED'
          : created.status === 'REJECTED'
            ? 'REJECTED'
            : 'PENDING';
      let externalId = created.externalTemplateId;

      if (status === 'PENDING' && waitForApproved) {
        const waited = await meta.waitForUtilityTemplateApproved({
          pageId: page.platformPageId,
          pageAccessToken: token,
          templateName: name,
          retries: 40,
          intervalMs: 3000,
        });
        status =
          waited.status === 'APPROVED'
            ? 'APPROVED'
            : waited.status === 'REJECTED'
              ? 'REJECTED'
              : 'PENDING';
        externalId = waited.externalTemplateId || externalId;
      }

      await persist(status, language, externalId);
      return { pageId, status, language, externalId };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      log?.({ err, pageId, language }, 'utility ensure: create failed');
    }
  }

  return {
    pageId,
    status: 'error',
    language: 'en',
    externalId: '',
    error: lastErr.slice(0, 400),
  };
}
