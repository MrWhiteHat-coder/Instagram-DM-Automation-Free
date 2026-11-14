/**
 * Thin client for the Instagram API with Instagram Login (host graph.instagram.com).
 * Endpoints and payload shapes follow Meta's docs, listed in docs/META_DOCS.md.
 */
export class InstagramApiError extends Error {
  constructor(public status: number, public body: unknown, where: string) {
    super(`Instagram API ${where} failed (HTTP ${status}): ${summarize(body)}`);
  }
}

function summarize(body: any): string {
  const e = body?.error;
  if (e?.message) return `${e.message}${e.code ? ` [code ${e.code}]` : ""}`;
  return JSON.stringify(body)?.slice(0, 300) ?? "no body";
}

export type Button = { type: "postback"; title: string; payload: string } | { type: "web_url"; title: string; url: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Account {
  userId: string;
  username: string;
  picture: string | null;
  followers: number | null;
  mediaCount: number | null;
}

export interface Media {
  id: string;
  caption: string;
  type: string;
  productType: string;
  thumb: string | null;
  permalink: string;
  timestamp: string;
}

export class InstagramClient {
  private base: string;

  constructor(
    private accessToken: string,
    apiVersion: string,
    private fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
    this.base = `https://graph.instagram.com/${apiVersion}`;
  }

  private async call(where: string, path: string, init: RequestInit = {}): Promise<any> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.accessToken}`, ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new InstagramApiError(res.status, body, where);
    return body;
  }

  private postJson(where: string, path: string, payload: unknown) {
    return this.call(where, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  /** POST /<COMMENT_ID>/replies — public reply under the comment. */
  replyToComment(commentId: string, message: string) {
    return this.call("replyToComment", `/${commentId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message }).toString(),
    });
  }

  /** POST /<IG_ID>/messages with recipient.comment_id. Meta allows ONE per comment, within 7 days. */
  privateReply(igId: string, commentId: string, message: object): Promise<{ recipient_id?: string; message_id?: string }> {
    return this.postJson("privateReply", `/${igId}/messages`, { recipient: { comment_id: commentId }, message });
  }

  /** POST /<IG_ID>/messages with recipient.id — only inside the 24h window after the user interacts. */
  sendMessage(igId: string, igsid: string, message: object) {
    return this.postJson("sendMessage", `/${igId}/messages`, { recipient: { id: igsid }, message });
  }

  /** GET /<IGSID>?fields=is_user_follow_business — Meta requires user consent (they messaged you first). */
  async userFollowsBusiness(igsid: string): Promise<boolean> {
    const body = await this.call("userFollowsBusiness", `/${igsid}?fields=is_user_follow_business`);
    if (typeof body?.is_user_follow_business !== "boolean") {
      throw new InstagramApiError(200, body, "userFollowsBusiness (field missing)");
    }
    return body.is_user_follow_business;
  }

  /** GET /me — the connected professional account. */
  async getAccount(): Promise<Account> {
    const b = await this.call("getAccount", "/me?fields=user_id,username,profile_picture_url,followers_count,media_count");
    return {
      userId: String(b.user_id ?? b.id ?? ""),
      username: b.username ?? "",
      picture: b.profile_picture_url ?? null,
      followers: b.followers_count ?? null,
      mediaCount: b.media_count ?? null,
    };
  }

  /** POST /me/subscribed_apps — turns on webhook notifications for this account. */
  async subscribeApp(fields: string): Promise<boolean> {
    const b = await this.call("subscribeApp", `/me/subscribed_apps?subscribed_fields=${encodeURIComponent(fields)}`, { method: "POST" });
    return b?.success === true;
  }

  /** GET /me/media — recent posts and reels, for the post picker. */
  async listMedia(limit = 30): Promise<Media[]> {
    const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";
    const b = await this.call("listMedia", `/me/media?fields=${fields}&limit=${limit}`);
    return (b?.data ?? []).map((m: any) => ({
      id: String(m.id),
      caption: m.caption ?? "",
      type: m.media_type ?? "",
      productType: m.media_product_type ?? "",
      thumb: m.thumbnail_url ?? (m.media_type === "VIDEO" ? null : m.media_url) ?? null,
      permalink: m.permalink ?? "",
      timestamp: m.timestamp ?? "",
    }));
  }
}

/**
 * GET https://graph.instagram.com/refresh_access_token — long-lived tokens (60 days) can be refreshed
 * once they are at least 24 hours old and not yet expired.
 */
export async function refreshLongLivedToken(token: string, fetchImpl: FetchLike = (i, init) => fetch(i, init)) {
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  const res = await fetchImpl(url);
  const body: any = await res.json().catch(() => null);
  if (!res.ok || typeof body?.access_token !== "string") throw new InstagramApiError(res.status, body, "refreshToken");
  return { token: body.access_token as string, expiresIn: Number(body.expires_in) || 0 };
}

export const textMessage = (text: string) => ({ text });

/** Button template: text up to 640 characters with 1-3 buttons. Postback taps arrive as messaging_postbacks. */
export const buttonMessage = (text: string, buttons: Button[]) => ({
  attachment: {
    type: "template",
    payload: { template_type: "button", text, buttons },
  },
});
