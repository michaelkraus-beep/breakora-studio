import React from 'react';

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 64 64" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className="drop-shadow-[0_0_12px_rgba(56,189,248,0.6)]"
    >
      {/* Hovering Hands (Left) */}
      <path 
        d="M10 28C10 28 12 18 22 14C32 10 34 12 34 12" 
        stroke="#93C5FD" 
        strokeWidth="3" 
        strokeLinecap="round" 
        className="opacity-80"
      />
      {/* Hovering Hands (Right) */}
      <path 
        d="M54 28C54 28 52 18 42 14C32 10 30 12 30 12" 
        stroke="#93C5FD" 
        strokeWidth="3" 
        strokeLinecap="round" 
        className="opacity-80"
      />
      
      {/* Crystal Ball */}
      <circle cx="32" cy="40" r="18" fill="url(#ballGrad)" stroke="white" strokeOpacity="0.2" />
      
      {/* Inner Glow / Reflection */}
      <circle cx="24" cy="32" r="6" fill="white" fillOpacity="0.3" filter="blur(2px)" />
      
      {/* Chart Line inside ball */}
      <path 
        d="M22 48L28 42L34 46L42 34" 
        stroke="white" 
        strokeWidth="2.5" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        className="drop-shadow-sm"
      />
      
      {/* Base of the ball */}
      <path d="M24 58C24 58 26 61 32 61C38 61 40 58 40 58" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round" />

      <defs>
        <radialGradient id="ballGrad" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(24 32) rotate(45) scale(30)">
          <stop stopColor="#F0F9FF" />
          <stop offset="0.4" stopColor="#38BDF8" />
          <stop offset="1" stopColor="#0369A1" />
        </radialGradient>
      </defs>
    </svg>
  );
}
