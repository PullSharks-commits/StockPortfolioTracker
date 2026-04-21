import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import 'echarts-gl';
import { formatCurrency } from '../lib/currency';

interface DataItem {
  name: string;
  value: number;
  color: string;
  profitLoss?: number;
}

interface ThreeDBarChartProps {
  data: DataItem[];
  activeCurrency?: string;
  title?: string;
}

const ThreeDBarChart: React.FC<ThreeDBarChartProps> = ({
  data,
  activeCurrency = 'USD',
  title
}) => {
  const option = useMemo(() => {
    if (!data || data.length === 0) return {};

    const xData = data.map(item => item.name);
    const yData = data.map(item => item.value);

    return {
      tooltip: {
        formatter: (params: any) => {
          const item = data[params.dataIndex];
          if (item) {
            return `${item.name}<br/>Value: ${formatCurrency(item.value, activeCurrency, false, 0)}`;
          }
          return '';
        }
      },
      xAxis3D: {
        type: 'category',
        data: xData,
        name: '',
        axisLabel: {
          interval: 0,
          margin: 8,
          textStyle: {
            color: '#71717a',
            fontSize: 10
          },
          formatter: (value: string) => {
            if (value.length > 10) {
              if (value.includes(' ')) {
                return value.split(' ').join('\n');
              }
              return value.substring(0, 10) + '...';
            }
            return value;
          }
        },
        axisLine: {
          lineStyle: {
            color: '#d4d4d8'
          }
        }
      },
      yAxis3D: {
        type: 'category',
        data: [''],
        name: '',
        axisLine: {
          lineStyle: {
            color: '#d4d4d8'
          }
        }
      },
      zAxis3D: {
        type: 'value',
        name: '',
        axisLabel: {
          textStyle: {
            color: '#71717a',
            fontSize: 12
          },
          formatter: (value: number) => {
            if (value >= 1000) {
              return (value / 1000).toFixed(1) + 'k';
            }
            return value;
          }
        },
        axisLine: {
          lineStyle: {
            color: '#d4d4d8'
          }
        }
      },
      grid3D: {
        boxWidth: Math.max(200, data.length * 25),
        boxDepth: 40,
        boxHeight: 100,
        viewControl: {
          alpha: 15,
          beta: 20,
          rotateSensitivity: 1,
          zoomSensitivity: 1,
          panSensitivity: 1,
          distance: 250
        },
        light: {
          main: {
            intensity: 1.2,
            shadow: true
          },
          ambient: {
            intensity: 0.3
          }
        }
      },
      series: [{
        type: 'bar3D',
        data: data.map((item, index) => {
          return {
            value: [index, 0, item.value],
            itemStyle: {
              color: item.color
            }
          };
        }),
        shading: 'lambert',
        label: {
          show: false
        },
        itemStyle: {
          opacity: 0.9
        },
        emphasis: {
          label: {
            show: false
          }
        }
      }]
    };
  }, [data, activeCurrency]);

  return (
    <div className="w-full h-full min-h-[300px]">
      <ReactECharts 
        option={option} 
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    </div>
  );
};

export default ThreeDBarChart;
