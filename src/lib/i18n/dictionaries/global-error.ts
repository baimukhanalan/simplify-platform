// The root error screen's copy lives in its own tiny module: global-error.tsx replaces the root layout (no provider,
// no server), so it imports these three objects directly instead of a whole dictionary.
export const globalErrorRu = {
  title: "Simplify временно недоступен",
  text: "Попробуй обновить страницу через минуту.",
  retry: "Обновить",
};
export type GlobalErrorMessages = typeof globalErrorRu;
export const globalErrorKk: GlobalErrorMessages = {
  title: "Simplify уақытша қолжетімсіз",
  text: "Бір минуттан кейін бетті жаңартып көр.",
  retry: "Жаңарту",
};
export const globalErrorEn: GlobalErrorMessages = {
  title: "Simplify is temporarily unavailable",
  text: "Try refreshing the page in a minute.",
  retry: "Refresh",
};
