# Zuno - Project Context & Guidelines

## 1. Project Overview

**Zuno** is a credit card optimization application designed for users who juggle multiple credit cards. The goal is to help users maximize their reward points and cashback without needing to memorize complex reward structures, tiered milestones, or changing category multipliers.

**MVP Scope:**

- **Manual Card Selection:** Users manually select their existing cards to build their digital wallet (bypassing complex banking aggregators for now).
- **Spend Guide (Core Feature):** Recommends the best card to use for a specific category (e.g., Dining, Travel) to maximize yield.
- **Spending Warnings:** Alerts users when a card yields zero points for a category (e.g., Rent, Taxes).
- **Creditpedia:** A centralized knowledge base showing card benefits, lounge access, fee waivers, and milestone trackers.

## 2. Tech Stack & Architecture

- **Backend:** Node.js, Express.js (v5) — `server.js` in `/app`
- **Database:** MongoDB Atlas — database: `zuno_mvp`
- **Collections:**
  - `cards` — merged card documents (reward categories + creditpedia data)
  - `users` — user accounts (`user_id` UUID, `firstName`, `lastName`, `email`, `password_hash`, `card_ids[]`, `created_at`, `updated_at`)
- **Config:** `dotenv` for environment variables (`MONGO_URI`, `PORT`)
- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui
  - Location: `/app/zuno-frontend`
  - Fonts: `Satoshi` (headings/display/CTAs) via `next/font/local` (self-hosted woff2 in `public/fonts/satoshi/`), `DM Sans` (body) via `next/font/google`
  - CSS variables: `--font-satoshi`, `--font-dm-sans`; Tailwind tokens: `font-display`, `font-heading` → Satoshi, `font-sans` → DM Sans
  - Toasts: `sonner`
  - Search debounce: `use-debounce`
  - Icons: `lucide-react`
  - Theme: dark luxury — near-black `#07070D`, gold accent `#C9A84C`, aqua `#03FDFC`, teal `#00D8D8`
  - Ambient background: fixed teal (top-left, 15% opacity, blur 120px) + aqua (bottom-right, 10% opacity, blur 120px) orbs in `layout.tsx`

## 3. Database Architecture

### `cards` Collection
Seeded from two JSON files per bank via `seed.js`:
1. `[bank]-conditionalreward.json` — category objects (`base_earn`, `accelerated_earn`, `condition[]`, `cap_*`, `exclusions`, `brands`)
2. `[bank]-creditpedia.json` — `trackers[]`, `annual_fee`, `key_benefits`, `lounge_access`, `welcome_benefits`

Indexes: `card_id` (unique), `bank_name`, `card_name`

### `users` Collection
Created at runtime (no seed). Schema:
```json
{
  "user_id": "string",
  "card_ids": [1073, 1074],
  "updated_at": "ISODate"
}
```

## 4. Current Project State

### Milestone 3 — Auth Flow + VirtualCard + Brand Refresh Complete

| File | Purpose |
|---|---|
| `src/app/layout.tsx` | Root layout — Satoshi + DM Sans fonts, fixed teal/aqua ambient orbs, `Toaster` |
| `src/app/globals.css` | Dark luxury theme, grain texture, stagger animations, `--font-satoshi`, `--color-aqua`, `--color-teal` tokens |
| `src/app/page.tsx` | Auth shell — `#121212` bg + Zuno logo + `<AuthForm />` |
| `src/app/wallet/page.tsx` | Wallet route — hero + `<WalletBuilder />` (moved from `/`) |
| `src/components/AuthForm.tsx` | Login/signup toggle form, bcrypt API calls, `localStorage`, `router.push('/wallet')` |
| `src/components/ui/VirtualCard.tsx` | Reusable glassmorphic CSS credit card chip (full + compact variants) |
| `src/components/WalletBuilder.tsx` | VirtualCard grid for search results, compact VirtualCard sidebar, `localStorage` user_id |

**Auth flow:**
- `POST /api/auth/signup` → `localStorage.setItem('zuno_user_id', uuid)` → redirect to `/wallet`
- `POST /api/auth/login` → same localStorage pattern → redirect to `/wallet`
- Password mismatch validated client-side before API call
- All errors surface as Sonner toasts using message from API response

