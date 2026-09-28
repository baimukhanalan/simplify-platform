import { currentUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/engine/agent";

/** GDPR-style data export: every record owned by the signed-in user, as a JSON download. */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, role: true, careerMode: true, referredByCode: true, consents: true, createdAt: true,
      profile: true,
      goal: true,
      facts: { orderBy: { createdAt: "asc" } },
      miniAnswers: { orderBy: { createdAt: "asc" } },
      stories: { orderBy: { createdAt: "asc" } },
      campaigns: {
        orderBy: { createdAt: "asc" },
        include: { opportunities: { include: { job: true, pkg: true } } },
      },
      payments: { orderBy: { createdAt: "asc" } },
      approvals: { orderBy: { createdAt: "asc" } },
      inbox: { orderBy: { receivedAt: "asc" } },
      interviews: { orderBy: { createdAt: "asc" }, include: { mocks: true } },
      offers: { orderBy: { createdAt: "asc" } },
      snapshots: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!user) return Response.json({ error: "not found" }, { status: 404 });

  await logEvent(userId, "data_export", "Экспорт данных скачан");
  const stamp = new Date().toISOString().slice(0, 10);
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), format: "simplify-export/v1", user }, null, 2);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="simplify-export-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
