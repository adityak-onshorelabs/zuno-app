# Zuno Auth Flow — Design Spec
**Date:** 2026-04-04  
**Status:** Approved  
**Scope:** Typography system, auth screens at `/`, WalletBuilder route move to `/wallet`, VirtualCard component

---

## 1. Typography System

### Font Installation
- Install `@fontsource/satoshi` (npm package).
- Load via `next/font/local` pointing at the variable font file inside `node_modules/@fontsource-variable/satoshi` (or the static weights from `@fontsource/satoshi` — use weight 400, 500, 700, 900).
- DM Sans stays loaded via `next/font/google` as today.

### CSS Variables (globals.css / layout.tsx)
| Variable | Font | Usage |
|---|---|---|
| `--font-satoshi` | Satoshi | Headings, display text, CTA labels, bank names, large numerals |
| `--font-dm-sans` | DM Sans | Body copy, form inputs, placeholders, labels, small descriptive text |

### Tailwind Mapping (globals.css `@theme`)
```
--font-display: var(--font-satoshi);   /* new — use class font-display */
--font-sans: var(--font-dm-sans);      /* unchanged */
--font-heading: var(--font-satoshi);   /* currently maps to Syne — replaced with Satoshi */
```
> **Migration note:** All existing `style={{ fontFamily: "var(--font-syne)" }}` inline styles in `page.tsx`, `WalletBuilder.tsx` etc. must be updated to `var(--font-satoshi)`. Syne is removed from the font imports entirely.

### Application Rules
- **Satoshi:** `<h1>`–`<h3>`, card names in VirtualCard, auth screen title, Submit button text, logo wordmark.
- **DM Sans:** form `<input>` + `<label>`, placeholder text, toast copy, footer, small metadata text.

---

## 2. Ambient Background

Applied as a fixed, pointer-events-none layer. Lives in `src/app/layout.tsx` so it persists across all routes.

| Orb | Position | Color | Opacity | Blur | Size |
|---|---|---|---|---|---|
| 1 (Teal) | Top-left | `#00D8D8` | 15% | 120px | ~600×600px |
| 2 (Aqua) | Bottom-right | `#03FDFC` | 10% | 120px | ~500×500px |

- Base page background: `bg-[#121212]` set on `<body>` (overrides current `#07070D` only on auth page; wallet page retains `bg-[--background]`).
- Auth page (`page.tsx`) sets `bg-[#121212]` on its root div so the glass card reads correctly against the darker base.
- The orbs use `radial-gradient(ellipse at center, color 0%, transparent 70%)` + `filter: blur(120px)`.

---

## 3. File & Route Architecture

```
src/
  app/
    layout.tsx          ← add Satoshi font + ambient orb layer
    globals.css         ← add --font-satoshi variable + font-display Tailwind token
    page.tsx            ← AUTH SCREEN (replaces WalletBuilder)
    wallet/
      page.tsx          ← NEW — moves current page.tsx content here
  components/
    AuthForm.tsx        ← NEW — login/signup toggle form (client component)
    WalletBuilder.tsx   ← updated: reads user_id from localStorage
    ui/
      VirtualCard.tsx   ← NEW — glassmorphic CSS credit card chip
```

---

## 4. Auth Screen (`/`)

### Shell (`page.tsx`)
Thin server component. Renders ambient background (inherited from layout) + `<AuthForm />`. No logic of its own.

```
bg-[#121212] min-h-screen flex flex-col justify-center items-center px-4
```

Top of page: Zuno logo wordmark (Satoshi, bold) centered above the card.

### `AuthForm.tsx` (client component)
State: `mode: 'login' | 'signup'`

**Glass card container:**
```
max-w-md w-full
bg-white/5 backdrop-blur-lg border border-white/10 rounded-3xl p-6 shadow-2xl
```

**Toggle:**  
Two pill tabs ("Log In" / "Sign Up") at the top of the card. Active tab: `bg-white/10 text-white`. Inactive: `text-white/40`.

**Sign Up fields:** First Name, Last Name, Email, Password, Confirm Password.  
**Log In fields:** Email / Phone (`identifier`), Password.

**Input style:**
```
bg-white/5 border border-white/10 text-white placeholder:text-white/30
rounded-xl h-11 px-4 text-sm   ← DM Sans
focus:border-[#03FDFC]/40 focus:ring-1 focus:ring-[#03FDFC]/30
```

