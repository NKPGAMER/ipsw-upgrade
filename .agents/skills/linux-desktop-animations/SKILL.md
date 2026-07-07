---
name: linux-desktop-animations
description: Comprehensive animation guide for Linux desktop apps built with React + TypeScript + Tailwind CSS + Framer Motion. Covers easing curves, durations, stagger patterns, page transitions, dropdowns, micro-interactions, and performance best practices. Use when implementing any UI animation in the app.
---

# Animation Guide — Phong cách Linear / Arc / Raycast

> Tài liệu này dành cho agent code (Claude Code, Cursor, v.v.) khi implement animation cho ứng dụng React + TypeScript + Tailwind CSS. Mục tiêu: chuyển động mượt, nhẹ, tinh tế — không "nảy tưng tưng", không giật, không gây phân tâm.

## 0. Triết lý chung

- **Chuyển động phải có lý do.** Mỗi animation trả lời một câu hỏi UX: "cái này từ đâu ra?", "cái kia biến đi đâu?", "trạng thái nào đang active?". Không animate chỉ để cho đẹp.
- **Nhanh hơn bạn nghĩ.** Linear/Arc dùng duration cực ngắn (120–220ms cho UI chuyển động nhỏ). Animation "đẹp" thường là animation **người dùng gần như không nhận thấy** nhưng vẫn cảm nhận được sự mượt.
- **Chỉ animate `transform` và `opacity`.** Đây là 2 thuộc tính được GPU-compose, không trigger layout/paint. Tuyệt đối tránh animate `width`, `height`, `top`, `left`, `margin`, `box-shadow` trực tiếp — dùng `transform: scale()`, `transform: translate()` thay thế.
- **Easing không phải `ease` hay `linear` mặc định của CSS.** Dùng cubic-bezier tùy chỉnh (xem mục 1).
- **Tôn trọng `prefers-reduced-motion`.** Luôn có fallback tắt animation cho người dùng nhạy cảm chuyển động.
- **Stagger có giới hạn.** Danh sách dài không stagger toàn bộ — chỉ stagger N phần tử đầu (~8–12), phần còn lại render ngay để tránh cảm giác "chờ animation chạy xong".

---

## 1. Bảng easing & duration chuẩn

```ts
// lib/motion.ts
export const easing = {
  // Chuyển động UI thông thường (mở/đóng, hover, chuyển tab)
  standard: [0.4, 0, 0.2, 1] as const,
  // Vào màn hình / xuất hiện — hơi "nảy nhẹ" ở cuối, cảm giác sống động
  emphasized: [0.16, 1, 0.3, 1] as const,
  // Thoát / biến mất — nhanh, dứt khoát
  exit: [0.4, 0, 1, 1] as const,
  // Spring cho kéo-thả, resize, thứ cần phản hồi vật lý
  spring: { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 },
  springSoft: { type: 'spring', stiffness: 260, damping: 26, mass: 1 },
} as const;

export const duration = {
  instant: 0.08,   // micro feedback: nhấn nút, checkbox
  fast: 0.15,      // hover, dropdown item highlight
  base: 0.2,       // mở/đóng dropdown, tooltip, modal nhỏ
  medium: 0.28,    // card xuất hiện, page transition trong app
  slow: 0.4,       // route transition lớn, full-page
} as const;
```

**Quy tắc**: exit luôn **nhanh hơn** enter khoảng 20–30%. Người dùng chờ thứ xuất hiện, nhưng muốn thứ biến mất *ngay lập tức*.

---

## 2. Stack đề xuất

Vì dự án dùng **React + TypeScript + Tailwind**, ưu tiên theo thứ tự:

1. **Framer Motion (`motion/react`)** — cho mọi animation có state (enter/exit, layout, drag). Đây là lựa chọn chính.
2. **Tailwind transition utilities** (`transition-*`, `duration-*`, `ease-*`) — chỉ cho hover/focus đơn giản không cần AnimatePresence.
3. **CSS `@keyframes`** trong Tailwind config — cho animation lặp lại (skeleton shimmer, spinner) không cần JS.

