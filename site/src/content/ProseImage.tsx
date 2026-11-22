import { useId, useRef, useState } from 'react';
import ModelDialog from '../components/ModelDialog';
import '../components/ModelPreview.css';

export default function ProseImage({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  return (
    <figure className="prose-figure">
      <button className="prose-image-button" type="button" ref={opener} onClick={() => setOpen(true)}
        aria-label={alt ? `View original image: ${alt}` : 'View original image'} aria-haspopup="dialog" title="View original image">
        <img src={src} alt={alt} loading="lazy" />
      </button>
      {caption && <figcaption>{caption}</figcaption>}
      {open && (
        <ModelDialog titleId={titleId} returnFocus={opener} onClose={() => setOpen(false)}>
          <header className="model-preview-heading">
            <h2 id={titleId}>Original image</h2>
            <button className="model-preview-close" type="button" onClick={() => setOpen(false)}>Close</button>
          </header>
          <div className="prose-image-viewer" tabIndex={0} aria-label="Original image">
            <figure className="prose-image-original">
              <img src={src} alt={alt} />
              {caption && <figcaption>{caption}</figcaption>}
            </figure>
          </div>
        </ModelDialog>
      )}
    </figure>
  );
}
