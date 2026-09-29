// «Can someone living in Kazakhstan take this job?» — a deterministic classifier over title + location + description.
// Ported from JOBFINDER backend/applier/regions.py (open_anywhere), whose rules were tuned on a 120-posting audit:
// the location field is authoritative (a named foreign country pins the role), EMEA / APAC / Europe never turned out to
// include KZ, and a bare «Remote» is decided by the text (negatives first). Pure: no I/O, safe for tests and the client.

export type Workplace = "remote" | "hybrid" | "onsite" | "" | undefined;

export type KzVerdict = {
  /** A KZ resident can apply (the role names KZ / Central Asia / CIS, or is open worldwide). */
  open: boolean;
  /** open · pinned (restricted to somewhere else) · unclear (bare «Remote», no signal either way). */
  verdict: "open" | "pinned" | "unclear";
  /** The role names Kazakhstan or a region that contains it (vs. merely worldwide). */
  named: boolean;
  /** For pinned roles: best-effort country / region codes the role is restricted to (ISO-2, or APAC / LATAM / OTHER). */
  pin: string[];
  reason: string;
};

// `\b` is ASCII-only in JS: next to Cyrillic it never matches. Rewrite it to a Unicode-aware word boundary.
const W = "[\\p{L}\\p{N}_]";
const B = `(?:(?<!${W})(?=${W})|(?<=${W})(?!${W}))`;
const re = (src: string, flags = "") => new RegExp(src.replace(/\\b/g, B), `${flags}u`);

// ——— Place vocabularies (lower-case input) ———
const WORLDWIDE_SRC =
  "work (?:from |remotely from )?anywhere|(?:hire|employ|recruit)\\w*\\s+(?:from\\s+)?anywhere|anywhere in the world|from any country|in any country" +
  "|open to (?:candidates|applicants)\\s+(?:from\\s+)?(?:anywhere|worldwide|any country|any location|around the world|globally)" +
  "|(?:candidates|applicants)\\s+(?:from\\s+)?(?:anywhere|around the world)\\s+(?:are welcome|may apply|can apply)" +
  "|location[- ]independent|remote,?\\s+worldwide|worldwide,?\\s+remote";
const WORLDWIDE_RE = re(WORLDWIDE_SRC);
const LOC_WORLDWIDE_RE = re("\\b(?:worldwide|anywhere|global(?:ly)?|everywhere|весь мир|любая страна)\\b");
const NA_RE = re("\\bnorth america\\b|\\bus\\s*&\\s*canada\\b|\\bus\\s*/\\s*canada\\b|\\bus and canada\\b|\\busa\\s*/\\s*canada\\b|\\bnoram\\b|\\bnamer\\b|\\bamericas\\b|\\bamer\\b");
const US_STRONG_RE = re("\\bunited states\\b|\\bu\\.?s\\.?a\\b|\\bu\\.s\\.|\\bus[- ]based\\b|\\bus[- ]only\\b|\\bremote\\s*[-,(]\\s*us\\b|\\bсша\\b");
// "georgia" is deliberately absent: a US state and a country. A bare «Georgia» is the country (see namesAPlace).
const US_STATE_RE = re(
  "\\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland" +
    "|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio" +
    "|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming" +
    "|district of columbia|washington,? d\\.?c\\.?)\\b",
);
const US_CITY_RE = re(
  "\\b(?:san francisco|sf bay area|bay area|san jose|los angeles|san diego|new york city|nyc|seattle|austin|boston|chicago|denver|atlanta|dallas|houston|miami" +
    "|philadelphia|phoenix|minneapolis|nashville|charlotte|san antonio|brooklyn|palo alto|mountain view|sunnyvale|santa clara|santa monica|santa barbara|san carlos" +
    "|menlo park|cupertino|redwood city|oakland|sacramento|pittsburgh|tampa|orlando|raleigh|durham|cincinnati|cleveland|kansas city|saint louis|st\\.? louis" +
    "|indianapolis|milwaukee|las vegas|san mateo|irvine|bellevue|fremont|plano|chattanooga|salt lake city|boulder)\\b",
);
const CA_RE = re("\\bcanada\\b|\\bcanadian\\b|\\bontario\\b|\\bquebec\\b|\\bbritish columbia\\b|\\balberta\\b|\\btoronto\\b|\\bvancouver\\b|\\bmontreal\\b");
const UK_STRONG_RE = re("\\bunited kingdom\\b|\\bengland\\b|\\bscotland\\b|\\bwales\\b|\\blondon\\b|\\bbritain\\b|\\bbritish\\b");
// Short ambiguous tokens — scanned over title + location only, never the description («join us»).
const US_LOC_RE = re("\\bus\\b(?!\\s*[/&]?\\s*canada)");
const UK_LOC_RE = re("\\buk\\b|\\bu\\.k\\.");
const EUROPE_WORDS =
  "germany|france|spain|netherlands|poland|portugal|romania|ireland|italy|hungary|czechia|czech republic|slovakia|slovenia|croatia|serbia|bulgaria|greece|austria" +
  "|switzerland|belgium|sweden|norway|denmark|finland|estonia|latvia|lithuania|ukraine|cyprus|malta|luxembourg|iceland|turkey|armenia|moldova|bosnia|montenegro" +
  "|albania|macedonia|berlin|munich|amsterdam|paris|madrid|barcelona|lisbon|warsaw|krakow|dublin|stockholm|vienna|prague|tallinn|riga|vilnius|zurich|copenhagen";
