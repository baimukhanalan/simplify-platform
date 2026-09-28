import { redirect } from "next/navigation";

/** Pipeline became "Applications". Old links and bookmarks keep working. */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") qs.set(k, v);
  const q = qs.toString();
  redirect(`/app/applications${q ? `?${q}` : ""}`);
}
