import { useState, type FormEvent } from "react";
import { api } from "./api.js";
import { SiteNav } from "./SiteNav.js";
import type { SitePage } from "./site-route.js";

const MAX_IMAGES = 3;
const MAX_BYTES = 1_500_000;

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function Feedback({ onNavigate }: { onNavigate: (next: SitePage) => void }) {
  const [comment, setComment] = useState("");
  const [contact, setContact] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      if (files.some((f) => f.size > MAX_BYTES)) {
        throw new Error("Each image must be under 1.5 MB");
      }
      const images = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type,
          dataBase64: await fileToBase64(file),
        })),
      );
      const result = await api.submitFeedback({
        comment,
        contact: contact.trim() || undefined,
        page: window.location.pathname,
        images,
      });
      setDone(result.note);
      setComment("");
      setContact("");
      setFiles([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="beta-banner" role="status">
        Closed beta feedback — comments and screenshots stay on the game host.
        They are not posted publicly.
      </div>
      <header>
        <SiteNav page="feedback" onNavigate={onNavigate} />
        <h1>Beta feedback</h1>
        <p className="tagline">Tell us what broke, what was confusing, or what you want next.</p>
      </header>

      {error && <div className="banner error">{error}</div>}
      {done && <div className="banner win">{done}</div>}

      <form className="panel feedback-form" onSubmit={(e) => void onSubmit(e)}>
        <label htmlFor="feedback-comment">Comment</label>
        <textarea
          id="feedback-comment"
          required
          minLength={3}
          maxLength={8000}
          rows={8}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Example: WalletConnect QR never appeared after I clicked Connect Sage."
        />

        <label htmlFor="feedback-contact">Contact (optional)</label>
        <input
          id="feedback-contact"
          type="text"
          maxLength={200}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Sage handle, email, or Discord"
        />

        <label htmlFor="feedback-images">Screenshots (optional, JPEG/PNG/WebP, max 3)</label>
        <input
          id="feedback-images"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => {
            const next = [...(e.target.files ?? [])].slice(0, MAX_IMAGES);
            setFiles(next);
          }}
        />
        {files.length > 0 && (
          <p className="muted small">
            {files.length} file{files.length === 1 ? "" : "s"} selected
          </p>
        )}

        <div className="row">
          <button type="submit" disabled={busy || comment.trim().length < 3}>
            {busy ? "Sending…" : "Send feedback"}
          </button>
        </div>
      </form>
    </div>
  );
}
