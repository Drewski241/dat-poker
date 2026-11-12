export type SitePage = "landing" | "play" | "slots" | "casino" | "feedback" | "privacy";

/** Map a browser pathname to the public site page. Unknown paths go home. */
export function pathToPage(pathname: string): SitePage {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/slots" || p.startsWith("/slots/")) return "slots";
  if (p === "/casino" || p.startsWith("/casino/")) return "casino";
  if (p === "/play") return "play";
  if (p === "/feedback") return "feedback";
  if (p === "/privacy") return "privacy";
  return "landing";
}

export function pageToPath(page: SitePage): string {
  if (page === "slots") return "/slots";
  if (page === "casino") return "/casino";
  if (page === "play") return "/play";
  if (page === "feedback") return "/feedback";
  if (page === "privacy") return "/privacy";
  return "/";
}

export function testerSiteUrls(origin: string): {
  home: string;
  play: string;
  slots: string;
  casino: string;
  feedback: string;
} {
  const base = origin.replace(/\/+$/, "");
  return {
    home: `${base}/`,
    play: `${base}/play`,
    slots: `${base}/slots`,
    casino: `${base}/casino`,
    feedback: `${base}/feedback`,
  };
}