const APAC_WORDS =
  "india|philippines|pakistan|australia|new zealand|singapore|japan|china|hong kong|taiwan|korea|indonesia|vietnam|thailand|malaysia|bangladesh|sri lanka|nepal" +
  "|tokyo|sydney|melbourne|bangalore|bengaluru|mumbai|manila|seoul|shanghai|beijing";
const LATAM_WORDS =
  "brazil|mexico|argentina|colombia|chile|peru|uruguay|ecuador|guatemala|costa rica|bolivia|venezuela|paraguay|dominican|panama|honduras|nicaragua|el salvador|sao paulo|são paulo|buenos aires|bogota|bogotá";
const MEA_WORDS = "nigeria|kenya|south africa|ghana|morocco|egypt|israel|uae|dubai|saudi|qatar|kazakhstan|azerbaijan";
const MACRO_WORDS =
  "emea|apac|anz|mena|cis|nordics?|benelux|balkans?|dach|iberia|europe(?:an)?|asia(?:n|-pacific| pacific)?|latam|latin america|south america|central america|middle east|africa|oceania";
const OTHER_RE = re(`\\b(?:${MACRO_WORDS}|${EUROPE_WORDS}|${APAC_WORDS}|${LATAM_WORDS}|${MEA_WORDS})\\b`);

// ——— open_anywhere rules ———
const LOC_BROAD_INCL_SRC = "\\beurasia\\b|\\bcentral asia\\b|\\bcis\\b|\\bснг\\b|\\bglobal\\b|\\binternational\\b|\\bworldwide\\b|\\banywhere\\b|\\beverywhere\\b|\\basia\\b";
const LOC_BROAD_INCL_RE = re(LOC_BROAD_INCL_SRC);
const LOC_BROAD_INCL_ALL = re(LOC_BROAD_INCL_SRC, "g"); // for .replace only (a /g regex is stateful under .test)
const LOC_SUBREGION_PIN_RE = re(
  "\\bsouth[- ]?east asia\\b|\\bse asia\\b|\\beast asia\\b|\\bsouth asia\\b|\\bnorth asia\\b|\\bwest asia\\b|\\bgreater china\\b|\\banz\\b|\\boceania\\b|\\bmena\\b" +
    "|\\bnordics?\\b|\\bbenelux\\b|\\bdach\\b|\\biberia\\b|\\beurope(?:an)?\\b|\\beu\\b|\\beea\\b|\\bemea\\b|\\bapac\\b|\\basia[- ]pacific\\b|\\blatam\\b|\\blatin america\\b|\\bевроп\\p{L}*",
);
const LOC_REMOTE_ONLY_RE = re(
  "^[\\s\\-–—,/()·]*(?:(?:fully|100%|fully-|entirely)\\s*)?(?:remote|virtual|distributed|home[- ]?based|home office|work from home|wfh|telecommute|telework|удал[её]нн?о|удал[её]нка)" +
    "(?:[\\s\\-–—,/()·]*(?:remote|first|ok|only|friendly|position|role|job|work))*[\\s\\-–—,/()·]*$",
);
const LOC_HYBRID_RE = re("\\bhybrid\\b|\\bon[- ]?site\\b|\\bin[- ]office\\b|\\boffice\\b|\\bгибрид\\p{L}*|\\bофис\\p{L}*");
const KZ_PLACES_SRC =
  "\\bkazakhstan\\b|\\bказахстан\\p{L}*|\\balmaty\\b|\\bалматы\\b|\\bastana\\b|\\bастана\\b|\\bnur-sultan\\b|\\bshymkent\\b|\\bшымкент\\b|\\bkaraganda\\b|\\bкараганд\\p{L}*" +
  "|\\bcentral asia\\b|\\bцентральн\\p{L}* ази\\p{L}*|\\bснг\\b|\\beurasia\\b|\\bевраз\\p{L}*";
