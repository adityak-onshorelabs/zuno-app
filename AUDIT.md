# Zuno Technical Audit — April 2026

---

## 1. Architectural Debt

### 1.1 `API_BASE` Hardcoded Across Every Component
`"http://localhost:5000"` appears in **five separate files**: `AuthForm.tsx`, `WalletBuilder.tsx`, `dashboard/page.tsx`, `analytics/page.tsx`, and `MilestoneCard.tsx`. There is no shared constant, no env var (`NEXT_PUBLIC_API_BASE`), no central API client. Every fetch is an ad-hoc one-liner. This is the clearest sign of incremental generation — each component was built in isolation and copied the URL. Deploying to any non-local environment will require hunting down every occurrence.

### 1.2 `getUserId()` Duplicated Four Times
The function is copy-pasted in every page/component that touches auth. The implementations aren't even identical — `WalletBuilder.tsx:21` returns `"user_123"` as a fallback on SSR, while the others return `""`. This divergence is a latent bug: if the wallet page ever SSR-renders even briefly, it will send wallet requests for the fake `user_123` account.

```ts
// WalletBuilder.tsx:21 — WRONG fallback
return localStorage.getItem("zuno_user_id") ?? "user_123";

// analytics/page.tsx:15 — correct
return localStorage.getItem("zuno_user_id") ?? "";
```

### 1.3 No Shared Type Definitions
`RankedCard`, `WalletCard`, `MilestoneProgress`, and `TrackerEntry` are re-declared in every file that uses them. There is no `src/types/` module. Drift between these shadow types is already visible: `analytics/page.tsx` uses an inline anonymous type for its `.map()` cast instead of importing the shared shape.

### 1.4 Mixed Styling Discipline
The project uses Tailwind utility classes and raw `style={{}}` objects interchangeably — sometimes on adjacent elements within the same component. `dashboard/page.tsx` is the worst offender: the segmented control uses raw `style` objects while the skeleton around it uses Tailwind. This is purely a generative artifact; each AI pass picked a different idiom.

### 1.5 `SpendGuideSheet` / Dashboard Coupling Gap
CLAUDE.md documents a `SpendGuideSheet` with a `cardDetail` prop for a tappable VirtualCard→sheet flow. The current `dashboard/page.tsx` has **no sheet at all** — it renders flat `RecommendationCard` tiles with no tap-to-detail action. The entire inline expand flow described in Milestone 6 is missing from the current code. The component `SpendGuideSheet.tsx` likely still exists but is no longer wired into the dashboard.

---

## 2. Edge Case Resilience

### 2.1 Race Condition in Dashboard's Parallel Spend-Guide Fetch
`dashboard/page.tsx:130–159` fires 8 concurrent `POST /api/spend-guide` requests on mount. If the component unmounts before all resolve (user navigates away), all 8 `.then()` callbacks will still call `setRecommendations` and `setFeedLoading` on the unmounted component. React 18 suppresses the warning but state updates still process. More critically, there is **no AbortController** — all 8 requests continue executing on the server. For a user who quickly bounces between tabs, this produces unnecessary DB load and stale state writes.

**Fix:** Use `AbortController` and a cleanup function in the `useEffect`.

### 2.2 `tracked_spend` PATCH Has No User-Card Ownership Check
`server.js:423–430` — the PATCH endpoint updates `wallet_entries.${card_id}.tracked_spend` for any `user_id` passed in the URL. There is **no verification that the card belongs to that user's wallet**. Any client knowing a `user_id` and any `card_id` (even one not in their wallet) can write an arbitrary spend value to a phantom wallet entry. The only guard is `matchedCount === 0` (user must exist), not card ownership.

```js
// server.js:423 — no check that card_id ∈ user.card_ids
const result = await db.collection("users").updateOne(
  { user_id },        // ← only checks user exists
  { $set: { [`wallet_entries.${card_id}.tracked_spend`]: tracked_spend ... } }
);
```

**Fix:** Change the filter to `{ user_id, card_ids: card_id }` or add a pre-flight `findOne` check.

