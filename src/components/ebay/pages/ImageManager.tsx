import { useRef, useState } from 'react';
import { api, type Attempt } from '../api';
import { AmazonImages } from '../components/AmazonImages';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error(`Datei ${file.name} konnte nicht gelesen werden.`));
    reader.readAsDataURL(file);
  });
}

/**
 * Galerie + Bild-Verwaltung: Fotos hochladen (eBay-Bilderdienst) oder Bild-URLs
 * mit Nutzungsrechten einfügen. Die Bilder des gewählten Listings sind bereits
 * übernommen — der Hinweis verankert die Rechteprüfung vor dem Veröffentlichen.
 */
export function ImageManager({ attempt, editable, onChanged }: {
  attempt: Attempt;
  editable: boolean;
  onChanged: (a: Attempt) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const images = attempt.imageUrls ?? [];

  async function run(fn: () => Promise<Attempt>) {
    setError('');
    setBusy(true);
    try {
      onChanged(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = await Promise.all(
      Array.from(list).map(async (f) => ({ name: f.name, dataBase64: await fileToBase64(f) }))
    );
    await run(() => api<Attempt>(`/attempts/${attempt.id}/images`, { method: 'POST', body: JSON.stringify({ files }) }));
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <section className="images-block">
      {editable && images.length > 0 && (
        <p className="hint images-source-hint">
          Die Bilder stammen aus dem gewählten Listing. Nur behalten, was du verwenden darfst — beim
          Veröffentlichen werden sie als eigene Kopien zu eBay hochgeladen.
        </p>
      )}
      {images.length > 0 && (
        <div className="gallery">
          {images.map((url) => (
            <div key={url} className="thumb">
              <img src={url} alt="" loading="lazy" />
              {editable && (
                <button
                  className="thumb-remove"
                  title="Bild entfernen"
                  aria-label="Bild entfernen"
                  disabled={busy}
                  onClick={() => run(() => api<Attempt>(`/attempts/${attempt.id}/images`, { method: 'DELETE', body: JSON.stringify({ url }) }))}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {editable && (
        <div className="image-tools">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => uploadFiles(e.target.files)}
          />
          <button disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? 'Lädt hoch …' : '+ Eigene Fotos hochladen'}
          </button>
          <AmazonImages
            attempt={attempt}
            busy={busy}
            onAdd={(urls) => run(() => api<Attempt>(`/attempts/${attempt.id}/images`, { method: 'POST', body: JSON.stringify({ urls }) }))}
          />
          <div className="image-url-row">
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="Bild-URL einfügen (nur mit Nutzungsrechten, z.B. Herstellerbilder)"
            />
            <button
              disabled={busy || imageUrl.trim() === ''}
              onClick={() =>
                run(() => api<Attempt>(`/attempts/${attempt.id}/images`, { method: 'POST', body: JSON.stringify({ urls: [imageUrl.trim()] }) })).then(() => setImageUrl(''))
              }
            >
              Hinzufügen
            </button>
          </div>
          {error && <div className="banner error">{error}</div>}
        </div>
      )}
    </section>
  );
}
