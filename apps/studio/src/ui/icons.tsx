// Stroke icons drawn for Studio; all decorative, so the control carries the label.

const stroke = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Back = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" {...stroke} strokeWidth="1.5" /></svg>
);
export const Inspector = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" {...stroke} strokeWidth="1.2" /><path d="M10 2.5v11" {...stroke} strokeWidth="1.2" /></svg>
);
export const Plus = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" {...stroke} strokeWidth="1.6" /></svg>
);
export const Search = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><circle cx="6" cy="6" r="4.3" {...stroke} strokeWidth="1.4" /><path d="M9.3 9.3 12.5 12.5" {...stroke} strokeWidth="1.4" /></svg>
);
export const Gear = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.3" {...stroke} strokeWidth="1.3" /><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" {...stroke} strokeWidth="1.3" /></svg>
);
export const Play = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2v10l8.5-5z" fill="currentColor" /></svg>
);
export const PauseGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2" width="2.2" height="8" rx="0.6" fill="currentColor" /><rect x="7.3" y="2" width="2.2" height="8" rx="0.6" fill="currentColor" /></svg>
);
export const Expand = () => (
  <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden="true"><path d="M8 1.5h4.5V6M6 12.5H1.5V8M12.5 1.5 8.5 5.5M1.5 12.5l4-4" {...stroke} strokeWidth="1.4" /></svg>
);
export const More = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="3" cy="7" r="1.2" fill="currentColor" /><circle cx="7" cy="7" r="1.2" fill="currentColor" /><circle cx="11" cy="7" r="1.2" fill="currentColor" /></svg>
);
export const Chevron = () => (
  <svg width="7" height="10" viewBox="0 0 7 10" aria-hidden="true"><path d="M1.5 1.5 5 5 1.5 8.5" {...stroke} stroke="#a1a1a6" strokeWidth="1.3" /></svg>
);
export const StepChevron = () => (
  <svg width="6" height="8" viewBox="0 0 6 8" aria-hidden="true"><path d="M1.5 1 4.5 4 1.5 7" {...stroke} stroke="#b0b0b5" strokeWidth="1.2" /></svg>
);
export const Caret = () => (
  <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 4 5 6.5 7.5 4" {...stroke} strokeWidth="1.5" /></svg>
);
export const Cursor = () => (
  <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M3 2 L3 16 L7 12 L10 18 L12.5 17 L9.6 11 L15 11 Z" fill="#1d1d1f" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" /></svg>
);

/** A ring that empties as the countdown runs. */
export function Countdown({ left, total, size = 20 }: { left: number; total: number; size?: number }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  const share = total > 0 ? Math.max(0, Math.min(1, left / total)) : 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${left} seconds left`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e3e3e6" strokeWidth="2" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1d1d1f" strokeWidth="2" strokeLinecap="round"
        strokeDasharray={`${c * share} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
