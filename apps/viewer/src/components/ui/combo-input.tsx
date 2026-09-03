/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ComboInput — a free-text input that opens a suggestion dropdown on focus
 * and filters it as you type. Pick a suggestion or keep typing anything;
 * the value is never restricted to the options. Used by the filter chip
 * editors to surface real model values (materials, classifications,
 * property values, pset/qto names) without hiding them behind a tiny chevron.
 *
 * The list is portaled to `document.body` and fixed-positioned under the
 * input so it's never clipped by the modal's scroll container, and it
 * follows the input on scroll / resize.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ComboInputProps {
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<string>;
  placeholder?: string;
  className?: string;
  /** Cap rendered suggestions (filtering still scans all options). */
  maxRendered?: number;
  'aria-label'?: string;
}

/** Fixed-position placement for the portaled list. Opens downward from `top`
 *  or, when the input sits too low, upward from `bottom`; `maxHeight` is capped
 *  to the space actually available so the last option is always reachable. */
interface Anchor { left: number; width: number; maxHeight: number; top?: number; bottom?: number }

export function ComboInput({
  value,
  onChange,
  options,
  placeholder,
  className,
  maxRendered = 50,
  'aria-label': ariaLabel,
}: ComboInputProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  // Narrow the list by `value` only while actively typing. Reopening a field
  // that already holds a value (e.g. a picked number) shows the FULL list
  // again, so you can browse to another value without clearing the current one.
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    // While typing, narrow suggestions by the text — treat `*` as a wildcard
    // (stripped) so a query like `*AW*` still surfaces matches; for a compound
    // `&`/`||` query show the full list so options stay browsable.
    let q = '';
    if (typing) {
      const cleaned = value.replace(/\*/g, '').trim().toLowerCase();
      q = /[&|]/.test(cleaned) ? '' : cleaned;
    }
    const matches = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return matches.slice(0, maxRendered);
  }, [options, value, maxRendered, typing]);

  useEffect(() => { setHighlight(0); }, [filtered]);

  const reposition = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom - gap - margin;
    const spaceAbove = r.top - gap - margin;
    // Open upward only when there's little room below and more room above,
    // so a row low in the panel still shows its full (scrollable) list.
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(140, Math.floor(openUp ? spaceAbove : spaceBelow));
    setAnchor(
      openUp
        ? { left: r.left, width: r.width, maxHeight, bottom: window.innerHeight - r.top + gap }
        : { left: r.left, width: r.width, maxHeight, top: r.bottom + gap },
    );
  }, []);

  // Track the input's position while open (capture = also catch ancestor
  // scrolls inside the modal), and close on outside pointer-down / Escape.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const onScroll = () => reposition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (inputRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, reposition]);

  const showList = open && filtered.length > 0 && anchor !== null;

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
    setTyping(false);
  };

  return (
    <>
      <Input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setTyping(true); }}
        onFocus={() => { setOpen(true); setTyping(false); }}
        onClick={() => { setOpen(true); setTyping(false); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            if (showList && filtered[highlight] !== undefined) {
              e.preventDefault();
              commit(filtered[highlight]);
            }
          } else if (e.key === 'Escape') {
            if (open) {
              // Escape closes the suggestion list only. React's
              // stopPropagation doesn't reach Radix's DOCUMENT-level dismiss
              // listener, so a combo inside a Dialog would close the whole
              // dialog on the first Escape — stop the native event too.
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              e.preventDefault();
              setOpen(false);
            }
          }
        }}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-label={ariaLabel}
      />
      {showList && createPortal(
        <div
          ref={listRef}
          role="listbox"
          // Portaled to <body>, which sits OUTSIDE the Radix Dialog. Radix's
          // scroll-lock disables pointer events on everything outside the
          // dialog, so re-enable them here or mouse clicks/scroll are dead.
          // Stop pointerdown from bubbling to the dialog's dismissable layer
          // so selecting a value doesn't also close the whole modal.
          style={{
            position: 'fixed',
            left: anchor.left,
            ...(anchor.top !== undefined ? { top: anchor.top } : { bottom: anchor.bottom }),
            minWidth: anchor.width,
            maxHeight: anchor.maxHeight,
            pointerEvents: 'auto',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          // `popover-surface` is load-bearing (matches SearchableSelect): the
          // "colorful" theme reclaims an opaque background through it. Keep the
          // zinc pairing it expects; `scrollbar-thin` is the project's thin,
          // theme-aware scrollbar utility (shadcn look, not the chunky native one).
          className="popover-surface scrollbar-thin z-[120] w-max max-w-[20rem] overflow-y-auto rounded-md border border-zinc-300 bg-white p-1 shadow-md dark:border-zinc-600 dark:bg-zinc-800"
        >
          {filtered.map((o, i) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={i === highlight}
              // mousedown (not click) so the input doesn't blur-close first.
              onMouseDown={(e) => { e.preventDefault(); commit(o); }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                'block w-full cursor-default select-none truncate rounded-sm px-2 py-1 text-left text-xs font-mono transition-colors',
                i === highlight
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {o}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
