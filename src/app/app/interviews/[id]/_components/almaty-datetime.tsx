"use client";
import { useState } from "react";

/** Almaty is UTC+5 all year (Kazakhstan has had one time zone and no DST since 2024). */
const ALMATY_OFFSET = "+05:00";

/**
 * A date-time the user types as Almaty wall-clock time, whatever the browser's own zone is. The visible
 * datetime-local field has no name; the hidden `name` field carries the same moment with an explicit offset
 * («2026-10-01T15:00:00+05:00»), so the server stores exactly what was chosen. Empty stays empty.
 */
export function AlmatyDateTimeInput({ name, id, className, describedBy }: { name: string; id?: string; className?: string; describedBy?: string }) {
  const [local, setLocal] = useState("");
  return (
    <>
      <input id={id} type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} className={className} aria-describedby={describedBy} />
      <input type="hidden" name={name} value={local ? `${local.length === 16 ? `${local}:00` : local}${ALMATY_OFFSET}` : ""} />
    </>
  );
}
