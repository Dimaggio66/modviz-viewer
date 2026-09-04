/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * FloatingToolbar — the viewer's only desktop command surface.
 *
 * It replaces the two toolbars that shipped before it (the classic single
 * strip and the tabbed ribbon) and carries their commands unchanged: the six
 * workspace tabs still own the wiring, this file only arranges them.
 *
 * Three pills float over one continuous background instead of a bar that owns
 * a band of its own:
 *
 *   ┌── modes ──┐        ┌── commands for the active mode ──┐   ┌ model ─┐
 *
 * Nothing is written on a button — every command is an icon, named by its
 * tooltip and its accessible name (see `primitives.tsx`). The row itself is
 * `pointer-events-none` so the canvas keeps receiving drags in the gaps
 * between the pills; each pill turns pointer events back on.
 */

import React from 'react';
import {
  Boxes,
  ChartColumn,
  ChevronDown,
  ChevronUp,
  Eye,
  FolderOpen,
  HelpCircle,
  Loader2,
  MousePointer2,
  PenLine,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore, type RibbonTabId } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { cn } from '@/lib/utils';
import { TOUR_ANCHORS, tourAnchor } from '@/lib/tours/anchors';
import { ThemeSwitch } from '../ThemeSwitch';
import { ExportChangesButton } from '../ExportChangesButton';
import { ExtensionToolbarSlot } from '@/components/extensions/ExtensionToolbarSlot';
import { useFileCommands } from '../toolbar/useFileCommands';
import { COMMAND_PILL_CLASS } from './primitives';
import { FileTab } from './tabs/FileTab';
import { HomeTab } from './tabs/HomeTab';
import { ViewTab } from './tabs/ViewTab';
import { ElementsTab } from './tabs/ElementsTab';
import { AnalyzeTab } from './tabs/AnalyzeTab';
import { AuthorTab } from './tabs/AuthorTab';
import { useRibbonContextualTab } from './useRibbonContextualTab';

const RIBBON_TABS: { id: RibbonTabId; label: string; tooltip: string; icon: React.ElementType }[] = [
  { id: 'file', label: 'File', tooltip: 'Models and export', icon: FolderOpen },
  { id: 'home', label: 'Home', tooltip: 'Selection and markup tools', icon: MousePointer2 },
  { id: 'view', label: 'View', tooltip: 'Camera and presentation', icon: Eye },
  { id: 'elements', label: 'Elements', tooltip: 'Element selection and visibility', icon: Boxes },
  { id: 'analyze', label: 'Analyze', tooltip: 'Checks, comparisons and data', icon: ChartColumn },
  { id: 'author', label: 'Author', tooltip: 'Edit and create elements', icon: PenLine },
];

interface FloatingToolbarProps {
  onShowShortcuts?: () => void;
}

