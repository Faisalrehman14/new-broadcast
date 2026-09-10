/**
 * Meta Graph Platform / Business Use Case rate-limit headers.
 * @see https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
 */

export type MetaRateLimitSnapshot = {
  source: 'buc' | 'app' | 'none';
  /** Highest of call_count / total_cputime / total_time (0–100+). */
  maxUsagePercent: number;
  callCount?: number;
  totalCpuTime?: number;
  totalTime?: number;
  /** Minutes until Meta expects throttle to clear (BUC only). */
  estimatedTimeToRegainAccessMin?: number;
  type?: string;
  businessObjectId?: string;
};

type HeaderBag =
  | Headers
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

function headerGet(headers: HeaderBag, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === 'function') {
    return (
      (headers as Headers).get(name) ||
      (headers as Headers).get(name.toLowerCase()) ||
      (headers as Headers).get(name.toUpperCase())
    );
  }
  const rec = headers as Record<string, string | string[] | undefined>;
  const raw = rec[name] ?? rec[name.toLowerCase()] ?? rec[name.toUpperCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

function parseJsonHeader(raw: string | null): unknown {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

type BucEntry = {
  type?: string;
  call_count?: number;
  total_cputime?: number;
  total_time?: number;
  estimated_time_to_regain_access?: number;
};

/**
 * Parse `X-Business-Use-Case-Usage` / `X-App-Usage` from a Graph response.
 * Prefers Pages / Messenger BUC entries when present.
 */
export function parseMetaRateLimitHeaders(headers: HeaderBag): MetaRateLimitSnapshot {
  const bucRaw = parseJsonHeader(
    headerGet(headers, 'X-Business-Use-Case-Usage') ||
      headerGet(headers, 'x-business-use-case-usage')
  );
  if (bucRaw && typeof bucRaw === 'object') {
    let best: MetaRateLimitSnapshot | null = null;
    for (const [businessObjectId, entries] of Object.entries(
      bucRaw as Record<string, BucEntry[] | BucEntry>
    )) {
      const list = Array.isArray(entries) ? entries : [entries];
      for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const callCount = asNum(entry.call_count);
        const totalCpuTime = asNum(entry.total_cputime);
        const totalTime = asNum(entry.total_time);
        const maxUsagePercent = Math.max(callCount ?? 0, totalCpuTime ?? 0, totalTime ?? 0);
        const estimated = asNum(entry.estimated_time_to_regain_access);
        const snap: MetaRateLimitSnapshot = {
          source: 'buc',
          maxUsagePercent,
          callCount,
          totalCpuTime,
          totalTime,
          estimatedTimeToRegainAccessMin: estimated,
          type: typeof entry.type === 'string' ? entry.type : undefined,
          businessObjectId,
        };
        const preferType =
          snap.type === 'pages' || snap.type === 'messenger' || snap.type === 'instagram';
        const bestPrefer =
          best?.type === 'pages' || best?.type === 'messenger' || best?.type === 'instagram';
        if (
          !best ||
          (preferType && !bestPrefer) ||
          (preferType === bestPrefer && snap.maxUsagePercent > best.maxUsagePercent) ||
          (!preferType && !bestPrefer && snap.maxUsagePercent > best.maxUsagePercent)
        ) {
          best = snap;
        }
      }
    }
    if (best) return best;
  }

  const appRaw = parseJsonHeader(
    headerGet(headers, 'X-App-Usage') || headerGet(headers, 'x-app-usage')
  );
  if (appRaw && typeof appRaw === 'object') {
    const o = appRaw as Record<string, unknown>;
    const callCount = asNum(o.call_count);
    const totalCpuTime = asNum(o.total_cputime);
    const totalTime = asNum(o.total_time);
    return {
      source: 'app',
      maxUsagePercent: Math.max(callCount ?? 0, totalCpuTime ?? 0, totalTime ?? 0),
      callCount,
      totalCpuTime,
      totalTime,
    };
  }

  return { source: 'none', maxUsagePercent: 0 };
}

/** Meta docs: stop hammering once usage is near the ceiling. */
export const META_USAGE_SOFT_PCT = 70;
export const META_USAGE_HARD_PCT = 90;
