import type { MouseEvent, ReactNode } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'inverted' | 'danger' | 'ghost';

interface ButtonProps {
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  title?: string;
  fullWidth?: boolean;
  compact?: boolean;
  type?: 'button' | 'submit';
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default:
    'border-studio-border/80 bg-transparent text-studio-text hover:border-studio-border-strong hover:bg-studio-surface disabled:hover:border-studio-border/80',
  primary: 'border-studio-text/30 bg-studio-raised text-studio-text font-medium hover:bg-studio-border',
  inverted: 'border-black bg-black text-white font-medium hover:bg-[#1a1a1a]',
  danger: 'border-studio-danger bg-studio-danger text-black font-medium hover:opacity-90',
  ghost:
    'border-transparent bg-transparent text-studio-muted hover:bg-studio-surface hover:text-studio-text',
};

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled = false,
  title,
  fullWidth = false,
  compact = false,
  type = 'button',
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={
        'inline-flex items-center justify-center gap-1.5 rounded border text-[12px] whitespace-nowrap transition-colors ' +
        'disabled:cursor-not-allowed disabled:opacity-40 ' +
        (compact ? 'px-2 py-1.5 ' : 'px-3 py-2 ') +
        (fullWidth ? 'w-full ' : '') +
        VARIANT_CLASS[variant]
      }
    >
      {children}
    </button>
  );
}
