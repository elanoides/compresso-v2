import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface AccordionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function Accordion({ title, children, defaultOpen = false }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="shrink-0 border-b border-studio-border/70 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 py-2.5 text-left transition-colors hover:text-studio-text"
      >
        <span className="text-[11px] font-medium tracking-[0.06em] text-studio-muted uppercase">
          {title}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-studio-faint transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open ? <div className="flex flex-col gap-2.5 pb-3">{children}</div> : null}
    </section>
  );
}
