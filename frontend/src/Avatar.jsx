import React from 'react';

// Flat-colour smiley avatars, in the spirit of the classic profile icons.
export const AVATAR_COLORS = ['#2F80ED', '#F2C94C', '#E50914', '#27AE60', '#9B51E0', '#F2994A', '#2DB5C9', '#EB5757'];

export default function Avatar({ index = 0, kids = false, size = 96, className = '', rounded = 'rounded-[6px]' }) {
  if (kids) {
    return (
      <div
        className={`${rounded} flex items-center justify-center overflow-hidden ${className}`}
        style={{
          width: size,
          height: size,
          background: 'linear-gradient(135deg, #7b2ff7 0%, #2f80ed 45%, #27ae60 100%)',
        }}
      >
        <span
          className="font-logo whitespace-nowrap leading-none"
          style={{ fontSize: size * 0.33, letterSpacing: '0.02em', textShadow: '0 2px 0 rgba(0,0,0,.25)' }}
        >
          <span style={{ color: '#ffd23f' }}>k</span>
          <span style={{ color: '#ff6b6b' }}>i</span>
          <span style={{ color: '#fff' }}>d</span>
          <span style={{ color: '#7dffb0' }}>s</span>
        </span>
      </div>
    );
  }

  const color = AVATAR_COLORS[index % AVATAR_COLORS.length];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={`${rounded} ${className}`} role="img" aria-label="Profile avatar">
      <rect width="100" height="100" fill={color} />
      <ellipse cx="33" cy="40" rx="4.6" ry="6.2" fill="#fff" />
      <ellipse cx="67" cy="40" rx="4.6" ry="6.2" fill="#fff" />
      <path d="M26 62 Q50 82 74 62" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" />
    </svg>
  );
}
