# Plan: Đồng nhất UI theo Apple Design System

## Mục tiêu
Áp dụng Apple design system (`apple-DESIGN.md`) để đồng nhất toàn bộ giao diện trong `src/`. Chuyển từ dark theme tự do sang dark theme Apple-style với typography, màu sắc, spacing, và component patterns nhất quán.

## Design Read
*"Reading this as: Electron desktop app for technical users (Apple device managers), with a premium dark-interface language, leaning toward Apple's product-tile aesthetic adapted for dark-mode-only desktop UI."*

## Thay đổi cốt lõi

### 1. CSS Variables & Theme (`src/assets/styles/index.css`)
**Thay `:root` variables thành Apple tokens:**

| Token cũ | Token mới (Apple) | Giá trị |
|---|---|---|
| `--primary: #137fec` | `--primary: #0066cc` | Action Blue |
| `--accent: #3b82f6` | `--primary-focus: #0071e3` | Focus Blue |
| `--accent-hover: #2563eb` | `--primary-on-dark: #2997ff` | Sky Link Blue |
| `--background-dark: #101922` | `--surface-tile-1: #272729` | Near-black tile |
| `--surface-dark: #1c2127` | `--surface-tile-2: #2a2a2c` | Tile variant |
| `--border-dark: #283039` | `--surface-tile-3: #252527` | Tile variant |
| (new) | `--ink: #1d1d1f` | Near-black ink |
| (new) | `--canvas-parchment: #f5f5f7` | Apple parchment |
| (new) | `--on-dark: #ffffff` | Text on dark |
| (new) | `--body-muted: #cccccc` | Muted text on dark |
| (new) | `--ink-muted-48: #7a7a7a` | Disabled/fine print |
| (new) | `--hairline: #e0e0e0` | Border color |

**Xoá:**
- `--primary-gradient`, `--secondary-gradient` (Apple không dùng decorative gradients)
- `--glass-bg`, `--glass-border` (glassmorphism patterns)
- `.hero-gradient`, `.shadow-neon` classes

**Typography:**
- Font: `'SF Pro Text', 'SF Pro Display', system-ui, -apple-system, BlinkMacSystemFont, sans-serif`
- Body: 17px / 400 / 1.47 / -0.374px (Apple body)
- Display: 600 weight, negative letter-spacing
- Code/mono: `'SF Mono', 'JetBrains Mono', monospace`

### 2. Tailwind Theme (`index.css` @theme block)
Thêm Apple tokens vào `@theme` để dùng Tailwind classes:
```
--color-apple-primary: #0066cc
--color-apple-primary-focus: #0071e3
--color-apple-primary-on-dark: #2997ff
--color-apple-ink: #1d1d1f
--color-apple-on-dark: #ffffff
--color-apple-body-muted: #cccccc
--color-apple-ink-muted-48: #7a7a7a
--color-apple-tile-1: #272729
--color-apple-tile-2: #2a2a2c
--color-apple-tile-3: #252527
--color-apple-canvas: #ffffff
--color-apple-parchment: #f5f5f7
--color-apple-hairline: rgba(255,255,255,0.08)
```

### 3. Component Updates (theo từng file)

#### `src/App.tsx`
- ErrorBoundary & LoadingScreen: `bg-linear-to-br from-slate-900...` → Apple tile bg `#272729`
- Button: `bg-blue-600` → `bg-[#0066cc]` pill shape
- Border radius: consistent `rounded-xl` (18px) hoặc `rounded-full` (pill)

#### `src/ui/home.tsx`
- Header: `bg-[#111]` → `bg-[#000000]` (Apple global-nav pure black)
- StatCard: `bg-[#161616] border-[#1e1e1e]` → `bg-[#272729] border-white/[0.06]`
- Accent bar: `bg-[#137fec]` → `bg-[#0066cc]`
- ProductCard: `bg-[#161616]` → `bg-[#272729]`, hover → `bg-[#2a2a2c]`
- Icon masks: `bg-[#137fec]` → `bg-[#0066cc]`
- Text colors: `text-[#e5e5e5]` → `text-white`, `text-[#666]` → `text-[#7a7a7a]`
- Section label: remove uppercase eyebrow pattern (Apple restraint)
- Typography: font sizes align với Apple scale

