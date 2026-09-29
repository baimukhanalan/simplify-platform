export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Загружаю ошибки…</span>
      <div className="h-24 w-2/3 animate-pulse rounded-[20px] bg-white/50" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="glass h-[118px] animate-pulse" />)}
      </div>
      <div className="glass h-[420px] animate-pulse" />
    </div>
  );
}
