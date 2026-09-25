import React, { useState, useEffect } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface CompanyLogoProps {
  ticker?: string;
  logo?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const CompanyLogo: React.FC<CompanyLogoProps> = ({ ticker = '', logo, size = 'md' }) => {
  const [error, setError] = useState(false);
  const safeTicker = (ticker || '').toString();
  
  const dimensions = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  }[size];

  const fontSize = {
    sm: 'text-[8px]',
    md: 'text-[10px]',
    lg: 'text-xs'
  }[size];

  useEffect(() => {
    // Reset error if ticker changes
    setError(false);
  }, [safeTicker]);

  const displayLogo = logo || `/api/logo/${safeTicker}`;

  if (error || safeTicker.toUpperCase() === 'CASH' || !safeTicker) {
    return (
      <div className={cn(dimensions, "rounded-lg bg-zinc-100 flex items-center justify-center shrink-0 border border-zinc-200")}>
        <span className={cn("font-bold text-zinc-400 uppercase", fontSize)}>
          {safeTicker.toUpperCase() === 'CASH' ? '$' : safeTicker.slice(0, 2)}
        </span>
      </div>
    );
  }

  return (
    <div className={cn(dimensions, "rounded-lg bg-white flex items-center justify-center overflow-hidden shrink-0 border border-zinc-200 p-0.5")}>
      <img 
        src={displayLogo} 
        alt={safeTicker} 
        className="w-full h-full object-contain"
        referrerPolicy="no-referrer"
        onError={() => {
          setError(true);
        }}
      />
    </div>
  );
};
