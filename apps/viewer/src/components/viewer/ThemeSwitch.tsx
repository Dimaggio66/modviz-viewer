/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useRef, type PointerEvent } from 'react';
import { Contrast } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { useViewerStore } from '@/store';
import { cn } from '@/lib/utils';

/**
 * Accessible light/dark theme toggle.
 *
 * An icon toggle rather than a switch with a written label: it sits in the
 * floating command pill next to icon-only buttons, where "Dark Mode" spelled
 * out was the only text on the whole surface. The name it lost from the label
 * lives on in `aria-label` and in the tooltip its parent mounts.
 *
 * Hold Shift while clicking to toggle the hidden colorful theme.
 */
export function ThemeSwitch() {
  const shiftHeldRef = useRef(false);
  const theme = useViewerStore((state) => state.theme);
  const setTheme = useViewerStore((state) => state.setTheme);
  const toggleColorful = useViewerStore((state) => state.toggleColorful);
  const isColorful = theme === 'colorful';

  // Radix reports only the resulting pressed state, not the event, so the
  // Shift flag has to be captured on the way down — same as before.
  const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    shiftHeldRef.current = event.shiftKey;
  }, []);

  const handlePressedChange = useCallback((pressed: boolean) => {
    if (shiftHeldRef.current) {
      shiftHeldRef.current = false;
      toggleColorful();
      return;
    }

    setTheme(pressed ? 'dark' : 'light');
  }, [setTheme, toggleColorful]);

  return (
    <Toggle
      pressed={theme === 'dark'}
      onPressedChange={handlePressedChange}
      onPointerDown={handlePointerDown}
      aria-label="Dark Mode"
      className={cn(
        // Match the icon buttons sharing the pill: same box, same corner, and
        // the 18px icon the pill uses instead of the toggle's default 16px.
        'h-9 w-9 min-w-0 rounded-xl p-0 text-muted-foreground [&_svg]:size-[18px]',
        'hover:bg-muted hover:text-foreground data-[state=on]:bg-muted data-[state=on]:text-foreground',
        isColorful && 'scale-110',
      )}
      style={isColorful ? {
        filter: 'drop-shadow(0 0 6px rgba(157,124,216,0.5)) drop-shadow(0 0 12px rgba(255,158,100,0.25))',
      } : undefined}
    >
      <Contrast aria-hidden="true" />
    </Toggle>
  );
}
