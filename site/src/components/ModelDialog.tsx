import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export default function ModelDialog({ titleId, returnFocus, onClose, children }: { titleId: string; returnFocus: RefObject<HTMLElement>; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropDown = useRef(false);

  useLayoutEffect(() => {
    const dialog = ref.current!;
    const opener = returnFocus.current ?? document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('.model-preview-close')?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [returnFocus]);

  const outside = (x: number, y: number): boolean => {
    const bounds = ref.current!.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  };

  return createPortal(
    <dialog ref={ref} className="model-preview model-preview-dialog" aria-labelledby={titleId}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
        const controls = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')].filter((node) => node.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onPointerDown={(event) => { backdropDown.current = event.target === ref.current && outside(event.clientX, event.clientY); }}
      onPointerUp={(event) => {
        if (backdropDown.current && event.target === ref.current && outside(event.clientX, event.clientY)) onClose();
        backdropDown.current = false;
      }}>
      {children}
    </dialog>, document.body,
  );
}
