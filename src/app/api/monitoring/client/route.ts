import { handleClientReport } from "@/lib/monitoring/client-report";

/** Error-boundary reports from the browser (src/lib/monitoring/client.ts). Public, same-origin, rate-limited. */
export async function POST(req: Request) {
  return handleClientReport(req);
}
