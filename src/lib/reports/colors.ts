// Gelir yeşil, gider turuncu tonlarında (CLAUDE.md 7.1); dilim sayısı fazlaysa tonlar döner.
// İstemci (grafik) ve sunucu (liste noktaları) bileşenlerinin ortak kullandığı, "use client" dışı dosya.
const INCOME_COLORS = ["#34d399", "#10b981", "#6ee7b7", "#059669", "#a7f3d0", "#2dd4bf", "#86efac"];
const EXPENSE_COLORS = ["#fb923c", "#f97316", "#fdba74", "#ea580c", "#fed7aa", "#f59e0b", "#fcd34d"];

export const pieColor = (type: "income" | "expense", i: number) => (type === "income" ? INCOME_COLORS : EXPENSE_COLORS)[i % 7];
