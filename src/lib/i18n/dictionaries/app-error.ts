// The /app error screen's copy (src/app/app/error.tsx) lives in its own tiny module: that client boundary imports these
// three objects directly, so no page has to ship the «errors» namespace to the browser just in case something breaks.
// The dictionaries spread the same objects into «errors», so server code and key checks still see them there.
export const appErrorRu = {
  appEyebrow: "Что-то пошло не так",
  appTitle: "Экран не загрузился",
  appText: "Агент при этом продолжает работать. Попробуй ещё раз — если не поможет, вернись в Today.",
  code: "Код: {digest}",
  retry: "Повторить",
  toToday: "В Today",
};
export type AppErrorMessages = typeof appErrorRu;
export const appErrorKk: AppErrorMessages = {
  appEyebrow: "Бірдеңе дұрыс болмады",
  appTitle: "Бет жүктелмеді",
  appText: "Агент бұл уақытта жұмысын жалғастыруда. Қайталап көр — көмектеспесе, Today-ге орал.",
  code: "Коды: {digest}",
  retry: "Қайталау",
  toToday: "Today-ге",
};
export const appErrorEn: AppErrorMessages = {
  appEyebrow: "Something went wrong",
  appTitle: "This screen didn't load",
  appText: "The agent keeps working meanwhile. Try again — if that doesn't help, go back to Today.",
  code: "Code: {digest}",
  retry: "Try again",
  toToday: "To Today",
};
