const DONUT_COLORS: Record<string, string> = {
  mastered: "#10b981",
  review: "#6366f1",
  learning: "#f59e0b",
  difficult: "#ef4444",
  new: "#94a3b8",
};

const DONUT_LABELS: Record<string, string> = {
  mastered: "Đã thuộc",
  review: "Đang ôn",
  learning: "Đang học",
  difficult: "Khó",
  new: "Chưa học",
};

export function StatusDonutChart({ counts }: { counts: Record<string, number> }) {
  const entries = (["mastered", "review", "learning", "difficult", "new"] as const)
    .map((key) => ({ key, value: counts[key] ?? 0 }))
    .filter((item) => item.value > 0);
  const total = entries.reduce((sum, item) => sum + item.value, 0);

  if (!total) {
    return <div className="flex h-48 items-center justify-center text-sm text-on-surface-variant dark:text-white/50">Chưa có dữ liệu.</div>;
  }

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-lg sm:flex-row sm:items-center sm:justify-center">
      <svg viewBox="0 0 100 100" className="h-40 w-40 shrink-0 -rotate-90" role="img" aria-label="Phân bố trạng thái từ vựng">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" className="text-surface-container-low dark:text-white/10" strokeWidth="14" />
        {entries.map((item) => {
          const fraction = item.value / total;
          const dash = fraction * circumference;
          const circle = (
            <circle
              key={item.key}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={DONUT_COLORS[item.key]}
              strokeWidth="14"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return circle;
        })}
        <text x="50" y="50" transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="middle" className="fill-on-surface text-[16px] font-bold dark:fill-white">
          {total}
        </text>
      </svg>
      <div className="grid w-full grid-cols-2 gap-x-md gap-y-sm sm:w-auto sm:grid-cols-1">
        {entries.map((item) => (
          <div key={item.key} className="flex items-center gap-sm text-sm">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: DONUT_COLORS[item.key] }} />
            <span className="min-w-0 flex-1 truncate text-on-surface-variant dark:text-white/65">{DONUT_LABELS[item.key]}</span>
            <span className="shrink-0 font-bold">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HorizontalBarChart({ data, colorClass = "bg-primary" }: { data: { label: string; value: number; suffix?: string }[]; colorClass?: string }) {
  if (!data.length) {
    return <div className="flex h-32 items-center justify-center text-sm text-on-surface-variant dark:text-white/50">Chưa có dữ liệu.</div>;
  }
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <div className="space-y-sm">
      {data.map((item) => (
        <div key={item.label} className="min-w-0">
          <div className="mb-xs flex items-center justify-between gap-sm text-sm">
            <span className="min-w-0 flex-1 truncate font-semibold">{item.label}</span>
            <span className="shrink-0 text-on-surface-variant dark:text-white/60">{item.value}{item.suffix ?? ""}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-container-low dark:bg-white/10">
            <div className={`h-full rounded-full ${colorClass} transition-all`} style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ColumnChart({ data, colorClass = "bg-primary", highlightLabel }: { data: { label: string; value: number }[]; colorClass?: string; highlightLabel?: string }) {
  if (!data.length) {
    return <div className="flex h-40 items-center justify-center text-sm text-on-surface-variant dark:text-white/50">Chưa có dữ liệu.</div>;
  }
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex min-w-max items-end gap-[3px] px-xs" style={{ height: "9rem" }}>
        {data.map((item) => {
          const heightPct = Math.max(item.value > 0 ? 6 : 2, (item.value / max) * 100);
          const active = item.label === highlightLabel;
          return (
            <div key={item.label} className="flex h-full w-4 shrink-0 flex-col items-center justify-end gap-xs" title={`${item.label}: ${item.value}`}>
              <div
                className={`w-full rounded-t-sm transition-all ${active ? "bg-emerald-500" : colorClass} ${item.value === 0 ? "opacity-25" : ""}`}
                style={{ height: `${heightPct}%` }}
              />
              <span className={`text-[9px] leading-none ${active ? "font-bold text-emerald-600 dark:text-emerald-300" : "text-on-surface-variant dark:text-white/50"}`}>{item.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TrendLineChart({ points }: { points: { label: string; value: number }[] }) {
  if (!points.length) {
    return <div className="flex h-40 items-center justify-center text-sm text-on-surface-variant dark:text-white/50">Chưa có dữ liệu.</div>;
  }
  const width = 100;
  const height = 40;
  const padY = 4;
  const max = 100;
  const min = 0;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((point, index) => {
    const x = points.length > 1 ? index * stepX : width / 2;
    const y = height - padY - ((point.value - min) / (max - min || 1)) * (height - padY * 2);
    return { x, y, ...point };
  });
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(2)},${height} L${coords[0].x.toFixed(2)},${height} Z`;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-40 w-full min-w-[280px]" role="img" aria-label="Xu hướng độ chính xác">
        <line x1="0" y1={height - padY} x2={width} y2={height - padY} stroke="currentColor" className="text-surface-variant dark:text-white/10" strokeWidth="0.5" />
        <path d={areaPath} fill="url(#trend-gradient)" opacity="0.18" />
        <path d={linePath} fill="none" stroke="#4f46e5" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c) => (
          <circle key={c.label + c.x} cx={c.x} cy={c.y} r="1.6" fill="#4f46e5" />
        ))}
        <defs>
          <linearGradient id="trend-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <div className="mt-xs flex justify-between text-[11px] text-on-surface-variant dark:text-white/50">
        <span>{points[0]?.label}</span>
        {points.length > 1 ? <span>{points[points.length - 1]?.label}</span> : null}
      </div>
    </div>
  );
}
