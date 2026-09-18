import { Tabs } from './Tabs';
import type { TabId } from '../../types/fontTypes';

interface HeaderProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  activePreset: string;
  presetCount: number;
}

export function Header({
  activeTab,
  onTabChange,
  activePreset,
  presetCount,
}: HeaderProps) {
  return (
    <header className="flex shrink-0 items-center gap-6 border-b border-studio-border/80 bg-studio-bg/80 px-5 py-3 backdrop-blur-sm">
      <div className="min-w-0 shrink-0">
        <h1 className="text-[15px] font-semibold tracking-[0.08em] text-studio-text uppercase">
          Compresso
        </h1>
        <p className="mt-0.5 truncate font-mono text-[10px] tracking-wide text-studio-faint">
          {activePreset}
          <span className="text-studio-border-strong"> · </span>
          {presetCount} начертаний
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <Tabs active={activeTab} onChange={onTabChange} />
      </div>
    </header>
  );
}
