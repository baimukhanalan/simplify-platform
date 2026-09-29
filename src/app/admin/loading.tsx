export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Загружаем данные…</span>
      <div className="flex flex-col gap-3">
        <div className="h-3 w-32 animate-pulse rounded-full bg-head/10" />
        <div className="h-10 w-72 max-w-full animate-pulse rounded-2xl bg-head/10" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="glass h-[118px] animate-pulse" />)}
      </div>
      <div className="glass h-72 animate-pulse" />
    </div>
  );
}
