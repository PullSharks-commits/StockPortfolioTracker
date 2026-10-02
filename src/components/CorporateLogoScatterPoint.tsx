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
  maxExtent?: number; // largest cost + |profit/loss| among the plotted points
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

  // Sizes are areas on one shared scale, so they compare across bubbles:
  // logo area ∝ investment cost, ring area ∝ the gain (green) or loss (red).
  // In profit the whole bubble's area is therefore ∝ market value.
  const cost = Math.max(0, payload?.cost ?? 0);
  const marketValue = Math.max(0, payload?.value ?? 0);
  const profitLoss = payload?.profitLoss ?? (marketValue - cost);
  const isProfit = profitLoss > 0;
  const isLoss = profitLoss < 0;

  // The largest cost + |gain or loss| on the chart gets MAX_RADIUS.
  const MAX_RADIUS = 36;
  const MIN_ICON_RADIUS = 7; // keeps tiny positions' logos legible (only these break proportion)
  const maxExtent = props.maxExtent && props.maxExtent > 0 ? props.maxExtent : Math.max(cost + Math.abs(profitLoss), 1);
  const pxPerUnitArea = (MAX_RADIUS * MAX_RADIUS) / maxExtent; // radius² per currency unit

  let rIcon = Math.max(MIN_ICON_RADIUS, Math.sqrt(cost * pxPerUnitArea));
  // Ring radius from the icon outwards, so the ring's own area ∝ |profit/loss|
  // whatever the icon size (including floored icons).
  // Gains grow outward: a green ring whose area ∝ the gain. Losses eat into what was
  // invested: a red wedge over the logo covering the share lost (so its area ∝ the
  // loss too), and the bubble keeps its cost size with just an outline.
  let rTotal = isProfit ? Math.sqrt(rIcon * rIcon + profitLoss * pxPerUnitArea) : rIcon + 1.5;
  const lossFraction = isLoss && cost > 0 ? Math.min(1, -profitLoss / cost) : 0;

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

  const lossLabelLength = isLoss ? `-${currencySymbol}${formatCompact(Math.abs(profitLoss))} · -${Math.round(lossFraction * 100)}%`.length : 0;
  const labelWidth = Math.max(32, ticker.length * 6.5 + 10, lossLabelLength * 4.6 + 8);

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

      {/* Soft halo on hover/selection only, so at rest the ring's size is exact */}
      {isProfit && (isSelected || isHovered) && (
        <circle
          cx={drawCx}
          cy={drawCy}
          r={rTotal + (isSelected || isHovered ? 4.5 : 2.5)}
          fill={isHovered ? "rgba(52, 211, 153, 0.35)" : "rgba(52, 211, 153, 0.22)"}
          className="pointer-events-none transition-all duration-300"
        />
      )}
      {isLoss && (isSelected || isHovered) && (
        <circle
          cx={drawCx}
          cy={drawCy}
          r={rTotal + 4.5}
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

      {/* Loss wedge: from 12 o'clock clockwise, covering the share of the cost lost */}
      {lossFraction > 0 && (
        lossFraction >= 0.999 ? (
          <circle cx={drawCx} cy={drawCy} r={rIcon} fill="rgba(239, 68, 68, 0.55)" className="pointer-events-none" />
        ) : (
          <path
            d={(() => {
              const a = lossFraction * 2 * Math.PI;
              const x = drawCx + rIcon * Math.sin(a), y = drawCy - rIcon * Math.cos(a);
              return `M ${drawCx} ${drawCy} L ${drawCx} ${drawCy - rIcon} A ${rIcon} ${rIcon} 0 ${lossFraction > 0.5 ? 1 : 0} 1 ${x} ${y} Z`;
            })()}
            fill={isHovered ? 'rgba(239, 68, 68, 0.62)' : 'rgba(239, 68, 68, 0.5)'}
            stroke="rgba(220, 38, 38, 0.9)"
            strokeWidth={0.75}
            className="pointer-events-none"
          />
        )
      )}

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
              {`-${currencySymbol}${formatCompact(Math.abs(profitLoss))}${lossFraction > 0 ? ` · -${Math.round(lossFraction * 100)}%` : ''}`}
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
