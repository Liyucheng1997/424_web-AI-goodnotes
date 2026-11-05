import { memo } from 'react';
import { strokePath, shapePaths, textLines, textFont } from './ink.js';
import { templatePrims, paperColor, PAGE_W, PAGE_H } from './templates.js';

export const ElementView = memo(function ElementView({ el, hidden }) {
  if (hidden) return null;
  switch (el.type) {
    case 'stroke':
      return (
        <path
          d={strokePath(el)}
          fill={el.color}
          style={el.tool === 'highlighter' ? { opacity: 0.38, mixBlendMode: 'multiply' } : undefined}
        />
      );
    case 'shape':
      return (
        <g>
          {shapePaths(el).map((p, i) => (
            <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill={p.fill || 'none'} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </g>
      );
    case 'text': {
      const f = textFont(el);
      return (
        <text
          x={el.x}
          y={el.y}
          fill={el.color}
          fontSize={f.size}
          fontFamily={f.css}
          fontWeight={el.bold ? 700 : 400}
          transform={el.rot ? `rotate(${el.rot} ${el.x} ${el.y})` : undefined}
          style={{ whiteSpace: 'pre' }}
        >
          {textLines(el).map((ln, i) => (
            <tspan key={i} x={el.x} y={el.y + i * el.lh + el.lh * 0.74}>
              {ln.text || ' '}
            </tspan>
          ))}
        </text>
      );
    }
    case 'image':
      return <image href={el.src} x={el.x} y={el.y} width={el.w} height={el.h} preserveAspectRatio="none" />;
    default:
      return null;
  }
});

/** 纸张 + 模板背景 */
export const PaperView = memo(function PaperView({ template, paper, pid }) {
  const prims = templatePrims(template);
  return (
    <g>
      <rect x="0" y="0" width={PAGE_W} height={PAGE_H} fill={paperColor(paper)} />
      {prims.map((p, i) => {
        switch (p.t) {
          case 'line':
            return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.stroke} strokeWidth={p.w} />;
          case 'hlines': {
            let d = '';
            for (let y = p.y0; y <= p.y1; y += p.gap) d += `M${p.x1},${y}H${p.x2}`;
            return <path key={i} d={d} stroke={p.stroke} strokeWidth={p.w} fill="none" />;
          }
          case 'grid': {
            const id = `grid-${pid}`;
            return (
              <g key={i}>
                <defs>
                  <pattern id={id} width={p.gap} height={p.gap} patternUnits="userSpaceOnUse">
                    <path d={`M${p.gap},0V${p.gap}H0`} fill="none" stroke={p.stroke} strokeWidth={p.w} />
                  </pattern>
                </defs>
                <rect x={p.x0} y={p.y0} width={p.x1 - p.x0} height={p.y1 - p.y0} fill={`url(#${id})`} />
              </g>
            );
          }
          case 'dots': {
            const id = `dots-${pid}`;
            return (
              <g key={i}>
                <defs>
                  <pattern id={id} x={p.x0 - p.gap / 2} y={p.y0 - p.gap / 2} width={p.gap} height={p.gap} patternUnits="userSpaceOnUse">
                    <circle cx={p.gap / 2} cy={p.gap / 2} r={p.r} fill={p.fill} />
                  </pattern>
                </defs>
                <rect x="0" y="0" width={PAGE_W} height={PAGE_H} fill={`url(#${id})`} />
              </g>
            );
          }
          case 'text':
            return (
              <text
                key={i}
                x={p.x}
                y={p.y}
                fontSize={p.size}
                fill={p.fill}
                fontWeight={p.weight}
                textAnchor={p.anchor === 'end' ? 'end' : 'start'}
                letterSpacing={p.spacing}
                fontFamily="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
              >
                {p.text}
              </text>
            );
          default:
            return null;
        }
      })}
    </g>
  );
});
