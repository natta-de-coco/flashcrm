// Server functions the browser half of the two-factor suite can call "over
// the wire" without a network: the call goes through the app's own client
// middleware (src/start.ts), then the app's own server middleware and
// requireSupabaseAuth, in this process.
//
// The "wire" is the part the compiler and the network normally provide. It
// carries the headers the client middleware set, and hands a thrown error back
// as an Error with the same message -- which is what the framework's
// serialiser does with one.
import { createServerFn } from "@tanstack/react-start";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { startInstance } from "@/start";

/** Everything the suite watches, reset between tests. */
export const watched = {
  /** Every address the pages asked the router for, in order. */
  navigations: [],
  /** Every server function whose handler actually ran: { name, userId }. */
  served: [],
  /** Every server call the browser started, whether or not the server took it: { name, authorization }. */
  sent: [],
  /** Every toast the pages showed: { kind, message }. */
  toasts: [],
  reset() {
    this.navigations.length = 0;
    this.served.length = 0;
    this.sent.length = 0;
    this.toasts.length = 0;
  },
};

/** One call arriving at the server, exactly as the server suite makes it. */
async function arriveAtServer(fn, headers, data) {
  const request = new Request("https://app.test/_serverFn/abc", { method: "POST", headers });
  return runWithStartContext(
    {
      startOptions: await startInstance.getOptions(),
      request,
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    },
    () => fn.__executeServer({ data, method: "POST", context: {} }),
  );
}

export function serverFunction(
  name,
  { open = false, file = "src/lib/example.functions.ts", throws = null } = {},
) {
  const builder = createServerFn({ method: "POST" });
  const wire = Object.assign(
    async (payload) => {
      watched.sent.push({
        name,
        authorization: new Headers(payload.headers ?? {}).get("authorization"),
      });
      const outcome = await arriveAtServer(fn, payload.headers, payload.data);
      if (outcome.error) throw new Error(outcome.error.message);
      return { result: outcome.result, error: undefined, context: outcome.context };
    },
    { serverFnMeta: { id: `id-${name}`, name, filename: file } },
  );
  const fn = (open ? builder : builder.middleware([requireSupabaseAuth])).handler(
    wire,
    async ({ context }) => {
      // A handler that fails for its own reasons, nothing to do with signing in.
      if (throws) throw new Error(throws);
      watched.served.push({ name, userId: context.userId ?? null });
      return { ok: true };
    },
  );
  // The browser half of a server function reads the start options the browser
  // build was given. Here there is no build, only Node, where the same lookup
  // reads Start's context; so the call is made inside one holding those options.
  const fromTheBrowser = async (options) =>
    runWithStartContext(
      {
        startOptions: await startInstance.getOptions(),
        request: undefined,
        contextAfterGlobalMiddlewares: {},
        executedRequestMiddlewares: new Set(),
      },
      () => fn(options),
    );
  return Object.assign(fromTheBrowser, { __executeServer: fn.__executeServer });
}

/** What the server alone says to this bearer token, with no browser reaction around it. */
export async function serverAnswer(fn, token) {
  return arriveAtServer(fn, token ? { authorization: `Bearer ${token}` } : {}, undefined);
}

/** The heartbeat the signed-in layout sends: the one server call every signed-in screen makes. */
export const touchPresence = serverFunction("touchPresence", {
  file: "src/lib/presence.functions.ts",
});
