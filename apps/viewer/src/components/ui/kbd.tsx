/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as React from 'react';
import { cn } from '@/lib/utils';

/** A compact visual representation of one physical keyboard key. */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-mono text-[10px] font-medium leading-none text-muted-foreground shadow-sm select-none',
        className,
      )}
      {...props}
    />
  );
}

/** Groups adjacent keys into one readable chord, such as Ctrl + K. */
function KbdGroup({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="kbd-group"
      className={cn('inline-flex items-center gap-1 whitespace-nowrap', className)}
      {...props}
    />
  );
}

interface ShortcutKbdProps {
  /** A shortcut string such as `Ctrl+K`, `⌘⇧F`, or `Del / Space`. */
  shortcut: string;
  className?: string;
  keyClassName?: string;
}

const MODIFIER_GLYPHS = new Set(['⌘', '⇧', '⌥', '⌃']);

function splitChord(chord: string) {
  const plusSeparated = chord.split(/\s*\+\s*/).filter(Boolean);
  if (plusSeparated.length > 1) return { keys: plusSeparated, showPlus: true };

  const characters = Array.from(chord);
  const modifiers = characters.filter((key) => MODIFIER_GLYPHS.has(key));
  const primaryKey = characters.filter((key) => !MODIFIER_GLYPHS.has(key)).join('');
  if (modifiers.length > 0 && primaryKey) return { keys: [...modifiers, primaryKey], showPlus: false };

  return { keys: [chord], showPlus: false };
}

/** Renders the viewer's shortcut strings with Kbd and KbdGroup. */
function ShortcutKbd({ shortcut, className, keyClassName }: ShortcutKbdProps) {
  const alternatives = shortcut.split(/\s*\/\s*/).filter(Boolean);

  return (
    <span aria-label={shortcut} className={cn('inline-flex items-center gap-1', className)}>
      {alternatives.map((alternative, alternativeIndex) => {
        const { keys, showPlus } = splitChord(alternative);
        return (
          <React.Fragment key={`${alternative}-${alternativeIndex}`}>
            {alternativeIndex > 0 && <span className="text-muted-foreground/70">/</span>}
            <KbdGroup>
              {keys.map((key, keyIndex) => (
                <React.Fragment key={`${key}-${keyIndex}`}>
                  {showPlus && keyIndex > 0 && <span className="text-muted-foreground/70">+</span>}
                  <Kbd className={keyClassName}>{key}</Kbd>
                </React.Fragment>
              ))}
            </KbdGroup>
          </React.Fragment>
        );
      })}
    </span>
  );
}

export { Kbd, KbdGroup, ShortcutKbd };
