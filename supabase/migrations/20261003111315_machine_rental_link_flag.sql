-- ============================================================
-- KİRA SENKRONU: "tam ödenmiş ay" artık TAHMİN edilmez, işaretlenir (transactions.machine_synced).
-- Bir makinenin o ayki kira ödemelerinin toplamı puantajla (gün sayısı / toplam saat) tam eşitse o ayın ödemeleri "bağlı"
-- (machine_synced = true) olur; ödeme veya puantaj-ödeme eşitliği ÖDEME tarafında değişince işaret yeniden hesaplanır.
-- Puantaj değişince YALNIZCA bağlı ödemeler güncellenir. Kısmi ödeme (ödenen < puantaj) hiçbir zaman bağlı değildir;
-- böylece kısmi ödemeli bir ayda gün kaldırıp geri eklemek ödenmemiş günü "ödenmiş" yazmaz.
-- ============================================================

ALTER TABLE public.transactions ADD COLUMN machine_synced BOOLEAN NOT NULL DEFAULT false;
-- Kullanıcılar bu sütunu doğrudan güncelleyemez (UPDATE yetkisi sütun bazlı verilir); tetikleyiciler yönetir.

-- Bir makinenin bir aydaki ödemelerinin "bağlı" işaretini yeniden hesapla.
CREATE FUNCTION private.refresh_rental_link(p_machine INTEGER, p_month DATE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  m       public.machines;
  worked  NUMERIC;
  paid    NUMERIC;
  broken  INTEGER;
  linked  BOOLEAN;
  month_end DATE := (p_month + INTERVAL '1 month - 1 day')::date;
BEGIN
  SELECT * INTO m FROM public.machines WHERE id = p_machine;
  IF NOT FOUND OR m.rate_unit IS NULL THEN
    RETURN;
  END IF;

  IF m.rate_unit = 'day' THEN
    SELECT COUNT(*) INTO worked FROM public.machine_attendance a WHERE a.machine_id = m.id AND a.work_date BETWEEN p_month AND month_end;
  ELSE
    SELECT COALESCE(SUM(a.hours), 0) INTO worked FROM public.machine_attendance a WHERE a.machine_id = m.id AND a.work_date BETWEEN p_month AND month_end;
  END IF;

  SELECT COUNT(*) FILTER (WHERE t.machine_qty IS NULL OR t.machine_unit IS DISTINCT FROM m.rate_unit), COALESCE(SUM(t.machine_qty), 0)
    INTO broken, paid
  FROM public.transactions t
  WHERE t.machine_id = m.id AND t.user_id = m.owner_id AND t.period_month = p_month;

  linked := broken = 0 AND paid > 0 AND ABS(paid - worked) < 0.05;

  UPDATE public.transactions t SET machine_synced = linked
  WHERE t.machine_id = m.id AND t.user_id = m.owner_id AND t.period_month = p_month AND t.machine_synced IS DISTINCT FROM linked;
END;
$$;

CREATE FUNCTION private.trg_refresh_rental_link()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- İç içe (senkron tetikleyicisi / CASCADE) çağrılarda işaret değişmez
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.machine_id IS NOT NULL AND NEW.period_month IS NOT NULL THEN
    PERFORM private.refresh_rental_link(NEW.machine_id, NEW.period_month);
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.machine_id IS NOT NULL AND OLD.period_month IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.machine_id <> NEW.machine_id OR OLD.period_month IS DISTINCT FROM NEW.period_month) THEN
    PERFORM private.refresh_rental_link(OLD.machine_id, OLD.period_month);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_rental_link(INTEGER, DATE), private.trg_refresh_rental_link() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER transactions_refresh_rental_link
  AFTER INSERT OR DELETE OR UPDATE OF machine_qty, machine_unit, machine_id, period_month ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.trg_refresh_rental_link();