**VirtualCard:**
- Full variant (`h-[190px]`): used in WalletBuilder search results (single-column list)
- Compact variant (`compact` prop, `h-[110px]`): available but not used in current mobile layout
- Selected state: aqua `#03FDFC` border glow + checkmark badge
- Bank initial badge with per-bank colour scheme

---

### Milestone 6 — Visual & UX Overhaul Complete

| File | Purpose |
|---|---|
| `src/components/ui/AnimatedBackground.tsx` | Two Framer Motion blobs (aqua top-left, teal bottom-right) drifting on 16s/20s loops inside the phone shell |
| `src/components/ui/TopNavBar.tsx` | `variant="home"`: avatar circle (aqua gradient, initials) + "Hi [name]!" + bell; `variant="default"`: back-nav (unchanged) |
| `src/components/ui/BottomNavBar.tsx` | Floating glassmorphic pill, 4 tabs (Home/Wallet/Creditpedia/Settings), Framer Motion `layoutId` active indicator |
| `src/components/ui/SlideButton.tsx` | Drag-to-confirm pill: aqua fill strip tracks thumb, fires `onConfirm` at ≥85%, springs back on early release |
| `src/app/dashboard/page.tsx` | Inline "Winning Card" reveal: AnimatePresence below grid expands on category tap; sheet only opens on card tap |
| `src/components/SpendGuideSheet.tsx` | New `cardDetail` prop — renders key_benefits list + milestone tracker progress bars |
| `src/app/analytics/page.tsx` | Analytics hub — live Milestone Tracker: fetches wallet on mount, filters milestone cards, renders glassmorphic staggered list with animated progress bars and inline PATCH-persisted spend update input |
| `src/components/MilestoneCard.tsx` | Per-card milestone tracker — Framer Motion animated progress bar, AnimatePresence inline input panel, optimistic update + revert on PATCH failure |

**UX flow (Spend Guide):**
1. Tap category → spend-guide API → inline slot expands (AnimatePresence, spring)
2. Slot shows: earn rate badge + tappable VirtualCard + "Tap for details" hint
3. Tap VirtualCard → fetch `/api/cards/detail/:card_id` → open SpendGuideSheet

**firstName persistence:** `AuthForm` stores `zuno_first_name` in localStorage on signup/login; read by `TopNavBar` home variant.

**Theme:** `--background` updated to `#121212`. Desktop shell bg `#0A0A0A`.

---

### Milestone 5 — Dashboard + Spend Guide Complete

| File | Purpose |
|---|---|
| `src/app/dashboard/page.tsx` | Main dashboard — wallet strip (horizontal scroll) + spend guide category grid |
| `src/components/SpendGuideSheet.tsx` | Framer Motion bottom sheet — drag-to-dismiss, spring physics, earn rate display, ranked card list |

**Spend Guide flow:**
- `POST /api/spend-guide` with `{ user_id, category }` → `{ category, ranked_cards: [{ card_id, bank_name, card_name, earn_rate, earn_type, conditions, cap, warning }] }`
- `earn_rate > 0` → aqua glow + "Yields NX" display
- `earn_rate === 0` → coral red (`#FF6B6B`) + "Zero Yield" warning state
- Bottom sheet: `drag="y"`, `dragConstraints={{ top: 0 }}`, `type: "spring", bounce: 0.2`; backdrop opacity tied to drag y via `useTransform`

**Routing:** `WalletBuilder` → `router.push('/dashboard')` after successful wallet save

**New dependency:** `framer-motion` v12

---

### Milestone 4 — Native Mobile App Shell + UI Refactor Complete

