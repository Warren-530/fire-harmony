// A tiny line (and soft area) for tables and stat tiles. Nulls make gaps. The last point gets a dot.
export function Sparkline({ values, width = 96, height = 28, color = 'var(--accent)', fill = true, label, highlight }: {
  values: (number | null)[]; width?: number; height?: number; color?: string; fill?: boolean; label?: string; highlight?: number;
}) {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const pad = 2, h = height - pad * 2, w = width - pad * 2;
  const x = (i: number) => pad + (values.length === 1 ? w / 2 : (i * w) / (values.length - 1));
  const y = (v: number) => pad + (hi === lo ? h / 2 : h - ((v - lo) / (hi - lo)) * h);
  const segs: string[] = [];
  let cur = '';
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) { if (cur) segs.push(cur); cur = ''; return; }
    cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  const lastI = values.reduce<number>((acc, v, i) => (v !== null && Number.isFinite(v) ? i : acc), -1);
  const hi_i = highlight ?? lastI;
  const hv = values[hi_i];
  const area = fill && segs.length === 1 ? `${segs[0]}L${x(lastI).toFixed(1)},${height - pad}L${x(values.findIndex((v) => v !== null)).toFixed(1)},${height - pad}Z` : null;
  return (
    <svg className="ui-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? 'img' : undefined}
      aria-label={label} aria-hidden={label ? undefined : true}>
      {area ? <path d={area} fill={color} opacity={0.14} /> : null}
      {segs.map((d, i) => <path key={i} d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />)}
      {hv !== null && hv !== undefined && Number.isFinite(hv) ? <circle cx={x(hi_i)} cy={y(hv)} r={2.4} fill={color} /> : null}
    </svg>
  );
}
