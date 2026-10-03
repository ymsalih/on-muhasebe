-- ============================================================
-- GİDERİN KAYNAĞI: bir gider, hangi GELİR kaydından harcandığını belirtebilir (opsiyonel).
-- "Hangi gelirimden ne kadar harcadım / ne kadarı kaldı" takibi bu bağlantıdan hesaplanır (tabloda tutulmaz).
--  * Kaynak yalnızca aynı şantiyenin bir gelir (income) kaydı olabilir (bileşik yabancı anahtar + tetikleyici).
--  * Yalnızca giderlerin kaynağı olur (CHECK).
--  * Kendisine gider bağlı bir gelir silinemez ve gelir olmaktan çıkarılamaz (veri bütünlüğü).
-- ============================================================

ALTER TABLE public.transactions ADD CONSTRAINT transactions_id_site_key UNIQUE (id, site_id);

ALTER TABLE public.transactions ADD COLUMN source_income_id INTEGER;

-- NO ACTION: bağlı gider varken gelir silinemez (şantiye silinirken hepsi aynı anda gittiği için sorun olmaz).
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_source_income_fk
    FOREIGN KEY (source_income_id, site_id) REFERENCES public.transactions (id, site_id),
  ADD CONSTRAINT transactions_source_only_expense CHECK (source_income_id IS NULL OR type = 'expense');

CREATE INDEX idx_transactions_source_income ON public.transactions (source_income_id, site_id) WHERE source_income_id IS NOT NULL;

GRANT UPDATE (source_income_id) ON public.transactions TO authenticated;

CREATE FUNCTION private.check_income_source()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.source_income_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.transactions s
    WHERE s.id = NEW.source_income_id AND s.site_id = NEW.site_id AND s.type = 'income'
  ) THEN
    RAISE EXCEPTION 'Kaynak gelir bu şantiyeye ait bir gelir kaydı olmalı.' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.type = 'income' AND NEW.type <> 'income' AND EXISTS (
    SELECT 1 FROM public.transactions e WHERE e.source_income_id = OLD.id AND e.site_id = OLD.site_id
  ) THEN
    RAISE EXCEPTION 'Bu gelire bağlı giderler var; önce giderlerin kaynağını değiştirin.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_check_income_source
  BEFORE INSERT OR UPDATE OF source_income_id, type, site_id ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.check_income_source();

-- Gelir kayıtları ve her birinden harcanan tutar (bağlı giderlerin toplamı; giderin tarihi dönem dışında olsa da sayılır).
-- p_from/p_to boş bırakılırsa tüm zamanlar. SECURITY INVOKER: RLS geçerli.
CREATE FUNCTION public.get_income_allocations(p_site_id INTEGER, p_from DATE, p_to DATE, p_limit INTEGER DEFAULT 500)
RETURNS TABLE (income_id INTEGER, transaction_date DATE, description TEXT, category_id INTEGER, amount NUMERIC, spent NUMERIC, expense_count INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT i.id, i.transaction_date, i.description, i.category_id, i.amount,
         COALESCE(x.spent, 0), COALESCE(x.cnt, 0)::integer
  FROM public.transactions i
  LEFT JOIN LATERAL (
    SELECT SUM(e.amount) AS spent, COUNT(*) AS cnt
    FROM public.transactions e
    WHERE e.source_income_id = i.id AND e.site_id = i.site_id
  ) x ON true
  WHERE i.site_id = p_site_id AND i.type = 'income'
    AND (p_from IS NULL OR i.transaction_date >= p_from)
    AND (p_to IS NULL OR i.transaction_date <= p_to)
  ORDER BY i.transaction_date DESC, i.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 1000)
$$;

-- Aralıktaki giderlerin kaynağı belirtilmiş / belirtilmemiş toplamı.
CREATE FUNCTION public.get_expense_source_split(p_site_id INTEGER, p_from DATE, p_to DATE)
RETURNS TABLE (linked NUMERIC, linked_count INTEGER, unlinked NUMERIC, unlinked_count INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.source_income_id IS NOT NULL), 0),
         (COUNT(*) FILTER (WHERE t.source_income_id IS NOT NULL))::integer,
         COALESCE(SUM(t.amount) FILTER (WHERE t.source_income_id IS NULL), 0),
         (COUNT(*) FILTER (WHERE t.source_income_id IS NULL))::integer
  FROM public.transactions t
  WHERE t.site_id = p_site_id AND t.type = 'expense' AND t.transaction_date BETWEEN p_from AND p_to
$$;

REVOKE ALL ON FUNCTION public.get_income_allocations(INTEGER, DATE, DATE, INTEGER), public.get_expense_source_split(INTEGER, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_income_allocations(INTEGER, DATE, DATE, INTEGER), public.get_expense_source_split(INTEGER, DATE, DATE) TO authenticated, service_role;