#### `src/ui/download.tsx`
- Sidebar: `border-r-[#137fec]/20` → `border-r-white/[0.06]`
- StatusBadge: `#137fec` → `#0066cc` cho downloading status
- DownloadCard: `bg-[#121212]` → `bg-[#272729]`, border accent colors update
- Font: remove `fontFamily: "'Syne'"` inline style → use global Apple font
- Filter tabs: active color `#137fec` → `#0066cc`
- Progress bar colors: update to Apple palette

#### `src/ui/setting.tsx`
- Section: `bg-[#161616] border-[#1e1e1e]` → `bg-[#272729] border-white/[0.06]`
- Toggle: `bg-[#137fec]` → `bg-[#0066cc]`
- Input: `bg-[#292a2b]` → `bg-[#2a2a2c]`, focus border → `#0066cc`
- Button primary: `bg-[#137fec]` → `bg-[#0066cc]`, `rounded-lg` → `rounded-full` (pill)
- Icon container: update bg to Apple tint

#### `src/ui/welcome.tsx`
- Section: `bg-[#161616] border-[#2a2a2a]` → `bg-[#272729] border-white/[0.06]`
- Toggle: `bg-[#0078d4]` → `bg-[#0066cc]`
- Button: `bg-[#0078d4]` → `bg-[#0066cc]`, `rounded` → `rounded-full` (pill)
- DirPicker: update border/bg colors
- Badge: `border-[#0078d440]` → `border-[#0066cc40]`
- What's New section: keep amber accent (functional, not decorative)

#### `src/ui/appUpdate.tsx`
- Header: `bg-[#111]` → `bg-[#000000]` (Apple global-nav)
- Version badge: `bg-[#137fec18]` → `bg-[#0066cc18]`
- Progress bar: `bg-[#137fec]` → `bg-[#0066cc]`
- Button: `bg-[#137fec]` → `bg-[#0066cc]`, pill shape
- Changelog container: `bg-[#111] border-[#1e1e1e]` → `bg-[#272729] border-white/[0.06]`

#### `src/ui/IPSWUpdateManager.tsx`
- Top bar: `bg-[#0d0d14]` → `bg-[#000000]` (Apple global-nav)
- UpdateRow: `rgba(255,255,255,0.025)` → `bg-[#272729]`
- Status colors: keep semantic colors but align blue to `#0066cc`
- Start button: gradient → solid `#0066cc`, pill shape
- Font: remove inline `fontFamily` → use global

#### `src/ui/pages/SelectDevice/index.tsx`
- Container: `bg-[#0c0c0f]` → `bg-[#252527]` (Apple tile-3)
- Toolbar: `bg-[#0e0e12]` → `bg-[#000000]` (Apple nav)
- Search input: update border/bg to Apple tokens
- Group headers: dot color `#137fec` → `#0066cc`

#### `src/ui/pages/SelectDevice/DeviceCard.tsx`
- Card bg: `bg-white/4` → `bg-[#272729]`
- Selected: `border-[#137fec]/50` → `border-[#0066cc]/50`
- Aurora border: update colors to Apple blue family
- Status dot/text colors: align with Apple palette
- Version badge: `text-[#137fec]` → `text-[#0066cc]`

#### `src/ui/pages/SelectDevice/DetailPanel.tsx`
- Header: `border-b-white/8` → `border-b-white/[0.06]`
- Firmware card: `bg-white/4` → `bg-[#272729]`
- Signed badge: keep emerald (semantic)
- Linked devices: `bg-[#137fec]/6` → `bg-[#0066cc]/6`

#### `src/ui/pages/SelectDevice/ControlButtons.tsx`
- Primary button: `bg-[#137fec]` → `bg-[#0066cc]`, `rounded-xl` → `rounded-full` (pill)
- All action buttons: consistent `rounded-xl` (18px)
- Status-specific colors: align with Apple palette

#### `src/ui/pages/SelectDevice/ProgressBar.tsx`
- Downloading color: `bg-[#137fec]` → `bg-[#0066cc]`

#### `src/ui/pages/SelectDevice/ModeBadge.tsx`
- Turbo: keep `#e08b1a` (semantic)
- Normal: `#137fec` → `#0066cc`

