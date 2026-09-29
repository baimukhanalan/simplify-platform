// Legal chrome: document names, footer, inline document links, the in-app acceptance banner and the legal page frame.
// The documents' own text (src/app/{offer,terms,privacy,consent,refund}/content.ts) stays Russian: it is the legally
// binding version; kk/en readers see `bindingNote` above it.
export const legalChromeRu = {
  docs: {
    offer: { title: "Публичная оферта", short: "Оферта", description: "Договор возмездного оказания услуг Simplify: тарифы, оплата через Kaspi Pay, гарантия, реферальная программа, возвраты." },
    terms: { title: "Пользовательское соглашение", short: "Соглашение", description: "Правила использования сервиса Simplify: аккаунт, работа ИИ-агента, Copilot, оплата и ответственность." },
    privacy: { title: "Политика конфиденциальности", short: "Конфиденциальность", description: "Как Simplify собирает, использует, хранит и защищает персональные данные — по Закону РК «О персональных данных и их защите»." },
    consent: { title: "Согласие на обработку персональных данных", short: "Согласие на обработку ПД", description: "Текст согласия на сбор и обработку персональных данных пользователя Simplify." },
    refund: { title: "Политика возврата", short: "Возврат", description: "Когда и как вернуть деньги за кампанию Simplify, оплаченную через Kaspi Pay." },
  },
  eyebrow: "Документы Simplify",
  edition: "Редакция от {date} · {city}",
  city: "г. Алматы",
  bindingNote: "Документ действует на русском языке",
  toc: "Содержание",
  docsNav: "Документы",
  footerNav: "Правовые документы",
  newTab: "(откроется в новой вкладке)",
  links: "<terms>пользовательское соглашение</terms> и <privacy>политику конфиденциальности</privacy>",
  offerAcceptance: "Оплачивая, ты принимаешь условия <offer>публичной оферты</offer>.",
  banner: {
    title: "Мы обновили документы.",
    text: "Подтверди, что принимаешь <terms>пользовательское соглашение</terms> и даёшь <consent>согласие на обработку персональных данных</consent> по <privacy>политике конфиденциальности</privacy>.",
    error: "Не получилось сохранить — попробуй ещё раз.",
    saving: "Сохраняем…",
    accept: "Принимаю",
  },
};
