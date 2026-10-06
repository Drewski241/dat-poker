/** True for phone/tablet browsers (Safari iOS, Chrome Android, etc.). */
export function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/** Universal link that opens a WalletConnect-capable wallet app (Sage, etc.). */
export function walletConnectUniversalLink(uri: string): string {
  return `https://walletconnect.com/wc?uri=${encodeURIComponent(uri)}`;
}