#### `src/ui/pages/SelectDevice/styles.css`
- Aurora border: `#137fec` → `#0066cc`
- Scrollbar: `rgba(19,127,236,...)` → `rgba(0,102,204,...)`

#### `src/assets/styles/index.css` (global)
- Confirm dialog: `bg-[#111118]` → `bg-[#272729]`, border → `border-white/[0.06]`
- Confirm variants: update gradient colors to solid Apple-style
- Search input: update to Apple tokens
- Topbar: update to Apple tokens
- Download item: `rgba(255,255,255,0.08)` → `bg-[#272729]`
- Device card: update glass effects → flat Apple surfaces
- Status badges: align colors
- Toast messages: update to Apple tokens
- Scrollbar: `rgba(19,127,236,...)` → `rgba(0,102,204,...)`
- Remove `.hero-gradient`, `.shadow-neon` (AI slop patterns)

#### `src/assets/styles/animations.css`
- `ld-flash` keyframe: `rgba(19,127,236,...)` → `rgba(0,102,204,...)`
- Keep all animation utilities (they're well-structured)

#### `src/ui/ErrorBoundarySection.tsx`
- Button: `bg-[#137fec]` → `bg-[#0066cc]`, pill shape

### 4. Patterns to Remove (AI Slop)
- Glassmorphism: `backdrop-filter: blur(20px)` trên cards → flat surfaces
- Neon shadows: `.shadow-neon`, `box-shadow: 0 0 30px rgba(37,99,235,...)` → remove
- Decorative gradients: `--primary-gradient`, `--secondary-gradient` → solid colors
- Mixed border-radius: standardize `rounded-xl` (18px) cho cards, `rounded-full` cho pills
- Uppercase eyebrow labels: giảm thiểu (max 1 per 3 sections)

### 5. Patterns to Keep
- Animation system (`animations.css`) — well-structured, aligned with motion
- Stagger animations — good UX
- Skeleton loaders — Apple uses them too
- `motion/react` transitions — clean, performant
- Reduced motion support — accessibility

## Files to Modify (18 files)

1. `src/assets/styles/index.css` — CSS variables, global styles
2. `src/assets/styles/animations.css` — color token updates
3. `src/App.tsx` — ErrorBoundary, LoadingScreen
4. `src/ui/home.tsx` — StatCard, ProductCard, header
5. `src/ui/download.tsx` — Sidebar, DownloadCard, toolbar
6. `src/ui/setting.tsx` — Section, Row, Toggle, buttons
7. `src/ui/welcome.tsx` — all pages, buttons, sections
8. `src/ui/welcome.css` — font import update
9. `src/ui/appUpdate.tsx` — header, progress, buttons
10. `src/ui/IPSWUpdateManager.tsx` — top bar, rows, buttons
11. `src/ui/ErrorBoundarySection.tsx` — button color
12. `src/ui/shared.tsx` — no changes needed (utility only)
13. `src/ui/pages/SelectDevice/index.tsx` — container, toolbar
14. `src/ui/pages/SelectDevice/DeviceCard.tsx` — card styles
15. `src/ui/pages/SelectDevice/DetailPanel.tsx` — panel styles
16. `src/ui/pages/SelectDevice/ControlButtons.tsx` — button styles
17. `src/ui/pages/SelectDevice/ProgressBar.tsx` — color map
18. `src/ui/pages/SelectDevice/ModeBadge.tsx` — color update
19. `src/ui/pages/SelectDevice/styles.css` — aurora, scrollbar colors

## Verification
1. `npm run build:main` —确保 TypeScript 编译通过
2. `npm run dev` — 启动 app，检查每个页面：
   - Home: stat cards, product cards, header
   - Downloads: sidebar, download cards, filter tabs
   - Settings: sections, toggles, inputs, buttons
   - SelectDevice: device cards, detail panel, control buttons
   - IPSWUpdateManager: update rows, progress bars
   - AppUpdate: version badge, progress, changelog
   - Welcome: wizard pages
3. Kiểm tra一致性: tất cả accent colors đều là `#0066cc`, tất cả pill buttons đều `rounded-full`, typography đều Apple scale
4. `npm run lint` —确保没有 lint errors
