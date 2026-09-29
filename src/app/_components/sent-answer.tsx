import { answerRu } from "@/lib/engine/autonomy";

/**
 * A form answer as the user reads it (Russian), with the exact text the employer received kept visible
 * when it differs — e.g. «Предпочитаю не отвечать» · работодатель видит: I prefer not to answer.
 */
export function SentAnswer({ answer }: { answer: string }) {
  const ru = answerRu(answer);
  // Yes / No translate one-to-one — only a phrase the employer reads differently (the opt-out) gets the note.
  if (ru === answer || /^(yes|no)$/i.test(answer.trim())) return <>{ru}</>;
  return (
    <>
      {ru}
      <span className="mt-0.5 block text-[12.5px] text-ink-3">
        работодатель видит: <span lang="en">{answer}</span>
      </span>
    </>
  );
}