| File | Purpose |
|---|---|
| `src/app/layout.tsx` | Phone shell (`max-w-md mx-auto`) — ambient orbs contained within, desktop sees phone floating on `#07070D` bg |
| `src/components/ui/TopNavBar.tsx` | Reusable top app bar — `h-14`, ChevronLeft back nav, centered Satoshi title, optional right slot |
| `src/app/page.tsx` | Thin shell — renders `<AuthForm />` directly |
| `src/components/AuthForm.tsx` | Full-height mobile auth — large Satoshi heading, `h-14` glassmorphic inputs, fixed bottom aqua CTA with gradient overlay |
| `src/app/wallet/page.tsx` | Wallet route — `<TopNavBar>` + `<WalletBuilder>` in flex column |
| `src/components/WalletBuilder.tsx` | Single-column mobile layout — sticky search, `overflow-y-auto` scrollable results, fixed bottom wallet chips + CTA |

**Mobile shell rules:**
- All pages render inside `max-w-md` phone container; desktop sees the phone floating centered
- Sticky bottom CTAs use `fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md` pattern
- Scrollable regions use `overflow-y-auto` with `[&::-webkit-scrollbar]:hidden [scrollbar-width:none]` for clean native feel
- Bottom spacer `<div className="h-52">` prevents last card from hiding behind fixed CTA

---

### Milestone 2 + 3 — Onboarding UI + Auth Flow Complete
Frontend scaffolded and auth + wallet builder screens built in `zuno-frontend/`.

---

### Milestone 1 — MVP Backend Complete
All backend API endpoints are implemented in `server.js`.

| Endpoint | Method | Description |
|---|---|---|
| `/api/cards` | GET | List all cards (id, bank, name) |
| `/api/cards/search?q=` | GET | Search cards by name or bank |
| `/api/cards/detail/:card_id` | GET | Full card document for Creditpedia screen |
| `/api/user/wallet` | POST | Save/replace a user's wallet (validates card_ids) |
| `/api/user/wallet/:user_id` | GET | Get wallet with populated card details (`$lookup`) |
| `/api/user/wallet/:user_id/:card_id` | DELETE | Remove a single card from the wallet |
| `/api/spend-guide` | POST | Rank user's wallet cards by earn rate for a category |
| `/api/spend-warning` | POST | Warn if a specific card earns 0 on a given category |

**Spend Guide logic:** fetches user wallet → queries those cards → reads `card[category].accelerated_earn` vs `base_earn` → sorts highest-to-lowest → flags zero-earners with a warning message.

**Spend Warning logic:** checks `base_earn`, `accelerated_earn`, the `exclusions` field (null / boolean / string), and scans `condition[]` strings for exclusion keywords.

## 5. Next Immediate Tasks

### Frontend (Phase 7 — Remaining Screens)
All screens follow: `TopNavBar` at top, `flex-1 overflow-y-auto` scrollable middle, `fixed bottom-0 max-w-md` CTAs.

- [ ] **Auth guard** — redirect unauthenticated users from `/wallet` and `/dashboard` to `/` (check `localStorage.getItem('zuno_user_id')`)
- [ ] **Creditpedia screen** (`/creditpedia`) — browse all cards; tap one → `SpendGuideSheet`-style bottom sheet showing trackers, lounge access, fee waivers from `GET /api/cards/detail/:card_id`
- [ ] **Wallet management on dashboard** — long-press or edit mode to remove cards using `DELETE /api/user/wallet/:user_id/:card_id`
- [ ] **Bottom tab bar** — native-style tab bar (Home / Creditpedia / Wallet) as persistent bottom nav on `/dashboard` and `/creditpedia`
- [ ] **Expand Spend Guide categories** — verify backend category keys match card data; add Insurance, Education, etc. if present
- [ ] **Analytics hub — Phase 2** — add a "Spending Patterns" section below the tracker (category breakdown chart, total rewards yield)

### Backend (Hardening)
- [ ] Replace `user_id` string with JWT or session-based auth
- [ ] Add input sanitization middleware
- [ ] Add rate limiting

## 6. AI Assistant Rules

- **Continuous Context Updates:** At the end of every major milestone or completed task, update this `CLAUDE.md` file.
- Always move completed tasks from "Next Immediate Tasks" to "Current Project State".
- Draft the next logical "Next Immediate Tasks" so we always know what to build next.
- Update "Tech Stack & Architecture" or "Database Architecture" sections if new libraries, collections, or schema changes are introduced.
