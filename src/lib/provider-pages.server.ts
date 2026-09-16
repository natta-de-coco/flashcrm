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
    const body = await response.json();
    if (!response.ok || body.error)
      throw new Error(
        `The provider could not list accounts (HTTP ${response.status}). Please retry or ask a FLAS administrator.`,
      );
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
