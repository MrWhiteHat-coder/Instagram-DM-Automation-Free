import { handleApi } from "./api";
import { handleWebhook, jsonLog } from "./flow";
import { detectApiMode, InstagramClient } from "./instagram";
import { privacyHtml } from "./privacy";
import { verifySignature } from "./signature";
import { Store } from "./store";
import { currentToken, maybeRefreshToken } from "./token";

export interface Env {
  DB: D1Database;
  GRAPH_API_VERSION: string;
  // Secrets: `.dev.vars` locally, `wrangler secret put` (or the Deploy button form) when deployed.
  META_APP_SECRET: string;
  IG_ACCESS_TOKEN: string;
  WEBHOOK_VERIFY_TOKEN: string;
  ADMIN_PASSWORD: string;
  /** Optional: "unified" or "instagram". Normally detected from the token. */
  IG_API_MODE?: string;
}

/** Meta's verification handshake: echo hub.challenge when hub.verify_token matches ours. */
export function verificationResponse(url: URL, verifyToken: string | undefined): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && verifyToken && token === verifyToken && challenge !== null) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

async function webhook(request: Request, env: Env, ctx: ExecutionContext, store: Store): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET") return verificationResponse(url, env.WEBHOOK_VERIFY_TOKEN);
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (!env.META_APP_SECRET || !env.IG_ACCESS_TOKEN) {
    jsonLog("error", { kind: "config", error: "META_APP_SECRET or IG_ACCESS_TOKEN is not set" });
    return new Response("Server not configured", { status: 500 });
  }

  const rawBody = await request.text();
  if (!(await verifySignature(rawBody, request.headers.get("X-Hub-Signature-256"), env.META_APP_SECRET))) {
    jsonLog("rejected", { reason: "bad_signature" });
    return new Response("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // Answer Meta straight away and do the API calls afterwards.
  ctx.waitUntil(
    (async () => {
      await store.setValue("last_webhook_at", String(Date.now()));
      const { token } = await currentToken(store, env.IG_ACCESS_TOKEN);
      const ig = new InstagramClient(token, env.GRAPH_API_VERSION || "v27.0", undefined, detectApiMode(token, env.IG_API_MODE));
      await handleWebhook(body, { ig, store });
    })().catch((e) => jsonLog("error", { kind: "webhook", error: String(e) })),
  );
  return new Response("EVENT_RECEIVED", { status: 200 });
}

/** Public privacy policy (Meta App Review needs a URL for one). */
export async function privacyPage(store: Store): Promise<Response> {
  const [settings, username] = await Promise.all([store.getSettings(), store.getValue("account_username")]);
  return new Response(privacyHtml({ ownerName: settings.ownerName, contactEmail: settings.contactEmail, username }), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=60",
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const store = new Store(env.DB);
    await store.init();

    if (url.pathname === "/webhook") return webhook(request, env, ctx, store);
    if (url.pathname === "/privacy") return privacyPage(store);
    if (url.pathname.startsWith("/api/")) return handleApi(request, { env, store });
    // Everything else is the dashboard, served from ./public by Workers static assets.
    return new Response("Not found", { status: 404 });
  },

  /** Daily: clean old rows and keep the 60-day access token alive. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const store = new Store(env.DB);
    ctx.waitUntil(
      (async () => {
        await store.init();
        await store.cleanup();
        try {
          const r = await maybeRefreshToken(store, env.IG_ACCESS_TOKEN, { minAgeDays: 7, modeOverride: env.IG_API_MODE });
          jsonLog("token_refresh", r);
        } catch (e) {
          jsonLog("token_refresh_failed", { error: String(e) });
          await store.logEvent("error", { detail: `Token refresh failed: ${String(e)}` });
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
