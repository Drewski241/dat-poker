export type SitePage = "landing" | "play";

/** Map a browser pathname to the public site page. Unknown paths go home. */
export function pathToPage(pathname: string): SitePage {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/play") return "play";
  return "landing";
}

export function pageToPath(page: SitePage): string {
  return page === "play" ? "/play" : "/";
}

export function testerSiteUrls(origin: string): { home: string; play: string } {
  const base = origin.replace(/\/+$/, "");
  return { home: `${base}/`, play: `${base}/play` };
}
