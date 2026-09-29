import type { shellRu } from "../ru/shell";

export const shellKk: typeof shellRu = {
  notifier: {
    grantedTitle: "Жүйелік хабарламалар қосулы: интервью, assessment және офферлер",
    granted: "Хабарламалар қосулы",
    denied: "Хабарламалар браузер баптауларында бұғатталған",
    enable: "Интервью туралы хабарла",
  },
  moment: {
    kind: {
      interviewEyebrow: "Жаңа интервью",
      interviewHeadline: "INTERVIEW",
      assessmentEyebrow: "Үй тапсырмасы",
      assessmentHeadline: "Сен келесі кезеңдесің",
      offerEyebrow: "Оффер",
      offerHeadline: "YOU GOT THE OFFER",
      hiredEyebrow: "Жаңа жұмыс",
      hiredHeadline: "HIRED.",
    },
    more: "тағы {n, plural, other {# хабарлама}}",
    when: "{date}, {time}",
    deadline: "Мерзімі: {date}, {time} дейін",
    cta: {
      interview: "Prepare",
      assessment: "Prepare",
      offer: "Офферді көру",
      hired: "Career ашу",
    },
    dismissAria: "Хабарламаны жасыру",
    dismiss: "Жасыру",
  },
  offline: {
    docTitle: "Байланыс жоқ · Simplify",
    title: "Байланыс жоқ",
    text: "Интернетті тексер — байланыс қалпына келген бойда бет өзі ашылады. Агент осы уақытта жұмысын жалғастырып жатыр.",
    reload: "Жаңарту",
  },
};
