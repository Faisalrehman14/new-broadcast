/**
 * Page-level Utility Messaging eligibility — ported from fb-page-manager page-token-health.
 * Prevents fanning out Graph "outside window" on Pages missing pages_utility_messaging.
 */

export type UtilityEligibility = {
  /** true = ok to send UTILITY; false = blocked; null = unknown (try send) */
  eligible: boolean | null;
  reason: string | null;
  pageTokenFromAccounts: string | null;
};

type DebugTokenData = {
  is_valid?: boolean;
  scopes?: string[];
  granular_scopes?: Array<{ scope?: string; target_ids?: Array<string | number> }>;
};

export async function inspectDebugToken(params: {
  graphVersion: string;
  appId: string;
  appSecret: string;
  inputToken: string;
}): Promise<DebugTokenData | null> {
  if (!params.appId || !params.appSecret || !params.inputToken) return null;
  const appToken = `${params.appId}|${params.appSecret}`;
  const qs = new URLSearchParams({
    input_token: params.inputToken,
    access_token: appToken,
  });
  const res = await fetch(
    `https://graph.facebook.com/${params.graphVersion}/debug_token?${qs}`
  );
  if (!res.ok) return null;
  try {
    const json = (await res.json()) as { data?: DebugTokenData };
    return json.data || null;
  } catch {
    return null;
  }
}

function grantUtilityForPage(data: DebugTokenData | null, pageId: string): boolean | null {
  if (!data) return null;
  const pid = String(pageId);
  const granular = data.granular_scopes || [];
  const hit = granular.find((g) => g.scope === 'pages_utility_messaging');
  if (hit) {
    const targets = (hit.target_ids || []).map(String);
    if (!targets.length) return true; // granted without target list
    return targets.includes(pid);
  }
  if (Array.isArray(data.scopes) && data.scopes.includes('pages_utility_messaging')) {
    // Scope present but no granular target list — inconclusive for this Page.
    return null;
  }
  return false;
}

export async function resolveMeAccountsPageToken(params: {
  graphVersion: string;
  userAccessToken: string;
  platformPageId: string;
}): Promise<string | null> {
  const qs = new URLSearchParams({
    fields: 'id,name,access_token',
    access_token: params.userAccessToken,
    limit: '100',
  });
  const res = await fetch(
    `https://graph.facebook.com/${params.graphVersion}/me/accounts?${qs}`
  );
  if (!res.ok) return null;
  try {
    const json = (await res.json()) as {
      data?: Array<{ id: string; access_token?: string }>;
    };
    const hit = (json.data || []).find((p) => String(p.id) === String(params.platformPageId));
    return hit?.access_token || null;
  } catch {
    return null;
  }
}

/**
 * Utility eligibility for a Page before outside-24h fan-out.
 * Prefer /me/accounts page token (picker). Secondary: debug_token granular grant.
 */
export async function assessPageUtilityEligibility(params: {
  graphVersion: string;
  appId: string;
  appSecret: string;
  userAccessToken: string | null;
  platformPageId: string;
  pageAccessToken: string;
}): Promise<UtilityEligibility> {
  const pid = String(params.platformPageId);
  let pageTokenFromAccounts: string | null = null;

  if (params.userAccessToken) {
    pageTokenFromAccounts = await resolveMeAccountsPageToken({
      graphVersion: params.graphVersion,
      userAccessToken: params.userAccessToken,
      platformPageId: pid,
    });
  }

  const debugUser = params.userAccessToken
    ? await inspectDebugToken({
        graphVersion: params.graphVersion,
        appId: params.appId,
        appSecret: params.appSecret,
        inputToken: params.userAccessToken,
      })
    : null;
  const grant = grantUtilityForPage(debugUser, pid);

  // Strong negative: Meta proved this Page is not in the utility grant.
  if (grant === false) {
    return {
      eligible: false,
      reason:
        'This Page is missing Utility Messaging. Reconnect Facebook, tick this Page in the picker, and approve pages_utility_messaging.',
      pageTokenFromAccounts,
    };
  }

  // Strong positive: Page appears on /me/accounts (classic picker token).
  if (pageTokenFromAccounts) {
    return {
      eligible: true,
      reason: null,
      pageTokenFromAccounts,
    };
  }

  // Page token works for templates but may still POST UTILITY as Graph #10 if not from picker.
  if (grant === true) {
    return {
      eligible: true,
      reason: null,
      pageTokenFromAccounts: null,
    };
  }

  return {
    eligible: null,
    reason: null,
    pageTokenFromAccounts,
  };
}

export const PAGE_UTILITY_PICKER_MESSAGE =
  'This Page was not selected for Utility Messaging. Reconnect Facebook, select this Page in the Facebook picker, and approve Utility Messaging. Other Pages can keep sending.';