```bash
npm install motion
```

```ts
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
```

Không dùng `react-spring` + `framer-motion` cùng lúc trong 1 codebase — chọn 1 để nhất quán token easing.

---

## 3. Danh sách card xuất hiện (list load / stagger)

**Nguyên tắc**: fade + dịch chuyển nhẹ theo trục Y (8–12px), không scale, không xoay. Stagger delay rất nhỏ (30–45ms/item), giới hạn tổng thời gian stagger ~300ms dù danh sách dài bao nhiêu.

```tsx
const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.035, delayChildren: 0.02 },
  },
};

const item = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.medium, ease: easing.emphasized },
  },
};

function CardGrid({ items }: { items: Item[] }) {
  return (
    <motion.div
      className="grid grid-cols-3 gap-4"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {items.map((it) => (
        <motion.div key={it.id} variants={item} className="rounded-xl border p-4">
          {/* card content */}
        </motion.div>
      ))}
    </motion.div>
  );
}
```

**Khi danh sách được filter/sort lại (không phải load lần đầu)**: dùng `layout` prop thay vì replay stagger toàn bộ — Framer Motion tự tính vị trí mới và animate FLIP-style.

```tsx
<motion.div layout transition={{ ...easing.spring }}>
```

**Skeleton loading** (trước khi data về): shimmer nhẹ bằng CSS, không dùng JS spring cho việc lặp vô hạn.

```ts
// tailwind.config.ts
extend: {
  keyframes: {
    shimmer: { '100%': { transform: 'translateX(100%)' } },
  },
  animation: { shimmer: 'shimmer 1.5s infinite' },
}
```

---

## 4. Dropdown / Popover / Menu

**Nguyên tắc**: origin transform đúng hướng (từ trigger button ra), scale nhẹ 0.96→1 kết hợp fade + dịch Y ngắn (4–6px). Đóng nhanh hơn mở.

```tsx
const dropdownVariants = {
  closed: { opacity: 0, scale: 0.96, y: -4 },
  open: {
    opacity: 1, scale: 1, y: 0,
    transition: { duration: duration.base, ease: easing.emphasized },
  },
  exit: {
    opacity: 0, scale: 0.98, y: -2,
    transition: { duration: duration.fast, ease: easing.exit },
  },
};

<AnimatePresence>
  {open && (
    <motion.div
      style={{ transformOrigin: 'top left' }} // đổi theo vị trí trigger
      variants={dropdownVariants}
      initial="closed" animate="open" exit="exit"
      className="rounded-lg border bg-popover shadow-lg"
    >
      {/* menu items */}
    </motion.div>
  )}
</AnimatePresence>
```

**Menu items bên trong**: không cần stagger riêng trừ khi menu > 6 item — nếu có, dùng stagger 15–20ms, nhanh hơn nhiều so với card list.

**Tooltip**: duration `instant`–`fast`, không scale, chỉ fade + dịch 2–4px, delay xuất hiện ~150–300ms (tránh flash khi lướt chuột qua nhanh) nhưng đóng ngay lập tức khi rời chuột.

---

## 5. Chuyển trang (page transition) trong app (route thay đổi)

**Nguyên tắc quan trọng**: page transition trong desktop app (Electron/Tauri) khác web — người dùng thao tác liên tục, animation chậm sẽ cảm thấy "nặng". Giữ duration ≤ 200–250ms, direction-aware nếu có khái niệm forward/back.

```tsx
const pageVariants = {
  initial: (direction: 1 | -1) => ({ opacity: 0, x: direction * 16 }),
  animate: { opacity: 1, x: 0, transition: { duration: duration.medium, ease: easing.standard } },
  exit: (direction: 1 | -1) => ({
    opacity: 0, x: direction * -16,
    transition: { duration: duration.fast, ease: easing.exit },
  }),
};

<AnimatePresence mode="wait" custom={direction}>
  <motion.div
    key={routeKey}
    custom={direction}
    variants={pageVariants}
    initial="initial" animate="animate" exit="exit"
  >
    {children}
  </motion.div>
</AnimatePresence>
```

