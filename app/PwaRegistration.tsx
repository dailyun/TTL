"use client";
import { useEffect } from "react";
export function PwaRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(async () => {
        const registration = await navigator.serviceWorker.ready;
        const assets = [
          ...Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).map(e => e.src),
          ...Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]")).map(e => e.href),
          ...performance.getEntriesByType("resource").map(e => e.name)
        ].filter(url => { const parsed = new URL(url, location.origin); return parsed.origin === location.origin && parsed.pathname.startsWith("/_next/static/"); });
        registration.active?.postMessage({ type: "CACHE_SHELL", assets: [...new Set(assets)] });
      }).catch(() => undefined);
    }
  }, []);
  return null;
}
