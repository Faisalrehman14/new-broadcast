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

/** Paginate /me/accounts so multi-Page workspaces are not truncated at 100. */
export async function listMeAccountsPages(params: {
  graphVersion: string;
  userAccessToken: string;
}): Promise<{ ok: boolean; pages: Array<{ id: string; access_token?: string }> }> {
  const pages: Array<{ id: string; access_token?: string }> = [];
  let url: string | null =
    `https://graph.facebook.com/${params.graphVersion}/me/accounts?` +
    new URLSearchParams({
      fields: 'id,name,access_token',
      access_token: params.userAccessToken,
      limit: '100',
    }).toString();

  let guard = 0;
  while (url && guard < 20) {
    guard += 1;
    const res = await fetch(url);
    if (!res.ok) return { ok: false, pages };
    try {
      const json = (await res.json()) as {
        data?: Array<{ id: string; access_token?: string }>;
        paging?: { next?: string };
        error?: unknown;
      };
      if (json.error) return { ok: false, pages };
      pages.push(...(json.data || []));
      url = json.paging?.next || null;
    } catch {
      return { ok: false, pages };
    }
  }
  return { ok: true, pages };
}

export async function resolveMeAccountsPageToken(params: {
  graphVersion: string;
  userAccessToken: string;
  platformPageId: string;
}): Promise<string | null> {
  const listed = await listMeAccountsPages({
    graphVersion: params.graphVersion,
    userAccessToken: params.userAccessToken,
  });
  if (!listed.ok) return null;
  const hit = listed.pages.find((p) => String(p.id) === String(params.platformPageId));
  return hit?.access_token || null;
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
  let accountsListedOk = false;

  if (params.userAccessToken) {
    const listed = await listMeAccountsPages({
      graphVersion: params.graphVersion,
      userAccessToken: params.userAccessToken,
    });
    accountsListedOk = listed.ok;
    if (listed.ok) {
      const hit = listed.pages.find((p) => String(p.id) === pid);
      pageTokenFromAccounts = hit?.access_token || null;
    }
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
      reason: PAGE_UTILITY_PICKER_MESSAGE,
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

  // User token can list accounts, but this Page was not ticked in the picker.
  // Do NOT mark ready — stale Page tokens still list templates but UTILITY POST fails as outside_window.
  if (accountsListedOk && grant !== true) {
    return {
      eligible: false,
      reason: PAGE_UTILITY_PICKER_MESSAGE,
      pageTokenFromAccounts: null,
    };
  }

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
