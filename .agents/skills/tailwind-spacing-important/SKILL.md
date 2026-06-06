---
name: tailwind-spacing-important
description: Enforce that all Tailwind CSS margin and padding utility classes must use the important modifier (!). Use this skill whenever writing or editing Tailwind CSS classes in JSX/TSX/HTML files. Applies to all margin (m-, mt-, mb-, ml-, mr-, mx-, my-, ms-, me-) and padding (p-, pt-, pb-, pl-, pr-, px-, py-, ps-, pe-) utilities.
---

# Tailwind Spacing Important Rule

When writing Tailwind CSS classes, **every** margin and padding utility class **must** include the important modifier (`!`).

## Affected Classes

All variants of margin and padding utilities:

- **Margin**: `m-`, `mt-`, `mb-`, `ml-`, `mr-`, `mx-`, `my-`, `ms-`, `me-`
- **Padding**: `p-`, `pt-`, `pb-`, `pl-`, `pr-`, `px-`, `py-`, `ps-`, `pe-`

## Rule

Append `!` to the end of every margin/padding utility class.

### ✅ Correct

```
mt-1! mb-2! px-4! py-2! mr-3! ml-auto! p-0! m-0!
```

### ❌ Wrong

```
mt-1 mb-2 px-4 py-2 mr-3 ml-auto p-0 m-0
```

## Notes

- The `!` modifier comes **after** the value, not before: `mt-4!` not `!mt-4`
- Arbitrary values also need `!`: `mt-[12px]!`, `px-[5%]!`
- This rule applies to ALL margin/padding classes, no exceptions
- Other utility classes (flex, grid, colors, typography, etc.) do NOT need the `!` modifier
