/**
 * Runic UI theme — "Runes of Aldur".
 *
 * A single source of truth for the DOM-overlay chrome (tooltip, toolbar,
 * attribution, popovers). The look mirrors the league banner: dark titan-grey
 * slate panels, cold steel borders, and electric glyph-blue text with a faint
 * glow on titles.
 *
 * Components reference {@link palette} tokens (plus {@link fontDisplay} /
 * {@link fontBody} / {@link panelShadow}) directly in their style objects.
 * Keep hex values *here* — don't reintroduce literals in component files, or
 * the theme drifts apart again.
 */
export const palette = {
  /** Translucent slate for floating panels over the canvas. */
  panelBg: 'rgba(16, 20, 28, 0.92)',
  /** Opaque slate for popovers/menus that must fully occlude the tree. */
  panelBgSolid: '#141a24',
  /** Recessed slate for inputs, selects, chips, buttons. */
  fieldBg: '#1a212d',
  /** Darker band behind a panel's title row. */
  headerBg: 'rgba(8, 11, 16, 0.6)',

  /** Default cold-steel border. */
  border: '#34465c',
  /** Hairline divider inside panels. */
  divider: '#222d3d',

  /** Electric rune blue — the signature accent (glow, links, active state). */
  rune: '#5db4ff',
  /** Deep rune blue — for solid accent marks (e.g. the tooltip stat stripe)
   *  that should read as a dark accent rather than glow. Tuned to sit close to
   *  the panel header background tone. */
  runeDark: '#19222f',
  /** Soft glow colour for title text-shadow. */
  runeGlow: 'rgba(93, 180, 255, 0.55)',

  /** Bright blue-white for titles. */
  textTitle: '#d6e8ff',
  /** Primary blueish body text. */
  textPrimary: '#bcd3ec',
  /** Stat / value blue. */
  textStat: '#7fb4ee',
  /** Brushed-titanium grey for tooltip stat values, sub-bullets, and underlines
   *  — metallic and low-chroma so they sit quietly with the body. The deep
   *  `runeDark` entry stripe is the only accent that still pops. */
  textMetal: '#c2c8d0',
  /** Muted steel for labels, captions, disabled. */
  textMuted: '#6f8398',

  /** Warning / over-cap red, tinted cool to sit with the palette. */
  dangerBg: '#3a1620',
  dangerBorder: '#a04458',
  dangerText: '#ff8fa3',

  /** Success (copied toast). */
  successBg: '#10302a',
  successBorder: '#2f6a5c',
  successText: '#8fe6cf',
} as const;

/** Engraved-stone display stack for titles. OptimusPrincepsSemiBold is the
 *  preferred carved Roman face, self-hosted via @font-face (see index.css);
 *  Cinzel (Google Fonts) covers the brief load gap and any fetch failure, then
 *  the sans/serif fallbacks. */
export const fontDisplay =
  'OptimusPrincepsSemiBold, Cinzel, "Noto Sans JP", Verdana, Arial, Helvetica, sans-serif, serif';

export const fontBody = "system-ui, 'Segoe UI', Roboto, sans-serif";

/** Soft outer glow + drop shadow shared by floating panels. */
export const panelShadow =
  '0 8px 24px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(93, 180, 255, 0.06)';

/** Uniform height (px) for interactive toolbar controls — selects, search,
 *  buttons, chips — so a wrapped row stays visually aligned. */
export const controlHeight = 28;
