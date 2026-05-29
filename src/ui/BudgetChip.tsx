import { useStore } from '../state/store';
import { palette, fontDisplay, controlHeight } from './theme';

interface RejectionTicks {
  passiveRejectionTick: number;
  ascendancyRejectionTick: number;
  weaponSet1RejectionTick: number;
  weaponSet2RejectionTick: number;
}

/** Pick the per-budget rejection counter that keys this chip's shake. */
function rejectionTickFor(s: RejectionTicks, kind: BudgetChipProps['kind']): number {
  switch (kind) {
    case 'passive': return s.passiveRejectionTick;
    case 'ascendancy': return s.ascendancyRejectionTick;
    case 'weaponSet1': return s.weaponSet1RejectionTick;
    case 'weaponSet2': return s.weaponSet2RejectionTick;
  }
}

interface BudgetChipProps {
  label: string;
  count: number;
  /** Cap for the `N / cap` form. Omit for a plain count (e.g. Shared, whose
   *  real headroom is bound by the per-set active totals, not a cap of its own). */
  cap?: number;
  /** Which budget this chip represents — picks the per-budget rejection tick
   *  to key the shake animation on. */
  kind: 'passive' | 'ascendancy' | 'weaponSet1' | 'weaponSet2';
  /** Optional muted suffix after the cap (e.g. "18 left"). */
  note?: string;
}

/**
 * Single budget chip: `<Label> N / cap`. The cap is fixed per game rules
 * (123 passives, 8 ascendancy) and rendered as static text. Over-cap clicks
 * are always rejected.
 *
 * Shake animation: the wrapper's React `key` is bound to this budget's
 * rejection counter from the store. When the counter increments (a commit
 * was rejected against THIS budget), the wrapper remounts and the CSS
 * @keyframes runs once. The other budget's counter doesn't move, so the
 * other chip doesn't remount.
 */
export default function BudgetChip({
  label, count, cap, kind, note,
}: Readonly<BudgetChipProps>) {
  const tick = useStore((s) => rejectionTickFor(s, kind));

  const over = cap !== undefined && count > cap;

  return (
    <div
      key={tick}
      style={{
        ...chipStyle,
        ...(over ? chipOverStyle : null),
        ...(tick > 0 ? chipShakeStyle : null),
      }}
      data-kind={kind}
    >
      {/* Inner row aligns the display-font label and the body-font numbers on
          a shared text baseline (their box centres don't coincide because the
          fonts have different metrics); the chip then centres the row. */}
      <span style={chipInnerStyle}>
        <span style={chipLabelStyle}>{label}</span>
        <span style={over ? chipCountOverStyle : chipCountStyle}>{count}</span>
        {cap !== undefined && <span style={chipSlashStyle}>/</span>}
        {cap !== undefined && <span style={capStyle}>{cap}</span>}
        {note && <span style={chipNoteStyle}>{note}</span>}
      </span>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: controlHeight,
  boxSizing: 'border-box',
  padding: '0 10px',
  background: palette.fieldBg,
  border: `1px solid ${palette.border}`,
  borderRadius: 3,
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
  transition: 'background-color 150ms, border-color 150ms',
};

const chipInnerStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 5,
};

const chipOverStyle: React.CSSProperties = {
  background: palette.dangerBg,
  borderColor: palette.dangerBorder,
};

const chipShakeStyle: React.CSSProperties = {
  animation: 'poe2-shake 250ms',
};

const chipLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontFamily: fontDisplay,
  textTransform: 'uppercase',
  letterSpacing: 1.2,
  color: palette.textMuted,
  marginRight: 2,
};

// Count and cap share the same look so the chip reads as a single "N / M"
// value. Over-cap is the only state that changes the count's colour/weight.
const numStyle: React.CSSProperties = {
  color: palette.textTitle,
  fontWeight: 500,
  fontSize: 13,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
};

const chipCountStyle: React.CSSProperties = numStyle;
const chipCountOverStyle: React.CSSProperties = { ...numStyle, color: palette.dangerText, fontWeight: 700 };
const chipSlashStyle: React.CSSProperties = { ...numStyle, opacity: 0.4 };
const capStyle: React.CSSProperties = numStyle;

// Muted trailing note (e.g. unspent points) — set apart with a thin divider.
const chipNoteStyle: React.CSSProperties = {
  marginLeft: 4,
  paddingLeft: 6,
  borderLeft: `1px solid ${palette.border}`,
  fontSize: 12,
  color: palette.textMuted,
  fontVariantNumeric: 'tabular-nums',
};
