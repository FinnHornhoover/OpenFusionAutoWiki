export default function PreviewOptionsButton() {
  return <button type="button" className="model-preview-options-jump" onClick={(event) => {
    const body = event.currentTarget.closest('.model-preview-body');
    const controls = body?.querySelector('.model-preview-controls');
    if (!body || !controls) return;

    body.scrollTo({
      top: body.scrollTop + controls.getBoundingClientRect().top - body.getBoundingClientRect().top,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }}>Options ↓</button>;
}
