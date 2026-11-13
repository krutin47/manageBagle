import { useEffect, useState, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
  );
}

type Theme = "light" | "dark";

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  const apply = (next: Theme) => {
    // A short cross-fade for the theme switch only, so ordinary hovers stay crisp.
    document.documentElement.classList.add("theme-switching");
    document.documentElement.dataset.theme = next;
    window.setTimeout(() => document.documentElement.classList.remove("theme-switching"), 320);
    try {
      localStorage.setItem("mb.theme", next);
    } catch {
      /* storage blocked: theme still applies for this visit */
    }
    setTheme(next);
  };
  return [theme, apply];
}

/** Minutes since local midnight, refreshed every 30 s — drives the "now" line. */
export function useNowMinutes(): number {
  const read = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const id = window.setInterval(() => setNow(read()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · manageBagle`;
  }, [title]);
}
