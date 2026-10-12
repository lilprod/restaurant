/** Décrit un appareil à partir de son user-agent (« Chrome sur macOS »). Volontairement simple. */
export function describeUserAgent(ua: string | null | undefined): { label: string; kind: "mobile" | "tablet" | "desktop" | "unknown" } {
  if (!ua) return { label: "Appareil inconnu", kind: "unknown" };
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\/|Opera/.test(ua) ? "Opera" :
    /SamsungBrowser/.test(ua) ? "Samsung Internet" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Chrome\/|CriOS/.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" :
    /curl|node|undici|axios|python|okhttp/i.test(ua) ? "Client API" : "Navigateur";
  const os =
    /iPad/.test(ua) ? "iPadOS" :
    /iPhone|iPod/.test(ua) ? "iOS" :
    /Android/.test(ua) ? "Android" :
    /Windows/.test(ua) ? "Windows" :
    /Mac OS X|Macintosh/.test(ua) ? "macOS" :
    /CrOS/.test(ua) ? "ChromeOS" :
    /Linux/.test(ua) ? "Linux" : null;
  const kind = /iPad|Tablet/.test(ua) ? "tablet" : /Mobi|iPhone|Android/.test(ua) ? "mobile" : "desktop";
  return { label: os ? `${browser} sur ${os}` : browser, kind };
}
