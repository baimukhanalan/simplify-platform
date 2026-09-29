import { currentUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimitUser } from "@/lib/rate-limit";
import { cvPdfFilename } from "@/lib/links";
import { textToPdf } from "./pdf";

/** The exact CV text that went out with an application, as a PDF. Owner-scoped through the campaign. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rl = await rateLimitUser("cv-pdf", userId, 150, 10 * 60 * 1000);
  if (!rl.ok) return Response.json({ error: "too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  const { id } = await params;
  const opp = await db.opportunity.findFirst({
    where: { id, campaign: { userId } },
    select: { job: { select: { company: true, title: true } }, pkg: { select: { cvText: true } } },
  });
  if (!opp?.pkg) return Response.json({ error: "not found" }, { status: 404 });

  // Employer-facing: company + role only — the internal version id never appears in the file or its name.
  const pdf = textToPdf(opp.pkg.cvText, { title: `CV - ${opp.job.title} - ${opp.job.company}`, footer: `${opp.job.company} · ${opp.job.title}` });
  const filename = cvPdfFilename(opp.job.company, opp.job.title);
  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