/** In a location field every token is a place, CIS included. */
const KZ_TOKENS_RE = re(`${KZ_PLACES_SRC}|\\bcis\\b`);
/**
 * In a title «CIS» is often not a region («CIS Security Engineer»: Center for Internet Security, «CIS Controls»): it counts
 * only in a place context — after a separator («Sales Manager, CIS», «Head of Sales (CIS)») or as «CIS region / markets»,
 * «in / for / across the CIS».
 */
const KZ_TITLE_RE = re(
  `${KZ_PLACES_SRC}|[,(/|–—-]\\s*cis\\b(?!\\s*(?:security|controls?|benchmarks?|compliance|hardening|level))|\\bcis\\s+(?:region|markets?|countries|territory|cluster)\\b|\\b(?:in|for|across|within|covering)\\s+(?:the\\s+)?cis\\b(?!\\s*(?:security|controls?|benchmarks?|compliance|hardening))`,
);
// Role-level sentences that pin a bare-remote posting elsewhere (company blurbs like «remote-first» never count).
const NEG_TEXT_RE = re(
  "(?:must|need to|needs to|required to|have to|should|expected to) be (?:located|based|residing|living|physically located)(?: in| within)" +
    "|only (?:open|available) to (?:candidates|applicants|people)(?: who are)? (?:in|based in|residing in|located in|from)" +
    "|strictly for .{0,40}?based (?:applicants|candidates)|candidates (?:residing|based|located) in|only able to accept applications from|hire[sd]? .{0,30}?exclusively" +
    "|based in (?:latin america|latam)|from latam" +
    "|(?:est|pst|et|pt|pacific|eastern|central|mountain|us) (?:time ?zones?|hours|working hours|business hours).{0,60}?(?:required|must|mandatory)|\\best\\s*[–-]\\s*pst\\b" +
    "|days? (?:a|per) week in the office|site visits|on[- ]site (?:role|position|presence|attendance)|in[- ]office (?:role|position)" +
    "|relocat(?:e|ion) to|relocation (?:is )?required|willing(?:ness)? to relocate" +
    "|native (?:french|arabic|german|japanese|spanish|portuguese|serbian|italian|korean|polish|dutch|ukrainian|mandarin|chinese|turkish|hebrew) (?:speaker|fluency|level|proficiency)",
);
const POS_TEXT_RE = re(
  `${WORLDWIDE_SRC}|from (?:almost )?anywhere|hire[sd]? (?:from )?anywhere|any country|no location restriction|(?:all|any) time ?zones?` +
    "|open to (?:candidates|applicants) (?:worldwide|globally|in any country)",
);
const ASIA_NARROW_RE = re("south[- ]?east asia|\\bsea\\b|\\bapac\\b|\\b(?:singapore|hong kong|japan|taiwan|korea|vietnam|thailand|malaysia|indonesia|philippines|india|china)\\b");
const UTC_BAND_RE = re("(?:utc|gmt)\\s*([+\\-−]\\s*\\d{1,2})(?::\\d\\d)?\\s*(?:to|through|and|-|–|—|\\.\\.)\\s*(?:utc|gmt)\\s*([+\\-−]\\s*\\d{1,2})", "g");
const TZ_REGION_RE = re(
  "\\b(?:apac|amer|latam|noram|us|u\\.s\\.|american|pacific|eastern|central|mountain|est|pst)\\s+(?:time ?zones?|hours|business hours|working hours)" +
    "|(?:location|based|located|reside|residing)\\s+(?:in|within)\\s+(?:apac|amer|latam|us|u\\.s\\.)\\s+time ?zones?" +
    "|\\b(?:us|u\\.s\\.|american) time ?zones?",
);
const HIRE_LIST_RE = re(
  "(?:we |our |the company )?(?:hire|hires|hiring|employ|employs|build(?:ing)? (?:their |our )?remote teams?)(?: only| exclusively| people| talent)?\\s+(?:in|across|from)\\s+([^.;\\n]{3,140})",
  "g",
);
const TITLE_REGION_RE = re("\\b(?:apac|emea|amer|latam|noram|anz)\\b");
const TITLE_INTERN_RE = re("\\bintern(?:ship)?\\b|accelerator program|graduate program|working student");

