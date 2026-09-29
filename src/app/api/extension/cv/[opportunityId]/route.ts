import { db } from "@/lib/db";
import { cvPdfFilename } from "@/lib/links";
import { textToPdf } from "../../../applications/[id]/cv/pdf";
import { corsHeaders, preflight, json, withExtension } from "../../_lib/auth";

export const OPTIONS = preflight;

/** The exact CV that goes out with this application, as a PDF — same renderer and metadata as /api/applications/[id]/cv. */
export async function GET(req: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  return withExtension(req, async ({ userId }) => {
    const { opportunityId } = await params;
    const opp = await db.opportunity.findFirst({
      where: { id: opportunityId, campaign: { userId } },
      select: { job: { select: { company: true, title: true } }, pkg: { select: { cvText: true } } },
    });
    if (!opp?.pkg) return json(req, { error: "not found" }, 404);
    const pdf = textToPdf(opp.pkg.cvText, { title: `CV - ${opp.job.title} - ${opp.job.company}`, footer: `${opp.job.company} · ${opp.job.title}` });
    const filename = cvPdfFilename(opp.job.company, opp.job.title);
    return new Response(pdf as BodyInit, {
      headers: {
        ...corsHeaders(req.headers.get("origin")),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdf.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Expose-Headers": "Content-Disposition",
      },
    });
  }, { bucket: "cv", limit: 60 });
}
