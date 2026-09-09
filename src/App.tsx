import { useCallback, useState } from 'react';

import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { RenameOfferDialog, ScopeConfirmDialog } from './components/Modal';
import { AnimationStudio } from './components/Tabs/AnimationStudio';
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
import type { ApplyScope } from './engine/styleAssets';
import { useStudio } from './hooks/useStudio';
import type { Ligature } from './types/fontTypes';

export default function App() {
  const studio = useStudio();
  const [renameOffer, setRenameOffer] = useState<{
    serial: string;
    suggested: string;
  } | null>(null);
  const [loadStatus, setLoadStatus] = useState<string | null>(null);
  const [loadStatusKind, setLoadStatusKind] = useState<'ok' | 'warn' | 'error' | null>(null);
  const [loadBusy, setLoadBusy] = useState(false);
  const [scopePrompt, setScopePrompt] = useState<{
    title: string;
    description: string;
    run: (scope: ApplyScope) => void;
  } | null>(null);

  const askScope = useCallback(
    (title: string, description: string, run: (scope: ApplyScope) => void) => {
      setScopePrompt({ title, description, run });
    },
    [],
  );

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
            result.glyphsByStyle,
            result.ligaturesByStyle,
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

  const requestSetLigature = useCallback(
    (trigger: string, entry: Ligature, onDone?: () => void) => {
      askScope(
        'Сохранить лигатуру',
        `Применить лигатуру «${trigger}» только к начертанию «${studio.activePreset}» или ко всем начертаниям?`,
        (scope) => {
          studio.setLigature(trigger, entry, scope);
          onDone?.();
        },
      );
    },
    [askScope, studio],
  );

  const requestRemoveLigature = useCallback(
    (trigger: string) => {
      askScope(
        'Удалить лигатуру',
        `Удалить лигатуру «${trigger}» только из «${studio.activePreset}» или из всех начертаний?`,
        (scope) => studio.removeLigature(trigger, scope),
      );
    },
    [askScope, studio],
  );

  const requestKerningPair = useCallback(
    (pair: string, delta: number) => {
      askScope(
        'Кернинговая пара',
        `Задать пару «${pair}» только для «${studio.activePreset}» или для всех начертаний?`,
        (scope) => studio.applyKerningPair(pair, delta, scope),
      );
    },
    [askScope, studio],
  );

  const requestRemoveKerning = useCallback(
    (pair: string) => {
      askScope(
        'Удалить кернинг',
        `Убрать пару «${pair}» только из «${studio.activePreset}» или из всех начертаний?`,
        (scope) => studio.removeKerningPair(pair, scope),
      );
    },
    [askScope, studio],
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
          onApplyKerningPair={requestKerningPair}
          onRemoveKerningPair={requestRemoveKerning}
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
              glyphsByStyle={studio.glyphsByStyle}
              ligaturesByStyle={studio.ligaturesByStyle}
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
              onSetLigature={requestSetLigature}
              onRemoveLigature={requestRemoveLigature}
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
              glyphsByStyle={studio.glyphsByStyle}
              ligaturesByStyle={studio.ligaturesByStyle}
            />
          ) : null}

          {studio.tab === 'animation' ? (
            <AnimationStudio
              presets={studio.presets}
              activePreset={studio.activePreset}
              text={studio.wordText}
              onTextChange={studio.setWordText}
              glyphsByStyle={studio.glyphsByStyle}
              ligaturesByStyle={studio.ligaturesByStyle}
              fontPaths={studio.context.fontPaths}
              fontAlphabet={studio.context.fontAlphabet}
              onCreatePreset={(name, sourceStyleName) => {
                const source = sourceStyleName
                  ? studio.presets[sourceStyleName]
                  : undefined;
                return studio.createPreset(name, source, false, sourceStyleName);
              }}
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

      {scopePrompt ? (
        <ScopeConfirmDialog
          title={scopePrompt.title}
          styleName={studio.activePreset}
          description={scopePrompt.description}
          onCurrent={() => {
            scopePrompt.run('current');
            setScopePrompt(null);
          }}
          onAll={() => {
            scopePrompt.run('all');
            setScopePrompt(null);
          }}
          onCancel={() => setScopePrompt(null)}
        />
      ) : null}
    </div>
  );
}
