-- ============================================================
-- FAZ 8a — Fiyat bilgisi: irsaliye birim fiyatı/tutarı, personel günlük ücreti, gün × ücret maaş ödemesi
-- ============================================================

-- İrsaliye/fatura: birim fiyat girilince tutar (miktar × birim fiyat) veritabanında otomatik hesaplanır.
ALTER TABLE public.goods_entries
  ADD COLUMN unit_price   NUMERIC(14,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  ADD COLUMN total_amount NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(quantity * unit_price, 2)) STORED;

GRANT UPDATE (unit_price) ON public.goods_entries TO authenticated;

-- Personel: günlük ücret (ödeme ekranında varsayılan olarak önerilir).
ALTER TABLE public.personnel
  ADD COLUMN daily_wage NUMERIC(14,2) CHECK (daily_wage IS NULL OR daily_wage >= 0);

GRANT SELECT (daily_wage) ON public.personnel TO authenticated;
GRANT INSERT (daily_wage) ON public.personnel TO authenticated;
GRANT UPDATE (daily_wage) ON public.personnel TO authenticated;

-- Maaş ödemesi = kasada bir gider kaydı: gün × günlük tutar. period_month = hangi ayın hakedişi (ayın 1'i).
ALTER TABLE public.transactions
  ADD COLUMN work_days    INTEGER CHECK (work_days IS NULL OR work_days BETWEEN 1 AND 31),
  ADD COLUMN daily_rate   NUMERIC(14,2) CHECK (daily_rate IS NULL OR daily_rate >= 0),
  ADD COLUMN period_month DATE CHECK (period_month IS NULL OR period_month = date_trunc('month', period_month)::date),
  ADD CONSTRAINT transactions_wage_consistent CHECK (
    (work_days IS NULL AND daily_rate IS NULL)
    OR (work_days IS NOT NULL AND daily_rate IS NOT NULL AND personnel_id IS NOT NULL
        AND amount = ROUND(work_days * daily_rate, 2))
  );

GRANT UPDATE (work_days, daily_rate, period_month) ON public.transactions TO authenticated;

CREATE INDEX idx_transactions_personnel_period ON public.transactions (site_id, personnel_id, period_month)
  WHERE personnel_id IS NOT NULL;

-- Cari: faturalanan toplam (irsaliyelerdeki tutarlar). Kalan borç = faturalanan − ödenen (uygulamada hesaplanır).
CREATE OR REPLACE VIEW public.party_balances
WITH (security_invoker = true) AS
SELECT
  p.id AS party_id,
  p.site_id,
  p.name,
  p.category,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)  AS total_income,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS total_expense,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)
    - COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS balance,
  COALESCE(SUM(t.amount), 0) AS total_turnover,
  COUNT(t.id)::integer AS transaction_count,
  MAX(t.transaction_date) AS last_transaction_date,
  (SELECT COALESCE(SUM(g.total_amount), 0) FROM public.goods_entries g
    WHERE g.party_id = p.id AND g.site_id = p.site_id) AS total_invoiced
FROM public.parties p
LEFT JOIN public.transactions t ON t.party_id = p.id AND t.site_id = p.site_id
GROUP BY p.id, p.site_id, p.name, p.category;
