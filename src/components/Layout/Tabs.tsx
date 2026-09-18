import type { TabId } from '../../types/fontTypes';

export const TAB_LABELS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'word', label: 'Наборщик' },
  { id: 'glyph', label: 'Глиф' },
  { id: 'styles', label: 'Начертания' },
  { id: 'animation', label: 'Анимация' },
];

interface TabsProps {
  active: TabId;
  onChange: (tab: TabId) => void;
}

export function Tabs({ active, onChange }: TabsProps) {
  return (
    <nav className="flex flex-wrap gap-0.5" role="tablist" aria-label="Разделы студии">
      {TAB_LABELS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={
              'rounded-md px-3 py-1.5 text-[12px] transition-colors ' +
              (selected
                ? 'bg-studio-raised font-medium text-studio-text'
                : 'text-studio-muted hover:bg-studio-surface hover:text-studio-text')
            }
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
