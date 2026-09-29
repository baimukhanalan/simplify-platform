// Part C namespaces (account, money, settings, legal chrome, app shell). One spread in ../ru.ts.
import { legalChromeRu } from "./legal-chrome";
import { shellRu } from "./shell";
import { agentPageRu } from "./agent-page";
import { campaignPageRu } from "./campaign-page";
import { settingsPageRu } from "./settings-page";
import { telegramCardRu } from "./telegram-card";
import { pushCardRu } from "./push-card";
import { pwaRu } from "./pwa";
import { referralPageRu } from "./referral-page";
import { extensionPageRu } from "./extension-page";
import { payPageRu } from "./pay-page";
import { partnersPageRu } from "./partners-page";
import { serverErrorsRu } from "./server-errors";

export const partCRu = {
  legalChrome: legalChromeRu,
  shell: shellRu,
  agentPage: agentPageRu,
  campaignPage: campaignPageRu,
  settingsPage: settingsPageRu,
  telegramCard: telegramCardRu,
  pushCard: pushCardRu,
  pwa: pwaRu,
  referralPage: referralPageRu,
  extensionPage: extensionPageRu,
  payPage: payPageRu,
  partnersPage: partnersPageRu,
  serverErrors: serverErrorsRu,
};