- `mode="wait"`: trang cũ thoát xong mới vào trang mới — dùng khi 2 trang có layout khác biệt lớn (tránh chồng lấp lộn xộn).
- `mode="popLayout"` hoặc không set `mode`: 2 trang animate song song — dùng khi muốn cảm giác "trượt qua nhau" liền mạch (giống Linear chuyển giữa các view chính).
- Với sidebar navigation (danh sách bên trái cố định, panel bên phải đổi nội dung — đúng kiểu app của bạn với DeviceCard/sidebar), **chỉ animate phần content**, sidebar không animate lại.

---

## 6. Sub page / Panel chi tiết (drill-down, giống mở firmware detail từ model browser)

**Nguyên tắc**: đây là "đi sâu vào", nên dùng chuyển động có **chiều sâu** — không chỉ fade, mà scale nhẹ + slide, gợi cảm giác zoom vào lớp mới. Linear dùng pattern này khi mở issue detail từ list.

```tsx
const subPageVariants = {
  initial: { opacity: 0, scale: 0.98, x: 24 },
  animate: {
    opacity: 1, scale: 1, x: 0,
    transition: { duration: duration.medium, ease: easing.emphasized },
  },
  exit: {
    opacity: 0, scale: 0.99, x: 16,
    transition: { duration: duration.fast, ease: easing.exit },
  },
};
```

**Nếu có shared element** (ví dụ ảnh cover firmware ở card list → cùng ảnh đó lớn hơn ở detail page): dùng `layoutId` để Framer Motion tự animate morph liên tục giữa 2 vị trí — đây là hiệu ứng "chuyển động ma thuật" đặc trưng của Linear/Arc.

```tsx
// Ở card:
<motion.img layoutId={`cover-${item.id}`} src={item.cover} className="rounded-lg" />

// Ở detail page:
<motion.img layoutId={`cover-${item.id}`} src={item.cover} className="rounded-2xl w-full" />
```

Cả 2 phải nằm trong cùng `LayoutGroup` (hoặc cùng cây AnimatePresence) để `layoutId` match được.

**Backdrop cho panel dạng overlay/slide-over** (nếu sub page là panel trượt từ phải, không phải full route):

```tsx
<motion.div
  initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
  transition={{ ...easing.spring, stiffness: 340, damping: 34 }}
  className="fixed inset-y-0 right-0 w-[420px] bg-background shadow-2xl"
/>
<motion.div
  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
  className="fixed inset-0 bg-black/40"
  onClick={onClose}
/>
```

---

## 7. Micro-interaction (nút bấm, checkbox, toggle, switch)

- **Button press**: `whileTap={{ scale: 0.97 }}`, duration `instant`, không easing phức tạp.
- **Hover trên card/row**: chỉ đổi `background-color`/`border-color` qua Tailwind `transition-colors duration-150`, không cần Framer Motion.
- **Progress ring / border progress** (bạn đã có SVG ring trong DeviceCard): animate `stroke-dashoffset` bằng CSS transition `transition-[stroke-dashoffset] duration-300 ease-linear`, KHÔNG dùng easing "emphasized" ở đây vì progress phải tuyến tính, phản ánh đúng % thực.
- **Toggle/switch**: dùng `layout` trên knob bên trong track, spring nhẹ (`stiffness: 500, damping: 30`).

```tsx
<motion.button whileTap={{ scale: 0.97 }} transition={{ duration: duration.instant }}>
  Download
</motion.button>
```

---

## 8. Toast / Notification xuất hiện

Vào từ dưới hoặc từ góc, ra biến mất nhanh hơn nhiều so với vào. Nếu có nhiều toast xếp chồng, dùng `layout` để toast cũ tự dịch chuyển khi 1 toast bị đóng — không giật cục.

