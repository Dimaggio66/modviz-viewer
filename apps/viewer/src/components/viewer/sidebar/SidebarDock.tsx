/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The viewer's right region (#1208): a VS Code-style activity bar + a
 * docked content pane. Its width is controlled by the surrounding
 * shadcn-style ResizablePanel in ViewerLayout.
 *
 * Two modes (persisted in `sidebarSlice`):
 *   - `expanded`  — content pane + activity bar (the content pane is resizable).
 *   - `collapsed` — activity bar only (icons); clicking an icon re-expands.
 *
 * The activity-bar rail is ALWAYS visible — it is the always-available entry
 * point to every panel, so there is no "fully hidden" state. The content pane
 * width is stored as a % of the main row so it survives reloads and travels
 * with a Flavor.
 */

import { useViewerStore } from '@/store';
import { ActivityBar } from './ActivityBar';
import { SidebarPanelHost } from './SidebarPanelHost';

export const SIDEBAR_ACTIVITY_BAR_WIDTH = 48; // w-12

export function SidebarDock() {
  const mode = useViewerStore((s) => s.sidebarMode);

  return (
    <div className="viewer-sidebar-dock flex h-full min-w-0">
      {mode === 'expanded' && (
        <div className="viewer-panel-surface h-full min-w-0 flex-1 overflow-hidden panel-container">
          <SidebarPanelHost />
        </div>
      )}
      <ActivityBar />
    </div>
  );
}
