/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon toolbar (issue #1686) — the tabbed, IFCFlux/Office-style
 * alternative to the classic single-strip `MainToolbar`, and the default
 * toolbar since the ribbon shipped. A slim tab strip selects a command
 * context; the band beneath lays the commands out in labeled groups with
 * visible names, trading one strip of vertical space for zero-recall
 * discovery. Selected per user via `uiSlice.toolbarStyle`; both styles
 * drive the same shared command hooks so behaviour can never fork.
 *
 * Office conventions kept: double-click the active tab (or the chevron)
 * to collapse the band to the tab strip; the collapsed state persists.
 * The active tab also follows the working context (see
 * `useRibbonContextualTab`), which the user can turn off in View.
 */

import React from 'react';
import { ChevronDown, ChevronUp, HelpCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore, type RibbonTabId } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { cn } from '@/lib/utils';
import { TOUR_ANCHORS, tourAnchor } from '@/lib/tours/anchors';
import { ThemeSwitch } from '../ThemeSwitch';
import { ExportChangesButton } from '../ExportChangesButton';
import { ExtensionToolbarSlot } from '@/components/extensions/ExtensionToolbarSlot';
import { useFileCommands } from '../toolbar/useFileCommands';
import { FileTab } from './tabs/FileTab';
import { HomeTab } from './tabs/HomeTab';
import { ViewTab } from './tabs/ViewTab';
import { ElementsTab } from './tabs/ElementsTab';
import { AnalyzeTab } from './tabs/AnalyzeTab';
import { AuthorTab } from './tabs/AuthorTab';
import { RibbonSwitchNotice } from './RibbonSwitchNotice';
import { useRibbonContextualTab } from './useRibbonContextualTab';

const RIBBON_TABS: { id: RibbonTabId; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'home', label: 'Home' },
  { id: 'view', label: 'View' },
  { id: 'elements', label: 'Elements' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'author', label: 'Author' },
];

interface RibbonToolbarProps {
  onShowShortcuts?: () => void;
}

export function RibbonToolbar({ onShowShortcuts }: RibbonToolbarProps = {} as RibbonToolbarProps) {
  // The active tab lives in the store so the contextual driver and the
  // walkthrough can open one; it starts on Home and is never persisted.
  const activeTab = useViewerStore((s) => s.ribbonTab);
  const setActiveTab = useViewerStore((s) => s.setRibbonTab);
  const ribbonCollapsed = useViewerStore((s) => s.ribbonCollapsed);
  const setRibbonCollapsed = useViewerStore((s) => s.setRibbonCollapsed);

  useRibbonContextualTab();

  // Shared command surface — registers the global load listeners and the
  // hidden file inputs exactly once for this toolbar style.
  const fileCommands = useFileCommands();

  const { loading, progress, geometryProgress, metadataProgress } = useIfc();
  const error = useViewerStore((state) => state.error);
  const activeProgress = geometryProgress ?? metadataProgress ?? progress;

  const handleTabClick = (id: RibbonTabId) => {
    if (id === activeTab && !ribbonCollapsed) return;
    setActiveTab(id);
    // Clicking any tab while collapsed re-opens the band (Office pins on click).
    if (ribbonCollapsed) setRibbonCollapsed(false);
  };

  return (
    <div className="viewer-topbar modviz-toolbar-shell modviz-ribbon relative z-50 border-b border-border bg-card text-foreground shadow-sm">
      {fileCommands.fileInputs}

      {/* ── Tab strip ── */}
      <div className="modviz-toolbar-strip flex h-14 min-w-0 items-center gap-3 border-b border-border/80 px-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <div
            role="tablist"
            aria-label="Ribbon tabs"
            className="modviz-ribbon-tablist flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-2"
            {...tourAnchor(TOUR_ANCHORS.ribbonTabs)}
          >
            {RIBBON_TABS.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleTabClick(tab.id)}
                  onDoubleClick={() => {
                    if (isActive) setRibbonCollapsed(!ribbonCollapsed);
                  }}
                  className={cn(
                    'relative flex h-9 shrink-0 select-none items-center rounded-lg px-3 text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    isActive
                      ? 'bg-muted text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {tab.label}
                  {isActive && (
                  <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>

          {loading && activeProgress && (
            <div className="hidden min-w-0 items-center gap-2 2xl:flex">
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

          {error && <span className="max-w-40 truncate text-xs text-destructive">{error}</span>}
        </div>

        <div className="ml-auto flex min-w-0 items-center">
          <ExtensionToolbarSlot slot="toolbar.right" />
          <ExportChangesButton />

          <div className="modviz-toolbar-utilities ml-1 flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="modviz-ribbon-theme">
                <ThemeSwitch />
              </div>
            </TooltipTrigger>
            <TooltipContent>Toggle theme (Shift+click for secret mode)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Info and keyboard shortcuts"
                onClick={() => onShowShortcuts?.()}
                className="text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Info (?)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={ribbonCollapsed ? 'Expand the ribbon' : 'Collapse the ribbon'}
                aria-expanded={!ribbonCollapsed}
                onClick={() => setRibbonCollapsed(!ribbonCollapsed)}
                {...tourAnchor(TOUR_ANCHORS.ribbonCollapse)}
                className="text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {ribbonCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{ribbonCollapsed ? 'Expand the ribbon' : 'Collapse the ribbon'}</TooltipContent>
          </Tooltip>
          </div>
        </div>
      </div>

      {/* ── Band ── */}
      {!ribbonCollapsed && (
        <div
          role="tabpanel"
          aria-label={`${activeTab} commands`}
          className="modviz-ribbon-band flex h-[96px] items-stretch overflow-x-auto overflow-y-hidden border-b border-border/80 bg-card/95 px-2"
        >
          {activeTab === 'file' && <FileTab fileCommands={fileCommands} />}
          {activeTab === 'home' && <HomeTab />}
          {activeTab === 'view' && <ViewTab />}
          {activeTab === 'elements' && <ElementsTab />}
          {activeTab === 'analyze' && <AnalyzeTab />}
          {activeTab === 'author' && <AuthorTab />}
        </div>
      )}

      {/* One-time "the toolbar changed" line, with the way back. Sits under
          the band so it never displaces a command the user is reaching for. */}
      <RibbonSwitchNotice />
    </div>
  );
}
