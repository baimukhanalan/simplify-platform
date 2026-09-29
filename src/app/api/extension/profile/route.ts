import { db, j } from "@/lib/db";
import { latinName } from "@/lib/engine/taxonomy";
import { preflight, json, withExtension } from "../_lib/auth";

/** Region code → English name for ATS forms ("KZ" → "Kazakhstan"); unknown codes pass through. */
function countryEn(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const OPTIONS = preflight;

/** The user's own contact/profile data for employer forms — English values, nothing the forms don't ask for. */
export async function GET(req: Request) {
  return withExtension(req, async ({ userId }) => {
    const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, profile: true } });
    if (!user) return json(req, { error: "not found" }, 404);
    const p = user.profile;
    const fullName = latinName(user.name).trim();
    const [firstName, ...rest] = fullName.split(/\s+/);
    const workAuth = j<string[]>(p?.workAuth, []).filter((c) => typeof c === "string");
    const city = latinName(p?.city ?? "").trim();
    const country = countryEn(p?.country ?? "");
    const location = latinName(p?.location ?? "").trim() || [city, country].filter(Boolean).join(", ");
    return json(req, {
      name: { full: fullName, first: firstName ?? "", last: rest.join(" ") },
      email: user.email,
      phone: p?.phone ?? "",
      location,
      city,
      country,
      links: { linkedin: p?.linkedin ?? "", github: p?.github ?? "", portfolio: p?.portfolio ?? "" },
      workAuthorization: {
        countries: workAuth.map(countryEn),
        codes: workAuth,
        needsSponsorship: p?.needsSponsorship ?? true,
        relocation: p?.relocation ?? false,
      },
      noticePeriod: p?.noticePeriod || "2 weeks",
      yearsExperience: p?.yearsExperience ?? 0,
      headline: p?.headline ?? "",
      englishLevel: p?.englishLevel ?? "",
      skills: j<string[]>(p?.skills, []).filter((x) => typeof x === "string").slice(0, 40),
    });
  }, { bucket: "profile" });
}
