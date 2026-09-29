import { j } from "@/lib/db";
import { APPLIED_OR_LATER } from "@/lib/engine/taxonomy";
import { cvPdfFilename } from "@/lib/links";
import type { Answer } from "@/lib/engine/personalize";
import { preflight, json, withExtension } from "../_lib/auth";
import { findOpportunityForUrl } from "../_lib/find";
import { jobKey } from "../_lib/match";
import { splitAnswers } from "../_lib/answers";

export const OPTIONS = preflight;

/** GET ?url=<page url> → the user's vacancy for that page and its application package (what the extension may fill). */
export async function GET(req: Request) {
  return withExtension(req, async ({ userId }) => {
    const pageUrl = new URL(req.url).searchParams.get("url") ?? "";
    const key = jobKey(pageUrl);
    if (!key) return json(req, { error: "bad url" }, 400);
    const opp = await findOpportunityForUrl(userId, pageUrl);
    if (!opp) return json(req, { matched: false, ats: key.ats });

    const pkg = opp.pkg;
    const cvPath = `/api/extension/cv/${opp.id}`;
    const { answers, held } = pkg ? splitAnswers(j<Answer[]>(pkg.answers, [])) : { answers: [], held: [] };
    return json(req, {
      matched: true,
      ats: key.ats,
      opportunity: {
        id: opp.id,
        company: opp.job.company,
        title: opp.job.title,
        status: opp.status,
        submitted: APPLIED_OR_LATER.includes(opp.status),
        hasPackage: Boolean(pkg),
        appUrl: `/app/opportunities/${opp.id}`,
      },
      package: pkg
        ? {
            coverLetter: pkg.coverLetter,
            answers,
            held,
            cv: { path: cvPath, url: new URL(cvPath, req.url).toString(), fileName: cvPdfFilename(opp.job.company, opp.job.title) },
          }
        : null,
    });
  }, { bucket: "match" });
}
