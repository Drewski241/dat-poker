export type SitePage = "landing" | "play" | "slots" | "feedback" | "privacy";

/** Match datspiritpoker.com paths (production uses /play for the table). */
export function pathToPage(pathname: string): SitePage {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/slots" || p.startsWith("/slots/")) return "slots";
  if (p === "/play") return "play";
  if (p === "/feedback") return "feedback";
  if (p === "/privacy") return "privacy";
  if (p === "/") return "play";
  return "play";
}

export function pageToPath(page: SitePage): string {
  if (page === "slots") return "/slots";
  if (page === "play") return "/play";
  if (page === "feedback") return "/feedback";
  if (page === "privacy") return "/privacy";
  return "/play";
}
