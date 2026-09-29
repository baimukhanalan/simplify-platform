"use strict";
(() => {
  const { DEFAULT_BASE, getSettings, normalizeBase, api } = window.SimplifyApi;
  const $ = (id) => document.getElementById(id);
  const status = (text, kind) => {
    $("status").textContent = text;
    $("status").className = `status ${kind || ""}`;
  };
  const pairHref = (base) => `${base}/app/extension`;

  async function load() {
    const s = await getSettings();
    $("token").value = s.token;
    $("baseUrl").value = s.baseUrl;
    $("pairLink").href = pairHref(s.baseUrl);
  }

  $("baseUrl").addEventListener("input", () => {
    const b = normalizeBase($("baseUrl").value);
    if (b) $("pairLink").href = pairHref(b);
  });

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = $("token").value.trim();
    const baseUrl = normalizeBase($("baseUrl").value) || "";
    if (!baseUrl) return status("Адрес должен начинаться с https:// (или http://localhost для разработки).", "err");
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return status("Похоже, ключ скопирован не полностью. Скопируй его ещё раз.", "err");
    $("save").disabled = true;
    status("Проверяем ключ…");
    await chrome.storage.local.set({ token, baseUrl });
    try {
      const p = await api("/api/extension/profile");
      status(`Готово. Подключено к аккаунту ${p.email}.`, "ok");
    } catch (err) {
      if (err && err.status === 401) status("Ключ не подходит или отозван. Создай новый в Simplify → Расширение.", "err");
      else if (err && err.status === 429) status("Слишком много запросов. Попробуй через пару минут.", "err");
      else status(`Не удалось связаться с ${baseUrl}. Проверь адрес и интернет.`, "err");
    } finally {
      $("save").disabled = false;
    }
  });

  $("forget").addEventListener("click", async () => {
    await chrome.storage.local.set({ token: "" });
    $("token").value = "";
    status("Ключ удалён из браузера. Чтобы отключить его совсем, отзови ключ в Simplify.", "ok");
  });

  $("baseUrl").placeholder = DEFAULT_BASE;
  load();
})();
