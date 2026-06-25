---
name: Local English Flashcards
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#464555'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#712ae2'
  on-secondary: '#ffffff'
  secondary-container: '#8a4cfc'
  on-secondary-container: '#fffbff'
  tertiary: '#7e3000'
  on-tertiary: '#ffffff'
  tertiary-container: '#a44100'
  on-tertiary-container: '#ffd2be'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#eaddff'
  secondary-fixed-dim: '#d2bbff'
  on-secondary-fixed: '#25005a'
  on-secondary-fixed-variant: '#5a00c6'
  tertiary-fixed: '#ffdbcc'
  tertiary-fixed-dim: '#ffb695'
  on-tertiary-fixed: '#351000'
  on-tertiary-fixed-variant: '#7b2f00'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  display-word:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Be Vietnam Pro
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Be Vietnam Pro
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  translation-text:
    fontFamily: Be Vietnam Pro
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 30px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  container-margin: 20px
  gutter: 16px
---

## Brand & Style
The design system is centered on a **Modern Academic** aesthetic—a blend of institutional reliability and contemporary digital friendliness. It targets Vietnamese students who need a focused, distraction-free environment for language acquisition. 

The style prioritizes **Minimalism** with high-clarity information density. By utilizing generous white space and a structured hierarchy, the UI reduces cognitive load, allowing the vocabulary to remain the focal point. The emotional response is one of "organized progress"—encouraging the user through clarity rather than gamified clutter. The absence of cloud features is reflected in a "local-first" design language: sturdy, fast, and always available.

## Colors
The palette uses a **Modern Blue (#4F46E5)** as the primary driver for action and progress, symbolizing trust and academic focus. **Royal Purple (#7C3AED)** serves as the secondary accent, specifically reserved for "Aha!" moments, such as discovering new words or completing a deck.

- **Backgrounds:** Use the soft gray (`#F9FAFB`) for the main app canvas to reduce eye strain during long study sessions.
- **Surfaces:** Cards and interactive tiles must be crisp white (`#FFFFFF`) to create a clear "physical" distinction from the background.
- **Typography:** Primary English text uses the darkest gray (`#111827`) for maximum contrast, while Vietnamese translations and metadata use the secondary gray (`#4B5563`).

## Typography
This design system pairs **Inter** for English content and functional UI with **Be Vietnam Pro** for Vietnamese labels and headings. This pairing ensures that Vietnamese diacritics are rendered beautifully and legibly.

- **English Words:** Displayed using `display-word` for flashcard fronts to ensure immediate recognition.
- **Vietnamese Translations:** Displayed using `translation-text` with a slight italicize to distinguish them from English definitions.
- **Hierarchy:** Use `label-caps` for metadata like "DANH MỤC" (Category) or "TIẾN ĐỘ" (Progress) to maintain an organized, dashboard-like feel.

## Layout & Spacing
The layout follows a **Fixed Grid** model on desktop (centered 1024px container) and a **Fluid Grid** on mobile. A 4px baseline grid ensures vertical rhythm across all study components.

- **Dashboard:** Uses a 12-column layout. "Daily Goals" and "Recent Decks" span 6 columns each on desktop, but stack vertically on mobile.
- **Study Mode:** The flashcard is centered within the viewport with a `2xl` (48px) margin on all sides to eliminate distractions.
- **Safe Areas:** Maintain a `container-margin` of 20px on mobile to ensure content doesn't hit the screen edges.

## Elevation & Depth
Depth is used to signify "interactivity." The design system avoids heavy shadows in favor of **Ambient Shadows** that suggest the flashcards are resting just above the surface.

- **Level 0 (Background):** Flat `#F9FAFB`. No shadow.
- **Level 1 (Dashboard Tiles):** 1px border in `#E5E7EB` with a very soft 4px blur shadow (5% opacity).
- **Level 2 (Active Flashcard):** 12px blur shadow (10% opacity) with a subtle tint of the primary color (`#4F46E5`) to make the card feel "active" and primary in the user's focus.
- **Level 3 (Modals/Popups):** 24px blur shadow (15% opacity) to create distinct separation for settings or deck creation.

## Shapes
The shape language is friendly and modern, utilizing **Rounded (2)** corners for most elements. 

- **Flashcards:** Must use `rounded-2xl` (1.5rem / 24px) to emphasize the soft, approachable nature of the learning tool.
- **Buttons & Inputs:** Use standard `rounded-lg` (1rem / 16px).
- **Progress Bars:** Use pill-shaped (fully rounded) caps to communicate a smooth, continuous flow of learning.

## Components

### Study Buttons
The primary action button (e.g., "Bắt đầu học") should be large, using the `primary_color_hex` with white text. It should have a subtle scale-down effect (98%) on press to provide tactile feedback.

### Flashcards
The "2xl" rounded cards are the core component. The front should be minimal (English only), while the back reveals the translation, IPA (phonetic) transcription, and an example sentence. Use a "flip" transition animation.

### Progress Bars
Track deck completion with a 2-tone bar: a light blue background track and a `primary_color_hex` fill. Include a percentage label using `label-caps`.

### Interactive Tiles
Used for selecting categories (e.g., "Business", "Travel"). These should have a hover state that slightly lifts the card (increases shadow) and changes the border color to the primary blue.

### Input Fields
For adding new words locally, inputs should be clean with a 1px gray border that transitions to the `secondary_color_hex` (Purple) when focused, signaling an active state.

### Chips
Use small, light-tinted chips for word tags (e.g., "Noun", "Verb") with `body-md` text.