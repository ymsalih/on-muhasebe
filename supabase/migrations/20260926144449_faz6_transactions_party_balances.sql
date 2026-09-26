-- ============================================================
-- FAZ 6 — cari hesaplar: transactions + categories (şema) ve party_balances view'i
-- ============================================================
-- NOT: CLAUDE.md bu tabloları Faz 7'ye yazıyor, ama Faz 6'nın party_balances view'i ve cari detay ekranı
-- (hareket listesi, "Ödeme/Tahsilat Ekle") transactions'a bağlıdır. Bu yüzden yalnızca ŞEMA + RLS burada kurulur;
-- Genel Kasa ekranı, kategori yönetimi, site_cash_summary ve grafikler Faz 7'dedir.
-- Farklar (Bölüm 4'e göre): users(id) referansı UUID ve ON DELETE SET NULL; personel/firma/irsaliye bağlantıları
-- (id, site_id) BİLEŞİK yabancı anahtarlar (başka şantiyenin kaydı bağlanamaz); RLS politikaları performans kalıbıyla
-- (site_id IN (SELECT private.writable_site_ids()) — satır başı fonksiyon YOK).

-- goods_entries: transactions.goods_entry_id bileşik yabancı anahtarının hedefi
ALTER TABLE public.goods_entries ADD CONSTRAINT goods_entries_id_site_key UNIQUE (id, site_id);

-- ------------------------------------------------------------
-- categories (site_id NULL = tüm şantiyelerde görünen varsayılan kategori)
-- ------------------------------------------------------------
CREATE TABLE public.categories (
  id          SERIAL PRIMARY KEY,
  site_id     INTEGER REFERENCES public.sites(id) ON DELETE CASCADE,
  name        VARCHAR(80) NOT NULL CHECK (length(btrim(name)) > 0),
  type        VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_categories_scope_name ON public.categories (COALESCE(site_id, 0), type, lower(name));
CREATE INDEX idx_categories_site ON public.categories (site_id);

-- ------------------------------------------------------------
-- transactions (genel kasa hareketleri; cari ödeme/tahsilatları da burada)
-- ------------------------------------------------------------
CREATE TABLE public.transactions (
  id                SERIAL PRIMARY KEY,
  site_id           INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES public.users(id) ON DELETE SET NULL,   -- işlemi giren ortak
  category_id       INTEGER REFERENCES public.categories(id),
  party_id          INTEGER,                                               -- ödemenin yapıldığı/geldiği cari
  personnel_id      INTEGER,                                               -- puantaja bağlı maaş ödemesiyse
  goods_entry_id    INTEGER,                                               -- bir irsaliye/faturaya bağlıysa
  type              VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  description       TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  amount            NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency          VARCHAR(3) NOT NULL DEFAULT 'TRY',
  payment_method    VARCHAR(20) CHECK (payment_method IS NULL OR payment_method IN ('nakit', 'havale', 'cek', 'diger')),
  transaction_date  DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transactions_party_same_site_fk
    FOREIGN KEY (party_id, site_id) REFERENCES public.parties (id, site_id),
  CONSTRAINT transactions_personnel_same_site_fk
    FOREIGN KEY (personnel_id, site_id) REFERENCES public.personnel (id, site_id),
  -- İrsaliye silinirse yalnızca goods_entry_id boşalır (site_id korunur).
  CONSTRAINT transactions_goods_entry_same_site_fk
    FOREIGN KEY (goods_entry_id, site_id) REFERENCES public.goods_entries (id, site_id) ON DELETE SET NULL (goods_entry_id)
);

-- İndeksler: sorgu kalıpları (şantiye + tarih aralığı, cari hareketleri) ve yabancı anahtarlar
CREATE INDEX idx_transactions_site_date   ON public.transactions (site_id, transaction_date DESC);
CREATE INDEX idx_transactions_user        ON public.transactions (user_id);
CREATE INDEX idx_transactions_party_site  ON public.transactions (party_id, site_id);
CREATE INDEX idx_transactions_personnel   ON public.transactions (personnel_id, site_id);
CREATE INDEX idx_transactions_goods_entry ON public.transactions (goods_entry_id, site_id);
CREATE INDEX idx_transactions_category    ON public.transactions (category_id);

-- Kategori, işlemin şantiyesine (ya da varsayılan) ve TÜRÜNE (gelir/gider) uygun olmalı.
CREATE FUNCTION private.check_transaction_category()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.id = NEW.category_id
      AND (c.site_id IS NULL OR c.site_id = NEW.site_id)
      AND c.type = NEW.type
  ) THEN
    RAISE EXCEPTION 'Kategori bu şantiyeye veya işlem türüne uygun değil.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_check_category
  BEFORE INSERT OR UPDATE OF category_id, type, site_id ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.check_transaction_category();

CREATE FUNCTION private.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_touch_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ------------------------------------------------------------
-- YETKİLER (GRANT) + RLS
-- ------------------------------------------------------------
ALTER TABLE public.categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.categories, public.transactions FROM anon, authenticated;

GRANT SELECT, INSERT, DELETE ON public.categories TO authenticated;
GRANT UPDATE (name) ON public.categories TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.transactions TO authenticated;
GRANT UPDATE (category_id, party_id, personnel_id, goods_entry_id, type, description, amount, currency,
              payment_method, transaction_date)
  ON public.transactions TO authenticated;                       -- site_id / user_id değiştirilemez
GRANT USAGE ON SEQUENCE public.categories_id_seq, public.transactions_id_seq TO authenticated;

GRANT ALL ON public.categories, public.transactions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.categories_id_seq, public.transactions_id_seq TO service_role;

-- categories: varsayılanlar (site_id NULL) herkes okur, yalnızca service_role yazar; şantiye kategorilerini yazma yetkilileri yönetir.
CREATE POLICY categories_select ON public.categories FOR SELECT TO authenticated
  USING (site_id IS NULL OR (SELECT private.is_admin()) OR site_id IN (SELECT private.member_site_ids()));
CREATE POLICY categories_insert ON public.categories FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY categories_update ON public.categories FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids())) WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY categories_delete ON public.categories FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()));

-- transactions: okuma üyeler + admin; yazma yalnızca owner/partner (admin ve viewer yazamaz).
CREATE POLICY transactions_select ON public.transactions FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR site_id IN (SELECT private.member_site_ids()));
CREATE POLICY transactions_insert ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND user_id = (SELECT auth.uid()));
CREATE POLICY transactions_update ON public.transactions FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids())) WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY transactions_delete ON public.transactions FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()));

-- ------------------------------------------------------------
-- VIEW: cari bakiyeleri — parties'e sabit sütun EKLENMEZ, her zaman transactions'tan canlı hesaplanır.
-- security_invoker: çağıranın RLS'i uygulanır. Yorum: balance = tahsilat (income) − ödeme (expense).
-- ------------------------------------------------------------
CREATE VIEW public.party_balances
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
  MAX(t.transaction_date) AS last_transaction_date
FROM public.parties p
LEFT JOIN public.transactions t ON t.party_id = p.id AND t.site_id = p.site_id
GROUP BY p.id, p.site_id, p.name, p.category;

REVOKE ALL ON public.party_balances FROM anon, authenticated;
GRANT SELECT ON public.party_balances TO authenticated, service_role;
