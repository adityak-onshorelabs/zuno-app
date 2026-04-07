# Creditpedia Page — Design Spec
**Date:** 2026-04-07  
**Route:** `/creditpedia`  
**File:** `zuno-frontend/src/app/creditpedia/page.tsx`

---

## Overview

The Creditpedia page is a premium card-discovery engine. Users can browse all cards in the Zuno database, search by name or bank, and tap any card to see an inline detail expansion (welcome offer, key benefits, annual fee, CTA) without navigating away.

---

## Architecture

### Data Flow
1. On mount: `GET http://localhost:5000/api/cards` → returns `{ card_id, bank_name, card_name }[]`
2. Search query filters that list client-side (no extra requests)
3. On card tap: `GET http://localhost:5000/api/cards/detail/:card_id` → full card document
4. Detail responses are cached in a `useRef` Map to avoid re-fetching

### State
| Variable | Type | Purpose |
|---|---|---|
| `cards` | `CardSummary[]` | Full list from API |
| `query` | `string` | Live search input value |
| `expandedCardId` | `number \| null` | Which card's detail slot is open |
| `detailCache` | `React.MutableRefObject<Map<number, CardDetail>>` | Memoised fetch results |
| `loadingDetailId` | `number \| null` | Shows shimmer while fetching |
| `pageLoading` | `boolean` | Initial cards-list fetch state |

### Types
```ts
interface CardSummary {
  card_id: number;
  bank_name: string;
  card_name: string;
}

interface CardDetail {
  card_id: number;
  card_name: string;
  bank_name: string;
  annual_fee?: number;
  key_benefits?: string[];
  trackers?: MilestoneTracker[];
  welcome_benefits?: string[];
}
```

---

## Layout Structure

```
<div flex flex-col min-h-[100dvh]>
  <AnimatedBackground />                    // z-0, absolute
  <TopNavBar title="Creditpedia" showBack={false} />
  <div sticky search header>                // sticky top-0 z-20
    <input search />
  </div>
  <div flex-1 overflow-y-auto pb-28>        // scrollable feed
    <motion.div stagger container>
      {filteredCards.map(card => (
        <motion.div card row>
          <VirtualCard onClick={handleTap} />
          <AnimatePresence>
            {expandedCardId === card.card_id && (
              <motion.div detail slot />     // inline expansion
            )}
          </AnimatePresence>
        </motion.div>
      ))}
    </motion.div>
  </div>
  <BottomNavBar />
</div>
```

---

## Components & Behaviour

### Shell
- `"use client"` directive
- Wrapper: `max-w-md mx-auto` is handled by root `layout.tsx` — page uses `flex flex-col min-h-[100dvh]`
- `AnimatedBackground` sits at `z-0 absolute`; all content at `z-10 relative`

### Sticky Search Header
- `sticky top-0 z-20 px-4 py-3 bg-[#121212]/80 backdrop-blur-xl border-b border-white/[0.05]`
- Input: `h-14 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xl pl-11 pr-4 text-white placeholder:text-white/25`
- `Search` lucide icon: `absolute left-4`, `text-white/30`, `w-4 h-4`
- Input value drives `query` state; filtered list is `useMemo` derived

### Card Feed
- Outer scroll region: `flex-1 overflow-y-auto px-4 pt-3 pb-28 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]`
- Stagger container (`motion.div`): `variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}`
- Each row (`motion.div`): `variants={{ hidden: { opacity:0, y:20 }, visible: { opacity:1, y:0, transition: { type:"spring", bounce:0.18, duration:0.55 } } }}`
- `VirtualCard` is full variant (`h-[190px]`), `onClick={() => handleTap(card.card_id)}`

### Tap Handler (`handleTap`)
```
if expandedCardId === card_id → setExpandedCardId(null)   // collapse
else:
  setExpandedCardId(card_id)
  if not in detailCache:
    setLoadingDetailId(card_id)
    fetch detail → cache it → setLoadingDetailId(null)
```

### Inline Detail Slot
- `AnimatePresence` wraps a `motion.div` with:
  - `initial={{ opacity: 0, height: 0 }}` / `animate={{ opacity: 1, height: "auto" }}` / `exit={{ opacity: 0, height: 0 }}`
  - `transition={{ type: "spring", bounce: 0.15, duration: 0.45 }}`
  - `overflow: hidden` to clip during animation
- Inner container: `pt-3 pb-1 flex flex-col gap-3`

#### Loading shimmer (while `loadingDetailId === card_id`)
- Three rounded rects `animate-pulse bg-white/[0.06]`

#### Welcome Offer box
- `bg-[#03FDFC]/[0.06] border border-[#03FDFC]/20 rounded-2xl px-4 py-3`
- Label: `text-[10px] text-white/30 uppercase tracking-[0.1em]` "Welcome Offer"
- Value: `text-[14px] font-bold text-[#03FDFC]` from `detail.welcome_benefits?.[0]` or fallback "Sign-up bonus available"

#### Key Benefits list
- Section label: `text-[10px] text-white/25 uppercase tracking-[0.1em]` "Key Benefits"
- Up to 4 items: same `bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5` rows with aqua bullet dot — reuses pattern from `SpendGuideSheet`

#### Annual Fee row
- Single line: `text-[13px] text-white/55` label + `text-[13px] font-semibold text-white/80` value
- Value: `"₹{annual_fee.toLocaleString('en-IN')} / year"` or `"Lifetime Free"` if 0 or absent

#### Learn More CTA
- Full-width pill: `w-full h-12 rounded-2xl bg-[#03FDFC]/10 border border-[#03FDFC]/30`
- Text: `text-[14px] font-bold text-[#03FDFC]` Satoshi, "Learn More"
- No-op `onClick` for MVP (no external URLs in data)

---

## Empty & Error States

| State | UI |
|---|---|
| Initial load | `Loader2` spinner centred, `text-[#03FDFC]/50 animate-spin` |
| No results from search | "No cards found" with subdued Satoshi heading + DM Sans subtext |
| Detail fetch failure | Inline error row in the expanded slot: red/coral text "Couldn't load details" |

---

## Decisions Made

- **No filter pills** — deferred; search-by-name is sufficient for MVP
- **Lazy detail fetch** — tap to load, cache in ref to avoid re-fetches
- **Collapse on re-tap** — tapping the same card again collapses the slot
- **No navigation** — all discovery happens on this single page (no separate detail route)
- **`showBack={false}`** on TopNavBar — Creditpedia is a root tab, not a drill-down
