import { Modal } from "./Modal";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
  readonly destructive?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
  destructive = false,
}: ConfirmDialogProps) {
  return (
    <Modal
      className={styles.modal}
      describedBy="confirm-dialog-message"
      labelledBy="confirm-dialog-title"
      onClose={onClose}
      open={open}
    >
      <section className={styles.card}>
        <p className={styles.eyebrow}>Please confirm</p>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p className={styles.message} id="confirm-dialog-message">
          {message}
        </p>
        <div className={styles.actions}>
          <button type="button" data-autofocus onClick={onClose}>
            Keep playing
          </button>
          <button
            type="button"
            data-destructive={destructive || undefined}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </Modal>
  );
}
