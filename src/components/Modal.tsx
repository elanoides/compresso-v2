import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from './controls/Button';
import { TextField } from './controls/Inputs';

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions: ReactNode;
}

export function Modal({ title, children, onClose, actions }: ModalProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-lg border border-studio-border-strong bg-studio-surface p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-2 text-[14px] font-semibold text-studio-text">{title}</h2>
        <div className="mb-5 text-[12px] leading-relaxed text-studio-muted">{children}</div>
        <div className="flex justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}

const RENAME_OFFER_MS = 7000;

interface RenameOfferDialogProps {
  serialName: string;
  suggestedName: string;
  onApply: (name: string) => string | null;
  onKeep: () => void;
}

interface ScopeConfirmDialogProps {
  title: string;
  styleName: string;
  description: string;
  onCurrent: () => void;
  onAll: () => void;
  onCancel: () => void;
}

/** Ask whether a kerning/ligature edit applies to one style or every style. */
export function ScopeConfirmDialog({
  title,
  styleName,
  description,
  onCurrent,
  onAll,
  onCancel,
}: ScopeConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>Отмена</Button>
          <Button onClick={onCurrent}>Только «{styleName}»</Button>
          <Button variant="primary" onClick={onAll}>
            Ко всем начертаниям
          </Button>
        </>
      }
    >
      <p>{description}</p>
    </Modal>
  );
}

export function RenameOfferDialog({
  serialName,
  suggestedName,
  onApply,
  onKeep,
}: RenameOfferDialogProps) {
  const [draft, setDraft] = useState(suggestedName);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const keepRef = useRef(onKeep);
  keepRef.current = onKeep;

  useEffect(() => {
    if (paused) {
      return undefined;
    }
    const timer = window.setTimeout(() => keepRef.current(), RENAME_OFFER_MS);
    return () => window.clearTimeout(timer);
  }, [paused]);

  const apply = () => {
    const result = onApply(draft);
    if (result) {
      setError(result);
    }
  };

  return (
    <Modal
      title={`Начертание создано: «${serialName}»`}
      onClose={onKeep}
      actions={
        <>
          <Button onClick={onKeep}>Оставить {serialName}</Button>
          <Button variant="primary" onClick={apply}>
            Применить имя
          </Button>
        </>
      }
    >
      <p className="mb-3">Хотите задать осмысленное название на основе параметров?</p>
      <TextField
        label="Новое имя"
        value={draft}
        onChange={(value) => {
          setPaused(true);
          setError(null);
          setDraft(value);
        }}
        onFocus={() => setPaused(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            apply();
          }
        }}
      />
      {error ? <p className="mt-2 text-[#ff746d]">{error}</p> : null}
    </Modal>
  );
}
