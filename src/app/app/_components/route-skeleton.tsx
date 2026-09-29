"use client";
// Route skeletons (loading.tsx under src/app/app): shown the moment a nav link is clicked, inside the app shell (the
// nav stays), until the screen's server data arrives. Shapes follow the real screens: PageHeader, glass cards, rows.
// A client component on purpose: it reads the shell namespace the app layout already provides (no server work, so
// prefetching a route's loading state costs nothing).
import { cx } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

export type SkeletonVariant = "today" | "list" | "dashboard" | "form" | "detail";

const Bar = ({ className }: { className?: string }) => <div className={cx("animate-pulse rounded-full bg-head/10", className)} />;

function Header({ actions = false }: { actions?: boolean }) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-3">
        <Bar className="h-3 w-28" />
        <Bar className="h-9 w-72 max-w-full !rounded-2xl sm:h-11 sm:w-96" />
        <Bar className="h-3.5 w-80 max-w-full" />
      </div>
      {actions && <Bar className="h-11 w-40" />}
    </div>
  );
}

/** The one-line «Нужно от тебя» status strip most screens open with. */
const StatusLine = () => <div className="glass h-12 animate-pulse !rounded-2xl" />;

function Row() {
  return (
    <div className="glass flex items-center gap-4 p-5 sm:p-6">
      <div className="size-11 shrink-0 animate-pulse rounded-full bg-head/10" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <Bar className="h-4 w-3/5" />
        <Bar className="h-3 w-2/5" />
      </div>
      <Bar className="hidden h-7 w-20 sm:block" />
    </div>
  );
}

function Today() {
  return (
    <div className="flex flex-col gap-5">
      <div className="glass flex flex-col gap-5 p-5 sm:p-7">
        <Bar className="h-3 w-40" />
        <Bar className="h-10 w-80 max-w-full !rounded-2xl" />
        <Bar className="h-3.5 w-full max-w-xl" />
        <div className="mt-2 flex justify-between gap-2">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="size-4 animate-pulse rounded-full bg-head/10" />)}
        </div>
      </div>
      <div className="glass h-36 animate-pulse" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="glass h-[108px] animate-pulse" />)}
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => <Row key={i} />)}
      </div>
    </div>
  );
}

function List() {
  return (
    <>
      <Header />
      <div className="flex flex-col gap-4">
        <StatusLine />
        <div className="flex gap-2">
          {Array.from({ length: 3 }, (_, i) => <Bar key={i} className="h-10 w-28" />)}
        </div>
        {Array.from({ length: 5 }, (_, i) => <Row key={i} />)}
      </div>
    </>
  );
}

function Dashboard() {
  return (
    <>
      <Header />
      <div className="flex flex-col gap-5">
        <div className="glass h-44 animate-pulse" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="glass h-[108px] animate-pulse" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="glass h-64 animate-pulse" />
          <div className="glass h-64 animate-pulse" />
        </div>
      </div>
    </>
  );
}

function Form() {
  return (
    <>
      <Header />
      <div className="flex flex-col gap-5">
        <StatusLine />
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass flex flex-col gap-4 p-5 sm:p-6">
            <Bar className="h-3 w-32" />
            <Bar className="h-5 w-64 max-w-full" />
            <Bar className="h-11 w-full !rounded-xl" />
            <Bar className="h-11 w-full !rounded-xl" />
          </div>
        ))}
      </div>
    </>
  );
}

function Detail() {
  return (
    <>
      <Bar className="mb-5 h-4 w-32" />
      <Header actions />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          <div className="glass h-56 animate-pulse" />
          <div className="glass h-72 animate-pulse" />
        </div>
        <div className="glass h-80 animate-pulse" />
      </div>
    </>
  );
}

const SHAPES: Record<SkeletonVariant, () => React.JSX.Element> = { today: Today, list: List, dashboard: Dashboard, form: Form, detail: Detail };

export function RouteSkeleton({ variant }: { variant: SkeletonVariant }) {
  const t = useT();
  const Shape = SHAPES[variant];
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only" role="status">{t("shell.loading")}</span>
      <div aria-hidden>
        <Shape />
      </div>
    </div>
  );
}
