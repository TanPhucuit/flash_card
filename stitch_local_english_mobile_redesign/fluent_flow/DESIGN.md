---
name: Fluent Flow
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#464554'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#767586'
  outline-variant: '#c7c4d7'
  surface-tint: '#494bd6'
  primary: '#4648d4'
  on-primary: '#ffffff'
  primary-container: '#6063ee'
  on-primary-container: '#fffbff'
  inverse-primary: '#c0c1ff'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#b61722'
  on-tertiary: '#ffffff'
  tertiary-container: '#da3437'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffdad7'
  tertiary-fixed-dim: '#ffb3ad'
  on-tertiary-fixed: '#410004'
  on-tertiary-fixed-variant: '#930013'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-flashcard:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-margin: 1rem
  stack-gap: 0.75rem
  section-gap: 1.5rem
  touch-target-min: 2.75rem
  inline-padding: 1rem
---

## Brand & Style

This design system is built for an engaging, mobile-first language learning experience. The brand personality is **encouraging, structured, and contemporary**, aiming to reduce the cognitive load associated with learning a new language. 

The visual style follows a **Modern Corporate** aesthetic with a "Soft UI" twist—utilizing high-quality whitespace, crisp typography, and subtle depth to make the educational content feel manageable rather than overwhelming. The interface prioritizes clarity and high-touch ergonomics, ensuring that users can navigate flashcard decks and review sessions with minimal friction. The emotional response should be one of progress and confidence.

## Colors

The palette is designed for high legibility and functional feedback. 

- **Primary (#6366F1):** Used for key actions, progress indicators, and active navigation states. It provides a scholarly yet modern feel.
- **Success (#10B981):** Reserved for "Correct" flashcard states, completed milestones, and positive reinforcement.
- **Error (#EF4444):** Used for "Incorrect" states and destructive actions.
- **Surface & Backgrounds:** We use a hierarchy of whites and soft grays. The main background is a very light gray (`#F8FAFC`) to allow white cards to "pop" with depth.
- **Text:** High-contrast slate grays are used instead of pure black to reduce eye strain during long study sessions.

## Typography

The typography system relies on **Inter** for its exceptional readability on small screens. 

- **Flashcard Text:** For the primary word being learned, use `display-flashcard` to ensure it is the focal point of the screen.
- **Headlines:** Use `headline-lg` for Page Titles and `headline-md` for Section Headers or Card Titles.
- **Body:** `body-lg` is the default for descriptions, while `body-md` is used for secondary information or metadata.
- **Labels:** Use `label-lg` for button text and `label-sm` for status badges or micro-copy.

## Layout & Spacing

This design system uses a **Fluid Grid** tailored for mobile viewports (375px - 480px). 

- **Margins:** A standard 16px (`1rem`) lateral margin is applied to all main containers.
- **Vertical Rhythm:** Elements within a card or list use a 12px (`0.75rem`) gap. Major sections are separated by 24px (`1.5rem`).
- **Mobile First:** Content should never be constrained by fixed widths; it must expand to fill the screen width minus margins.
- **Stacked Layouts:** Instead of tables, data is presented in vertical stacks. Each "row" becomes a card or a structured list item to ensure touch targets remain large and readable.

## Elevation & Depth

Hierarchy is established through **Tonal Layering** and **Ambient Shadows**.

- **Level 0 (Base):** The main application background (`#F8FAFC`).
- **Level 1 (Cards):** Pure white (`#FFFFFF`) surfaces. These use a soft, wide-spread shadow (Blur: 15px, Y: 4px, Opacity: 6% Black) to appear lifted from the base.
- **Level 2 (Floating Action Buttons / Sheets):** These use a more pronounced shadow (Blur: 20px, Y: 8px, Opacity: 12% Black) to indicate they sit high above the interface.
- **Interaction:** Buttons should provide a subtle "press" effect, either by darkening the background color or slightly reducing elevation on active state.

## Shapes

The shape language is friendly and approachable, avoiding sharp corners to maintain a "soft" educational feel.

- **Standard Cards & Inputs:** Use a 16px (`1rem`) border radius.
- **Buttons:** Use a 12px border radius for standard buttons, or full pill-shape for chips and small tags.
- **Bottom Sheets:** Only the top two corners are rounded (24px) to create a "drawer" effect.

## Components

### Navigation
- **Bottom Bar:** 5 items (Trang chủ, Bộ từ, Ôn tập, Trò chơi, Cài đặt). Active icons use the Primary color with a subtle background glow. 56px height.
- **Top App Bar:** Left-aligned back button (24px icon), centered or left-aligned Title (Headline-md).

### Buttons & Input
- **Primary Button:** Minimum 44px height (ideally 48px-52px for main actions). Filled with Primary color, white text (Label-lg).
- **Floating Action Button (FAB):** Circular, 56px diameter, centered Primary color icon. Positioned 16px from the bottom-right of the viewport.
- **Step-like Forms:** Use collapsible headers. Each step is a card. Completed steps show a Success Green checkmark.

### Information Display
- **Cards:** White background, 16px radius, soft shadow. For "Stacked Layouts," cards contain label-value pairs in a vertical format.
- **Progress Bars:** 8px height, rounded caps. Track is soft gray, indicator is Primary or Success green.
- **Status Badges:** Small pill-shaped containers with low-opacity background of the status color (e.g., light green background for "Hoàn thành").

### Overlays
- **Bottom Sheets:** Used for filters and deck options. They slide up from the bottom, covering 50-90% of the screen, with a dim background overlay.