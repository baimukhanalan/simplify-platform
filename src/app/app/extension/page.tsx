import type { Metadata } from "next";
import { Check, Download, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { revokeExtensionToken } from "@/lib/actions/extension";
import { Card, Chip, Label, PageHeader, Script } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { TokenPanel } from "./_components/token-panel";

export const metadata: Metadata = { title: "Расширение Apply Assist" };

const DOES = [
  "Узнаёт вакансию из твоего Simplify по адресу страницы и подтягивает её пакет.",
  "Заполняет имя, email, телефон, город, LinkedIn, GitHub и портфолио из твоего профиля.",
  "Прикрепляет ту самую версию CV, которую агент подготовил под эту вакансию, и вставляет сопроводительное письмо.",
  "Отвечает на знакомые скрининг-вопросы — только готовыми или одобренными тобой ответами.",
  "Подсвечивает, что заполнено, и показывает список того, что нужно проверить.",
];
const DOESNT = [
  "Никогда не нажимает «Отправить» — это делаешь ты, сам.",
  "Не заполняет деликатные и юридические вопросы (пол, раса, инвалидность, судимость, согласия) — только подсвечивает их.",
  "Не работает в фоне и не трогает страницу без твоего клика «Заполнить форму».",
  "Не обходит капчи, не прячет автоматизацию и не читает другие вкладки.",
];
const WHERE = ["Greenhouse", "Lever", "Ashby", "Workable", "hh.kz · отклик", "Обычные формы"];

const STEPS = [
  { t: "Скачай архив", d: <>Кнопка ниже собирает свежую версию расширения. Распакуй архив — появится папка <span className="font-mono text-head">simplify-apply-assist</span>.</> },
  { t: "Открой chrome://extensions", d: <>Вставь адрес <span className="font-mono text-head">chrome://extensions</span> в строку браузера (Chrome, Edge, Brave, Arc) и включи «Режим разработчика» справа сверху.</> },
  { t: "Загрузи распакованное расширение", d: <>Нажми «Загрузить распакованное расширение» и выбери папку <span className="font-mono text-head">simplify-apply-assist</span>. Закрепи значок Simplify на панели.</> },
  { t: "Вставь ключ", d: <>Создай ключ справа, открой настройки расширения (правый клик по значку → «Параметры») и вставь его. Адрес Simplify менять не нужно.</> },
  { t: "Подай заявку", d: <>Открой официальную форму вакансии из Simplify, нажми на значок → «Заполнить форму», проверь поля и отправь сам. Затем — «Заявка отправлена» в расширении.</> },
];

function when(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" });
}

export default async function ExtensionPage() {
  const user = await requireUser();
  const integ = await db.integration.findUnique({ where: { userId_provider: { userId: user.id, provider: "extension" } }, select: { tokenHash: true, meta: true } });
  const connected = Boolean(integ?.tokenHash);
  const meta = j<{ createdAt?: string; lastUsedAt?: string }>(integ?.meta, {});

  return (
    <>
      <PageHeader
        eyebrow="Apply Assist · расширение"
        title={<>Форма заполнится <Script>сама</Script> — отправляешь ты</>}
        sub="Расширение для браузера берёт твой пакет из Simplify — профиль, CV под вакансию, письмо и одобренные ответы — и заполняет официальную форму работодателя. Кнопку «Отправить» нажимаешь только ты."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="flex flex-col gap-4">
              <h2 className="label">Что делает</h2>
              <ul className="flex flex-col gap-3">
                {DOES.map((t) => (
                  <li key={t} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2">
                    <Check className="mt-1 size-4 shrink-0 text-green" strokeWidth={2} aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="flex flex-col gap-4">
              <h2 className="label">Чего не делает</h2>
              <ul className="flex flex-col gap-3">
                {DOESNT.map((t) => (
                  <li key={t} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2">
                    <X className="mt-1 size-4 shrink-0 text-rose" strokeWidth={2} aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="flex flex-col gap-3">
            <h2 className="label">Где работает</h2>
            <div className="flex flex-wrap gap-2">
              {WHERE.map((w) => <Chip key={w} tone={w === "Обычные формы" ? "neutral" : "green"}>{w}</Chip>)}
            </div>
            <p className="text-[13px] leading-relaxed text-ink-3">
              На сайтах вне списка расширение заполняет только контакты и ссылки по названиям полей. На hh.kz резюме выбирается из твоих резюме на hh — расширение вставит письмо и ответы.
            </p>
          </Card>

          <Card strong className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="h-serif text-[24px]">Установка за две минуты</h2>
              <a
                href="/api/extension/download"
                download
                className="inline-flex h-11 items-center justify-center gap-2 self-start rounded-full bg-cta px-5 text-[14.5px] font-medium text-[#fcfcfc] shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green active:scale-[.98]"
              >
                <Download className="size-4" strokeWidth={1.7} aria-hidden />
                Скачать расширение (.zip)
              </a>
            </div>
            <ol className="flex flex-col gap-4">
              {STEPS.map((s, i) => (
                <li key={s.t} className="flex gap-4">
                  <span className="num grid size-8 shrink-0 place-items-center rounded-full bg-mint text-[14px] text-head">{i + 1}</span>
                  <div className="flex flex-col gap-1 pt-1">
                    <div className="text-[15px] font-medium text-head">{s.t}</div>
                    <p className="text-[13.5px] leading-relaxed text-ink-2">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-6 lg:sticky lg:top-6">
          <Card strong className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="label">Ключ расширения</h2>
              <Chip tone={connected ? "green" : "neutral"} dot>{connected ? "Подключено" : "Не подключено"}</Chip>
            </div>
            {connected ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
                <dt className="text-ink-3">Создан</dt>
                <dd className="text-head">{when(meta.createdAt) ?? "—"}</dd>
                <dt className="text-ink-3">Последнее использование</dt>
                <dd className="text-head">{when(meta.lastUsedAt) ?? "ещё не использовался"}</dd>
              </dl>
            ) : (
              <p className="text-[14px] leading-relaxed text-ink-2">Ключ связывает расширение с твоим аккаунтом. Он даёт доступ только к данным для заявок: профилю, пакетам и CV.</p>
            )}
            <TokenPanel connected={connected} />
            {connected && (
              <form action={revokeExtensionToken} className="border-t border-line pt-4">
                <SubmitButton variant="ghost" size="sm" pendingText="Отзываем…" className="!h-10 !px-0 text-rose hover:!bg-transparent hover:underline">
                  Отозвать ключ
                </SubmitButton>
                <p className="mt-1 text-[12.5px] text-ink-3">Расширение сразу потеряет доступ к твоему аккаунту.</p>
              </form>
            )}
          </Card>

          <Card className="flex flex-col gap-2.5">
            <Label>Почему так</Label>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              Работодатели ждут заявку от живого человека. Simplify готовит всё заранее, а последний шаг — проверить и отправить — остаётся за тобой. Так заявка честная и точно твоя.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
