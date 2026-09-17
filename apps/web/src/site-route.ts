export type SitePage = "landing" | "play" | "feedback" | "verify-email";

/** Map a browser pathname to the public site page. Unknown paths go home. */
export function pathToPage(pathname: string): SitePage {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/play") return "play";
  if (p === "/feedback") return "feedback";
  if (p === "/verify-email") return "verify-email";
  return "landing";
}

export function pageToPath(page: SitePage): string {
  if (page === "play") return "/play";
  if (page === "feedback") return "/feedback";
  if (page === "verify-email") return "/verify-email";
  return "/";
}

export function testerSiteUrls(origin: string): { home: string; play: string; feedback: string } {
  const base = origin.replace(/\/+$/, "");
  return { home: `${base}/`, play: `${base}/play`, feedback: `${base}/feedback` };
}
