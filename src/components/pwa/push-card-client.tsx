"use client";
import { useEffect, useState } from "react";
import { BellRing, Monitor, Send, Smartphone } from "lucide-react";
import { Card, Chip, cx } from "@/components/ui";
import { endpointKey, isIos, isStandalone, pushSupported, swRegistration, urlBase64ToUint8Array } from "@/lib/push-client";
import { count } from "@/lib/ru";

const DEVICES = ["устройство", "устройства", "устройств"] as const;

export type Device = { id: string; key: string; label: string; createdAt: string };
type State = "loading" | "unsupported" | "ios-install" | "ios-old" | "denied" | "off" | "on";

const API = "/api/push/subscribe";

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array) {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

async function currentSubscription() {
  const reg = await swRegistration();
  return reg ? { reg, sub: await reg.pushManager.getSubscription().catch(() => null) } : null;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long" });

export function PushCardClient({ publicKey, initialDevices, prefOn }: { publicKey: string; initialDevices: Device[]; prefOn: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [devices, setDevices] = useState(initialDevices);
  const [thisKey, setThisKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"toggle" | "test" | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let next: State;
      let key: string | null = null;
      if (isIos() && !isStandalone()) next = "ios-install";
      else if (!pushSupported()) next = isIos() ? "ios-old" : "unsupported";
      else if (Notification.permission === "denied") next = "denied";
      else {
        const cur = await currentSubscription();
        if (!cur) next = "unsupported";
        else {
          if (cur.sub) key = await endpointKey(cur.sub.endpoint);
          next = cur.sub && Notification.permission === "granted" && prefOn && initialDevices.some((d) => d.key === key) ? "on" : "off";
        }
      }
      if (!alive) return;
      setThisKey(key);
      setState(next);
    })();
    return () => { alive = false; };
  }, [initialDevices, prefOn]);

  async function enable() {
    setBusy("toggle");
    setNote(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm === "denied") return setState("denied");
      if (perm !== "granted") return setNote({ tone: "err", text: "Разрешение не выдано. Нажми ещё раз и выбери «Разрешить»." });
      const cur = await currentSubscription();
      if (!cur) return setNote({ tone: "err", text: "Браузер не запустил фоновый сервис. Обнови страницу и попробуй снова." });
      const appKey = urlBase64ToUint8Array(publicKey);
      let sub = cur.sub;
      if (sub && !sameKey(sub.options.applicationServerKey, appKey)) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      sub ??= await cur.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!r.ok) return setNote({ tone: "err", text: r.status === 429 ? "Слишком много попыток — подожди минуту." : "Не получилось включить. Попробуй ещё раз." });
      const data = (await r.json()) as { devices: Device[] };
      setDevices(data.devices);
      setThisKey(await endpointKey(sub.endpoint));
      setState("on");
      setNote({ tone: "ok", text: "Готово — уведомления будут приходить на это устройство." });
    } catch {
      setNote({ tone: "err", text: "Не получилось включить. Проверь интернет и попробуй ещё раз." });
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setBusy("toggle");
    setNote(null);
    try {
      const cur = await currentSubscription();
      if (cur?.sub) {
        const r = await fetch(API, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: cur.sub.endpoint }) });
        if (!r.ok) return setNote({ tone: "err", text: "Не получилось выключить. Попробуй ещё раз." });
        setDevices(((await r.json()) as { devices: Device[] }).devices);
        await cur.sub.unsubscribe().catch(() => {});
      }
      setThisKey(null);
      setState("off");
    } catch {
      setNote({ tone: "err", text: "Не получилось выключить. Проверь интернет и попробуй ещё раз." });
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    setBusy("test");
    setNote(null);
    try {
      const sub = (await currentSubscription())?.sub;
      if (!sub) {
        setState("off");
        return setNote({ tone: "err", text: "Это устройство больше не подписано — включи уведомления заново." });
      }
      const r = await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      if (r.ok) return setNote({ tone: "ok", text: "Отправили — уведомление появится через пару секунд." });
      if (r.status === 410 || r.status === 404) {
        await sub.unsubscribe().catch(() => {});
        const d = (await r.json().catch(() => ({}))) as { devices?: Device[] };
        if (d.devices) setDevices(d.devices);
        setState("off");
        return setNote({ tone: "err", text: "Подписка этого устройства устарела — включи уведомления заново." });
      }
      setNote({ tone: "err", text: r.status === 429 ? "Слишком часто — попробуй через минуту." : "Не получилось отправить. Попробуй чуть позже." });
    } catch {
      setNote({ tone: "err", text: "Не получилось отправить. Проверь интернет." });
    } finally {
      setBusy(null);
    }
  }

  const on = state === "on";
  const chip =
    state === "on" ? <Chip tone="green" dot>Включены</Chip>
    : state === "off" ? <Chip>Выключены</Chip>
    : state === "denied" ? <Chip tone="rose">Заблокированы</Chip>
    : null;

  return (
    <Card className="flex flex-col gap-3" aria-labelledby="push-h" aria-busy={state === "loading"}>
      <BellRing className="size-5 text-teal" strokeWidth={1.7} aria-hidden />
      <div className="flex min-h-[22px] flex-wrap items-center justify-between gap-2">
        <h3 id="push-h" className="h-serif text-[19px]">Push-уведомления</h3>
        {chip}
      </div>

      {state === "loading" && (
        <div className="flex flex-col gap-2.5" aria-hidden>
          <div className="h-4 w-11/12 animate-pulse rounded-full bg-head/10" />
          <div className="h-4 w-2/3 animate-pulse rounded-full bg-head/10" />
          <div className="mt-2 h-11 w-full animate-pulse rounded-2xl bg-head/[.07]" />
        </div>
      )}

      {state === "ios-install" && (
        <p className="text-[13.5px] text-ink-3">
          На iPhone и iPad уведомления приходят, только когда Simplify установлен на экран «Домой». Нажми «Поделиться» → «На экран Домой», открой Simplify с иконки и включи уведомления здесь.
        </p>
      )}
      {state === "ios-old" && <p className="text-[13.5px] text-ink-3">Чтобы получать уведомления на iPhone или iPad, обнови iOS до версии 16.4 или новее — и включи их здесь.</p>}
      {state === "unsupported" && (
        <p className="text-[13.5px] text-ink-3">Этот браузер не умеет получать push-уведомления. Открой Simplify в Chrome, Edge, Firefox или Safari — и включи их здесь.</p>
      )}
      {state === "denied" && (
        <div className="flex flex-col gap-2 text-[13.5px] text-ink-3">
          <p>Уведомления для Simplify заблокированы в настройках {isIos() ? "устройства" : "браузера"}. Чтобы включить:</p>
          {isIos() ? (
            <p className="text-ink-2">Настройки → Уведомления → Simplify → «Допуск уведомлений». Затем открой Simplify заново.</p>
          ) : (
            <p className="text-ink-2">Нажми на значок слева от адреса сайта → «Настройки сайта» → «Уведомления» → «Разрешить». Затем обнови страницу.</p>
          )}
        </div>
      )}

      {(state === "on" || state === "off") && (
        <>
          <p className="text-[13.5px] text-ink-3">Приглашения на интервью, задания работодателей и офферы — сразу на экран, даже когда Simplify закрыт.</p>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            disabled={busy !== null}
            onClick={on ? disable : enable}
            className="group flex min-h-11 w-full items-center justify-between gap-4 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green disabled:cursor-wait"
          >
            <span className="flex flex-col">
              <span className="text-[15px] text-head">На этом устройстве</span>
              <span className="text-[12.5px] text-ink-3">{busy === "toggle" ? (on ? "Выключаем…" : "Включаем…") : on ? "Включены" : "Выключены"}</span>
            </span>
            <span aria-hidden className={cx("relative h-6 w-11 shrink-0 rounded-full transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform", on ? "bg-green after:translate-x-5" : "bg-head/15", busy === "toggle" && "opacity-60")} />
          </button>
          {on && (
            <button
              type="button"
              onClick={check}
              disabled={busy !== null}
              className="glass inline-flex h-10 w-fit items-center justify-center gap-2 !rounded-full px-4 text-[13px] font-medium text-head transition-all hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green active:scale-[.98] disabled:opacity-50"
            >
              <Send className="size-3.5" strokeWidth={1.8} aria-hidden />
              {busy === "test" ? "Отправляем…" : "Проверить связь"}
            </button>
          )}
        </>
      )}

      <p aria-live="polite" className={cx("text-[13px]", !note && "sr-only", note?.tone === "ok" ? "text-green" : "text-rose")}>{note?.text ?? ""}</p>

      {devices.length > 0 && state !== "loading" && (
        <div className="mt-1 flex flex-col gap-2 border-t border-line pt-3">
          <span className="label">
            {count(devices.length, DEVICES)} с уведомлениями
          </span>
          <ul className="flex flex-col gap-1.5">
            {devices.map((d) => {
              const Icon = /iPhone|iPad|Android/.test(d.label) ? Smartphone : Monitor;
              const mine = d.key === thisKey && on;
              return (
                <li key={d.id} className="flex min-w-0 items-center gap-2.5 text-[13.5px]">
                  <Icon className="size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
                  <span className="min-w-0 truncate text-ink-2">{d.label}</span>
                  <span className="shrink-0 text-[12.5px] text-ink-3">с {fmtDate(d.createdAt)}</span>
                  {mine && <Chip tone="teal" className="ml-auto shrink-0">это устройство</Chip>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
