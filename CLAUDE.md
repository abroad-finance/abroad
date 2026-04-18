# Abroad UI — Claude Code Design System Rules

## Project Stack

- **Framework:** React 19 + TypeScript
- **Styling:** Tailwind CSS v4 (via `@tailwindcss/vite`)
- **Build:** Vite
- **Routing:** react-router-dom v7
- **Icons:** `lucide-react` (already chunked — do NOT add other icon libraries)
- **Animations:** `framer-motion`, `lottie-web` / `@lordicon/react`
- **i18n:** `@tolgee/react` (`useTranslate()` hook)
- **Class merging:** `clsx` + `tailwind-merge` via the `cn()` utility

---

## Component Organization

| Directory | Purpose |
|-----------|---------|
| `src/shared/components/` | Shared UI primitives: `Button`, `ModalOverlay`, `TokenBadge`, `DropSelector`, etc. |
| `src/components/ui/` | Swap-specific UI components: `AmountInput`, `ChainPill`, `ChainSelectorModal`, etc. |
| `src/features/swap/components/` | Feature-level swap flow components (`HomeScreen`, `Swap`, `NavBarResponsive`, …) |
| `src/pages/` | Page views (`WebSwap`, `Meridian`, `Ops`) — wires together feature components |
| `src/shared/hooks/` | Shared hooks (`useTheme`, `useWalletAuth`, `useNavBarResponsive`, …) |
| `src/shared/utils/` | Utility functions (`cn`, `formatMoney`, `getWalletTypeByDevice`, …) |
| `src/shared/constants/` | Shared style constants (`AB_STYLES`, `ASSET_URLS`, `BRAND_TITLE_CLASS`) |
| `src/contexts/` | React contexts (`WalletAuthContext`, `NoticeContext`, `WebSocketContext`, …) |
| `src/services/` | API/service hooks |
| `src/api/` | Auto-generated API types (via Orval — do not hand-edit) |

### Rules

- IMPORTANT: Before creating a new component, check `src/shared/components/` and `src/components/ui/` for reusable primitives.
- Place new **shared/generic** UI primitives in `src/shared/components/`.
- Place new **swap-feature** UI components in `src/components/ui/` (small, stateless) or `src/features/swap/components/` (feature-coupled, may have local state).
- Export named (not default) exports from shared components; default exports are acceptable for lazy-loaded page/feature components.
- Use PascalCase for component file names and component function names.

---

## Styling Rules

### Tailwind v4 + Design Tokens

Design tokens are defined as CSS custom properties in `src/index.css` under `@theme {}`, `:root`, and `.dark`.

**Token naming:**

| CSS variable | Tailwind utility | Usage |
|---|---|---|
| `--ab-green` / `--color-ab-green` | `text-ab-green`, `bg-ab-green` | Brand green (#73B9A3) |
| `--ab-bg` / `--color-ab-bg` | `bg-ab-bg` | Page background |
| `--ab-text` / `--color-ab-text` | `text-ab-text` | Primary text |
| `--ab-text-secondary` | `text-ab-text-2` | Secondary text |
| `--ab-text-muted` | `text-ab-text-3` | Muted text |
| `--ab-border` | `border-ab-border` | Default border |
| `--ab-card` | `bg-ab-card` | Card background |
| `--ab-card-border` | `border-ab-card-border` | Card border |
| `--ab-input` | `bg-ab-input` | Input background |
| `--ab-btn` | `bg-ab-btn` | Primary button background |
| `--ab-btn-hover` | `bg-ab-btn-hover` | Button hover |
| `--ab-btn-text` | `text-ab-btn-text` | Button label |
| `--ab-modal-bg` | `bg-ab-modal-bg` | Modal background |
| `--ab-hover` | `bg-ab-hover` | Hover state background |
| `--ab-selected` | `bg-ab-selected` | Selected state background |
| `--ab-separator` | `bg-ab-separator` | Divider / separator |
| `--ab-error` | `text-ab-error` | Error red (#ef4444) |
| `--font-cereal` | `font-cereal` | Custom brand font |

- IMPORTANT: **Never hardcode hex colors** — always use `ab-*` Tailwind tokens or CSS variables.
- IMPORTANT: Dark mode is handled via the `.dark` class on the root. Token values automatically flip; never write `dark:` utilities that replicate token behavior.
- For shared repeated style combinations, add entries to `AB_STYLES` in `src/shared/constants/index.ts` instead of repeating inline strings.
- Use `cn()` from `@/shared/utils` for all conditional or merged class name construction.

### `cn()` Utility

```ts
import { cn } from '@/shared/utils'

// Usage
<div className={cn('base-class', condition && 'conditional-class', className)} />
```

---

## Figma MCP Integration Rules

These rules define how to translate Figma inputs into code for this project. Follow them for every Figma-driven change.

### Required Flow (do not skip)

1. Call `get_design_context` first to fetch the structured representation for the target node(s).
2. If the response is too large, call `get_metadata` to get the high-level node map, then re-fetch only needed nodes.
3. Call `get_screenshot` for a visual reference of the node/variant being implemented.
4. Only after you have both outputs: download assets if needed, then implement.
5. Translate the Figma output (React + Tailwind) into this project's conventions (see below).
6. Validate against the Figma screenshot for 1:1 visual parity before marking complete.

### Translation Rules

- Replace any raw Tailwind hex values (e.g. `bg-[#73B9A3]`) with the corresponding `ab-*` token (`bg-ab-green`).
- Replace generic Tailwind colors (`text-gray-500`, `bg-white`, etc.) with the closest `ab-*` semantic token.
- Use `cn()` from `@/shared/utils` instead of template literals for class composition.
- Reuse components from `src/shared/components/` and `src/components/ui/` instead of duplicating HTML structure.
- Wire up any user-facing strings with `useTranslate()` from `@tolgee/react`.
- Use `lucide-react` for icons — do NOT install new icon packages.
- Respect existing routing (react-router-dom v7), context, and data-fetch patterns.
- Strive for 1:1 visual parity; validate final UI against the Figma screenshot.

### Asset Handling

- If the Figma MCP server returns a `localhost` source for an image or SVG, use that source directly.
- Static assets (backgrounds, chain icons, token icons) are served from the CDN; reference them via `ASSET_URLS` in `src/shared/constants/index.ts`.
- Do NOT use placeholder images when a real source is available.
- Do NOT import or install new icon packages — all icons use `lucide-react` or are inline SVGs from Figma.

---

## Code Conventions

- **Path alias:** `@/` maps to `src/`. Use it for all non-relative imports beyond one directory up.
- **i18n:** Wrap all user-visible strings with `useTranslate()` from `@tolgee/react`. Never hardcode display strings.
- **Props:** Accept a `className?: string` prop on all presentational components to allow composition.
- **Accessibility:** Interactive elements must have semantic roles or `aria-label`s. Buttons must have `type="button"` unless they submit a form.
- **No hardcoded URLs** for icons or images — use `ASSET_URLS` or Figma-provided localhost sources.
- **Auto-generated API types** live in `src/api/` (generated by Orval). Do not hand-edit them.
