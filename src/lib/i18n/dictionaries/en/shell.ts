import type { shellRu } from "../ru/shell";

export const shellEn: typeof shellRu = {
  notifier: {
    grantedTitle: "System notifications are on: interviews, assessments and offers",
    granted: "Notifications on",
    denied: "Notifications are blocked in your browser settings",
    enable: "Get interview alerts",
  },
  moment: {
    kind: {
      interviewEyebrow: "New interview",
      interviewHeadline: "INTERVIEW",
      assessmentEyebrow: "Take-home assignment",
      assessmentHeadline: "You're through to the next stage",
      offerEyebrow: "Offer",
      offerHeadline: "YOU GOT THE OFFER",
      hiredEyebrow: "New job",
      hiredHeadline: "HIRED.",
    },
    more: "{n, plural, one {# more notification} other {# more notifications}}",
    when: "{date}, {time}",
    deadline: "Deadline: {date}, by {time}",
    cta: {
      interview: "Prepare",
      assessment: "Prepare",
      offer: "View offer",
      hired: "Open Career",
    },
    dismissAria: "Dismiss notification",
    dismiss: "Dismiss",
  },
  offline: {
    docTitle: "No connection · Simplify",
    title: "No connection",
    text: "Check your internet — the page will open by itself as soon as you're back online. Meanwhile, the Agent keeps working.",
    reload: "Reload",
  },
};
