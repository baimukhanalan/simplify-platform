import { revalidatePath } from "next/cache";
import { preflight, json, withExtension } from "../_lib/auth";
import { markSubmittedByExtension } from "../_lib/submitted";

export const OPTIONS = preflight;

/** POST {opportunityId} — the user says they submitted the application on the employer's form themselves. */
export async function POST(req: Request) {
  return withExtension(req, async ({ userId }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(req, { error: "bad json" }, 400);
    }
    const id = typeof body === "object" && body && "opportunityId" in body ? String((body as { opportunityId: unknown }).opportunityId ?? "") : "";
    if (!/^[a-z0-9]{10,40}$/i.test(id)) return json(req, { error: "bad opportunityId" }, 400);
    const r = await markSubmittedByExtension(userId, id);
    if (!r.ok) return json(req, r, r.error === "not-found" ? 404 : 409);
    revalidatePath("/app", "layout");
    return json(req, r);
  }, { bucket: "submit", limit: 30 });
}
