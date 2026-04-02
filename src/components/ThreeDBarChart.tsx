import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { formatCurrency, getCurrencySymbol } from '../lib/currency';

interface DataItem {
  name: string;
  value: number;
  color: string;
  profitLoss?: number;
}

interface ThreeDBarChartProps {
  data: DataItem[];
  width?: number;
  height?: number;
  depth?: number;
  gap?: number;
  activeTab?: string;
}

const ThreeDBarChart: React.FC<ThreeDBarChartProps> = ({
  data,
  width = 500,
  height = 300,
  depth = 15,
  gap = 20,
  activeTab = 'global'
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number, y: number, content: string } | null>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 40, right: 40, bottom: 40, left: 60 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const x = d3.scaleBand()
      .range([0, chartWidth])
      .domain(data.map(d => d.name))
      .padding(0.3);

    const y = d3.scaleLinear()
      .range([chartHeight, 0])
      .domain([0, d3.max(data, d => d.value) || 0]);

    const g = svg.append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

    // Axes
    g.append("g")
      .attr("transform", `translate(0, ${chartHeight})`)
      .call(d3.axisBottom(x))
      .selectAll("text")
      .style("text-anchor", "end")
      .attr("dx", "-.8em")
      .attr("dy", ".15em")
      .attr("transform", "rotate(-45)")
      .style("font-size", "10px")
      .style("fill", "#71717a");

    g.append("g")
      .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${getCurrencySymbol(activeTab)}${d}`))
      .style("font-size", "10px")
      .style("fill", "#71717a");

    // Grid lines
    g.append("g")
      .attr("class", "grid")
      .call(d3.axisLeft(y).ticks(5).tickSize(-chartWidth).tickFormat(() => ""))
      .style("stroke", "#e4e4e7")
      .style("stroke-dasharray", "3,3")
      .style("opacity", 0.5);

    // Draw bars
    data.forEach((d, i) => {
      const barX = x(d.name) || 0;
      const barY = y(d.value);
      const barW = x.bandwidth();
      const barH = chartHeight - barY;
      const isHovered = hoveredIndex === i;

      const barG = g.append("g")
        .attr("class", "bar")
        .style("cursor", "pointer")
        .style("transition", "all 0.3s ease")
        .on("mouseenter", (event) => {
          setHoveredIndex(i);
          setTooltip({
            x: event.pageX,
            y: event.pageY,
            content: `${d.name}: ${formatCurrency(d.value, activeTab, false, 0)}`
          });
        })
        .on("mousemove", (event) => {
          setTooltip(prev => prev ? { ...prev, x: event.pageX, y: event.pageY } : null);
        })
        .on("mouseleave", () => {
          setHoveredIndex(null);
          setTooltip(null);
        });

      const color = d.color;
      const darker = d3.rgb(color).darker(0.5).toString();
      const brighter = d3.rgb(color).brighter(0.5).toString();

      // Front face
      barG.append("rect")
        .attr("x", barX)
        .attr("y", barY)
        .attr("width", barW)
        .attr("height", barH)
        .attr("fill", isHovered ? brighter : color)
        .attr("stroke", brighter)
        .attr("stroke-width", 0.5);

      // Top face
      barG.append("path")
        .attr("d", `M ${barX} ${barY} L ${barX + depth} ${barY - depth} L ${barX + barW + depth} ${barY - depth} L ${barX + barW} ${barY} Z`)
        .attr("fill", d3.rgb(color).brighter(0.2).toString())
        .attr("stroke", brighter)
        .attr("stroke-width", 0.5);

      // Side face
      barG.append("path")
        .attr("d", `M ${barX + barW} ${barY} L ${barX + barW + depth} ${barY - depth} L ${barX + barW + depth} ${barY + barH - depth} L ${barX + barW} ${barY + barH} Z`)
        .attr("fill", darker)
        .attr("stroke", brighter)
        .attr("stroke-width", 0.5);
    });

  }, [data, width, height, depth, hoveredIndex]);

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

export default ThreeDBarChart;
