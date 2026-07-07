/**
 * Shared motion tokens — aligned with animations.css easing variables.
 * Use these for all Framer Motion animations in the app.
 */

export const easing = {
  /** UI motion (open/close, hover, tab switch) — matches --ease-smooth */
  standard: [0.4, 0, 0.2, 1] as const,
  /** Enter/appear — matches --ease-decelerate */
  emphasized: [0, 0, 0.2, 1] as const,
  /** Exit/disappear — matches --ease-accelerate */
  exit: [0.4, 0, 1, 1] as const,
  /** Primary motion — matches --ease-primary */
  primary: [0.2, 0, 0, 1] as const,
} as const;

export const duration = {
  instant: 0.08,
  fast: 0.15,
  base: 0.2,
  medium: 0.28,
  slow: 0.4,
} as const;

/** Card list stagger container */
export const staggerContainer = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.035, delayChildren: 0.02 },
  },
};

/** Card list stagger item — fade + translateY */
export const staggerItem = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.medium, ease: easing.emphasized },
  },
};

/** Card list stagger item — fade only (no movement) */
export const staggerItemFade = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: duration.medium, ease: easing.emphasized },
  },
};

/** Panel slide in from right */
export const panelSlideIn = {
  initial: { opacity: 0, x: 20 },
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: duration.medium, ease: easing.primary },
  },
  exit: {
    opacity: 0,
    x: 16,
    transition: { duration: duration.fast, ease: easing.exit },
  },
};

/** Page route transition */
export const pageTransition = {
  initial: { opacity: 0, x: 16 },
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: duration.medium, ease: easing.standard },
  },
  exit: {
    opacity: 0,
    x: -16,
    transition: { duration: duration.fast, ease: easing.exit },
  },
};

/** Download card enter/exit */
export const downloadCardVariants = {
  initial: { opacity: 0, y: 8, scale: 0.985 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: duration.medium, ease: easing.emphasized },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: { duration: duration.fast, ease: easing.exit },
  },
};

/** Dropdown / popover */
export const dropdownVariants = {
  closed: { opacity: 0, scale: 0.96, y: -4 },
  open: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: duration.base, ease: easing.emphasized },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    y: -2,
    transition: { duration: duration.fast, ease: easing.exit },
  },
};
