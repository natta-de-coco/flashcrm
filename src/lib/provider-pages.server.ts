// Never retain provider prose: error bodies may echo credentials, URLs or personal data.
const SAFE_REASONS = new Set([
  "accessNotConfigured",
  "SERVICE_DISABLED",
  "quotaExceeded",
  "dailyLimitExceeded",
  "rateLimitExceeded",
  "insufficientPermissions",
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
  "youtubeSignupRequired",
  "channelNotFound",
]);
export interface ProviderErrorDetails {
  status: number;
  code: number | null;
  reason: string | null;
}
export class ProviderPagesError extends Error {
  readonly status: number;
  readonly providerReason: string | null;
  readonly providerCode: number | null;
  constructor(message: string, details: ProviderErrorDetails) {
    super(message);
    this.name = "ProviderPagesError";
    this.status = details.status;
    this.providerReason = details.reason;
    this.providerCode = details.code;
  }
}
export function extractProviderError(status: number, body: unknown): ProviderErrorDetails {
  const details: ProviderErrorDetails = { status, code: null, reason: null };
  if (!body || typeof body !== "object") return details;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return details;
  const raw = error as Record<string, unknown>;
  if (typeof raw["code"] === "number" && Number.isSafeInteger(raw["code"]))
    details.code = raw["code"];
  // Google may put ErrorInfo after other detail objects. Inspect all bounded entries.
  const candidates: unknown[] = [raw["status"]];
  for (const key of ["errors", "details"]) {
    const entries = raw[key];
    if (Array.isArray(entries)) {
      for (const entry of entries.slice(0, 20)) {
        if (entry && typeof entry === "object") candidates.push(entry.reason);
      }
    }
  }
  details.reason =
    candidates.find(
      (value): value is string => typeof value === "string" && SAFE_REASONS.has(value),
    ) ?? null;
  return details;
}

/** Fetch every page without following provider-supplied URLs with credentials. */
export async function providerPages<T>(args: {
  url: string;
  token: string;
  items: string;
  pagination?: "google" | "meta" | "linkedin";
  headers?: Record<string, string>;
}): Promise<T[]> {
  const all: T[] = [];
  const seen = new Set<string>();
  const url = new URL(args.url);
  for (let page = 0; page < 100; page++) {
    const response = await fetch(url.toString(), {
      headers: { ...args.headers, Authorization: `Bearer ${args.token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) {
      const details = extractProviderError(response.status, body);
      throw new ProviderPagesError(
        `The provider could not list accounts (HTTP ${response.status}). Please retry or ask a FLAS administrator.`,
        details,
      );
    }
    if (body[args.items] !== undefined && !Array.isArray(body[args.items]))
      throw new Error("The provider returned an invalid account list.");
    all.push(...(body[args.items] ?? []));
    if (args.pagination === "linkedin") {
      const count = (body[args.items] ?? []).length;
      const start = Number(url.searchParams.get("start") ?? 0);
      const total = body.paging?.total;
      if (count === 0 || (typeof total === "number" ? start + count >= total : count < 50))
        return all;
      url.searchParams.set("start", String(start + count));
      continue;
    }
    if (args.pagination === "meta" && body.paging?.next && !body.paging?.cursors?.after)
      throw new Error("The provider returned an incomplete account page. Please retry.");
    const next =
      args.pagination === "meta"
        ? body.paging?.next && body.paging?.cursors?.after
        : body.nextPageToken;
    if (!next) return all;
    if (typeof next !== "string" || seen.has(next))
      throw new Error("The provider repeated an account page. Please retry.");
    seen.add(next);
    url.searchParams.set(args.pagination === "meta" ? "after" : "pageToken", next);
  }
  throw new Error("The account list is too large to load safely. Please ask a FLAS administrator.");
}
