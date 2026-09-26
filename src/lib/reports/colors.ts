// Gelir yeşil, gider turuncu tonlarında (CLAUDE.md 7.1); dilim sayısı fazlaysa tonlar döner.
// İstemci (grafik) ve sunucu (liste noktaları) bileşenlerinin ortak kullandığı, "use client" dışı dosya.
const INCOME_COLORS = ["#059669", "#10b981", "#34d399", "#6ee7b7", "#047857", "#065f46", "#a7f3d0"];
const EXPENSE_COLORS = ["#ea580c", "#f97316", "#fb923c", "#fdba74", "#c2410c", "#9a3412", "#fed7aa"];

export const pieColor = (type: "income" | "expense", i: number) => (type === "income" ? INCOME_COLORS : EXPENSE_COLORS)[i % 7];
