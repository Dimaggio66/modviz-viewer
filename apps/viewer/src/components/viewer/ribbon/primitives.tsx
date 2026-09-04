/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Command-bar building blocks. Every command is a square icon button in a
 * floating pill; the label lives in the tooltip and the accessible name, so
 * the 3D canvas keeps the space a written label would have taken.
 *
 * Because nothing is written on the button, the tooltip is not optional the
 * way it was in the labelled ribbon — an icon with no tooltip would be a
 * command the user can only identify by guessing. `CommandTooltip` therefore
 * always mounts, with the label as its body.
 */

import React, { forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ShortcutKbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

/** Subtle pressed-state tint shared by command toggles (a loud solid fill
 *  reads as alarm at this scale; tint + inset ring reads as "latched").
 *  Per-tool accents (amber annotate, purple edit) pass their own class. */
export const RIBBON_ACTIVE_CLASS =
  'bg-primary/15 text-primary ring-1 ring-inset ring-primary/30';

/** Shared shape of every floating segment: the pill the commands sit in. */
export const COMMAND_PILL_CLASS =
  'pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-2xl border border-border/60 '
  + 'bg-card/90 p-1.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/75';

interface CommandTooltipProps {
  label: string;
  /** Extra tooltip line (keyboard shortcut or state hint). */
  shortcut?: string;
  tooltip?: string;
  children: React.ReactElement;
}

/** Names the icon. Always mounted — see the file header. */
function CommandTooltip({ label, shortcut, tooltip, children }: CommandTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
        <span>{tooltip ?? label}</span>
        {shortcut && <ShortcutKbd shortcut={shortcut} className="ml-2 align-middle" />}
      </TooltipContent>
    </Tooltip>
  );
}

export interface RibbonButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: React.ElementType;
  label: string;
  /** Latched/toggled state (aria-pressed). */
  active?: boolean;
  /** Tailwind classes for the latched state; defaults to the shared tint. */
  activeClassName?: string;
  /** Tooltip body when the label isn't the whole story. */
  tooltip?: string;
  /** Keyboard shortcut shown in the tooltip. */
  shortcut?: string;
  /** Marks the button as opening a menu (corner dot). */
  hasMenu?: boolean;
  /** Corner count badge (e.g. peers in room, basket size). */
  badge?: React.ReactNode;
}

/**
 * A command. Forwards ref so it can serve as a DropdownMenu or Dialog
 * trigger via `asChild`.
 *
 * `size` is the only difference between the two exported variants, kept
 * because the tabs distinguish primary from secondary commands.
 */
const CommandButton = forwardRef<HTMLButtonElement, RibbonButtonProps & { iconClass: string }>(
  function CommandButton(
    { icon: Icon, label, active, activeClassName, tooltip, shortcut, hasMenu, badge, className, onClick, iconClass, ...rest },
    ref,
  ) {
    return (
      <CommandTooltip label={label} shortcut={shortcut} tooltip={tooltip}>
        <Button
          ref={ref}
          variant="ghost"
          size="icon"
          type="button"
          aria-label={tooltip ?? label}
          aria-pressed={active === undefined ? undefined : active}
          onClick={(e) => {
            // Blur to close the tooltip after click (house pattern).
            (e.currentTarget as HTMLButtonElement).blur();
            onClick?.(e);
          }}
          className={cn(
            'relative h-9 w-9 shrink-0 rounded-xl text-muted-foreground',
            'hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
            active && (activeClassName ?? RIBBON_ACTIVE_CLASS),
            className,
          )}
          {...rest}
        >
          <Icon className={cn('shrink-0', iconClass)} aria-hidden="true" />
          {/* A menu marker has to survive without a label to sit next to, so
              it becomes a corner dot rather than a trailing chevron. */}
          {hasMenu && (
            <span
              className="absolute bottom-1 right-1 h-1 w-1 rounded-full bg-current opacity-50"
              aria-hidden="true"
            />
          )}
          {badge}
        </Button>
      </CommandTooltip>
    );
  },
);

/** Primary command. */
export const RibbonLargeButton = forwardRef<HTMLButtonElement, RibbonButtonProps>(
  function RibbonLargeButton(props, ref) {
    return <CommandButton ref={ref} iconClass="h-[18px] w-[18px]" {...props} />;
  },
);

/** Secondary command — same shape, slightly smaller glyph. */
export const RibbonSmallButton = forwardRef<HTMLButtonElement, RibbonButtonProps>(
  function RibbonSmallButton(props, ref) {
    return <CommandButton ref={ref} iconClass="h-4 w-4" {...props} />;
  },
);

/** A compact inline run of secondary commands. */
export function RibbonSmallStack({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center gap-0.5', className)}>
      {children}
    </div>
  );
}

/**
 * A flat command cluster. The accessible group name remains for screen
 * readers, while visual grouping comes from the separators between clusters.
 */
export function RibbonGroup({ label, children, className }: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('modviz-command-group flex shrink-0 items-center gap-0.5', className)}
    >
      {children}
    </div>
  );
}

/** Hairline divider between command groups. */
export function RibbonGroupDivider() {
  return <Separator orientation="vertical" className="modviz-command-divider mx-1 h-6 shrink-0" />;
}
