// Fact kinds as the profile editors list them (plain data: shared by the server list and the client editors).
export const FACT_KIND_OPTIONS = [
  { key: "employment", label: "Опыт работы" },
  { key: "education", label: "Образование" },
  { key: "project", label: "Проекты" },
  { key: "certification", label: "Сертификаты" },
  { key: "achievement", label: "Достижения" },
  { key: "authorization", label: "Право на работу" },
  { key: "language", label: "Языки" },
  { key: "skill", label: "Навыки" },
] as const;