-- Mevcut kira ödemeleri için işareti hesapla
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT machine_id, period_month FROM public.transactions WHERE machine_id IS NOT NULL AND period_month IS NOT NULL LOOP
    PERFORM private.refresh_rental_link(r.machine_id, r.period_month);
  END LOOP;
END;
$$;

-- Puantaj senkron tetikleyicisi: YALNIZCA bağlı (machine_synced) ödemeler güncellenir.
CREATE OR REPLACE FUNCTION private.sync_machine_rental()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rec          public.machine_attendance;
  m            public.machines;
  delta        NUMERIC := 0;
  month_start  DATE;
  month_end    DATE;
  worked_after NUMERIC;
  paid         NUMERIC;
  unlinked     INTEGER;
  p            RECORD;
  remaining    NUMERIC;
  new_qty      NUMERIC;
  qty_text     TEXT;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  rec := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT * INTO m FROM public.machines WHERE id = rec.machine_id AND site_id = rec.site_id;
  IF NOT FOUND OR m.ownership <> 'rented' OR m.rate_unit IS NULL THEN
    RETURN NULL;
  END IF;

  IF m.rate_unit = 'day' THEN
    delta := CASE TG_OP WHEN 'INSERT' THEN 1 WHEN 'DELETE' THEN -1 ELSE 0 END;
  ELSE
    delta := CASE TG_OP
      WHEN 'INSERT' THEN COALESCE(NEW.hours, 0)
      WHEN 'DELETE' THEN -COALESCE(OLD.hours, 0)
      ELSE COALESCE(NEW.hours, 0) - COALESCE(OLD.hours, 0)
    END;
  END IF;
  IF delta = 0 THEN
    RETURN NULL;
  END IF;

  month_start := date_trunc('month', rec.work_date)::date;
  month_end   := (month_start + INTERVAL '1 month - 1 day')::date;

  IF m.rate_unit = 'day' THEN
    SELECT COUNT(*) INTO worked_after FROM public.machine_attendance a
    WHERE a.machine_id = m.id AND a.work_date BETWEEN month_start AND month_end;
  ELSE
    SELECT COALESCE(SUM(a.hours), 0) INTO worked_after FROM public.machine_attendance a
    WHERE a.machine_id = m.id AND a.work_date BETWEEN month_start AND month_end;
  END IF;

  -- Ayın ödemelerinden biri bile "bağlı" değilse (kısmi ödeme, döküm temizlenmiş…) dokunma
  SELECT COUNT(*) FILTER (WHERE NOT t.machine_synced), COALESCE(SUM(t.machine_qty), 0) INTO unlinked, paid
  FROM public.transactions t
  WHERE t.site_id = m.site_id AND t.machine_id = m.id AND t.user_id = m.owner_id AND t.period_month = month_start;
  IF unlinked > 0 OR paid <= 0 OR ABS(paid - (worked_after - delta)) >= 0.05 THEN
    RETURN NULL;
  END IF;

  remaining := delta;
  FOR p IN
    SELECT t.id, t.machine_qty, t.machine_rate, t.description FROM public.transactions t
    WHERE t.site_id = m.site_id AND t.machine_id = m.id AND t.user_id = m.owner_id AND t.period_month = month_start
    ORDER BY t.transaction_date DESC, t.id DESC
  LOOP
    EXIT WHEN remaining = 0;
    new_qty := p.machine_qty + remaining;
    IF new_qty > 0 THEN
      qty_text := replace(trim_scale(new_qty)::text, '.', ',');
      UPDATE public.transactions
      SET machine_qty = new_qty,
          amount = ROUND(new_qty * p.machine_rate, 2),
          description = regexp_replace(p.description, '\([0-9]+(,[0-9]+)? (gün|saat) ×', '(' || qty_text || ' ' || (CASE WHEN m.rate_unit = 'day' THEN 'gün' ELSE 'saat' END) || ' ×')
      WHERE id = p.id;
      remaining := 0;
    ELSE
      remaining := new_qty;
      DELETE FROM public.transactions WHERE id = p.id;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;
