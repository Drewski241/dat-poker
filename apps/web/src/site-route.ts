export type SitePage = "landing" | "play" | "feedback" | "privacy";

/** Browser location: static pages or a public shared-hand view. */
export type SiteLocation =
  | { page: SitePage }
  | { page: "sharedHand"; handId: string };

/** Map a browser pathname to the public site page. Unknown paths go home. */
export function pathToPage(pathname: string): SitePage {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/play") return "play";
  if (p === "/feedback") return "feedback";
  if (p === "/privacy") return "privacy";
  return "landing";
}

export function pageToPath(page: SitePage): string {
  if (page === "play") return "/play";
  if (page === "feedback") return "/feedback";
  if (page === "privacy") return "/privacy";
  return "/";
}

export function sharedHandPath(handId: string): string {
  return `/h/${encodeURIComponent(handId)}`;
}

export function parseSiteLocation(pathname: string): SiteLocation {
  const p = pathname.replace(/\/+$/, "") || "/";
  const match = /^\/h\/([^/]+)$/.exec(p);
  if (match?.[1]) {
    try {
      return { page: "sharedHand", handId: decodeURIComponent(match[1]) };
    } catch {
      return { page: "landing" };
    }
  }
  return { page: pathToPage(pathname) };
}

export function locationToPath(location: SiteLocation): string {
  if (location.page === "sharedHand") return sharedHandPath(location.handId);
  return pageToPath(location.page);
}

export function testerSiteUrls(origin: string): { home: string; play: string; feedback: string } {
  const base = origin.replace(/\/+$/, "");
  return { home: `${base}/`, play: `${base}/play`, feedback: `${base}/feedback` };
}
