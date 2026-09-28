"use client";
import { useEffect, useRef } from "react";

/**
 * Full-bleed topographic contour field. Lines drift slowly and part around the cursor;
 * accent lines warm toward green as `progress` (form completeness, 0–1) rises.
 * Canvas only, ~3k points/frame, DPR capped at 2, static frame under reduced motion.
 */
export function Atmosphere({ progress = 0 }: { progress?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(progress);
  useEffect(() => { progressRef.current = progress; }, [progress]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, t = Math.random() * 100;
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, power: 0, tpower: 0 };
    let shown = progressRef.current;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      mouse.x += (mouse.tx - mouse.x) * 0.08;
      mouse.y += (mouse.ty - mouse.y) * 0.08;
      mouse.power += (mouse.tpower - mouse.power) * 0.05;
      shown += (progressRef.current - shown) * 0.04;
      const lines = Math.max(14, Math.min(30, Math.round(h / 34)));
      const gap = h / (lines - 1);
      const step = w < 640 ? 14 : 10;
      const radius = Math.max(140, Math.min(w, h) * 0.22);
      for (let i = -1; i <= lines; i++) {
        const base = i * gap;
        const accent = i % 5 === 2;
        ctx.beginPath();
        for (let x = -step; x <= w + step; x += step) {
          const nx = x / w;
          let y = base
            + Math.sin(nx * 5.2 + t * 0.35 + i * 0.42) * gap * 0.55
            + Math.sin(nx * 11.3 - t * 0.22 + i * 0.93) * gap * 0.22
            + Math.sin(nx * 2.1 + t * 0.12 - i * 0.2) * gap * 0.8;
          const dx = x - mouse.x, dy = y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < radius * radius * 4) {
            const f = Math.exp(-d2 / (radius * radius)) * mouse.power;
            y += (dy >= 0 ? 1 : -1) * f * gap * 1.4;
          }
          if (x === -step) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        if (accent) {
          ctx.strokeStyle = `rgba(26,110,72,${0.1 + shown * 0.22})`;
          ctx.lineWidth = 1.15;
        } else {
          ctx.strokeStyle = "rgba(35,59,59,0.085)";
          ctx.lineWidth = 1;
        }
        ctx.stroke();
      }
      if (!reduce) {
        t += 0.012;
        raf = requestAnimationFrame(draw);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      mouse.tx = e.clientX; mouse.ty = e.clientY; mouse.tpower = 1;
      if (mouse.x < -1000) { mouse.x = e.clientX; mouse.y = e.clientY; }
    };
    const onLeave = () => { mouse.tpower = 0; };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    const ro = new ResizeObserver(() => { resize(); if (reduce) draw(); });
    ro.observe(canvas);
    if (!reduce) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      document.addEventListener("visibilitychange", onVisibility);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full [mask-image:radial-gradient(ellipse_120%_90%_at_50%_40%,#000_40%,transparent_100%)]" />;
}
