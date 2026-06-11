type LogoSize = "nav" | "sm" | "hero" | "float";

const sizes: Record<LogoSize, { width: number; height: number }> = {
  nav: { width: 26, height: 22 },
  sm: { width: 70, height: 62 },
  hero: { width: 120, height: 105 },
  float: { width: 190, height: 166 },
};

export function Logo({ size }: { size: LogoSize }) {
  const { width, height } = sizes[size];
  const isFloat = size === "float";
  const isSm = size === "sm";

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 160 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={
        isFloat
          ? {
              filter: "drop-shadow(0 8px 40px rgba(72,120,240,0.35)) drop-shadow(0 0 80px rgba(24,48,168,0.2))",
              animation: "logoFloat 7s ease-in-out infinite",
            }
          : isSm
          ? { opacity: 0.4 }
          : undefined
      }
    >
      <defs>
        <linearGradient id={`logo-grad-${size}`} x1="0" y1="0" x2="160" y2="140" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#90D8FF" />
          <stop offset="50%" stopColor="#4878F0" />
          <stop offset="100%" stopColor="#1830A8" />
        </linearGradient>
      </defs>
      {/* R stem */}
      <rect
        x={8}
        y={8}
        width={18}
        height={124}
        rx={9}
        fill={`url(#logo-grad-${size})`}
      />
      {/* R bowl */}
      <path
        d="M26 8 Q108 8 108 48 Q108 88 26 88"
        stroke={`url(#logo-grad-${size})`}
        strokeWidth={18}
        fill="none"
        strokeLinecap="round"
      />
      {/* R leg / E bottom connection */}
      <line
        x1={26}
        y1={88}
        x2={104}
        y2={136}
        stroke={`url(#logo-grad-${size})`}
        strokeWidth={17}
        strokeLinecap="round"
      />
      {/* E mid bar */}
      <line
        x1={26}
        y1={48}
        x2={86}
        y2={48}
        stroke={`url(#logo-grad-${size})`}
        strokeWidth={16}
        strokeLinecap="round"
      />
      {/* E bottom bar */}
      <line
        x1={104}
        y1={136}
        x2={155}
        y2={136}
        stroke={`url(#logo-grad-${size})`}
        strokeWidth={17}
        strokeLinecap="round"
      />
      <style>{`
        @keyframes logoFloat {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-18px) rotate(2deg); }
        }
      `}</style>
    </svg>
  );
}
