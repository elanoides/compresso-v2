import { useCallback, useState } from 'react';

import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { RenameOfferDialog } from './components/Modal';
import { GlyphInspector } from './components/Tabs/GlyphInspector';
import { PresetsGallery } from './components/Tabs/PresetsGallery';
import { WordTester } from './components/Tabs/WordTester';
import {
  FOREIGN_FONT_MESSAGE,
  parseStudioFile,
  studioFontLoadedMessage,
} from './engine/fontLoader';
import {
  generateStyleName,
  nextOrdinalStyleName,
} from './engine/nameGenerator';
import { useStudio } from './hooks/useStudio';

export default function App() {
  const studio = useStudio();
  const [renameOffer, setRenameOffer] = useState<{
    serial: string;
    suggested: string;
  } | null>(null);
  const [loadStatus, setLoadStatus] = useState<string | null>(null);
  const [loadStatusKind, setLoadStatusKind] = useState<'ok' | 'warn' | 'error' | null>(null);
  const [loadBusy, setLoadBusy] = useState(false);

  const saveAsNew = useCallback(() => {
    const names = Object.keys(studio.presets);
    const serial = nextOrdinalStyleName(names);
    const error = studio.createPreset(serial);
    if (error) {
      return;
    }
    const suggested = generateStyleName(studio.params, [...names, serial], studio.presets);
    setRenameOffer({ serial, suggested });
  }, [studio]);

  const applyOfferedName = useCallback(
    (name: string) => {
      if (!renameOffer) {
        return null;
      }
      const error = studio.renamePreset(renameOffer.serial, name);
      if (error) {
        return error;
      }
      setRenameOffer(null);
      return null;
    },
    [renameOffer, studio],
  );

  const loadStudioFile = useCallback(
    async (file: File) => {
      setLoadBusy(true);
      try {
        const result = await parseStudioFile(file);
        if (result.kind === 'foreign') {
          setLoadStatus(FOREIGN_FONT_MESSAGE);
          setLoadStatusKind('warn');
          return;
        }
        if (result.kind === 'json') {
          studio.replaceLibrary(
            result.presets,
            result.active,
            result.customGlyphs,
            result.ligatures,
          );
          const glyphCount = Object.keys(result.customGlyphs).length;
          const ligCount = Object.keys(result.ligatures).length;
          setLoadStatus(
            `Загружено начертаний: ${Object.keys(result.presets).length}` +
              (glyphCount > 0 ? ` · глифов: ${glyphCount}` : '') +
              (ligCount > 0 ? ` · лигатур: ${ligCount}` : ''),
          );
          setLoadStatusKind('ok');
          return;
        }
        const applied = studio.loadStudioSnapshot(
          result.presetName,
          result.params,
          result.customGlyphs,
          result.ligatures,
        );
        setLoadStatus(studioFontLoadedMessage(applied));
        setLoadStatusKind('ok');
      } catch (cause) {
        setLoadStatus(
          `Не удалось прочитать файл: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        setLoadStatusKind('error');
      } finally {
        setLoadBusy(false);
      }
    },
    [studio],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-studio-bg">
      <Header
        activeTab={studio.tab}
        onTabChange={studio.setTab}
        activePreset={studio.activePreset}
        presetCount={Object.keys(studio.presets).length}
      />

      <div className="flex min-h-0 w-full flex-1 overflow-hidden">
        <Sidebar
          params={studio.params}
          onChange={studio.updateParams}
          fontLoading={studio.fontLoading}
          fontError={studio.fontError}
          presets={studio.presets}
          activePreset={studio.activePreset}
          onApplyPreset={studio.applyPreset}
          onSavePreset={studio.saveActivePreset}
          onResetPreset={studio.resetToRegular}
          onCreatePreset={studio.createPreset}
          onSaveAsNew={saveAsNew}
          onLoadStudioFile={loadStudioFile}
          loadStatus={loadStatus}
          loadStatusKind={loadStatusKind}
          loadBusy={loadBusy}
        />

        <main className="min-w-0 flex-1 overflow-hidden p-4">
          {studio.tab === 'word' ? (
            <WordTester
              context={studio.context}
              presets={studio.presets}
              activePreset={studio.activePreset}
              text={studio.wordText}
              onTextChange={studio.setWordText}
              previewScale={studio.previewScale}
              onPreviewScaleChange={studio.setPreviewScale}
            />
          ) : null}

          {studio.tab === 'glyph' ? (
            <GlyphInspector
              context={studio.context}
              activePreset={studio.activePreset}
              char={studio.inspectChar}
              onCharChange={studio.setInspectChar}
              customGlyphs={studio.customGlyphs}
              ligatures={studio.ligatures}
              onSetGlyph={studio.setCustomGlyph}
              onRemoveGlyph={studio.removeCustomGlyph}
              onMergeGlyphs={studio.mergeCustomGlyphs}
              onAddVariant={studio.addCustomGlyphVariant}
              onSelectVariant={studio.selectCustomGlyphVariant}
              onRemoveVariant={studio.removeCustomGlyphVariant}
              onSetLigature={studio.setLigature}
              onRemoveLigature={studio.removeLigature}
              onResetAllGlyphs={() => studio.replaceCustomGlyphs({})}
            />
          ) : null}

          {studio.tab === 'styles' ? (
            <PresetsGallery
              presets={studio.presets}
              activePreset={studio.activePreset}
              onApply={studio.applyPreset}
              onCreate={studio.createPreset}
              onRename={studio.renamePreset}
              onDelete={studio.deletePreset}
              customGlyphs={studio.customGlyphs}
              ligatures={studio.ligatures}
            />
          ) : null}
        </main>
      </div>

      {renameOffer ? (
        <RenameOfferDialog
          serialName={renameOffer.serial}
          suggestedName={renameOffer.suggested}
          onApply={applyOfferedName}
          onKeep={() => setRenameOffer(null)}
        />
      ) : null}
    </div>
  );
}
