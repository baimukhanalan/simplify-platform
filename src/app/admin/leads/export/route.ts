import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { LEADS_CSV_MAX, leadWhere, leadsCsv, parseLeadFilters } from "@/lib/leads";

/** CSV of the leads matching the current /admin/leads filters (UTF-8 with BOM for Excel). Admins only. */
export async function GET(req: Request) {
  await requireAdmin();
  const f = parseLeadFilters(Object.fromEntries(new URL(req.url).searchParams));
  const rows = await db.lead.findMany({ where: leadWhere(f), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LEADS_CSV_MAX });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(leadsCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="simplify-leads-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