export function FloatingToolbar({ onShowShortcuts }: FloatingToolbarProps = {} as FloatingToolbarProps) {
  // The active tab lives in the store so the contextual driver and the
  // walkthrough can open one; it starts on Home and is never persisted.
  const activeTab = useViewerStore((s) => s.ribbonTab);
  const setActiveTab = useViewerStore((s) => s.setRibbonTab);
  const ribbonCollapsed = useViewerStore((s) => s.ribbonCollapsed);
  const setRibbonCollapsed = useViewerStore((s) => s.setRibbonCollapsed);

  useRibbonContextualTab();

  // Shared command surface — registers the global load listeners and the
  // hidden file inputs exactly once.
  const fileCommands = useFileCommands();

  const { loading, progress, geometryProgress, metadataProgress } = useIfc();
  const error = useViewerStore((state) => state.error);
  const activeProgress = geometryProgress ?? metadataProgress ?? progress;

  const handleTabChange = (id: RibbonTabId) => {
    if (id === activeTab) return;
    setActiveTab(id);
    // Picking a workspace always shows its commands. Hiding them is the
    // dedicated button's job, not a second meaning for the mode buttons:
    // the trigger cannot see whether it was already selected without a
    // handler of its own, and any such handler either reads a stale
    // `isActive` (Radix switches on mousedown, before click) or clobbers
    // Radix's own pointer handling and stops the tabs switching at all.
    // Both of those shipped here before this comment did.
    setRibbonCollapsed(false);
  };

  return (
    <div
      className={cn(
        'viewer-topbar modviz-toolbar-shell modviz-floating-toolbar',
        // No fill and no border of its own: the shell's background runs
        // straight through, so the pills read as floating on one continuous
        // surface rather than sitting in a bar. It still takes part in the
        // column layout — the docked side panels start below it, they are not
        // covered by it.
        'pointer-events-none relative z-50 flex shrink-0 items-start gap-3 bg-transparent p-3',
      )}
    >
      {fileCommands.fileInputs}

      {/* ── 1 · Workspace modes ── */}
      <div className="flex shrink-0 flex-col items-start gap-2">
        <Tabs value={activeTab} onValueChange={(id) => handleTabChange(id as RibbonTabId)}>
          <TabsList
            aria-label="Workspace modes"
            className={cn(COMMAND_PILL_CLASS, 'modviz-ribbon-mode-switcher h-auto')}
            {...tourAnchor(TOUR_ANCHORS.ribbonTabs)}
          >
            {RIBBON_TABS.map((tab) => {
              const isActive = tab.id === activeTab;
              const TabIcon = tab.icon;
              return (
                <Tooltip key={tab.id}>
                  <TooltipTrigger asChild>
                    <TabsTrigger
                      value={tab.id}
                      aria-label={tab.label}
                      className={cn(
                        'h-9 w-9 shrink-0 rounded-xl p-0',
                        'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm',
                        isActive
                          ? 'text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <TabIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{tab.tooltip}</TooltipContent>
                </Tooltip>
              );
            })}
          </TabsList>
        </Tabs>

        {/* Load progress and errors sit under the modes rather than inside
            them, so the switcher never changes width while a model loads. */}
        {loading && activeProgress && (
          <div className={cn(COMMAND_PILL_CLASS, 'gap-2 px-2.5 py-1.5')}>
            <span className="max-w-32 truncate text-xs text-muted-foreground">
              {activeProgress.phase}
              {geometryProgress && metadataProgress ? ` | ${metadataProgress.phase}` : ''}
            </span>
            {activeProgress.indeterminate ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <Progress value={activeProgress.percent ?? 0} className="h-2 w-20" />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(activeProgress.percent ?? 0)}%
                </span>
              </>
            )}
          </div>
        )}
        {error && (
          <div className={cn(COMMAND_PILL_CLASS, 'px-2.5 py-1.5')}>
            <span className="max-w-56 truncate text-xs text-destructive">{error}</span>
          </div>
        )}
      </div>

      {/* ── 2 · Commands for the active mode ── */}
      {!ribbonCollapsed && (
        <div
          role="tabpanel"
          aria-label={`${activeTab} commands`}
          className={cn(
            COMMAND_PILL_CLASS,
            'modviz-ribbon-band mx-auto max-w-[calc(100vw-26rem)] overflow-x-auto overflow-y-hidden',
          )}
        >
          {activeTab === 'file' && <FileTab fileCommands={fileCommands} />}
          {activeTab === 'home' && <HomeTab />}
          {activeTab === 'view' && <ViewTab />}
          {activeTab === 'elements' && <ElementsTab />}
          {activeTab === 'analyze' && <AnalyzeTab />}
          {activeTab === 'author' && <AuthorTab />}
        </div>
      )}

      {/* ── 3 · Model-level actions ── */}
      <div className={cn(COMMAND_PILL_CLASS, 'modviz-toolbar-utilities ml-auto')}>
        <ExtensionToolbarSlot slot="toolbar.right" />
        <ExportChangesButton />

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="modviz-ribbon-theme">
              <ThemeSwitch />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">Toggle theme (Shift+click for secret mode)</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="modviz-utility-separator mx-0.5 h-6" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Info and keyboard shortcuts"
              onClick={() => onShowShortcuts?.()}
              className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <HelpCircle className="h-[18px] w-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Info (?)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={ribbonCollapsed ? 'Show commands' : 'Hide commands'}
              aria-expanded={!ribbonCollapsed}
              onClick={() => setRibbonCollapsed(!ribbonCollapsed)}
              {...tourAnchor(TOUR_ANCHORS.ribbonCollapse)}
              className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {ribbonCollapsed ? <ChevronDown className="h-[18px] w-[18px]" /> : <ChevronUp className="h-[18px] w-[18px]" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{ribbonCollapsed ? 'Show commands' : 'Hide commands'}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
