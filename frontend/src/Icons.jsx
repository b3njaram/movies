import React from 'react';

const S = ({ children, size = 24, className = '', fill = 'currentColor', ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} className={className} aria-hidden="true" {...rest}>
    {children}
  </svg>
);

const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' };

export const PlayIcon = (p) => (
  <S {...p}>
    <path d="M6 4.6v14.8a1 1 0 0 0 1.52.85l12.1-7.4a1 1 0 0 0 0-1.7L7.52 3.75A1 1 0 0 0 6 4.6z" />
  </S>
);
export const PauseIcon = (p) => (
  <S {...p}>
    <rect x="5" y="4" width="4.6" height="16" rx="1" />
    <rect x="14.4" y="4" width="4.6" height="16" rx="1" />
  </S>
);
export const PlusIcon = (p) => (
  <S {...p} {...stroke} strokeWidth="2.6">
    <path d="M12 4.5v15M4.5 12h15" />
  </S>
);
export const CheckIcon = (p) => (
  <S {...p} {...stroke} strokeWidth="2.6">
    <path d="M4.5 12.5l5 5L19.5 7" />
  </S>
);
export const InfoIcon = (p) => (
  <S {...p} {...stroke} strokeWidth="2">
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 11v6" />
    <circle cx="12" cy="7.6" r="0.6" fill="currentColor" />
  </S>
);
export const ChevronDown = (p) => (
  <S {...p} {...stroke} strokeWidth="2.4">
    <path d="M5 8.5l7 7 7-7" />
  </S>
);
export const ChevronLeft = (p) => (
  <S {...p} {...stroke} strokeWidth="2.6">
    <path d="M15 4.5l-7.5 7.5L15 19.5" />
  </S>
);
export const ChevronRight = (p) => (
  <S {...p} {...stroke} strokeWidth="2.6">
    <path d="M9 4.5l7.5 7.5L9 19.5" />
  </S>
);
export const SearchIcon = (p) => (
  <S {...p} {...stroke} strokeWidth="2.2">
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5L21 21" />
  </S>
);
export const CloseIcon = (p) => (
  <S {...p} {...stroke} strokeWidth="2.4">
    <path d="M5 5l14 14M19 5L5 19" />
  </S>
);
export const BackIcon = (p) => (
  <S {...p} {...stroke} strokeWidth="2.4">
    <path d="M20 12H4.5M11 5l-7 7 7 7" />
  </S>
);
export const PencilIcon = (p) => (
  <S {...p} {...stroke} strokeWidth="2">
    <path d="M4 20l1-4.2L16.6 4.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19 4 20z" />
  </S>
);
export const VolumeIcon = ({ level = 2, ...p }) => (
  <S {...p}>
    <path d="M3 9.5v5h3.6l4.9 4V5.5l-4.9 4H3z" />
    {level === 0 && (
      <path d="M15.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    )}
    {level >= 1 && (
      <path d="M14.8 9.2a4 4 0 0 1 0 5.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    )}
    {level >= 2 && (
      <path d="M17.6 6.6a8 8 0 0 1 0 10.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    )}
  </S>
);
export const FullscreenIcon = (p) => (
  <S {...p} {...stroke} strokeWidth="2.2">
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </S>
);
export const ExitFullscreenIcon = (p) => (
  <S {...p} {...stroke} strokeWidth="2.2">
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </S>
);
export const Rewind10 = (p) => (
  <S {...p} {...stroke} strokeWidth="1.8">
    <path d="M4.6 12a7.4 7.4 0 1 0 2.3-5.4" />
    <path d="M4 3.8v4.4h4.4" />
    <text x="12" y="15.4" textAnchor="middle" fontSize="7.2" fontWeight="700" fill="currentColor" stroke="none" fontFamily="Arial, sans-serif">
      10
    </text>
  </S>
);
export const Forward10 = (p) => (
  <S {...p} {...stroke} strokeWidth="1.8">
    <path d="M19.4 12a7.4 7.4 0 1 1-2.3-5.4" />
    <path d="M20 3.8v4.4h-4.4" />
    <text x="12" y="15.4" textAnchor="middle" fontSize="7.2" fontWeight="700" fill="currentColor" stroke="none" fontFamily="Arial, sans-serif">
      10
    </text>
  </S>
);
export const NextIcon = (p) => (
  <S {...p}>
    <path d="M5 5.2v13.6a.8.8 0 0 0 1.2.7l9.6-6.8a.8.8 0 0 0 0-1.3L6.2 4.5A.8.8 0 0 0 5 5.2z" />
    <rect x="17.2" y="4.6" width="2.8" height="14.8" rx="0.8" />
  </S>
);
export const SpeedIcon = (p) => (
  <S {...p} {...stroke} strokeWidth="2">
    <path d="M4.2 17.5a8.6 8.6 0 1 1 15.6 0" />
    <path d="M12 13.2l4-4.6" />
    <circle cx="12" cy="13.6" r="1.2" fill="currentColor" />
  </S>
);
export const ListIcon = (p) => (
  <S {...p} {...stroke} strokeWidth="2.2">
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </S>
);
export const VolumeOnIcon = (p) => <VolumeIcon level={2} {...p} />;
export const WarningIcon = (p) => (
  <S {...p} {...stroke} strokeWidth="2">
    <path d="M12 3.5l9.5 16.5h-19L12 3.5z" />
    <path d="M12 10v4.5" />
    <circle cx="12" cy="17.2" r="0.5" fill="currentColor" />
  </S>
);
