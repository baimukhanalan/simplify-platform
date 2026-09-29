"use strict";
// Popup: find the vacancy of the active tab in the user's Simplify, fill the form ONLY on the user's click, show what was
// filled and what needs attention, and let the user record that THEY submitted. Nothing here clicks Submit.
(() => {
  const { getSettings, api, blobToBase64 } = window.SimplifyApi;
  const view = document.getElementById("view");

  // ——— tiny DOM helper: text only, never innerHTML with server data ———
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const render = (...nodes) => view.replaceChildren(...nodes);
  const note = (text, kind) => h("p", { class: `note ${kind || ""}` }, text);

  let state = { tab: null, settings: null, match: null, report: null, busy: false, confirming: false, submitted: false };

  document.getElementById("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

  const STATUS_RU = {
    found: "Найдена", qualified: "Подходит", prepared: "Пакет готов", submitted: "Отправлено", pending: "Ждём ответа",
    assessment: "Тестовое", recruiter: "Рекрутер", hiring_manager: "Менеджер", technical: "Техническое", final: "Финал",
    offer: "Оффер", rejected: "Отказ", skipped: "Пропущена", hired: "Нанят",
  };
  const HELD_RU = { sensitive: "деликатный вопрос — ответь сам", legal: "юридическое подтверждение — ответь сам", pending: "ответ ещё не одобрен в Simplify" };

  function appLink(path, text) {
    return h("a", { href: state.settings.baseUrl + path, target: "_blank", rel: "noopener" }, text);
  }

  // ——— views ———
  function viewNoToken() {
    render(
      h("div", { class: "card" },
        h("h2", {}, "Подключи расширение"),
        h("p", { class: "muted" }, "Создай ключ в Simplify → Расширение и вставь его в настройках. Ключ хранится только в этом браузере."),
      ),
      h("div", { class: "actions" },
        h("button", { class: "btn btn-primary", onclick: () => chrome.runtime.openOptionsPage() }, "Открыть настройки"),
        h("a", { class: "btn btn-glass", href: `${state.settings.baseUrl}/app/extension`, target: "_blank", rel: "noopener" }, "Создать ключ в Simplify"),
      ),
    );
  }

  function viewError(text, withSettings) {
    render(note(text, "err"), withSettings ? h("div", { class: "actions" }, h("button", { class: "btn btn-glass", onclick: () => chrome.runtime.openOptionsPage() }, "Настройки")) : null);
  }

  function jobCard() {
    const m = state.match;
    if (!m || !m.matched) {
      return h("div", { class: "card job" },
        h("h2", {}, "Вакансии нет в твоём Simplify"),
        h("p", { class: "muted" }, "Можно заполнить только контакты и ссылки из профиля. CV под вакансию, письмо и ответы есть только у вакансий из Simplify."),
      );
    }
    const o = m.opportunity;
    const p = m.package;
    const submitted = o.submitted || state.submitted;
    return h("div", { class: "card job" },
      h("h2", {}, o.title),
      h("div", { class: "company" }, o.company),
      h("div", { class: "chips" },
        h("span", { class: `chip ${submitted ? "chip-green" : "chip-neutral"}` }, submitted ? "Отправлено" : STATUS_RU[o.status] || o.status),
        p ? h("span", { class: "chip chip-green" }, "CV под вакансию") : h("span", { class: "chip chip-amber" }, "Пакет не готов"),
        p && p.coverLetter ? h("span", { class: "chip chip-green" }, "Письмо") : null,
        p && p.answers.length ? h("span", { class: "chip chip-green" }, `Ответов: ${p.answers.length}`) : null,
        p && p.held.length ? h("span", { class: "chip chip-amber" }, `Сам: ${p.held.length}`) : null,
      ),
      !p ? h("p", { class: "muted" }, "Пакет ещё не подготовлен — открой вакансию в Simplify и нажми «Подать». ", appLink(o.appUrl, "Открыть в Simplify")) : null,
    );
  }

  function checklist() {
    const r = state.report;
    if (!r) return null;
    const items = [];
    for (const f of r.filled) items.push(h("li", { class: "ok" }, h("span", { class: "mark" }, "✓"), f.review ? `${f.field} — проверь` : f.field));
    if (r.resume === "attached") items.push(h("li", { class: "ok" }, h("span", { class: "mark" }, "✓"), "CV прикреплён"));
    const warn = [];
    for (const a of r.attention) warn.push(h("li", { class: "warn" }, h("span", { class: "mark" }, "!"), `${a.field}: ${a.reason}`));
    if (r.resume === "no-input" && state.match && state.match.package && state.match.ats !== "hh") warn.push(h("li", { class: "warn" }, h("span", { class: "mark" }, "!"), "Поле для CV не найдено — прикрепи файл вручную"));
    if (r.resume === "failed") warn.push(h("li", { class: "err" }, h("span", { class: "mark" }, "×"), "CV не удалось прикрепить — прикрепи вручную"));
    const held = (state.match && state.match.package && state.match.package.held) || [];
    return h("div", { class: "card check" },
      h("div", { class: "label" }, r.frames ? `Заполнено: ${items.length} · проверь: ${warn.length}` : "Форма не найдена"),
      r.frames ? null : h("p", { class: "muted" }, "На этой странице нет полей заявки. Открой форму отклика (Apply) и нажми ещё раз."),
      items.length ? h("ul", {}, items) : null,
      warn.length ? h("h3", { class: "label" }, "Нужно твоё внимание") : null,
      warn.length ? h("ul", {}, warn) : null,
      held.length ? h("h3", { class: "label" }, "Ответь сам") : null,
      held.length ? h("ul", {}, held.map((q) => h("li", { class: "warn" }, h("span", { class: "mark" }, "!"), `${q.q} — ${HELD_RU[q.reason] || "ответь сам"}`))) : null,
      h("p", { class: "muted" }, "Зелёным подсвечено заполненное, жёлтым — то, что нужно проверить. Проверь форму и нажми «Отправить» на сайте сам."),
    );
  }

  function submitBlock() {
    const m = state.match;
    if (!m || !m.matched || !m.package) return null;
    if (m.opportunity.submitted || state.submitted) return note("Заявка отмечена отправленной в Simplify. Удачи!", "");
    if (!state.confirming) {
      return h("button", { class: "btn btn-glass", disabled: state.busy, onclick: () => { state.confirming = true; draw(); } }, "Заявка отправлена");
    }
    return h("div", { class: "confirm" },
      h("p", { class: "muted" }, "Заявка уже ушла работодателю? Simplify отметит её отправленной и закроет задачу «Отправь заявку»."),
      h("div", { class: "row" },
        h("button", { class: "btn btn-green", disabled: state.busy, onclick: markSubmitted }, "Да, отметить"),
        h("button", { class: "btn btn-ghost", disabled: state.busy, onclick: () => { state.confirming = false; draw(); } }, "Отмена"),
      ),
    );
  }

  function draw(extra) {
    const canFill = /^https?:/.test((state.tab && state.tab.url) || "");
    render(
      jobCard(),
      extra || null,
      checklist(),
      h("div", { class: "actions" },
        h("button", { class: "btn btn-primary", disabled: state.busy || !canFill, onclick: fill }, state.busy ? "Заполняем…" : state.report ? "Заполнить ещё раз" : "Заполнить форму"),
        submitBlock(),
      ),
    );
  }

  // ——— actions ———
  async function fill() {
    if (state.busy) return;
    state.busy = true;
    draw();
    try {
      const m = state.match;
      const profile = await api("/api/extension/profile");
      let cv = null;
      if (m && m.matched && m.package) {
        try {
          const blob = await api(m.package.cv.path, { as: "blob" });
          cv = { base64: await blobToBase64(blob), fileName: m.package.cv.fileName };
        } catch {
          cv = null;
        }
      }
      const payload = {
        ats: (m && m.ats) || "url",
        profile,
        coverLetter: (m && m.package && m.package.coverLetter) || "",
        answers: (m && m.package && m.package.answers) || [],
        cv,
      };
      state.report = await inject(payload);
    } catch (err) {
      state.busy = false;
      return draw(note(errorText(err), "err"));
    }
    state.busy = false;
    draw(state.report && state.report.cvFetchFailed ? note("CV не удалось скачать из Simplify — прикрепи его вручную.", "warn") : null);
  }

  /** Inject the filler on this click only (activeTab), into every frame we may access, then merge per-frame reports. */
  async function inject(payload) {
    const tabId = state.tab.id;
    const run = async (allFrames) => {
      await chrome.scripting.executeScript({ target: { tabId, allFrames }, files: ["content/fill.js"] });
      return chrome.scripting.executeScript({
        target: { tabId, allFrames },
        func: (p) => (typeof window.__simplifyFill === "function" ? window.__simplifyFill(p) : null),
        args: [payload],
      });
    };
    let results;
    try {
      results = await run(true);
    } catch {
      results = await run(false); // a cross-origin frame we have no access to — fill the top page only
    }
    const merged = { frames: 0, filled: [], attention: [], resume: "none", cvFetchFailed: Boolean(state.match && state.match.package && !payload.cv) };
    const rank = { attached: 3, failed: 2, "no-input": 1, none: 0 };
    for (const r of results || []) {
      const v = r && r.result;
      if (!v) continue;
      merged.frames++;
      merged.filled.push(...v.filled);
      merged.attention.push(...v.attention);
      if ((rank[v.resume] || 0) > (rank[merged.resume] || 0)) merged.resume = v.resume;
    }
    return merged;
  }

  async function markSubmitted() {
    state.busy = true;
    draw();
    try {
      await api("/api/extension/mark-submitted", { method: "POST", body: { opportunityId: state.match.opportunity.id } });
      state.submitted = true;
      state.confirming = false;
      state.busy = false;
      draw();
    } catch (err) {
      state.busy = false;
      const reason = err && err.body && err.body.reason;
      draw(note(err && err.status === 409 ? (reason === "no-package" || (err.body && err.body.error === "no-package") ? "Пакет ещё не готов — отметить нельзя." : "Simplify не смог отметить заявку. Открой её в Simplify и отметь вручную.") : errorText(err), "err"));
    }
  }

  function errorText(err) {
    if (err && err.status === 401) return "Ключ не подходит или отозван. Создай новый в Simplify → Расширение и вставь его в настройках.";
    if (err && err.status === 429) return "Слишком много запросов. Попробуй через пару минут.";
    if (err && err.message && /Cannot access|cannot be scripted|chrome:\/\//i.test(err.message)) return "На этой странице расширение не может работать.";
    return "Не удалось связаться с Simplify. Проверь интернет и адрес в настройках.";
  }

  // ——— start ———
  (async () => {
    state.settings = await getSettings();
    if (!state.settings.token) return viewNoToken();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tab = tab || null;
    const url = (tab && tab.url) || "";
    if (!/^https?:\/\//.test(url)) return render(note("Открой страницу вакансии или форму отклика — и нажми на значок ещё раз.", ""));
    render(h("p", { class: "muted" }, "Ищем вакансию в твоём Simplify…"));
    try {
      state.match = await api(`/api/extension/match?url=${encodeURIComponent(url)}`);
    } catch (err) {
      return viewError(errorText(err), err && err.status === 401);
    }
    draw();
  })();
})();
