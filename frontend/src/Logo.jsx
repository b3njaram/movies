import React from 'react';

export default function Logo({ className = '', size = 'text-3xl' }) {
  return <span className={`font-logo select-none text-nf-red ${size} ${className}`}>STREAMHUB</span>;
}
