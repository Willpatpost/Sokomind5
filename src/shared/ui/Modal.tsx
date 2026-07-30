import {
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import styles from "./Modal.module.css";

interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly labelledBy?: string;
  readonly describedBy?: string;
  readonly label?: string;
  readonly className?: string;
  readonly mobileSheet?: boolean;
  readonly closeOnBackdrop?: boolean;
  readonly children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  "[data-autofocus]",
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Accessible application modal built on the browser's top-layer dialog.
 *
 * `showModal()` supplies focus containment and makes the rest of the page
 * inert. This wrapper adds predictable initial/return focus and backdrop
 * behavior for every Sokomind overlay.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  describedBy,
  label,
  className,
  mobileSheet = false,
  closeOnBackdrop = true,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    if (!dialog.open) dialog.showModal();
    document.documentElement.dataset.modalOpen = "";

    const frame = window.requestAnimationFrame(() => {
      const initialFocus = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      initialFocus?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (dialog.open) dialog.close();
      if (!document.querySelector("dialog[open]")) {
        delete document.documentElement.dataset.modalOpen;
      }
      const returnFocus = returnFocusRef.current;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [open]);

  function handleBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (!closeOnBackdrop || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside) onClose();
  }

  const dialogClassName = className
    ? `${styles.dialog} ${className}`
    : styles.dialog;

  return (
    <dialog
      aria-describedby={describedBy}
      aria-label={label}
      aria-labelledby={labelledBy}
      className={dialogClassName}
      data-mobile-sheet={mobileSheet || undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={handleBackdrop}
      ref={dialogRef}
    >
      {children}
    </dialog>
  );
}
