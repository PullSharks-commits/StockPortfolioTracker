import React, { useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getCurrencySymbol } from '../lib/currency';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface CorporateLogoScatterPointProps {
  cx?: number;
  cy?: number;
  size?: number;
  payload?: {
    name?: string;
    value?: number;
    cost?: number;
    profitLoss?: number;
    offsetX?: number;
    offsetY?: number;
    [key: string]: any;
  };
  metadata?: Record<string, { sector?: string; industry?: string; logo?: string; website?: string }>;
  fill?: string;
  stroke?: string;
  index?: number;
  isSelected?: boolean;
  isHovered?: boolean;
  isDimmed?: boolean;
  offsetX?: number;
  offsetY?: number;
  onHover?: (name: string | null) => void;
  maxValue?: number;
  minValue?: number;
  maxCost?: number;
  minCost?: number;
  maxProfit?: number;
  maxLoss?: number;
  activeCurrency?: string;
}

const formatCompact = (num: number): string => {
  const abs = Math.abs(num);
  if (abs >= 1_000_000) {
    return `${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${(abs / 1_000).toFixed(1)}k`;
  }
  return abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
};

const LogoImageOrFallback: React.FC<{
  ticker: string;
  logoUrl?: string;
  isCash: boolean;
  radius: number;
  fallbackColor: string;
}> = ({ ticker, logoUrl, isCash, radius, fallbackColor }) => {
  const [hasError, setHasError] = useState(false);

  if (hasError || !logoUrl || isCash) {
    return (
      <div
        className="w-full h-full rounded-full flex items-center justify-center font-bold text-white uppercase select-none shadow-inner"
        style={{
          backgroundColor: fallbackColor,
          fontSize: radius >= 18 ? '10px' : radius >= 13 ? '8px' : radius >= 10 ? '7px' : '6px',
        }}
      >
        {isCash ? '$' : radius < 11 ? ticker.slice(0, 1) : ticker.slice(0, 3)}
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      alt={ticker}
      className="w-full h-full object-cover rounded-full select-none block"
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      loading="lazy"
    />
  );
};

export const CorporateLogoScatterPoint: React.FC<CorporateLogoScatterPointProps> = (props) => {
  const { 
    cx, 
    cy, 
    payload, 
    metadata, 
    fill, 
    isSelected, 
    activeCurrency = 'USD',
    isHovered = false,
    isDimmed = false,
    offsetX = 0,
    offsetY = 0,
    onHover,
  } = props;

  if (cx == null || cy == null || isNaN(cx) || isNaN(cy)) {
    return null;
  }

  const name = (payload?.name || '').toString();
  const ticker = name.toUpperCase();
  const isCash = ticker === 'CASH';

  // Read offsets (either from explicit props or attached to payload)
  const actualOffsetX = offsetX || payload?.offsetX || 0;
  const actualOffsetY = offsetY || payload?.offsetY || 0;
  const hasOffset = Math.abs(actualOffsetX) > 0 || Math.abs(actualOffsetY) > 0;
  const drawCx = cx + actualOffsetX;
  const drawCy = cy + actualOffsetY;

  // Find logo URL from metadata or server endpoint
  const logoUrl = metadata?.[ticker]?.logo || metadata?.[name]?.logo || (!isCash && ticker ? `/api/logo/${ticker}` : '');

  // 1. Investment Size (Cost) calculation:
  // The size of the inner icon is strictly proportional to the investment cost.
  const cost = Math.max(0, payload?.cost ?? 0);
  const maxCost = props.maxCost && props.maxCost > 0 ? props.maxCost : (props.maxValue || 10000);
  const minCost = props.minCost && props.minCost >= 0 ? props.minCost : 0;

  // Square-root mapping so icon area is proportional to investment cost
  const costRatio = maxCost > minCost
    ? Math.min(1, Math.max(0, (cost - minCost) / (maxCost - minCost)))
    : 0.5;
  const costScale = Math.sqrt(costRatio);

  // Icon radius scaled proportionally to investment size (10px - 28px)
  const minIconRadius = 10;
  const maxIconRadius = 28;
  let rIcon = Math.round(minIconRadius + costScale * (maxIconRadius - minIconRadius));

  // 2. Current Market Value & Profit/Loss calculation:
  // Market Value = Investment Cost + Profit (or - Loss).
  // Total bubble size (icon size + green ring) is proportional to current market value.
  const marketValue = Math.max(0, payload?.value ?? 0);
  const maxValue = props.maxValue && props.maxValue > 0 ? props.maxValue : maxCost;
  const minValue = props.minValue && props.minValue >= 0 ? props.minValue : 0;

  const valueRatio = maxValue > minValue
    ? Math.min(1, Math.max(0, (marketValue - minValue) / (maxValue - minValue)))
    : costRatio;
  const valueScale = Math.sqrt(valueRatio);
  const rValueTheoretical = Math.round(minIconRadius + valueScale * (maxIconRadius - minIconRadius));

  const profitLoss = payload?.profitLoss ?? (marketValue - cost);
  const isProfit = profitLoss > 0;
  const isLoss = profitLoss < 0;

  const maxProfit = props.maxProfit && props.maxProfit > 0 ? props.maxProfit : 1000;
  const maxLoss = props.maxLoss && props.maxLoss > 0 ? props.maxLoss : 1000;

  const profitRatio = isProfit ? Math.min(1, Math.max(0, profitLoss / maxProfit)) : 0;
  const lossRatio = isLoss ? Math.min(1, Math.max(0, Math.abs(profitLoss) / maxLoss)) : 0;

  const profitScale = Math.pow(profitRatio, 0.5);
  const lossScale = Math.pow(lossRatio, 0.5);

  let rTotal = rIcon;
  if (isProfit) {
    // When in profit: Icon = Cost, Green Ring = Profit, Total Bubble = Market Value
    const dynamicRing = Math.max(3, rValueTheoretical - rIcon);
    const greenRingWidth = Math.max(3, Math.round(dynamicRing + profitScale * 3.5));
    rTotal = rIcon + greenRingWidth;
  } else if (isLoss) {
    // When in loss: Red boundary ring indicates loss
    const redRingWidth = Math.max(2.5, Math.round(2 + lossScale * 3));
    rTotal = rIcon + redRingWidth;
  } else {
    // Neutral or cash (zero profit/loss)
    rTotal = rIcon + 2;
  }

  if (isSelected || isHovered) {
    rTotal += 3;
    rIcon += 1.5;
  }

  const iconDiameter = rIcon * 2;
  const hitRadius = Math.max(rTotal + 4, 16);
  const currencySymbol = getCurrencySymbol(activeCurrency);

  // Translucent green and red tones with elegant glassmorphic soft fills
  const translucentGreenFill = isHovered ? 'rgba(52, 211, 153, 0.55)' : 'rgba(52, 211, 153, 0.38)';
  const translucentGreenBorder = isHovered ? 'rgba(16, 185, 129, 0.95)' : 'rgba(52, 211, 153, 0.75)';
  const translucentRedFill = isHovered ? 'rgba(248, 113, 113, 0.55)' : 'rgba(248, 113, 113, 0.38)';
  const translucentRedBorder = isHovered ? 'rgba(239, 68, 68, 0.95)' : 'rgba(248, 113, 113, 0.75)';

  const labelWidth = Math.max(32, ticker.length * 6.5 + 10);

  return (
    <g 
      className={cn(
        "scatter-corporate-logo-node transition-all duration-200 cursor-pointer",
        isDimmed && "opacity-25 filter grayscale-[20%]",
        isHovered && "opacity-100 scale-105",
        isSelected && !isHovered && "scale-105"
      )}
      style={{
        transformOrigin: `${drawCx}px ${drawCy}px`,
      }}
      onMouseEnter={() => onHover?.(name)}
      onMouseLeave={() => onHover?.(null)}
    >
      {/* Tether pin and connector line if position is deconflicted/offset */}
      {hasOffset && (
        <g className="pointer-events-none transition-opacity duration-200" opacity={isDimmed ? 0.2 : 0.65}>
          {/* Subtle origin marker at true coordinates */}
          <circle
            cx={cx}
            cy={cy}
            r={2.5}
            fill={isProfit ? "#10b981" : isLoss ? "#ef4444" : "#a1a1aa"}
          />
          {/* Dashed connector line leading to offset bubble */}
          <line
            x1={cx}
            y1={cy}
            x2={drawCx}
            y2={drawCy}
            stroke={isProfit ? "#34d399" : isLoss ? "#f87171" : "#a1a1aa"}
            strokeWidth={1.2}
            strokeDasharray="2 2"
          />
        </g>
      )}

      {/* Outer Soft Translucent Halo Glow */}
      {isProfit && (
        <circle
          cx={drawCx}
          cy={drawCy}
          r={rTotal + (isSelected || isHovered ? 4.5 : 2.5)}
          fill={isHovered ? "rgba(52, 211, 153, 0.35)" : "rgba(52, 211, 153, 0.22)"}
          className="pointer-events-none transition-all duration-300"
        />
      )}
      {isLoss && (
        <circle
          cx={drawCx}
          cy={drawCy}
          r={rTotal + (isSelected || isHovered ? 4.5 : 2)}
          fill={isHovered ? "rgba(248, 113, 113, 0.32)" : "rgba(248, 113, 113, 0.2)"}
          className="pointer-events-none transition-all duration-300"
        />
      )}

      {/* Translucent Outer Ring Circle: Full rTotal size (proportional to market value) */}
      <circle
        cx={drawCx}
        cy={drawCy}
        r={rTotal}
        fill={isProfit ? translucentGreenFill : isLoss ? translucentRedFill : (fill || "rgba(165, 180, 252, 0.35)")}
        stroke={isProfit ? translucentGreenBorder : isLoss ? translucentRedBorder : "rgba(165, 180, 252, 0.7)"}
        strokeWidth={isHovered ? 2 : 1.5}
        className="pointer-events-none transition-all duration-200"
      />

      {/* Solid background circle behind logo */}
      <circle
        cx={drawCx}
        cy={drawCy}
        r={rIcon}
        fill="#ffffff"
        className="dark:fill-zinc-900 pointer-events-none"
      />

      {/* HTML ForeignObject with Company Logo */}
      <foreignObject
        x={drawCx - rIcon}
        y={drawCy - rIcon}
        width={iconDiameter}
        height={iconDiameter}
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        <div
          className="w-full h-full rounded-full flex items-center justify-center p-0 m-0 overflow-hidden leading-none select-none"
          style={{ width: `${iconDiameter}px`, height: `${iconDiameter}px` }}
        >
          <LogoImageOrFallback
            ticker={ticker}
            logoUrl={logoUrl}
            isCash={isCash}
            radius={rIcon}
            fallbackColor={isProfit ? translucentGreenBorder : isLoss ? translucentRedBorder : (fill || "#a5b4fc")}
          />
        </div>
      </foreignObject>

      {/* Inner contour separating the logo from the ring */}
      <circle
        cx={drawCx}
        cy={drawCy}
        r={rIcon}
        fill="none"
        stroke="rgba(0, 0, 0, 0.08)"
        strokeWidth={1}
        className="pointer-events-none dark:stroke-zinc-700/60"
      />

      {/* Protective pill backdrop and ticker/profit label */}
      <g className="pointer-events-none select-none">
        {/* Soft rounded backdrop pill */}
        <rect
          x={drawCx - (labelWidth / 2)}
          y={drawCy + rTotal + 3}
          width={labelWidth}
          height={(isProfit && profitLoss >= 1) || (isLoss && Math.abs(profitLoss) >= 1) ? 20 : 12}
          rx={3.5}
          fill={isHovered ? "rgba(255, 255, 255, 0.96)" : "rgba(255, 255, 255, 0.82)"}
          stroke={isHovered ? (isProfit ? "#10b981" : isLoss ? "#ef4444" : "#6366f1") : "rgba(0, 0, 0, 0.08)"}
          strokeWidth={isHovered ? 1.2 : 0.75}
          className="dark:fill-zinc-900/90 dark:stroke-zinc-700/60 transition-all duration-150"
        />

        <text
          x={drawCx}
          y={drawCy + rTotal + 11.5}
          textAnchor="middle"
          className="select-none pointer-events-none"
        >
          <tspan x={drawCx} fontSize={rTotal >= 20 ? "9" : "8"} fontWeight={700} fill="#27272a" className="dark:fill-zinc-100">
            {ticker}
          </tspan>
          {isProfit && profitLoss >= 1 && (
            <tspan x={drawCx} dy="8.5" fontSize={rTotal >= 20 ? "7.5" : "7"} fontWeight={700} fill="#059669" className="dark:fill-emerald-400">
              {`+${currencySymbol}${formatCompact(profitLoss)}`}
            </tspan>
          )}
          {isLoss && Math.abs(profitLoss) >= 1 && (
            <tspan x={drawCx} dy="8.5" fontSize={rTotal >= 20 ? "7.5" : "7"} fontWeight={700} fill="#dc2626" className="dark:fill-rose-400">
              {`-${currencySymbol}${formatCompact(Math.abs(profitLoss))}`}
            </tspan>
          )}
        </text>
      </g>

      {/* Transparent overlay circle to ensure smooth, uninterrupted SVG event capturing */}
      <circle
        cx={drawCx}
        cy={drawCy}
        r={hitRadius}
        fill="transparent"
        className="cursor-pointer"
      />
    </g>
  );
};
