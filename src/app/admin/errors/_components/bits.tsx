import { Chip, type Tone } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { resolveError } from "../actions";

const SOURCE: Record<string, Tone> = { server: "dark", action: "teal", client: "neutral", cron: "amber" };

export function SourceChips({ source, level, reopened }: { source: string; level: string; reopened?: boolean }) {
  return (
    <>
      <Chip tone={SOURCE[source] ?? "neutral"}>{source}</Chip>
      {level === "warning" && <Chip tone="amber">warning</Chip>}
      {reopened && <Chip tone="rose">повтор</Chip>}
    </>
  );
}

export function ResolveButton({ id, small }: { id: string; small?: boolean }) {
  return (
    <form action={resolveError}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton size={small ? "sm" : "md"} variant="glass" pendingText="Сохраняю…" aria-label="Отметить ошибку как решённую">Решено</SubmitButton>
    </form>
  );
}
