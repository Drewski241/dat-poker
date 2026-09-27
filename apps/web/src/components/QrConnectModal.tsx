import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { isMobileUserAgent, walletConnectUniversalLink } from "../wallet/wc-link.js";

interface QrConnectModalProps {
  uri: string | null;
  status?: string;
  error?: string | null;
  onClose: () => void;
}

export function QrConnectModal({ uri, status, error, onClose }: QrConnectModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const mobile = isMobileUserAgent();

  useEffect(() => {
    if (!uri) {
      setQrDataUrl(null);
      setQrFailed(false);
      return;
    }
    let cancelled = false;
    setQrFailed(false);
    void QRCode.toDataURL(uri, { width: 280, margin: 2, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl(null);
          setQrFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const copyUri = async () => {
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
    } catch {
      /* iOS may block clipboard without a direct gesture — user can select mono text */
    }
  };

  return (
    <div className="modal-backdrop wc-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="wc-connect-title">
      <div className="modal wc-modal">
        <h3 id="wc-connect-title">Connect Sage Wallet</h3>
        {error && (
          <p className="banner err wc-modal-error" role="alert">
            {error}
          </p>
        )}
        <p className="muted">
          {uri
            ? mobile
              ? "On iPhone, tap Open Sage below (do not scan a QR on this same phone). Approve the connection in Sage, then return to Safari."
              : "Scan with Sage mobile (WalletConnect) or paste the URI in Sage desktop."
            : status || "Connecting to the WalletConnect relay…"}
        </p>
        {uri ? (
          <>
            {mobile && (
              <div className="wc-mobile-actions">
                <a
                  className="primary wc-open-sage"
                  href={walletConnectUniversalLink(uri)}
                  rel="noopener noreferrer"
                >
                  Open Sage
                </a>
                <a className="secondary wc-open-sage" href={uri}>
                  Open wc:// link
                </a>
                <button type="button" className="secondary" onClick={() => void copyUri()}>
                  Copy pairing link
                </button>
              </div>
            )}
            {!mobile && (
              <>
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="WalletConnect QR code" className="qr-img" width={280} height={280} />
                ) : qrFailed ? (
                  <p className="muted">QR image failed to render. Copy the link below into Sage.</p>
                ) : (
                  <div className="wc-pending" role="status">
                    <span className="wc-spinner" aria-hidden="true" />
                    Building QR…
                  </div>
                )}
              </>
            )}
            {mobile && qrDataUrl && (
              <details className="wc-qr-details">
                <summary>Show QR (for another device)</summary>
                <img src={qrDataUrl} alt="WalletConnect QR code" className="qr-img" width={240} height={240} />
              </details>
            )}
            <p className="mono wc-uri">{uri}</p>
          </>
        ) : (
          <div className="wc-pending" role="status">
            <span className="wc-spinner" aria-hidden="true" />
            Waiting for pairing QR
          </div>
        )}
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
