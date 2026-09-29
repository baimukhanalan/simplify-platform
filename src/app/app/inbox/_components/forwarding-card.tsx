import { ExternalLink, KeyRound, MailPlus } from "lucide-react";
import type { ForwardingStatus } from "@/lib/inbound/service";
import { dismissForwardingCode } from "@/lib/inbound/actions";
import { PROVIDER_RU } from "@/lib/inbound/verify";
import { fmtDateTime } from "@/lib/ops";
import { Chip, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { agoRu } from "../../opportunities/_lib/when";
import { CopyButton, ProviderGuide, RegenerateAlias, type Guide } from "./forwarding-client";

// Words employer mail almost always carries (RU + EN). Used in the provider filters below.
const WORDS_RU = "вакансия, отклик, собеседование, интервью, оффер, резюме";
const WORDS_EN = "interview, application, offer, recruiting, careers";
const GMAIL_QUERY = "{вакансия отклик собеседование интервью оффер резюме interview application offer recruiting careers}";

function guides(address: string): Guide[] {
  return [
    {
      key: "gmail",
      label: "Gmail",
      steps: [
        { text: "Открой Gmail на компьютере → шестерёнка → «Все настройки» → вкладка «Пересылка и POP/IMAP» → «Добавить адрес пересылки». Вставь адрес:", copy: address },
        { text: "Gmail отправит на этот адрес код подтверждения — через минуту он появится прямо в этой карточке. Введи код в Gmail или нажми «Подтвердить в Gmail»." },
        { text: "Пересылать всю почту не нужно. В строке поиска Gmail открой «Показать параметры поиска», в поле «Содержит слова» вставь фильтр и нажми «Создать фильтр»:", copy: GMAIL_QUERY },
        { text: "Отметь «Переслать» → выбери свой адрес Simplify → «Создать фильтр». Готово: письма работодателей будут приходить сюда сами." },
      ],
      note: "Можно и проще — в «Пересылке и POP/IMAP» включить «Пересылать копии входящих сообщений» на этот адрес. Рассылки и спам агент отсеет сам: они не меняют статусы заявок.",
    },
    {
      key: "outlook",
      label: "Outlook",
      steps: [
        { text: "Открой Outlook в браузере → шестерёнка «Параметры» → «Почта» → «Правила» → «Добавить новое правило». Назови правило, например «Simplify»." },
        { text: `Условие: «Тема или текст содержат» — добавь слова: ${WORDS_RU}, ${WORDS_EN}.` },
        { text: "Действие: «Переслать» → вставь адрес и нажми «Сохранить»:", copy: address },
      ],
      note: "Outlook не просит подтверждать адрес. Если он пишет, что пересылка на внешние адреса запрещена — это ограничение рабочей почты организации; настрой пересылку с личного ящика.",
    },
    {
      key: "mailru",
      label: "Mail.ru",
      steps: [
        { text: "Открой Почту Mail.ru → «Настройки» → «Фильтры» → «Добавить фильтр»." },
        { text: `Условие: «Тема» содержит — добавь по одному через «или»: ${WORDS_RU}, ${WORDS_EN}.` },
        { text: "Действие: «Переслать копию письма на адрес» → вставь адрес и сохрани:", copy: address },
        { text: "Mail.ru попросит подтвердить пересылку — письмо со ссылкой придёт на этот адрес и появится в этой карточке. Открой ссылку, и фильтр заработает." },
      ],
    },
    {
      key: "yandex",
      label: "Яндекс",
      steps: [
        { text: "Открой Яндекс Почту → шестерёнка → «Все настройки» → «Правила обработки писем» → «Создать правило»." },
        { text: `Если: «Тема» содержит — добавь условия через «или»: ${WORDS_RU}, ${WORDS_EN}.` },
        { text: "Действие: «Переслать по адресу» → вставь адрес → «Создать правило»:", copy: address },
        { text: "Яндекс пришлёт на этот адрес письмо со ссылкой подтверждения — она появится в этой карточке. Открой её, чтобы включить правило." },
      ],
    },
  ];
}

/** «Пересылка писем»: the personal forwarding address, its status and set-up instructions per mail provider. */
export function ForwardingCard({ status }: { status: ForwardingStatus }) {
  const { address, lastAt, verification: v } = status;
  const working = status.state === "simulated" || Boolean(lastAt);
  const addrId = "forwarding-address";
  const codeId = "forwarding-code";
  return (
    <section aria-labelledby="forwarding-title" className={cx("flex flex-col gap-5 p-5 sm:p-6", v ? "glass-strong" : "glass")}>
      <div className="flex items-start gap-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full border border-stroke bg-white text-teal">
          <MailPlus className="size-[18px]" strokeWidth={1.7} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="forwarding-title" className="text-[15.5px] font-medium text-head">Пересылка писем</h2>
            {v ? (
              <Chip tone="amber" dot>Нужно подтвердить</Chip>
            ) : working ? (
              <Chip tone="green" dot>Работает</Chip>
            ) : (
              <Chip tone="amber">Ждём первое письмо</Chip>
            )}
          </div>
          <p className="text-[13.5px] text-ink-3">
            {working ? (
              lastAt ? (
                <>Последнее письмо — <time dateTime={lastAt.toISOString()} title={fmtDateTime(lastAt)}>{agoRu(lastAt)}</time>. Письма работодателей приходят сюда сами, агент разбирает каждое.</>
              ) : (
                <>Письма работодателей приходят сюда сами, агент разбирает каждое.</>
              )
            ) : (
              <>Настрой в своей почте пересылку на этот адрес — ответы работодателей будут появляться здесь сами, и агент будет двигать заявки.</>
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="label !text-[11px]">Твой адрес для пересылки</span>
        <div className="flex flex-wrap items-center gap-2">
          <code id={addrId} className="min-w-0 flex-1 basis-56 break-all rounded-2xl border border-line bg-white/80 px-4 py-2.5 font-mono text-[14px] text-head">{address}</code>
          <CopyButton value={address} targetId={addrId} label="Скопировать адрес" />
        </div>
        <RegenerateAlias />
      </div>

      {v && (
        <div role="status" className="flex flex-col gap-3 rounded-2xl border border-amber/20 bg-amber-soft/50 p-4">
          <div className="flex items-start gap-2.5">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={1.8} aria-hidden />
            <p className="text-[13.5px] text-ink-2">
              {PROVIDER_RU[v.provider]} прислал{v.provider === "yandex" || v.provider === "mailru" ? "а" : ""} подтверждение пересылки{v.requester ? <> для <span className="break-all text-head">{v.requester}</span></> : null}
              {" "}<time dateTime={v.at.toISOString()} className="text-ink-3">{agoRu(v.at)}</time>.{" "}
              {v.code ? "Введи код в настройках пересылки" : "Открой ссылку, чтобы включить пересылку"}
              {v.code && v.link ? " или подтверди по ссылке." : "."}
            </p>
          </div>
          {v.code && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="label !text-[11px]">Код подтверждения</span>
              <code id={codeId} className="num rounded-xl border border-line bg-white px-3.5 py-1.5 font-mono text-[20px] tracking-[.12em] text-head">{v.code}</code>
              <CopyButton value={v.code} targetId={codeId} label="Скопировать код" />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {v.link && (
              <a href={v.link} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full bg-cta px-4 text-[13.5px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
                {v.provider === "gmail" ? "Подтвердить в Gmail" : "Открыть ссылку подтверждения"}<ExternalLink className="size-4" aria-hidden /><span className="sr-only"> (откроется в новой вкладке)</span>
              </a>
            )}
            <form action={dismissForwardingCode}>
              <SubmitButton variant="ghost" size="sm" pendingText="Скрываем…">Готово, подтверждено</SubmitButton>
            </form>
          </div>
        </div>
      )}

      <details className="group" open={!working && !v ? true : undefined}>
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded text-[13px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Как настроить пересылку</span><span className="hidden group-open:inline">Скрыть инструкцию</span>
        </summary>
        <div className="mt-3">
          <ProviderGuide guides={guides(address)} />
        </div>
      </details>
    </section>
  );
}
