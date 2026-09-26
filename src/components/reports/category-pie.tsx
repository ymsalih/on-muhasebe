"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCurrency } from "@/lib/format";
import { pieColor } from "@/lib/reports/colors";

export type PieRow = { name: string; total: number };

/** Kategori dağılımı — halka grafik (CLAUDE.md 7.3-I). Renk eşleşmesi liste satırlarındaki noktalarla aynıdır. */
export function CategoryPie({ rows, type }: { rows: PieRow[]; type: "income" | "expense" }) {
  return (
    <div className="h-56 w-full" role="img" aria-label={type === "income" ? "Gelir kategorileri halka grafiği" : "Gider kategorileri halka grafiği"}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={rows} dataKey="total" nameKey="name" innerRadius="55%" outerRadius="90%" paddingAngle={1} isAnimationActive={false}>
            {rows.map((_, i) => (
              <Cell key={i} fill={pieColor(type, i)} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
