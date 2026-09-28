import { regionRu } from "../../../_components/ru";

/** In the goal the WORLD region sits next to the «Удалённо» work format — name it distinctly here (REGION_RU stays shared). */
export const goalRegion = (k: string) => (k.toUpperCase() === "WORLD" ? "Весь мир (удалённо)" : regionRu(k));
