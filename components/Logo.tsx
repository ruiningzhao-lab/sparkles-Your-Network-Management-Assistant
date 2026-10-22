export function Mark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="logo-mark"
      style={{
        width: size,
        height: size,
        display: 'inline-grid',
        placeItems: 'center',
        fontFamily: 'var(--f-display)',
        fontWeight: 600,
        fontSize: size * 0.52,
        letterSpacing: '-0.02em',
        background: 'var(--sunk)',
        border: '1px solid var(--line2)',
        borderRadius: 8,
        color: 'var(--ink)',
      }}
      aria-hidden="true"
    >
      S
    </span>
  );
}
/** @deprecated use Mark */
export const Star = Mark;
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Sparkles';
