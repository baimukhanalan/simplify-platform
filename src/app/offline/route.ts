// Static offline fallback, served by the service worker (public/sw.js) when a page navigation fails without network.
// Self-contained on purpose: it's cached once and must render with nothing else available (no app CSS/JS/fonts),
// and it carries no user data, so caching it is safe.
export const dynamic = "force-static";

const HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#dcefe6">
<title>Нет соединения · Simplify</title>
<style>
  :root { color-scheme: light only; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px 16px;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #141414; -webkit-font-smoothing: antialiased;
    background: radial-gradient(ellipse 90% 60% at 50% -10%, rgb(44 86 71 / .28), transparent 70%), linear-gradient(180deg, #dcefe6 0%, #eef7f2 45%, #f5faf7 100%); background-color: #eaf5ef; }
  main { width: 100%; max-width: 420px; text-align: center; padding: 32px 24px; border-radius: 22px;
    background: rgb(255 255 255 / .74); border: 1px solid rgb(0 0 0 / .07); box-shadow: 0 4px 16px rgb(0 0 0 / .07), inset 0 1px 0 rgb(255 255 255 / .8); }
  img { width: 64px; height: 64px; border-radius: 50%; }
  .label { margin-top: 18px; font: 11px/1.2 ui-monospace, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; color: rgb(20 20 20 / .62); }
  h1 { margin: 10px 0 8px; font: 400 28px/1.1 Georgia, "Times New Roman", serif; color: #233b3b; letter-spacing: -.01em; }
  p { margin: 0; font-size: 15px; line-height: 1.5; color: rgb(20 20 20 / .82); }
  button { margin-top: 22px; height: 44px; padding: 0 22px; border: 0; border-radius: 999px; background: rgb(38 36 36); color: #fcfcfc;
    font: 500 14.5px/1 inherit; font-family: inherit; cursor: pointer; box-shadow: inset 0 1px .5px rgb(255 255 255 / .3), inset 0 -1.5px .5px rgb(0 0 0 / .3), 0 2px 5px rgb(0 0 0 / .25); }
  button:focus-visible { outline: 2px solid #1a6e48; outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <img src="/icons/icon-192.png" alt="" width="64" height="64">
  <div class="label">Simplify</div>
  <h1>Нет соединения</h1>
  <p>Проверь интернет — страница откроется сама, как только связь вернётся. Агент тем временем продолжает работать.</p>
  <button type="button" onclick="location.reload()">Обновить</button>
</main>
<script>addEventListener("online", function () { location.reload(); });</script>
</body>
</html>`;

export function GET() {
  return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
