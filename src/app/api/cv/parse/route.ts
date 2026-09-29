import { extractText, getDocumentProxy } from "unpdf";
import { rateLimit } from "@/lib/rate-limit";
import { actionT } from "@/lib/i18n/action";
import type { Dictionary } from "@/lib/i18n/translator";

export const maxDuration = 20;

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_CHARS = 30000;

/** The error in the reader's language (the UI shows it as-is). */
const fail = async (key: keyof Dictionary["serverErrors"]["cvParse"], status: number) => Response.json({ error: (await actionT())(`serverErrors.cvParse.${key}`) }, { status });

/** POST multipart `file` (PDF or .txt, ≤ 5 MB) → `{ text, pages, fileName }`. Used by Career Check and onboarding. */
export async function POST(req: Request) {
  const rl = await rateLimit("cv-parse", 20, 60 * 60 * 1000);
  if (!rl.ok) return fail("tooMany", 429);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("badRequest", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("noFile", 400);
  if (file.size > MAX_BYTES) return fail("tooBig", 413);

  const name = file.name || "cv";
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(name);
  const isTxt = file.type === "text/plain" || /\.txt$/i.test(name);
  if (!isPdf && !isTxt) return fail("badType", 415);

  const buf = new Uint8Array(await file.arrayBuffer());
  let text = "";
  let pages = 1;
  try {
    if (isPdf) {
      if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) return fail("notPdf", 415);
      const pdf = await getDocumentProxy(buf);
      if (pdf.numPages > 20) return fail("tooLong", 413);
      const out = await extractText(pdf, { mergePages: false });
      pages = out.totalPages;
      text = out.text.join("\n\n");
    } else {
      text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    }
  } catch (err) {
    console.error("[cv/parse]", err instanceof Error ? err.message : err);
    return fail("unreadable", 422);
  }

  text = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_CHARS);
  if (text.length < 40) return fail("noText", 422);
  return Response.json({ text, pages, fileName: name.slice(0, 200) });
}
