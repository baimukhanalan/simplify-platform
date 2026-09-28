export default function AppLoading() {
  const bar = "rounded-full bg-head/[.07] animate-pulse";
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Загрузка">
      <div className="flex flex-col gap-3">
        <div className={`${bar} h-3 w-32`} />
        <div className={`${bar} h-9 w-72 max-w-full`} />
        <div className={`${bar} h-4 w-96 max-w-full`} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass flex h-36 flex-col gap-3 p-6">
            <div className={`${bar} h-3 w-24`} />
            <div className={`${bar} h-8 w-16`} />
          </div>
        ))}
      </div>
      <div className="glass h-64 p-6"><div className={`${bar} h-3 w-40`} /></div>
    </div>
  );
}
