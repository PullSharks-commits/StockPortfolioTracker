import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { formatCurrency } from '../lib/currency';

interface DataItem {
  name: string;
  value: number;
  color: string;
}

interface ThreeDPieChartProps {
  data: DataItem[];
  width?: number;
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  depth?: number;
  tilt?: number; // angle in degrees
  activeTab?: string;
}

const ThreeDPieChart: React.FC<ThreeDPieChartProps> = ({
  data,
  width = 400,
  height = 300,
  innerRadius = 60,
  outerRadius = 100,
  depth = 20,
  tilt = 45,
  activeTab = 'global'
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number, y: number, content: string } | null>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const centerX = width / 2;
    const centerY = height / 2;
    const rx = outerRadius;
    const ry = outerRadius * Math.cos(tilt * Math.PI / 180);
    const irx = innerRadius;
    const iry = innerRadius * Math.cos(tilt * Math.PI / 180);

    const pie = d3.pie<DataItem>().value(d => d.value).sort(null);
    const arcs = pie(data);

    const g = svg.append("g")
      .attr("transform", `translate(${centerX}, ${centerY})`);

    // Helper to create path for the sides
    const drawSide = (startAngle: number, endAngle: number, r1: number, r2: number, h: number) => {
      const x1 = r1 * Math.cos(startAngle);
      const y1 = r2 * Math.sin(startAngle);
      const x2 = r1 * Math.cos(endAngle);
      const y2 = r2 * Math.sin(endAngle);
      
      return `M ${x1} ${y1} L ${x1} ${y1 + h} A ${r1} ${r2} 0 ${endAngle - startAngle > Math.PI ? 1 : 0} 1 ${x2} ${y2 + h} L ${x2} ${y2} A ${r1} ${r2} 0 ${endAngle - startAngle > Math.PI ? 1 : 0} 0 ${x1} ${y1} Z`;
    };

    // Helper to create path for the top
    const drawTop = (startAngle: number, endAngle: number, r1x: number, r1y: number, r2x: number, r2y: number) => {
      const x1 = r1x * Math.cos(startAngle);
      const y1 = r1y * Math.sin(startAngle);
      const x2 = r1x * Math.cos(endAngle);
      const y2 = r1y * Math.sin(endAngle);
      const x3 = r2x * Math.cos(endAngle);
      const y3 = r2y * Math.sin(endAngle);
      const x4 = r2x * Math.cos(startAngle);
      const y4 = r2y * Math.sin(startAngle);

      return `M ${x1} ${y1} A ${r1x} ${r1y} 0 ${endAngle - startAngle > Math.PI ? 1 : 0} 1 ${x2} ${y2} L ${x3} ${y3} A ${r2x} ${r2y} 0 ${endAngle - startAngle > Math.PI ? 1 : 0} 0 ${x4} ${y4} Z`;
    };

    // Draw slices
    arcs.forEach((d, i) => {
      const isHovered = hoveredIndex === i;
      const offset = isHovered ? 10 : 0;
      const midAngle = (d.startAngle + d.endAngle) / 2 - Math.PI / 2;
      const ox = offset * Math.cos(midAngle);
      const oy = offset * Math.sin(midAngle);

      const sliceG = g.append("g")
        .attr("class", "slice")
        .attr("transform", `translate(${ox}, ${oy})`)
        .style("cursor", "pointer")
        .style("transition", "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)")
        .on("mouseenter", (event) => {
          setHoveredIndex(i);
          setTooltip({
            x: event.pageX,
            y: event.pageY,
            content: `${d.data.name}: ${formatCurrency(d.data.value, activeTab, false, 0)}`
          });
        })
        .on("mousemove", (event) => {
          setTooltip(prev => prev ? { ...prev, x: event.pageX, y: event.pageY } : null);
        })
        .on("mouseleave", () => {
          setHoveredIndex(null);
          setTooltip(null);
        });

      // Bottom shadow/depth
      // Outer side
      sliceG.append("path")
        .attr("d", drawSide(d.startAngle - Math.PI/2, d.endAngle - Math.PI/2, rx, ry, depth))
        .attr("fill", d3.rgb(d.data.color).darker(0.5).toString());

      // Inner side (if innerRadius > 0)
      if (innerRadius > 0) {
        sliceG.append("path")
          .attr("d", drawSide(d.startAngle - Math.PI/2, d.endAngle - Math.PI/2, irx, iry, depth))
          .attr("fill", d3.rgb(d.data.color).darker(0.8).toString());
      }

      // Top face
      sliceG.append("path")
        .attr("d", drawTop(d.startAngle - Math.PI/2, d.endAngle - Math.PI/2, rx, ry, irx, iry))
        .attr("fill", d.data.color)
        .attr("stroke", d3.rgb(d.data.color).brighter(0.5).toString())
        .attr("stroke-width", 0.5);
      
      // Front edge (vertical lines at start/end angles)
      const x1 = rx * Math.cos(d.startAngle - Math.PI/2);
      const y1 = ry * Math.sin(d.startAngle - Math.PI/2);
      const ix1 = irx * Math.cos(d.startAngle - Math.PI/2);
      const iy1 = iry * Math.sin(d.startAngle - Math.PI/2);

      sliceG.append("path")
        .attr("d", `M ${x1} ${y1} L ${x1} ${y1 + depth} L ${ix1} ${iy1 + depth} L ${ix1} ${iy1} Z`)
        .attr("fill", d3.rgb(d.data.color).darker(0.3).toString());

      const x2 = rx * Math.cos(d.endAngle - Math.PI/2);
      const y2 = ry * Math.sin(d.endAngle - Math.PI/2);
      const ix2 = irx * Math.cos(d.endAngle - Math.PI/2);
      const iy2 = iry * Math.sin(d.endAngle - Math.PI/2);

      sliceG.append("path")
        .attr("d", `M ${x2} ${y2} L ${x2} ${y2 + depth} L ${ix2} ${iy2 + depth} L ${ix2} ${iy2} Z`)
        .attr("fill", d3.rgb(d.data.color).darker(0.3).toString());
    });

  }, [data, width, height, innerRadius, outerRadius, depth, tilt, hoveredIndex]);

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg ref={svgRef} width={width} height={height} viewBox={`0 0 ${width} ${height}`} />
      {tooltip && (
        <div 
          className="fixed z-50 bg-white/90 backdrop-blur-sm p-2 rounded-lg shadow-xl border border-zinc-200 text-xs font-bold pointer-events-none"
          style={{ left: tooltip.x + 10, top: tooltip.y + 10 }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
};

export default ThreeDPieChart;