**Submit button:**
```
w-full h-12 rounded-xl bg-[#03FDFC] text-black font-semibold
shadow-[0_0_15px_rgba(3,253,252,0.3)]
hover:shadow-[0_0_24px_rgba(3,253,252,0.45)] transition-shadow
← Satoshi font for button label
```

**Validation (client-side, before API call):**
- All fields required.
- Signup: password and confirm-password must match.
- Email: basic format check (`input type="email"`).

**API calls:**
| Action | Endpoint | Body |
|---|---|---|
| Sign Up | `POST http://localhost:5000/api/auth/signup` | `{ firstName, lastName, email, password }` |
| Log In | `POST http://localhost:5000/api/auth/login` | `{ identifier, password }` |

**On success:**
1. `localStorage.setItem('zuno_user_id', data.user_id)`
2. `toast.success("Welcome, [firstName]!")` (sonner)
3. `router.push('/wallet')` (Next.js `useRouter`)

**On error:**
- Show `toast.error(data.error)` — use the message from the API response body.
- Non-API errors: `toast.error("Something went wrong. Please try again.")`

---

## 5. VirtualCard Component (`src/components/ui/VirtualCard.tsx`)

A reusable, CSS-only glassmorphic credit card chip. No images.

### Props
```typescript
interface VirtualCardProps {
  cardName: string;
  bankName: string;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}
```

### Dimensions & Layout
- Fixed aspect ratio: **85.6mm × 54mm** (~`w-[340px] h-[214px]` or `aspect-[1.586]`)
- Responsive: `w-full max-w-[340px]`

### Visual Layers (back to front)
1. **Base glass:** `bg-white/5 backdrop-blur-md`
2. **Subtle gradient overlay:** `bg-gradient-to-br from-white/8 to-transparent`
3. **Border:** unselected `border border-white/10`; selected `border border-[#03FDFC]/50 shadow-[0_0_20px_rgba(3,253,252,0.18)]`
4. **Corner radius:** `rounded-2xl`

### Content Layout
```
Top-left:  Bank initial badge (carry-over from BankBadge)
Top-right: Small Zuno logo mark or decorative dot grid
Middle:    Simulated chip (CSS rectangle, gold #C9A84C, rounded)
Bottom-left:  Card name (Satoshi, 13px, white/80)
Bottom-right: Bank name (DM Sans, 11px, white/40)
```

### States
- **Default:** `border-white/10`, no glow.
- **Selected:** `border-[#03FDFC]/50 shadow-[0_0_20px_rgba(3,253,252,0.18)]` + faint aqua tint `ring-1 ring-[#03FDFC]/20`.
- **Hover:** `border-white/20` transition (unless already selected).
- **Cursor:** `cursor-pointer` when `onClick` is provided.

### Integration in WalletBuilder
- Search results panel: render `<VirtualCard />` in a horizontal scroll or wrapped grid instead of the current flat list rows.
- Wallet sidebar: render compact `<VirtualCard />` (smaller scale via `className="scale-75 origin-left"` or a dedicated `compact` prop).

---

## 6. WalletBuilder Updates (`/wallet`)

### Route
Move existing `page.tsx` hero + WalletBuilder to `src/app/wallet/page.tsx`. Keep same layout, heading, and nav.

### `user_id` from localStorage
Replace hardcoded `const USER_ID = "user_123"` with:
```typescript
const userId = typeof window !== 'undefined'
  ? localStorage.getItem('zuno_user_id') ?? 'user_123'
  : 'user_123';
```
Falls back to `"user_123"` if not logged in (preserves existing behaviour during dev).

### VirtualCard integration
- In search results: render `<VirtualCard>` per result.
- In wallet sidebar: render `<VirtualCard compact />` — the `compact` boolean prop renders `h-[130px]` instead of full-size, scaling down typography accordingly.
- `BankBadge` moves into VirtualCard internals (no longer a standalone export from WalletBuilder).

---

## 7. Layout Updates (`layout.tsx`)

1. Import and configure Satoshi via `next/font/local`.
2. Add `font.variable` to the `<html>` className alongside existing Syne/DM Sans variables.
3. Add fixed ambient orb layer (two divs, `pointer-events-none`, `z-0`) — lives here so it shows on all routes.
4. Update Toaster font to use DM Sans (already correct).

---

## 8. Out of Scope (This Iteration)
- JWT or session-based auth hardening (noted in CLAUDE.md backend hardening tasks).
- Auth guard middleware on `/wallet` (no redirect if unauthenticated — deferred).
- Spend Guide and Creditpedia screens.
- VirtualCard animated flip or 3D effect.
