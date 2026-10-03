"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency } from "@/lib/format";
import { periodLabel } from "@/lib/reports/labels";

export type TrendChartPoint = { period: string; income: number; expense: number };

const INCOME = "#34d399"; // gelir yeşil (7.1) — koyu zeminde okunur ton
const EXPENSE = "#fb923c"; // gider turuncu
const AXIS = "#cbd5e1";

const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });

/** Gelir–gider çizgi grafiği (CLAUDE.md 7.3-I). Ekran okuyucu için altında ayrıca özet tablo bulunur. */
export function TrendChart({ points, bucket }: { points: TrendChartPoint[]; bucket: "day" | "month" }) {
  const data = points.map((p) => ({ ...p, label: periodLabel(p.period, bucket) }));
  return (
    <div className="h-64 w-full sm:h-80" role="img" aria-label="Gelir ve gider çizgi grafiği">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} minTickGap={20} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} width={44} tickFormatter={(v: number) => compact.format(v)} tickLine={false} axisLine={false} />
          <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={{ borderRadius: 8, fontSize: 12, background: "#1c212b", border: "1px solid rgba(255,255,255,0.15)", color: "#f1f5f9" }} labelStyle={{ color: "#f1f5f9" }} itemStyle={{ color: "#f1f5f9" }} />
          <Legend iconType="plainline" wrapperStyle={{ color: "#f1f5f9" }} />
          <Line type="monotone" dataKey="income" name="Gelir" stroke={INCOME} strokeWidth={2.5} dot={data.length <= 31} isAnimationActive={false} />
          <Line type="monotone" dataKey="expense" name="Gider" stroke={EXPENSE} strokeWidth={2.5} dot={data.length <= 31} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
