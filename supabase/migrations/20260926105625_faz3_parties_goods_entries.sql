-- ============================================================
-- FAZ 3 — parties (cari/firma) + goods_entries (irsaliye/fatura/fiş)
-- ============================================================
-- Şema CLAUDE.md Bölüm 4 ile aynıdır; farklar:
--  * users(id) referansları UUID.
--  * goods_entries.party_id, (party_id, site_id) BİLEŞİK yabancı anahtarla parties'e bağlanır:
--    bir şantiyenin kaydına başka şantiyenin firması bağlanamaz (şantiyeler arası veri sızıntısı).
--    Aynı desen sonraki fazlarda party_id/personnel_id taşıyan tüm tablolarda kullanılacak.
--  * Cari bakiye/ciro sütunu YOKTUR (Faz 6'da party_balances view'inden hesaplanır).

-- Yazma yetkisi: şantiyenin sahibi veya ortağı. 'viewer' ve admin (üye olmadığı için) yalnızca okur.
CREATE FUNCTION private.can_write_site(p_site_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.site_members
    WHERE site_id = p_site_id
      AND user_id = (SELECT auth.uid())
      AND role IN ('owner', 'partner')
  );
$$;

REVOKE ALL ON FUNCTION private.can_write_site(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_write_site(INTEGER) TO authenticated;

-- ------------------------------------------------------------
-- TABLOLAR
-- ------------------------------------------------------------
CREATE TABLE public.parties (
  id          SERIAL PRIMARY KEY,
  site_id     INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name        VARCHAR(150) NOT NULL CHECK (length(btrim(name)) > 0),  -- kişi / firma adı, ya da araç kiralamada plaka
  category    VARCHAR(30) NOT NULL DEFAULT 'firma'
              CHECK (category IN ('firma', 'nakliyeci', 'arac', 'musteri', 'diger')),
  address     TEXT,
  phone       VARCHAR(30),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, site_id)   -- bileşik yabancı anahtar hedefi
);

-- Aynı şantiyede aynı adla ikinci cari açılmasın (büyük/küçük harf duyarsız).
CREATE UNIQUE INDEX uq_parties_site_name ON public.parties (site_id, lower(name));

CREATE TABLE public.goods_entries (
  id                 SERIAL PRIMARY KEY,
  site_id            INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  entry_date         DATE NOT NULL,                                                      -- 1. tarih
  document_type      VARCHAR(20) NOT NULL CHECK (document_type IN ('fis', 'fatura', 'irsaliye')),  -- 2.
  document_no        VARCHAR(50),                                                        -- 3. belge no
  party_id           INTEGER,                                                            -- 4. firma
  material_type      VARCHAR(150),                                                       -- 5. malzeme türü
  unit               VARCHAR(30),                                                        -- 6. birim
  variant            VARCHAR(150),                                                       -- 7. çeşidi / cinsi / çapı
  quantity           NUMERIC(14,2) CHECK (quantity IS NULL OR quantity >= 0),            -- 8. miktarı
  used_location      VARCHAR(150),                                                       -- 9. kullanıldığı yer
  purchase_location  VARCHAR(150),                                                       -- 10. satın alma yeri
  transport_cost     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (transport_cost >= 0),       -- 11. nakliye tutarı
  info               TEXT,                                                               -- 12. bilgi
  created_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT goods_entries_party_same_site_fk
    FOREIGN KEY (party_id, site_id) REFERENCES public.parties (id, site_id)
);

CREATE INDEX idx_parties_site             ON public.parties(site_id);
CREATE INDEX idx_goods_entries_site       ON public.goods_entries(site_id);
CREATE INDEX idx_goods_entries_site_date  ON public.goods_entries(site_id, entry_date DESC);
CREATE INDEX idx_goods_entries_party      ON public.goods_entries(party_id);

-- ------------------------------------------------------------
-- YETKİLER (GRANT) + RLS
-- ------------------------------------------------------------
ALTER TABLE public.parties       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.parties, public.goods_entries FROM anon, authenticated;

GRANT SELECT, INSERT, DELETE ON public.parties TO authenticated;
GRANT UPDATE (name, category, address, phone, notes) ON public.parties TO authenticated;   -- site_id değiştirilemez

GRANT SELECT, INSERT, DELETE ON public.goods_entries TO authenticated;
GRANT UPDATE (entry_date, document_type, document_no, party_id, material_type, unit, variant,
              quantity, used_location, purchase_location, transport_cost, info)
  ON public.goods_entries TO authenticated;                                                 -- site_id/created_by değiştirilemez

GRANT USAGE ON SEQUENCE public.parties_id_seq, public.goods_entries_id_seq TO authenticated;

GRANT ALL ON public.parties, public.goods_entries TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.parties_id_seq, public.goods_entries_id_seq TO service_role;

-- Okuma: şantiyenin üyeleri (viewer dahil) + admin (salt görüntüleme).
-- Yazma: yalnızca şantiyenin owner/partner üyeleri; admin veri yazmaz.
CREATE POLICY parties_select ON public.parties FOR SELECT TO authenticated
  USING (private.has_site_access(site_id));
CREATE POLICY parties_insert ON public.parties FOR INSERT TO authenticated
  WITH CHECK (private.can_write_site(site_id));
CREATE POLICY parties_update ON public.parties FOR UPDATE TO authenticated
  USING (private.can_write_site(site_id)) WITH CHECK (private.can_write_site(site_id));
CREATE POLICY parties_delete ON public.parties FOR DELETE TO authenticated
  USING (private.can_write_site(site_id));

CREATE POLICY goods_entries_select ON public.goods_entries FOR SELECT TO authenticated
  USING (private.has_site_access(site_id));
CREATE POLICY goods_entries_insert ON public.goods_entries FOR INSERT TO authenticated
  WITH CHECK (private.can_write_site(site_id) AND created_by = (SELECT auth.uid()));
CREATE POLICY goods_entries_update ON public.goods_entries FOR UPDATE TO authenticated
  USING (private.can_write_site(site_id)) WITH CHECK (private.can_write_site(site_id));
CREATE POLICY goods_entries_delete ON public.goods_entries FOR DELETE TO authenticated
  USING (private.can_write_site(site_id));
