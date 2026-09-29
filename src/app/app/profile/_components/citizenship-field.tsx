"use client";
import { useRef, useState } from "react";
import { Field } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

const OTHER = "__other";

/**
 * Citizenship: a select of common countries plus «Другое», which reveals a labelled, required text field.
 * Whichever control is active carries name="citizenship" — the action (updateConstraints) reads that one field
 * and accepts only a two-letter ISO code, so the free-text field asks for exactly that.
 */
export function CitizenshipField({ defaultValue, options }: { defaultValue: string; options: [string, string][] }) {
  const t = useT();
  const initial = (defaultValue || "KZ").toUpperCase();
  const known = options.some(([k]) => k === initial);
  const [other, setOther] = useState(!known);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-3">
      <Field label={t("profilePage.constraints.citizenship")}>
        <select
          name={other ? undefined : "citizenship"}
          defaultValue={known ? initial : OTHER}
          onChange={(e) => {
            const isOther = e.target.value === OTHER;
            setOther(isOther);
            if (isOther) requestAnimationFrame(() => input.current?.focus());
          }}
          className="field"
        >
          {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          <option value={OTHER}>{t("profilePage.constraints.other")}</option>
        </select>
      </Field>
      {other && (
        <Field label={t("profilePage.constraints.codeLabel")} hint={t("profilePage.constraints.codeHint")}>
          <input
            ref={input}
            name="citizenship"
            required
            minLength={2}
            maxLength={2}
            pattern="[A-Za-z]{2}"
            title={t("profilePage.constraints.codeTitle")}
            autoComplete="country"
            defaultValue={known ? "" : initial}
            className="field uppercase"
          />
        </Field>
      )}
    </div>
  );
}
