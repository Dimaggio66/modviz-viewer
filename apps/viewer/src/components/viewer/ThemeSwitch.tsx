/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useId, useRef, type PointerEvent } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useViewerStore } from '@/store';

/**
 * Accessible light/dark theme switch.
 *
 * Hold Shift while clicking to toggle the hidden colorful theme.
 */
export function ThemeSwitch() {
  const id = useId();
  const shiftHeldRef = useRef(false);
  const theme = useViewerStore((state) => state.theme);
  const setTheme = useViewerStore((state) => state.setTheme);
  const toggleColorful = useViewerStore((state) => state.toggleColorful);
  const isColorful = theme === 'colorful';

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    shiftHeldRef.current = event.shiftKey;
  }, []);

  const handleCheckedChange = useCallback((checked: boolean) => {
    if (shiftHeldRef.current) {
      shiftHeldRef.current = false;
      toggleColorful();
      return;
    }

    setTheme(checked ? 'dark' : 'light');
  }, [setTheme, toggleColorful]);

  return (
    <div
      onPointerDown={handlePointerDown}
      className={`flex items-center space-x-2 transition-all duration-300 ${
        isColorful
          ? 'scale-110 opacity-100'
          : 'opacity-80 hover:opacity-100'
      }`}
      style={isColorful ? {
        filter: 'drop-shadow(0 0 6px rgba(157,124,216,0.5)) drop-shadow(0 0 12px rgba(255,158,100,0.25))',
      } : undefined}
    >
      <Switch
        id={id}
        checked={theme === 'dark'}
        onCheckedChange={handleCheckedChange}
        aria-label="Dark Mode"
      />
      <Label htmlFor={id} className="cursor-pointer whitespace-nowrap text-xs">
        Dark Mode
      </Label>
    </div>
  );
}
