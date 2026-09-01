/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as React from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from '@/lib/utils';
import { usePortalContainer } from './portal-container';

const AUTO_TOOLTIP_ATTRIBUTE = 'data-shadcn-tooltip';

type TooltipProviderProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>;

/**
 * The shared tooltip provider has two responsibilities:
 *
 * 1. It powers the explicit Shadcn/Base UI tooltips used in command surfaces.
 * 2. It adopts the legacy native `title` hints still spread across the viewer,
 *    so every existing hover hint has the same visual language instead of
 *    falling back to the browser-specific yellow title bubble.
 */
function TooltipProvider({ children, ...props }: TooltipProviderProps) {
  return (
    <TooltipPrimitive.Provider {...props}>
      {children}
      <NativeTitleTooltip />
    </TooltipPrimitive.Provider>
  );
}

const Tooltip = TooltipPrimitive.Root;

type BaseTooltipTriggerProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>;

type TooltipTriggerProps = Omit<BaseTooltipTriggerProps, 'render'> & {
  asChild?: boolean;
  /** Base UI's Shadcn-compatible trigger composition. */
  render?: BaseTooltipTriggerProps['render'];
};

const TooltipTrigger = React.forwardRef<HTMLButtonElement, TooltipTriggerProps>(
  ({ asChild = false, children, render, ...props }, ref) => {
    const triggerRender = render ?? (
      asChild ? (React.Children.only(children) as React.ReactElement) : undefined
    );

    return (
      <TooltipPrimitive.Trigger
        ref={ref}
        render={triggerRender}
        {...props}
      >
        {triggerRender ? undefined : children}
      </TooltipPrimitive.Trigger>
    );
  }
);
TooltipTrigger.displayName = 'TooltipTrigger';

type TooltipContentProps = React.ComponentPropsWithoutRef<
  typeof TooltipPrimitive.Popup
> &
  Pick<
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Positioner>,
    'side' | 'sideOffset'
  >;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Popup>,
  TooltipContentProps
>(({ className, side, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal container={usePortalContainer()}>
    <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset}>
      <TooltipPrimitive.Popup
        ref={ref}
        className={cn(
          'z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Positioner>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Popup.displayName;

type NativeTooltipState = {
  label: string;
  target: HTMLElement;
  side: 'top' | 'bottom';
  left: number;
  top: number;
};

function NativeTitleTooltip() {
  const [tooltip, setTooltip] = React.useState<NativeTooltipState | null>(null);
  const hideTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const adoptTitle = (element: HTMLElement) => {
      const label = element.getAttribute('title')?.trim();
      if (!label || element.hasAttribute(AUTO_TOOLTIP_ATTRIBUTE)) return;
      element.setAttribute(AUTO_TOOLTIP_ATTRIBUTE, label);
      // Avoid two hints for the same element. The accessible name is already
      // supplied by aria-label/text for interactive elements throughout the UI.
      element.removeAttribute('title');
    };

    const adoptTitles = (root: ParentNode) => {
      if (root instanceof HTMLElement) adoptTitle(root);
      root.querySelectorAll?.<HTMLElement>('[title]').forEach(adoptTitle);
    };

    adoptTitles(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof HTMLElement) {
          adoptTitle(record.target);
        }
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) adoptTitles(node);
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title'],
    });

    const clearHideTimer = () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    const position = (target: HTMLElement, label: string) => {
      const rect = target.getBoundingClientRect();
      const side = rect.top > 52 ? 'top' : 'bottom';
      const left = Math.min(Math.max(rect.left + rect.width / 2, 12), window.innerWidth - 12);
      const top = side === 'top' ? rect.top - 8 : rect.bottom + 8;
      setTooltip({ label, target, side, left, top });
    };

    const resolveTarget = (eventTarget: EventTarget | null) => {
      if (!(eventTarget instanceof Element)) return null;
      const element = eventTarget.closest<HTMLElement>(`[${AUTO_TOOLTIP_ATTRIBUTE}], [title]`);
      if (!element) return null;
      // This handles a just-mounted element before the mutation observer has
      // run, while keeping the browser title hint suppressed afterwards.
      adoptTitle(element);
      const label = element.getAttribute(AUTO_TOOLTIP_ATTRIBUTE);
      return label ? { element, label } : null;
    };

    const show = (event: Event) => {
      const resolved = resolveTarget(event.target);
      if (!resolved) return;
      clearHideTimer();
      position(resolved.element, resolved.label);
    };

    const hide = (event: Event) => {
      const current = tooltip?.target;
      const related = event instanceof FocusEvent || event instanceof PointerEvent
        ? event.relatedTarget
        : null;
      if (current && related instanceof Node && current.contains(related)) return;
      hideTimerRef.current = window.setTimeout(() => setTooltip(null), 80);
    };

    const updatePosition = () => {
      if (!tooltip || !document.contains(tooltip.target)) return;
      position(tooltip.target, tooltip.label);
    };

    document.addEventListener('pointerover', show, true);
    document.addEventListener('focusin', show, true);
    document.addEventListener('pointerout', hide, true);
    document.addEventListener('focusout', hide, true);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      clearHideTimer();
      observer.disconnect();
      document.removeEventListener('pointerover', show, true);
      document.removeEventListener('focusin', show, true);
      document.removeEventListener('pointerout', hide, true);
      document.removeEventListener('focusout', hide, true);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [tooltip]);

  if (!tooltip) return null;

  return (
    <div
      role="tooltip"
      data-side={tooltip.side}
      className="pointer-events-none fixed z-[100] max-w-64 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{
        left: tooltip.left,
        top: tooltip.top,
        transform: tooltip.side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
    >
      {tooltip.label}
    </div>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