### 2.3 Null-Divide in Milestone Progress Calculation
`dashboard/page.tsx:399`:
```ts
const pct = Math.min(100, Math.round((mp.current / mp.target) * 100));
```
If `mp.target` is `0` (a card seeded with `spend_goal: 0` or missing the field), this produces `Infinity`, which renders as `NaN%` in the progress bar width. The same pattern exists in `MilestoneCard.tsx`. There is no guard for `target === 0`.

### 2.4 ReDoS via Unescaped Search Query
`server.js:114–119` — the `q` parameter from the query string is passed directly into a MongoDB `$regex` operator with no escaping:
```js
const q = req.query.q || "";
{ card_name: { $regex: q, $options: "i" } }
```
A user sending catastrophic backtracking patterns against MongoDB's PCRE engine can cause significant CPU spike on the DB. The fix is to escape special regex characters before interpolating.

### 2.5 `handleSave` Closure Captures Stale `trackers`
`analytics/page.tsx:57–85`:
```ts
const handleSave = useCallback(async (cardId: number, newAmount: number) => {
  const prev = trackers; // ← closed over at callback creation time
```
`useCallback` with `[trackers]` as a dependency means every render creates a new `handleSave`, but if `MilestoneCard` memoizes the prop, the child can hold a stale closure and revert to an out-of-date snapshot on error. The correct pattern is to use the functional updater form for the revert, not the closed-over `prev`.

---

## 3. CLAUDE.md Context Health

The CLAUDE.md is generally well-maintained but has drifted in several places:

| Claim in CLAUDE.md | Reality in Code |
|---|---|
| "Inline Winning Card reveal: AnimatePresence below grid expands on category tap; sheet only opens on card tap" (Milestone 6) | Dashboard has flat recommendation cards, no expand, no sheet wired |
| "SpendGuideSheet — new `cardDetail` prop" (Milestone 6) | `SpendGuideSheet` may have the prop but dashboard doesn't invoke it |
| "Creditpedia screen (`/creditpedia`)" listed as a **Next Task** | `src/app/creditpedia/page.tsx` exists in the file tree — may already be implemented |
| `src/app/profile/page.tsx` exists | Not mentioned anywhere in CLAUDE.md |
| Auth guard listed as a Next Task | Dashboard already redirects if no `user_id` — partially implemented |

**Assessment:** The "Current Project State" section is about one milestone behind the actual code. The `/creditpedia` and `/profile` routes were built but never added to the milestone log. The Next Tasks section has stale items that may already be done.

---

## 4. Efficiency Audit — Hallucinated Complexity

### 4.1 Dashboard Fires 8 API Calls on Every Mount
Every time the user opens the dashboard, 8 `POST /api/spend-guide` requests fire. The results are not cached, memoized, or stored in any persistent layer (no `sessionStorage`, no SWR, no React Query). For a user with a 3-card wallet, this is 8 × 1 DB roundtrip each time they switch tabs. This was generated as "fetch everything upfront for simplicity" and never revisited.

**Fix:** Cache recommendations in `sessionStorage` with a TTL, or use SWR/React Query.

### 4.2 `resultsKey` Pattern in WalletBuilder
`WalletBuilder.tsx:33,51` — `resultsKey` is a counter incremented on every search to force React to re-key the results list (triggering CSS stagger animations). This is a workaround for the absence of a proper animation library pattern. The same effect can be achieved with Framer Motion `AnimatePresence` without the integer counter state.

### 4.3 Wallet Fetch Duplicated on Three Different Pages
`/api/user/wallet/:user_id` is fetched independently in `dashboard/page.tsx`, `analytics/page.tsx`, and `AuthForm.tsx` (the `routeAfterAuth` redirect check). There is no shared wallet context or cache. A user opening the app fetches their wallet at least twice before seeing the dashboard.

### 4.4 `buildCap` Helper Buried at the Bottom of `server.js`
`server.js:548–555` — a 7-line utility at the end of a 566-line monolithic file with no separation between route handlers, business logic, and helpers. This is textbook generation-by-accretion — each session added to the bottom.

---

## 5. Security & Performance

