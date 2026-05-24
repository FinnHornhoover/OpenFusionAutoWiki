interface ErrorStateProps {
  title?: string;
  message?: string;
  detail?: string;
}

/**
 * Friendly error tile shown when a fetch fails. The cached hooks don't cache
 * failures, so a hard refresh (or navigating away and back) will retry.
 */
export default function ErrorState({
  title = "Couldn't load this",
  message = 'Something went wrong loading the data.',
  detail,
}: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {detail && <p className="muted error-detail"><code>{detail}</code></p>}
      <p className="muted">Refresh the page to try again.</p>
    </div>
  );
}