/** The applicant's offset: Kazakhstan is on a single UTC+5 zone since March 2024. */
const KZ_UTC = 5;

function utcBands(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(UTC_BAND_RE)) {
    const n = (s: string) => Number(s.replace(/\s/g, "").replace("−", "-"));
    const a = n(m[1]), b = n(m[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}
const bandExcludesKz = (text: string) => utcBands(text).some(([lo, hi]) => KZ_UTC < lo || KZ_UTC > hi);

const GEORGIA_RE = re("\\bgeorgia\\b");
function namesAPlace(s: string) {
  return OTHER_RE.test(s) || NA_RE.test(s) || US_STRONG_RE.test(s) || US_LOC_RE.test(s) || US_STATE_RE.test(s) || US_CITY_RE.test(s) || CA_RE.test(s) || UK_STRONG_RE.test(s) || UK_LOC_RE.test(s) || GEORGIA_RE.test(s);
}

function hireListExcludes(text: string) {
  for (const m of text.matchAll(HIRE_LIST_RE)) {
    if (KZ_TOKENS_RE.test(m[1])) return false;
    if (namesAPlace(m[1])) return true;
  }
  return false;
}

/** A place in the title's trailing segment («… (Bulgaria)», «… - Philippines», «… based in Japan»), a regional qualifier, or an internship. */
function titlePin(title: string): string | null {
  const m = /\(([^()]*)\)\s*$|[-–—|]\s*([^-–—|()]{2,48})\s*$/u.exec(title);
  const seg = (m && (m[1] || m[2])) || "";
  if (seg && namesAPlace(seg)) return `title pins a place: «${seg.trim()}»`;
  const m2 = /based in ([a-z ,.'-]{2,40})/u.exec(title);
  if (m2 && namesAPlace(m2[1])) return `title pins a place: «${m2[1].trim()}»`;
  if (TITLE_REGION_RE.test(title)) return "regional qualifier in the title";
  if (TITLE_INTERN_RE.test(title)) return "internships are contracted per country";
  return null;
}

function textPin(text: string): string | null {
  if (NEG_TEXT_RE.test(text)) return "text restricts where the candidate must be";
  if (TZ_REGION_RE.test(text)) return "text requires another region's working hours";
  if (bandExcludesKz(text)) return "UTC band excludes UTC+5";
  if (hireListExcludes(text)) return "company hires only in named countries";
  return null;
}

const EU_CODES = ["DE", "NL", "PL", "ES", "FR", "IE", "PT", "SE", "EE", "LT", "CZ", "AT", "BE", "DK", "FI", "IT"];

/** Best-effort codes for the region a closed role is restricted to (location first, then text). Never empty. */
function pinCodes(loc: string, title: string, text: string): string[] {
  const out = new Set<string>();
  const scan = (s: string, short: boolean) => {
    if (NA_RE.test(s)) { out.add("US"); out.add("CA"); }
    if (US_STRONG_RE.test(s) || US_STATE_RE.test(s) || US_CITY_RE.test(s) || (short && US_LOC_RE.test(s)) || /\b(?:us|u\.s\.|american|pacific|eastern|mountain|est|pst)\s+(?:time ?zones?|hours|business hours|working hours)/iu.test(s) || /\best\s*[–-]\s*pst\b/iu.test(s)) out.add("US");
    if (CA_RE.test(s)) out.add("CA");
    if (UK_STRONG_RE.test(s) || (short && UK_LOC_RE.test(s))) out.add("GB");
    if (re("\\b(?:europe(?:an)?|eu|eea|emea|dach|nordics?|benelux|iberia|cet)\\b|\\bевроп\\p{L}*").test(s) || re(`\\b(?:${EUROPE_WORDS})\\b`).test(s)) EU_CODES.forEach((c) => out.add(c));
    if (re(`\\b(?:apac|asia[- ]pacific|south[- ]?east asia|east asia|south asia|anz|oceania|greater china|${APAC_WORDS})\\b`).test(s)) out.add("APAC");
    if (re(`\\b(?:latam|latin america|south america|central america|${LATAM_WORDS})\\b`).test(s)) out.add("LATAM");
    if (re("\\b(?:mena|middle east|uae|dubai|abu dhabi|saudi|qatar)\\b").test(s)) ["AE", "SA", "QA"].forEach((c) => out.add(c));
  };
  // A UTC window is the weakest hint: only when no place is named anywhere.
  const bands = (s: string) => {
    for (const [lo, hi] of utcBands(s)) {
      if (hi <= -2) { out.add("US"); out.add("CA"); } else if (lo >= 6) out.add("APAC"); else { EU_CODES.forEach((c) => out.add(c)); out.add("GB"); }
    }
  };
  scan(`${loc} ${title}`, true);
  if (!out.size) scan(text, false);
  if (!out.size) bands(`${loc} ${text}`);
  return out.size ? [...out] : ["OTHER"];
}

const verdict = (v: KzVerdict["verdict"], reason: string, extra: Partial<KzVerdict> = {}): KzVerdict => ({ open: v === "open", verdict: v, named: false, pin: [], reason, ...extra });

/**
 * Is the posting open to an applicant living in Kazakhstan?
 * open: names KZ / Almaty / Astana / Central Asia / CIS / Eurasia, or a worldwide / anywhere / global remote role.
 * pinned: a named foreign country, EMEA / APAC / Europe-only, another region's hours, a UTC band without +5, on-site, relocation.
 * unclear: a bare «Remote» whose text says neither (JOBFINDER treated it as closed; callers decide).
 */
export function openFromKazakhstan(job: { title: string; location?: string; description?: string; workplace?: Workplace }): KzVerdict {
  const loc = (job.location ?? "").replace(/[_\s]+/g, " ").trim().toLowerCase();
  const title = (job.title ?? "").toLowerCase();
  const text = `${title} ${(job.description ?? "").slice(0, 6000).toLowerCase()}`;
  const pinned = (reason: string) => verdict("pinned", reason, { pin: pinCodes(loc, title, text) });

  if (KZ_TOKENS_RE.test(loc) || KZ_TITLE_RE.test(title)) return verdict("open", "names Kazakhstan / Central Asia / CIS", { named: true });
  if (job.workplace === "onsite" || job.workplace === "hybrid") return pinned(`${job.workplace} role outside Kazakhstan`);

  if (loc && !LOC_REMOTE_ONLY_RE.test(loc)) {
    if (LOC_SUBREGION_PIN_RE.test(loc)) return pinned("location is a region without Kazakhstan (Europe / EMEA / APAC / LATAM…)");
    if (LOC_HYBRID_RE.test(loc)) return pinned("location requires an office");
    if (bandExcludesKz(loc)) return pinned("UTC band excludes UTC+5");
    if (TZ_REGION_RE.test(loc)) return pinned("location requires another region's working hours");
    const stripped = loc.replace(LOC_BROAD_INCL_ALL, " ");
    if (namesAPlace(stripped)) return pinned("location names another country");
    const tp = titlePin(title) ?? textPin(text);
    if (tp) return pinned(tp);
    if (/\basia\b/u.test(loc)) return ASIA_NARROW_RE.test(text) ? pinned("Asia narrowed to another sub-region") : verdict("open", "Asia-wide role");
    if (re("\\beurasia\\b|\\bcentral asia\\b|\\bcis\\b|\\bснг\\b").test(loc)) return verdict("open", "region includes Kazakhstan", { named: true });
    if (LOC_BROAD_INCL_RE.test(loc) || LOC_WORLDWIDE_RE.test(loc) || WORLDWIDE_RE.test(loc)) return verdict("open", "worldwide / anywhere");
    return pinned("unrecognised location");
  }
  // Bare «Remote» or no location: the text decides, negatives first.
  const tp = titlePin(title) ?? textPin(text);
  if (tp) return pinned(tp);
  if (POS_TEXT_RE.test(text)) return verdict("open", "text says work from anywhere");
  return verdict("unclear", "bare remote, no location stated");
}
