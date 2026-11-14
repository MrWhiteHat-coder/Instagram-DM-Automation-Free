# AutoDM — free, self-hosted Instagram comment → DM automation

Someone comments a keyword like **`REPO`** on your reel → they get a DM with a button → they tap it → AutoDM checks if they follow you → followers get your link, others are asked to follow first.

- **Free and open source** (MIT). Runs on your own Cloudflare account; the free plan is enough for most creators.
- **Your data stays with you.** No third-party service sits between you and Instagram.
- **Official Meta API only.** No password sharing, no browser bots, no scraping.
- **Premium dashboard**: automations with a live phone preview, post picker, keyword tester, 14-day analytics and conversion funnel, activity log, dark/light mode, mobile friendly.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_GITHUB_USERNAME/ig-comment-dm)

> **Read this before you start.** Meta's rules apply to every tool like this, including paid ones.
> Until Meta approves **your** Meta app (App Review + Business Verification, then switched to *Live*), AutoDM only replies to Instagram accounts you added as **testers** in that app. Real followers need the approval. Details in [Going public](#going-public).

---

## What you get

| | |
| --- | --- |
| **Automations** | Any post or one specific reel · several keywords · "word / anywhere / exact" matching · up to 5 public reply variations · DM with a button · optional follow gate with an "I followed" re-check · link as text or as a button |
| **Overview** | Comments matched, DMs sent, button taps, links delivered, daily chart, funnel, setup checklist |
| **Activity** | Every step with the person's username, filter by conversations / links / problems |
| **Safety** | Never DMs the same person twice for one automation (cooldown you choose) · ignores Meta's duplicate deliveries · checks Meta's signature on every webhook · password-protected dashboard with login rate limiting |
| **Maintenance** | Access token refreshed automatically every week (Instagram tokens expire after 60 days) · old activity cleaned after 90 days |

## How it works

| Step | What happens | Meta API |
| --- | --- | --- |
| 1 | Someone comments your keyword | `comments` webhook → `/webhook` |
| 2 | AutoDM sends one private reply with a button | `POST /<IG_ID>/messages` with `recipient.comment_id` |
| 3 | AutoDM replies publicly ("Check your DM 📩") | `POST /<COMMENT_ID>/replies` |
| 4 | They tap the button | `messaging_postbacks` webhook |
| 5 | AutoDM checks if they follow you (optional) | `GET /<IGSID>?fields=is_user_follow_business` |
| 6 | Follower → link. Not following → "please follow" + **I followed** button, which repeats step 5 | `POST /<IG_ID>/messages` |

Built with a Cloudflare Worker, D1 (SQLite) and static assets. No build step for the dashboard.

---

## Setup (about 20 minutes)

You need: an Instagram **Professional** account (Business or Creator) that is **public**, a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and a [Meta developer](https://developers.facebook.com/) account.

### 1. Create the Meta app

1. Open <https://developers.facebook.com/apps> → **Create app**.
2. Use case **Other** → app type **Business** → name and contact email.
3. Find the **Instagram** product → **Set up** → it adds **API setup with Instagram login**. Use this one.
4. Under "Generate access tokens", **Add account** and log in with your Instagram account.
5. Click **Generate token** and allow these permissions:
   - `instagram_business_basic`
   - `instagram_business_manage_comments`
   - `instagram_business_manage_messages`
6. Copy the **token** and the **Instagram app secret** shown on that page. Keep them private.

### 2. Deploy AutoDM

**Option A — one click.** Press the **Deploy to Cloudflare** button above. Cloudflare copies this repo to your GitHub, creates the database and asks for four secrets:

| Secret | Value |
| --- | --- |
| `META_APP_SECRET` | Instagram app secret from step 1 |
| `IG_ACCESS_TOKEN` | Token from step 1 |
| `WEBHOOK_VERIFY_TOKEN` | Any random text you invent (you'll paste it into Meta) |
| `ADMIN_PASSWORD` | Password for your dashboard. Make it long. |

**Option B — command line** (Node.js 20+):

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/ig-comment-dm.git
cd ig-comment-dm
npm install
npx wrangler login
npx wrangler secret put META_APP_SECRET
npx wrangler secret put IG_ACCESS_TOKEN
npx wrangler secret put WEBHOOK_VERIFY_TOKEN
npx wrangler secret put ADMIN_PASSWORD
npm run deploy
```

The first `wrangler secret put` may ask to create the Worker; say yes. `npm run deploy` creates the D1 database for you.

You get a URL like `https://ig-comment-dm.<you>.workers.dev`. Open it and sign in with your `ADMIN_PASSWORD`. A custom domain can be added in Cloudflare → Workers & Pages → your worker → Settings → Domains & Routes.

### 3. Connect the webhook

Open **Setup** in the dashboard. It shows your callback URL and verify token with copy buttons.

1. In Meta: **Instagram → API setup with Instagram login → Configure webhooks**.
2. Paste the **Callback URL** and **Verify token**, press **Verify and save**.
3. Subscribe to `comments`, `messages` and `messaging_postbacks`.
4. Back in the dashboard press **Subscribe my account** (this turns on notifications for your Instagram account).

### 4. Create an automation and test

1. **Automations → New automation**. The template is ready; change the keyword and add your link.
2. In Meta: **App roles → Roles** → add a second Instagram account as **Instagram Tester**. Accept the invite on that account.
3. From the second account, comment the keyword on one of your posts. Watch **Activity**.

Expected: DM with a button arrives, "Check your DM" appears under the comment, tapping gives the link (or the follow request).

If nothing shows in Activity, Meta did not deliver the webhook. Check the subscription, that both accounts are public, and that the tester invite was accepted. Live logs: `npx wrangler tail`.

---

## Going public

Meta's docs say comment webhooks for people without a role on your app need **Advanced Access**, a **Live** app and **Business Verification**.

1. **Business Verification** — Meta App Dashboard → App settings → Basic → Verification. Meta's Business Help Center lists the documents.
2. **App Review** — Instagram → API setup with Instagram login → *Complete app review*. Request Advanced Access for the three permissions. For each: describe the use and upload a screen recording of this flow (English UI or captions). You need at least one successful API call per permission in the last 30 days (your tester test does this; Meta says it can take up to 2 days to register). Also needed: app icon (1024×1024), privacy policy URL, app category.
3. Meta's submission guide says a decision usually comes **within a week**. Rejections happen; fix and resubmit.
4. Switch the app to **Live**.

## Limits from Meta you should know

- **One private reply per comment**, within **7 days** of the comment. More messages only after the person responds, within 24 hours.
- **Buttons in the first DM**: Meta's private-reply docs only show a text example. AutoDM tries the button; if Instagram refuses it, it sends text ending with "Reply YES to get the link." and treats their reply as the tap (changeable in Settings).
- **Follow check needs consent**: Instagram shares follow status only after the person has messaged you. A button tap may not count. If the check fails, Settings decides: send the link anyway (default) or ask them to follow.
- **750 private replies per hour** per account. A viral reel can hit this; extra comments in that hour fail and show in Activity.
- Your account must be **public**. Live video comments are not handled.

Sources are listed in [docs/META_DOCS.md](docs/META_DOCS.md).

## FAQ

**Is it really free?** The code is. Cloudflare's free Workers and D1 plans cover typical creator traffic; check Cloudflare's current limits if you get very large volume.

**Can I host it for other creators (like a SaaS)?** Not with this setup. Each creator deploys their own copy with their own Meta app. Serving other people's accounts makes you a "Tech Provider" in Meta's terms, which needs a login flow and its own App Review.

**My token stopped working.** Generate a new one in the Meta dashboard and update the `IG_ACCESS_TOKEN` secret. AutoDM switches to the new one automatically.

**Where is my data?** In the D1 database in your Cloudflare account: automations, settings, and activity (username, Instagram-scoped id, comment text) for 90 days.

## Develop locally

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in values; dummy values are fine for UI work
npm run dev                       # http://localhost:8787
npm test                          # unit tests (needs Node 22.5+ for node:sqlite)
npm run typecheck
```

Project layout:

```
src/index.ts      routes: /webhook, /api/*, daily cron
src/flow.ts       comment → DM → follow check → link
src/instagram.ts  Meta API calls
src/store.ts      D1 tables (created automatically)
src/api.ts        dashboard API (session cookie auth)
src/rules.ts      keyword matching and validation
public/           dashboard (HTML/CSS/JS, no build step)
test/             vitest tests
```

## Security

- Secrets live only in Cloudflare secrets, never in the repo or the database (except the auto-refreshed access token, stored in your own D1).
- Webhooks are checked with Meta's `X-Hub-Signature-256` signature.
- Dashboard sessions are signed `HttpOnly`, `Secure`, `SameSite=Strict` cookies; writes require JSON; 10 login attempts per 15 minutes per IP.
- Found a problem? Please open an issue without posting tokens or secrets.

## License

MIT. Not affiliated with or endorsed by Meta or Instagram.
