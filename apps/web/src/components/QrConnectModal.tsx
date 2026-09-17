import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface QrConnectModalProps {
  uri: string | null;
  status?: string;
  onClose: () => void;
}

export function QrConnectModal({ uri, status, onClose }: QrConnectModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!uri || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, uri, { width: 280, margin: 2 });
  }, [uri]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="wc-connect-title">
      <div className="modal">
        <h3 id="wc-connect-title">Connect Sage Wallet</h3>
        <p className="muted">
          {uri
            ? "Scan with Sage mobile (WalletConnect) or paste the URI in Sage desktop."
            : status || "Connecting to the WalletConnect relay…"}
        </p>
        {uri ? (
          <>
            <canvas ref={canvasRef} className="qr-canvas" />
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
