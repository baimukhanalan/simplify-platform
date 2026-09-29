import type { legalChromeRu } from "../ru/legal-chrome";

export const legalChromeEn: typeof legalChromeRu = {
  docs: {
    offer: { title: "Public offer", short: "Offer", description: "Simplify's service agreement: plans, payment via Kaspi Pay, the guarantee, the referral program and refunds." },
    terms: { title: "Terms of use", short: "Terms", description: "The rules for using Simplify: your account, how the AI agent works, Copilot, payment and liability." },
    privacy: { title: "Privacy policy", short: "Privacy", description: "How Simplify collects, uses, stores and protects personal data under the Law of the Republic of Kazakhstan on personal data and its protection." },
    consent: { title: "Consent to personal data processing", short: "Data processing consent", description: "The text of the consent to the collection and processing of a Simplify user's personal data." },
    refund: { title: "Refund policy", short: "Refunds", description: "When and how to get your money back for a Simplify campaign paid via Kaspi Pay." },
  },
  eyebrow: "Simplify documents",
  edition: "Version of {date} · {city}",
  city: "Almaty",
  bindingNote: "This document is legally binding in Russian",
  toc: "Contents",
  docsNav: "Documents",
  footerNav: "Legal documents",
  newTab: "(opens in a new tab)",
  links: "<terms>terms of use</terms> and <privacy>privacy policy</privacy>",
  offerAcceptance: "By paying, you accept the terms of the <offer>public offer</offer>.",
  banner: {
    title: "We've updated our documents.",
    text: "Confirm that you accept the <terms>terms of use</terms> and give your <consent>consent to personal data processing</consent> under the <privacy>privacy policy</privacy>.",
    error: "Couldn't save — please try again.",
    saving: "Saving…",
    accept: "I accept",
  },
};