### 5.1 No Authentication on Any Protected Endpoint
The entire backend has **zero auth middleware**. Every endpoint that takes a `user_id` trusts the value supplied by the client. This means:
- Any user knowing another user's UUID can read their wallet
- Any user can overwrite another user's wallet (`POST /api/user/wallet`)
- Any user can delete cards from another user's wallet

This is documented as a planned fix ("Replace `user_id` string with JWT"), but the current state means the app is entirely authorization-free.

### 5.2 CORS Wildcard
`server.js:9`: `app.use(cors())` — allows all origins. For any deployed version, this permits cross-origin requests from any domain. Should be locked to the frontend origin in production.

### 5.3 Signup Doesn't Validate Email Format or Password Strength
`server.js:30–31` — the only validation is presence checking. A user can sign up with `email: "x"` (not a valid email) or `password: "a"` (1 character). The `type="email"` HTML attribute provides client-side validation only — it is trivially bypassed via direct API calls.

### 5.4 Internal Error Messages Leaked to Client
Throughout `server.js`, catch blocks do `res.status(500).json({ error: err.message })`. Node/MongoDB error messages can contain stack traces, collection names, or query details. A malformed request could leak internal schema information.

**Fix:** Log `err` server-side; return a generic `"Internal server error."` to the client.

---

## Prioritized Action Plan

| # | Action | Criticality | Ease | Notes |
|---|---|---|---|---|
| **1** | Add auth middleware (JWT) on all `/api/user/*` and `/api/spend-guide` endpoints | 🔴 Critical | Medium | Any real user data is currently unprotected |
| **2** | Fix ownership check in `PATCH /spend` — filter by `{ user_id, card_ids: card_id }` | 🔴 Critical | Easy | 2-line fix in `server.js:423` |
| **3** | Extract `API_BASE` to `src/lib/api.ts` and add a shared `getUserId()` utility | 🟠 High | Easy | Eliminates 5 duplicate declarations + the `"user_123"` fallback bug |
| **4** | Add `AbortController` to dashboard's 8-way fetch to prevent stale state on unmount | 🟠 High | Easy | Standard `useEffect` cleanup pattern |
| **5** | Guard milestone `target === 0` in both dashboard and MilestoneCard | 🟠 High | Easy | `pct = target > 0 ? Math.min(100, ...) : 0` |
| **6** | Escape regex in `/api/cards/search` | 🟠 High | Easy | `q.replace(/[.*+?^${}()\|[\]\\]/g, '\\$&')` before `$regex` |
| **7** | Replace `err.message` in 500 responses with a generic string; log internally | 🟠 High | Easy | One-pass find/replace through `server.js` |
| **8** | Fix `handleSave` stale closure in `analytics/page.tsx` — use functional updater for revert | 🟡 Medium | Easy | Replace closed-over `prev` with snapshot captured inside setter |
| **9** | Create `src/types/index.ts` with shared `WalletCard`, `RankedCard`, `MilestoneProgress` types | 🟡 Medium | Medium | Eliminates drift between shadow type declarations |
| **10** | Audit and update CLAUDE.md — document `/creditpedia`, `/profile`, move completed tasks | 🟡 Medium | Easy | Context drift slows future sessions |
| **11** | Cache spend-guide results in `sessionStorage` (or add SWR) to stop 8-call storm on every mount | 🟡 Medium | Medium | UX improvement + server load reduction |
| **12** | Add email format + password length validation to `/api/auth/signup` | 🟡 Medium | Easy | Backend guard, not just HTML `type="email"` |
| **13** | Lock CORS to frontend origin via env var | 🟢 Low (pre-deploy) | Easy | `cors({ origin: process.env.FRONTEND_URL })` |
| **14** | Break `server.js` into route modules (`routes/auth.js`, `routes/wallet.js`, etc.) | 🟢 Low | Medium | Structural cleanup, no behaviour change |

### Recommended Next Session Scope
**Items 2, 3, 5, 6, 7** — all are easy, high-impact, and completable in a single focused session (~90 min). Item 1 (JWT auth) is the most significant architectural change and should be scoped as its own dedicated session.
