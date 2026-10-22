export function Star({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M12 1.5l2.3 6.4 6.7 .3-5.3 4.1 1.9 6.5L12 15l-5.6 3.8 1.9-6.5L3 8.2l6.7-.3z" fill="var(--accent)" />
    </svg>
  );
}
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Sparkles';
