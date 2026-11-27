export function EyeMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 16C8 7 16 2 24 2s16 5 21 14c-5 9-13 14-21 14S8 25 3 16Z"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <circle cx="24" cy="16" r="7" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="24" cy="16" r="2.5" fill="currentColor" />
    </svg>
  );
}

export function ArrowIcon({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={diagonal ? "-rotate-45" : ""}
    >
      <path
        d="M4 12h15m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BasketEye() {
  return (
    <div className="basket-eye" aria-hidden="true">
      <svg viewBox="0 0 420 340" fill="none">
        <defs>
          <clipPath id="warden-eye-lens">
            <path d="M28 170c92-123 272-123 364 0-92 123-272 123-364 0Z" />
          </clipPath>
        </defs>
        <circle
          cx="210"
          cy="170"
          r="145"
          stroke="currentColor"
          strokeOpacity=".14"
        />
        <circle
          cx="210"
          cy="170"
          r="118"
          stroke="currentColor"
          strokeOpacity=".13"
          strokeDasharray="2 7"
        />
        <path
          d="M5 170h410M210 8v324"
          stroke="currentColor"
          strokeOpacity=".1"
        />
        <path
          d="M28 170c92-123 272-123 364 0-92 123-272 123-364 0Z"
          stroke="currentColor"
          strokeWidth="2"
        />
        <g clipPath="url(#warden-eye-lens)">
          <circle cx="210" cy="170" r="83" fill="currentColor" />
          <circle
            cx="210"
            cy="170"
            r="65"
            stroke="#f0f8e9"
            strokeOpacity=".4"
          />
          <circle cx="210" cy="170" r="45" stroke="#f0f8e9" strokeWidth="1.5" />
          <circle cx="210" cy="170" r="26" fill="#f0f8e9" />
          <circle cx="217" cy="162" r="7" fill="currentColor" />
        </g>
        {[
          [-0.5, 145],
          [0.38, 145],
          [1.28, 145],
          [2.18, 145],
          [3.08, 145],
          [3.98, 145],
          [4.88, 145],
        ].map(([angle, radius], i) => (
          <circle
            key={i}
            cx={210 + Math.cos(angle) * radius}
            cy={170 + Math.sin(angle) * radius}
            r={i === 0 ? 6 : 4}
            fill="currentColor"
          />
        ))}
        <path
          d="m362 37 8 8m0-8-8 8M49 285l8 8m0-8-8 8"
          stroke="currentColor"
          strokeOpacity=".5"
        />
      </svg>
      <span className="eye-caption">YOUR PORTFOLIO. IN VIEW.</span>
    </div>
  );
}