```tsx
const toastVariants = {
  initial: { opacity: 0, y: 20, scale: 0.9 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: duration.medium, ease: easing.emphasized } },
  exit: { opacity: 0, scale: 0.9, transition: { duration: duration.instant, ease: easing.exit } },
};
```

---

## 9. Hiệu năng — checklist bắt buộc

- [ ] Chỉ animate `transform` + `opacity`. Nếu cần animate `height` (accordion, expand), dùng `motion.div` với `animate={{ height: 'auto' }}` — Framer Motion tự đo và tween mượt, hoặc dùng `grid-template-rows: 0fr → 1fr` trick trong CSS thuần.
- [ ] Thêm `will-change: transform` cho phần tử animate liên tục (drag, progress ring) — KHÔNG lạm dụng cho toàn bộ DOM vì tốn VRAM.
- [ ] Với Electron/Tauri trên Windows: kiểm tra animation trên GPU tích hợp (Intel UHD) không chỉ GPU rời — đây là nơi jank hay lộ ra nhất.
- [ ] Danh sách rất dài (>50 card): tắt stagger, chỉ fade-in đồng loạt nhanh (`duration.fast`), hoặc dùng virtualization (react-window/virtua) trước, animation chỉ áp cho item đang render.
- [ ] Luôn wrap `AnimatePresence` ở component cha ổn định — không remount lại wrapper mỗi lần route đổi, nếu không exit animation sẽ không bao giờ chạy.
- [ ] Test với `prefers-reduced-motion: reduce`:

```tsx
import { useReducedMotion } from 'motion/react';

const shouldReduceMotion = useReducedMotion();
const transition = shouldReduceMotion
  ? { duration: 0 }
  : { duration: duration.medium, ease: easing.emphasized };
```

---

## 10. Bảng tra nhanh (cheat sheet)

| Tình huống | Thuộc tính animate | Duration | Easing |
|---|---|---|---|
| Card xuất hiện trong list | opacity, y (8-10px) | `medium` (0.28s) | `emphasized` |
| Dropdown/menu mở | opacity, scale (0.96→1), y | `base` (0.2s) | `emphasized` |
| Dropdown/menu đóng | opacity, scale, y | `fast` (0.15s) | `exit` |
| Tooltip | opacity, y (2-4px) | `fast`/`instant` | `standard` |
| Page/route chuyển | opacity, x (16-24px) | `medium` | `standard`/`exit` |
| Sub page drill-down | opacity, scale (0.98→1), x | `medium` | `emphasized` |
| Slide-over panel | x (100%→0) | spring | `spring` |
| Shared element (layoutId) | tự động (layout) | — | `spring` |
| Nút bấm (tap) | scale (1→0.97) | `instant` | linear |
| Toggle/switch knob | layout (spring) | — | spring stiff |
| Toast vào | opacity, y, scale | `medium` | `emphasized` |
| Toast ra | opacity, scale | `instant` | `exit` |
| Progress ring | stroke-dashoffset (CSS) | linear theo % thực | linear |

---

## 11. Việc agent KHÔNG nên làm

- Không dùng `ease: 'easeInOut'` mặc định của Framer Motion cho mọi thứ — quá "nhựa", không có cá tính.
- Không đặt duration > 400ms cho bất kỳ UI interaction thường xuyên nào (dropdown, hover, nút bấm). Duration dài chỉ dành cho onboarding/splash/hero, không phải thao tác lặp lại hàng ngày.
- Không animate đồng thời quá nhiều thuộc tính khác nhau trên 1 phần tử (vd: vừa đổi màu, vừa scale, vừa xoay, vừa dịch chuyển) — chọn tối đa 2-3 để chuyển động rõ ràng, có chủ đích.
- Không bỏ qua `exit` animation rồi để phần tử biến mất đột ngột (unmount cứng) — luôn có `AnimatePresence` nếu component có thể unmount.
- Không stagger toàn bộ danh sách hàng trăm item — giới hạn hoặc tắt.
