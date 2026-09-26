/**
 * Birincil eylem (Kaydet/Ekle) çubuğu (CLAUDE.md 7.1): mobilde alt navigasyonun hemen üstünde sabit,
 * başparmakla ulaşılabilir; masaüstünde formun sonunda normal akışta durur.
 * Kullanan form, mobilde içeriğin altta kalmaması için kendine `pb-24 md:pb-0` vermelidir.
 */
export function StickyActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t bg-background p-3 md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:pt-2">
      <div className="mx-auto flex max-w-2xl gap-3 md:mx-0">{children}</div>
    </div>
  );
}
