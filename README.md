# Sparkles

Your network on a world map. Say what you want to do ("I want to get better at jazz piano", "Who could help me with fundraising?"), and Sparkles finds the right people in your network, suggests small plans, and drafts the message.

- **Map:** everyone you know, placed by city, grouped into your own circles.
- **Ask:** type a goal, interest or trip. Claude picks people from *your* list (never invented), suggests 2–4 plans and a few real places.
- **Plans:** draft a message, copy it, mark the plan as planned.
- **People:** import a CSV (LinkedIn's Connections.csv works), add notes, interests and cities.
- **Invite-only:** you create invite links; each person gets their own private map.

## 0. No-setup version on claude.ai

`node scripts/build-artifact.mjs` builds `dist/sparkles.html`: the same app as one page that runs on claude.ai, saving each person's data privately to their Claude account and using their own Claude access for AI. Publish it as a Claude artifact and share the link; no server, Supabase or API key needed. People need a Claude account to use it.

## 1. Run it on your computer (5 minutes)

You need [Node.js 20 or newer](https://nodejs.org).

```bash
npm install
cp .env.example .env.local      # optionally add ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000. With no Supabase keys this is **local mode**: one user, no sign-in, data saved in `.data/` in this folder. Good for trying it out.

## 2. Turn on accounts and invites (Supabase, free tier is fine)

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, paste and run `supabase/migrations/0001_sparkles.sql`.
3. In **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` (later your real address)
   - Redirect URLs: add `http://localhost:3000/**` (and later `https://your-domain/**`)
4. In **Project Settings → API**, copy the URL, the `anon` key and the `service_role` key into `.env.local`.
5. Put your own email in `ADMIN_EMAILS`, then restart `npm run dev`.
6. Go to http://localhost:3000/login, enter your email, and click the link in the email.
7. Open the account menu (top right) → **Invite people** → **Create invite link**, and send the link.

People who open an invite link enter their email, click the sign-in link, and land on their own empty map. Links can be locked to one email, allow several uses, and expire. You can revoke them.

> Supabase's built-in email sender only sends a few emails per hour. Before a real pilot, add your own SMTP provider in **Authentication → Emails → SMTP settings** (Resend, Postmark, SES…).

## 3. Put it online (Vercel)

1. Push this folder to a GitHub repository.
2. Import it at [vercel.com/new](https://vercel.com/new).
3. Add the same environment variables, with `NEXT_PUBLIC_SITE_URL` set to your Vercel address.
4. In Supabase, add `https://your-app.vercel.app/**` to the Redirect URLs and set it as the Site URL.

## How it works

| Piece | Where |
|---|---|
| Map and panel UI | `components/atlas-engine.ts` (d3, renders into `components/Atlas.tsx`) |
| Pages | `app/page.tsx` (map), `app/login`, `app/invite/[code]`, `app/admin`, `app/no-access` |
| API | `app/api/*` — every route checks the person is a signed-in member |
| Data | `lib/store/supabase.ts` (Supabase, row level security) or `lib/store/local.ts` (local mode) |
| AI | `lib/ai.ts` — maps, drafts, next steps, city lookup, each with a non-AI fallback |
| Cities | `lib/geo/gazetteer.json` (~3,700 cities, GeoNames via all-the-cities) + `tz-lookup`; Claude looks up the rest |
| Database | `supabase/migrations/0001_sparkles.sql` |

**Privacy.** Each person's people, notes and maps are visible only to them (row level security on every table; non-members can't read or write anything). Invites are only readable by the server. When someone asks Sparkles something, up to 160 of their most relevant contacts (name, city, role, interests, notes) are sent to the Anthropic API to answer it.

**Circles.** Everyone starts with Work, Friends and Family and can rename, recolor, remove or add circles (up to 12) in the People tab.

## Not built yet

- Automatic refresh from Gmail, Calendar or LinkedIn (imports are CSV for now; LinkedIn exports don't include cities).
- Sharing a plan with the other person inside the app (today you copy the drafted message).
- Usage limits per member for AI calls.
