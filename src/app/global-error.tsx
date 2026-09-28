"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "linear-gradient(180deg,#dcefe6,#f5faf7)", fontFamily: "system-ui, sans-serif", color: "#233b3b" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontWeight: 400, fontSize: 32, margin: "0 0 12px" }}>Simplify временно недоступен</h1>
          <p style={{ opacity: 0.7, margin: "0 0 20px" }}>Попробуй обновить страницу через минуту.</p>
          <button onClick={reset} style={{ height: 44, padding: "0 20px", borderRadius: 999, border: 0, background: "#262424", color: "#fff", fontSize: 15, cursor: "pointer" }}>Обновить</button>
        </div>
      </body>
    </html>
  );
}
