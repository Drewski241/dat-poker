import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface QrConnectModalProps {
  uri: string;
  onClose: () => void;
}

export function QrConnectModal({ uri, onClose }: QrConnectModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, uri, { width: 280, margin: 2 });
  }, [uri]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>Connect Sage Wallet</h3>
        <p className="muted">
          Scan with Sage mobile (WalletConnect) or paste the URI in Sage desktop.
        </p>
        <canvas ref={canvasRef} className="qr-canvas" />
        <p className="mono wc-uri">{uri}</p>
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
