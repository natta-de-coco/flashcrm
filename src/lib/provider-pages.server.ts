const SECRET_PATTERNS: RegExp[] = [
  /access_token=[^&\s"']+/gi,
  /client_secret=[^&\s"']+/gi,
  /refresh_token=[^&\s"']+/gi,
  /code_verifier=[^&\s"']+/gi,
  /\bcode=[^&\s"']{8,}/gi,
  /\bstate=[^&\s"']{16,}/gi,
  /(["']?(?:access_token|client_secret|refresh_token|app_secret|api_key|password|code_verifier)["']?\s*[:=]\s*)["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /\bEAA[A-Za-z0-9]{20,}\b/g,
];

export function redactSecrets(input: string | null | undefined): string | null {
  if (!input) return null;
  let out = String(input);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out.slice(0, 2000);
}

export interface ProviderErrorDetails {
  status: number;
  code: string | number | null;
  reason: string | null;
  domain: string | null;
  message: string | null;
}

export class ProviderPagesError extends Error {
  readonly status: number;
  readonly providerReason: string | null;
  readonly providerCode: string | number | null;
  readonly providerDomain: string | null;
  readonly providerMessage: string | null;

  constructor(message: string, details: ProviderErrorDetails) {
    super(message);
    this.name = "ProviderPagesError";
    this.status = details.status;
    this.providerReason = details.reason;
    this.providerCode = details.code;
    this.providerDomain = details.domain;
    this.providerMessage = details.message;
  }
}

interface RawProviderErrorBody {
  error?:
    | {
        code?: number | string;
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string; domain?: string; message?: string }>;
        details?: Array<{ reason?: string; domain?: string }>;
        type?: string;
        error_subcode?: number | string;
      }
    | string;
  message?: string;
  serviceErrorCode?: number | string;
}

export function extractProviderError(status: number, body: unknown): ProviderErrorDetails {
  const details: ProviderErrorDetails = {
    status,
    code: null,
    reason: null,
    domain: null,
    message: null,
  };

  if (!body || typeof body !== "object") return details;
  const b = body as RawProviderErrorBody;

  // Google error shape: { error: { code, message, status, errors: [{ reason, domain, message }], details: [{ reason, domain }] } }
  if (b.error && typeof b.error === "object") {
    details.code = b.error.code ?? b.error.status ?? null;
    if (typeof b.error.message === "string") {
      details.message = redactSecrets(b.error.message)?.slice(0, 300) ?? null;
    }
    if (Array.isArray(b.error.errors) && b.error.errors.length > 0) {
      const first = b.error.errors[0];
      if (first && typeof first === "object") {
        details.reason = first.reason ? String(first.reason).slice(0, 100) : null;
        details.domain = first.domain ? String(first.domain).slice(0, 100) : null;
        if (!details.message && typeof first.message === "string") {
          details.message = redactSecrets(first.message)?.slice(0, 300) ?? null;
        }
      }
    }
    if (!details.reason && Array.isArray(b.error.details) && b.error.details.length > 0) {
      const firstDetail = b.error.details[0];
      if (firstDetail && typeof firstDetail === "object" && firstDetail.reason) {
        details.reason = String(firstDetail.reason).slice(0, 100);
      }
    }
  } else if (typeof b.error === "string") {
    details.reason = redactSecrets(b.error)?.slice(0, 100) ?? null;
  }

  // LinkedIn shape: { message, status, serviceErrorCode }
  if (!details.message && typeof b.message === "string") {
    details.message = redactSecrets(b.message)?.slice(0, 300) ?? null;
  }
  if (!details.code && b.serviceErrorCode != null) {
    details.code = String(b.serviceErrorCode);
  }

  // Meta shape: { error: { message, type, code, error_subcode } }
  if (b.error && typeof b.error === "object") {
    if (!details.code && b.error.code != null) {
      details.code = String(b.error.code);
    }
    if (!details.reason && b.error.type != null) {
      details.reason = String(b.error.type).slice(0, 100);
    }
  }

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
