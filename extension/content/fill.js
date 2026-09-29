// Simplify Apply Assist — form filler. Injected ONLY when the user clicks «Заполнить форму» in the popup (activeTab).
// Fills empty fields from the user's own Simplify data, highlights what it touched, and reports what needs the user.
// It never clicks Submit or any button, never ticks consent boxes, and never answers sensitive / legal / EEO questions.
(() => {
  "use strict";
  if (typeof window.__simplifyFill === "function") return;

  const GREEN = "#1a6e48";
  const AMBER = "#c48c1e";
  const MARK = "data-simplify-mark";

  // EEO / legal / consent wording: never filled, always handed to the user.
  const SENSITIVE = /\b(gender|sex|pronouns?|race|racial|ethnic(ity)?|hispanic|latin[oa]x?|veteran|disabilit(y|ies)|sexual orientation|transgender|lgbt\w*|religio(n|us)|date of birth|birth ?date|\bdob\b|marital|criminal|convict(ed|ion)?|felony|misdemeanou?r|background check|drug (test|screen)|self[- ]identif\w*|consent|certify|attest|acknowledg\w*|signature|social security|\bssn\b|passport|national id|privacy (policy|notice)|terms (and|&) conditions|gdpr|i agree|agree to)\b|(^|[^а-яё])пол([^а-яё]|$)|национальност|инвалидност|судимост|вероисповедан|дата рождения|соглас(ие|ен|на)|персональн\w* данн/i;

  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const low = (s) => norm(s).toLowerCase();

  // ——— labels ———
  function textOf(node) {
    return node ? norm(node.innerText || node.textContent || "") : "";
  }
  /** The human question for a control: <label for>, wrapping label, aria, the nearest field-group heading, placeholder. */
  function questionOf(el) {
    const bits = [];
    if (el.id) {
      try {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) bits.push(textOf(lab));
      } catch { /* bad id */ }
    }
    const wrap = el.closest("label");
    if (wrap) bits.push(textOf(wrap));
    const al = el.getAttribute("aria-label");
    if (al) bits.push(al);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) for (const id of lb.split(/\s+/)) { const n = document.getElementById(id); if (n) bits.push(textOf(n)); }
    if (!bits.length) {
      let cur = el.parentElement;
      for (let hop = 0; cur && hop < 5; hop++, cur = cur.parentElement) {
        const q = cur.querySelector("label, legend, [class*='label' i], [class*='question' i], [class*='title' i]");
        if (q && !q.contains(el) && textOf(q)) { bits.push(textOf(q)); break; }
      }
    }
    const ph = el.getAttribute("placeholder");
    if (ph) bits.push(ph);
    return norm(bits.join(" · ")).slice(0, 300);
  }
  /** Radio/checkbox group question: fieldset legend or the heading of the smallest container holding the group. */
  function groupQuestion(el) {
    const fs = el.closest("fieldset");
    if (fs) { const lg = fs.querySelector("legend"); if (lg && textOf(lg)) return textOf(lg); }
    if (!el.name) return questionOf(el);
    let cur = el.parentElement;
    for (let hop = 0; cur && hop < 7; hop++, cur = cur.parentElement) {
      let n = 0;
      try { n = cur.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`).length; } catch { n = 0; }
      if (n > 1) {
        const q = cur.querySelector("legend, label:not(:has(input)), [class*='label' i], [class*='question' i], h3, h4");
        if (q && textOf(q)) return textOf(q);
        return (textOf(cur).split("\n")[0] || "").slice(0, 200);
      }
    }
    return questionOf(el);
  }
  function optionLabel(el) {
    const wrap = el.closest("label");
    if (wrap && textOf(wrap)) return low(textOf(wrap));
    if (el.id) { try { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return low(textOf(l)); } catch { /* bad id */ } }
    return low(el.getAttribute("aria-label") || el.value || "");
  }
  const shortName = (q) => { const t = norm(q).replace(/\s*[*·:]\s*$/, ""); return t.length > 70 ? `${t.slice(0, 67)}…` : t || "Поле"; };

  // ——— visibility / setters ———
  function visible(el) {
    if (el.type === "file") return true; // ATS hide the real file input behind a drop zone
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  }
  function setText(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus({ preventScroll: true });
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  function pickOption(options, want) {
    const w = low(want);
    if (!w) return null;
    const yes = /^(yes|да)\b/.test(w), no = /^(no|нет)\b/.test(w);
    let best = null;
    for (const o of options) {
      const t = low(o.text);
      if (!t) continue;
      if (t === w) return o;
      if (yes && /^(yes|да)\b/.test(t)) return o;
      if (no && /^(no|нет)\b/.test(t)) return o;
      if (!best && w.length >= 3 && (t.includes(w) || (t.length >= 3 && w.includes(t)))) best = o;
    }
    return best;
  }
  function setSelect(el, want) {
    const opts = [...el.options].map((o) => ({ el: o, text: o.textContent || "" })).filter((o) => o.el.value !== "");
    const hit = pickOption(opts, want);
    if (!hit) return false;
    el.value = hit.el.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // ——— highlight (visible, removable) ———
  function mark(el, tone, title) {
    const target = el.type === "file" ? el.closest("[class*='upload' i], [class*='drop' i], label, div") || el : el;
    if (!target.hasAttribute(MARK)) target.setAttribute("data-simplify-prev", target.getAttribute("style") || "");
    target.setAttribute(MARK, tone);
    target.style.outline = `2px solid ${tone === "ok" ? GREEN : AMBER}`;
    target.style.outlineOffset = "2px";
    target.style.borderRadius = target.style.borderRadius || "6px";
    if (tone !== "ok") target.style.backgroundColor = "rgba(196, 140, 30, 0.10)";
    if (title) target.title = `Simplify: ${title}`;
  }
  function clearMarks() {
    for (const n of document.querySelectorAll(`[${MARK}]`)) {
      const prev = n.getAttribute("data-simplify-prev");
      if (prev) n.setAttribute("style", prev); else n.removeAttribute("style");
      n.removeAttribute(MARK);
      n.removeAttribute("data-simplify-prev");
      if (/^Simplify: /.test(n.title)) n.removeAttribute("title");
    }
    const b = document.getElementById("simplify-assist-banner");
    if (b) b.remove();
  }
  function banner(filled, attention) {
    if (window.top !== window) return;
    const b = document.createElement("div");
    b.id = "simplify-assist-banner";
    b.setAttribute("role", "status");
    Object.assign(b.style, {
      position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647", maxWidth: "340px", padding: "12px 14px",
      background: "#fff", color: "#233b3b", border: "1px solid rgba(35,59,59,.18)", borderRadius: "14px",
      boxShadow: "0 12px 32px -12px rgba(35,59,59,.35)", font: "13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    });
    const t = document.createElement("div");
    t.textContent = `Simplify заполнил полей: ${filled}. Проверь: ${attention}. Отправляешь заявку ты — кнопкой на этой странице.`;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "Скрыть подсветку";
    Object.assign(x.style, { marginTop: "8px", border: "1px solid rgba(35,59,59,.2)", background: "#fff", borderRadius: "999px", padding: "4px 12px", cursor: "pointer", font: "inherit", color: "#233b3b" });
    x.addEventListener("click", clearMarks);
    b.append(t, x);
    document.documentElement.append(b);
  }

  // ——— package answers: fuzzy match by question wording ———
  const STOP = new Set("the a an and or of to in on for with you your are is do does have has this that what which how when will would can could be at as by from our we us please any if not".split(" "));
  const tokens = (s) => low(s).replace(/[^a-z0-9а-яё+#.\s]/gi, " ").split(/\s+/).filter((w) => w && (w.length > 2 || /\d/.test(w)) && !STOP.has(w));
  const COUNTRY = { US: /\b(us|u\.s\.?|usa|united states|america)\b/, GB: /\b(uk|u\.k\.|united kingdom|britain|england)\b/, UK: /\b(uk|u\.k\.|united kingdom|britain|england)\b/, CA: /\bcanada\b/, KZ: /\b(kazakhstan|kz)\b|казахстан/, DE: /\bgermany\b/, EU: /\b(eu|european union|europe)\b/, NL: /\bnetherlands\b/, PL: /\bpoland\b/, AE: /\b(uae|emirates)\b/ };
  /** Hard anchors a label must contain for an answer to apply (the tech in "years with X", the country in "work in X"). */
  function anchorsOk(label, q) {
    const l = low(label);
    const tech = /years of experience do you have with (.+?)\?*$/i.exec(q);
    if (tech && !l.includes(low(tech[1]))) return false;
    const country = /(?:work in|to work in) ([A-Z]{2})\b/.exec(q);
    if (country) { const re = COUNTRY[country[1]]; if (!re || !re.test(l)) return false; }
    return true;
  }
  function bestAnswer(label, answers) {
    const A = new Set(tokens(label));
    if (!A.size) return null;
    let best = null, bestScore = 0;
    for (const x of answers) {
      if (!anchorsOk(label, x.q)) continue;
      const B = new Set(tokens(x.q));
      if (!B.size) continue;
      let inter = 0;
      for (const w of B) if (A.has(w)) inter++;
      const score = (2 * inter) / (A.size + B.size);
      if (score > bestScore) { bestScore = score; best = x; }
    }
    return bestScore >= 0.5 ? best : null;
  }

  // ——— profile fields ———
  function profileRules(P, coverLetter) {
    const L = P.links || {}, N = P.name || {}, W = P.workAuthorization || {};
    return [
      // [key, test on "label|name|id|autocomplete" haystack, value, note]
      ["Полное имя", /\bfull[\s_-]?name\b|\byour name\b|\blegal name\b|^name\b|\bname:name\b|_systemfield_name|autocomplete:name\b|фио|имя и фамилия/, N.full],
      ["Имя", /\bfirst[\s_-]?name\b|given[\s_-]?name|\bfname\b|firstname|autocomplete:given-name|(^|[^а-яё])имя([^а-яё]|$)(?!.*фамил)/, N.first],
      ["Фамилия", /\blast[\s_-]?name\b|family[\s_-]?name|surname|\blname\b|lastname|autocomplete:family-name|фамилия/, N.last],
      ["Email", /e-?mail|autocomplete:email|почта/, P.email],
      ["Телефон", /phone|mobile|\btel\b|autocomplete:tel|телефон/, P.phone],
      ["LinkedIn", /linkedin/, L.linkedin],
      ["GitHub", /github/, L.github],
      ["Портфолио", /portfolio|personal (web)?site|\bwebsite\b|urls\[other\]|urls\[portfolio\]|портфолио|сайт/, L.portfolio],
      ["Город", /\bcity\b|autocomplete:address-level2|город/, P.city],
      ["Страна", /\bcountry\b|autocomplete:country|страна/, P.country, "select"],
      ["Локация", /\blocation\b|current location|where are you (based|located)|address\b|местоположение|адрес/, P.location, "check"],
      ["Срок выхода", /notice period|when can you start|start date|earliest.*start|availability to start|срок.*выхода/, P.noticePeriod],
      ["Сопроводительное письмо", /cover[\s_-]?letter|motivation|сопроводительн|letter\b|additional information|comments\b/, coverLetter, "textarea"],
      ["Опыт (лет)", /total years|years of (professional |work )?experience\b(?! (with|in|using))|how many years of experience do you have\??$/, P.yearsExperience ? String(P.yearsExperience) : ""],
      ["Разрешение на работу", /authori[sz]ed to work|work authori[sz]ation|right to work|eligible to work|sponsor/, "", "attention"],
    ];
  }

  // ——— main ———
  window.__simplifyFill = async function (payload) {
    const P = (payload && payload.profile) || {};
    const answers = (payload && payload.answers) || [];
    const coverLetter = (payload && payload.coverLetter) || "";
    const controls = [...document.querySelectorAll("input, textarea, select")].filter((el) => {
      const t = (el.type || "").toLowerCase();
      if (["hidden", "submit", "button", "image", "reset", "password", "search"].includes(t)) return false;
      return !el.disabled && visible(el);
    });
    // Frames without a form (chat widgets, analytics) stay silent.
    if (controls.filter((el) => el.type !== "file").length < 2 && !controls.some((el) => el.type === "file")) return null;

    clearMarks();
    const report = { filled: [], attention: [], resume: "none" };
    const attention = (el, field, reason) => { mark(el, "warn", reason); report.attention.push({ field: shortName(field), reason }); };
    const rules = profileRules(P, coverLetter);
    const doneGroups = new Set();
    const used = new Set();

    // 1. Resume: the CV file input (Ashby's "autofill from resume" and cover-letter uploads excluded).
    const files = controls.filter((el) => el.type === "file");
    const resumeInput = files.find((el) => { const q = low(`${questionOf(el)} ${el.name} ${el.id}`); return /resume|résumé|\bcv\b|curriculum|резюме/.test(q) && !/cover|autofill|сопровод/.test(q); })
      || (files.length === 1 && !/cover|сопровод/.test(low(`${questionOf(files[0])} ${files[0].name} ${files[0].id}`)) ? files[0] : null);
    if (payload && payload.cv && payload.cv.base64) {
      if (!resumeInput) report.resume = "no-input";
      else if (resumeInput.files && resumeInput.files.length) report.resume = "attached"; // the user already attached one — leave it
      else if (resumeInput.accept && !/pdf|application\/\*|\*/.test(resumeInput.accept.toLowerCase())) {
        report.resume = "failed";
        attention(resumeInput, "CV", "форма не принимает PDF — прикрепи файл сам");
      } else {
        try {
          const bin = atob(payload.cv.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const file = new File([bytes], payload.cv.fileName || "CV.pdf", { type: "application/pdf" });
          const dt = new DataTransfer();
          dt.items.add(file);
          resumeInput.files = dt.files;
          resumeInput.dispatchEvent(new Event("input", { bubbles: true }));
          resumeInput.dispatchEvent(new Event("change", { bubbles: true }));
          report.resume = resumeInput.files && resumeInput.files.length ? "attached" : "failed";
          if (report.resume === "attached") mark(resumeInput, "ok", "CV из Simplify");
        } catch {
          report.resume = "failed";
        }
      }
    }
    for (const f of files) if (f !== resumeInput && /cover|сопровод/.test(low(`${questionOf(f)} ${f.name} ${f.id}`)) && !f.files?.length) {
      attention(f, "Письмо файлом", coverLetter ? "прикрепи файл или выбери ввод текстом и нажми «Заполнить» ещё раз" : "прикрепи сам, если нужно");
    }
    if (payload && payload.ats === "hh") {
      const anyRadio = document.querySelector("input[type='radio']");
      report.attention.push({ field: "Резюме на hh", reason: "выбери своё резюме на hh — расширение его не выбирает" });
      if (anyRadio) mark(anyRadio.closest("label, div") || anyRadio, "warn", "выбери резюме");
    }

    // 2. Every other control, one decision each.
    for (const el of controls) {
      if (el.type === "file" || used.has(el)) continue;
      const kind = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : (el.type || "text").toLowerCase();

      // Radios & checkboxes: decide per group, never tick consents.
      if (kind === "radio" || kind === "checkbox") {
        const key = `${kind}:${el.name || el.id}`;
        if (doneGroups.has(key)) continue;
        doneGroups.add(key);
        const q = groupQuestion(el);
        const group = el.name ? controls.filter((x) => x.type === el.type && x.name === el.name) : [el];
        if (group.some((x) => x.checked)) continue;
        if (SENSITIVE.test(q)) { attention(el.closest("fieldset") || el.parentElement || el, q, "деликатный или юридический вопрос — ответь сам"); continue; }
        if (kind === "checkbox") {
          if (el.required || el.getAttribute("aria-required") === "true") attention(el, q, "отметь сам, если согласен");
          continue;
        }
        const ans = bestAnswer(q, answers);
        if (ans) {
          const hit = pickOption(group.map((x) => ({ el: x, text: optionLabel(x) })), ans.a);
          if (hit) {
            hit.el.click(); // selecting a radio option — not a submit
            mark(hit.el.closest("label") || hit.el, ans.review ? "warn" : "ok", ans.review ? "проверь ответ" : "ответ из пакета");
            report.filled.push({ field: shortName(q), review: ans.review });
            continue;
          }
        }
        if (group.some((x) => x.required || x.getAttribute("aria-required") === "true") || /\*\s*$/.test(q)) attention(el.closest("fieldset") || el.parentElement || el, q, "нужен твой ответ");
        continue;
      }

      const q = questionOf(el);
      const hay = low(`${q} | name:${el.name || ""} | id:${el.id || ""} | autocomplete:${el.getAttribute("autocomplete") || ""}`);
      const hasValue = kind === "select" ? el.selectedIndex > 0 && el.value !== "" : norm(el.value) !== "";
      if (hasValue) continue; // never overwrite what the user (or the ATS) already put there

      if (SENSITIVE.test(q)) { attention(el, q, "деликатный или юридический вопрос — ответь сам"); continue; }

      // Package answer first for question-like labels (salary, notice, why us…), then profile fields.
      const isQuestion = q.length > 40 || /\?/.test(q) || kind === "textarea";
      let value = "", review = false, field = q, handled = false;
      const ans = isQuestion ? bestAnswer(q, answers) : null;
      if (ans) { value = ans.a; review = ans.review; }
      else {
        for (const [name, re, v, mode] of rules) {
          if (!re.test(hay)) continue;
          if (mode === "textarea" && kind !== "textarea" && !/cover|letter|сопровод/.test(hay)) continue;
          if (mode === "attention") { attention(el, q || name, "вопрос о праве на работу — проверь и ответь сам"); handled = true; break; }
          field = q || name;
          value = v || "";
          review = mode === "check";
          if (!value) { handled = true; if (el.required || el.getAttribute("aria-required") === "true") attention(el, q || name, "в профиле Simplify нет этих данных"); }
          break;
        }
        if (!value && !handled) {
          const late = bestAnswer(q, answers);
          if (late) { value = late.a; review = late.review; }
        }
      }
      if (handled) continue;
      if (!value) {
        if (el.required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(q)) attention(el, q, "нужен твой ответ");
        continue;
      }

      let ok = false;
      if (kind === "select") ok = setSelect(el, value);
      else if (["text", "email", "tel", "url", "number", "textarea"].includes(kind) || !kind) {
        if (kind === "number" && !/^\d+(\.\d+)?$/.test(value)) ok = false;
        else { setText(el, value); ok = norm(el.value) !== ""; }
      }
      if (!ok) { attention(el, q, "не удалось выбрать — выбери сам"); continue; }
      const auto = el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete");
      if (auto) review = true; // location autocompletes need a pick from the list
      mark(el, review ? "warn" : "ok", review ? (auto ? "выбери вариант из списка" : "проверь") : "заполнено из Simplify");
      report.filled.push({ field: shortName(field), review: Boolean(review) });
    }

    banner(report.filled.length + (report.resume === "attached" ? 1 : 0), report.attention.length);
    return report;
  };
})();
