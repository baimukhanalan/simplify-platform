// Part C namespaces (account, money, settings, legal chrome, app shell). One spread in ../kk.ts.
import { legalChromeKk } from "./legal-chrome";
import { shellKk } from "./shell";
import { agentPageKk } from "./agent-page";
import { campaignPageKk } from "./campaign-page";
import { settingsPageKk } from "./settings-page";
import { telegramCardKk } from "./telegram-card";
import { pushCardKk } from "./push-card";
import { pwaKk } from "./pwa";
import { referralPageKk } from "./referral-page";
import { extensionPageKk } from "./extension-page";
import { payPageKk } from "./pay-page";
import { partnersPageKk } from "./partners-page";
import { serverErrorsKk } from "./server-errors";

export const partCKk = {
  legalChrome: legalChromeKk,
  shell: shellKk,
  agentPage: agentPageKk,
  campaignPage: campaignPageKk,
  settingsPage: settingsPageKk,
  telegramCard: telegramCardKk,
  pushCard: pushCardKk,
  pwa: pwaKk,
  referralPage: referralPageKk,
  extensionPage: extensionPageKk,
  payPage: payPageKk,
  partnersPage: partnersPageKk,
  serverErrors: serverErrorsKk,
};
