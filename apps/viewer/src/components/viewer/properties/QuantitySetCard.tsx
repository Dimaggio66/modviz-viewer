/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Quantity set display component for IFC element quantities.
 */

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import type { QuantitySet } from './encodingUtils';
import type { ProjectUnits } from '@ifc-lite/parser';
import { resolveQuantityDisplay, formatConverted } from '@/lib/units/display';

/** Maps quantity type to friendly name for tooltip */
const QUANTITY_TYPE_NAMES: Record<number, string> = {
  0: 'Length',
  1: 'Area',
  2: 'Volume',
  3: 'Count',
  4: 'Weight',
  5: 'Time',
};

export interface QuantitySetCardProps {
  qset: QuantitySet;
  projectUnits: ProjectUnits;
  /** Per-unit-type display-unit overrides (issue #1573 proposal 2). See
   *  `PropertySetCardProps.unitDisplayOverrides`. */
  unitDisplayOverrides?: Record<string, string>;
}

export function QuantitySetCard({ qset, projectUnits, unitDisplayOverrides }: QuantitySetCardProps) {
  const formatValue = (value: number, type: number): string => {
    if (isNaN(value)) return '\u2014'; // em-dash for empty values
    const disp = resolveQuantityDisplay(value, type, projectUnits, unitDisplayOverrides ?? {});
    const formatted = disp.converted !== null ? formatConverted(disp.converted) : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
    return disp.unit ? `${formatted} ${disp.unit}` : formatted;
  };

  return (
    <Collapsible defaultOpen className="w-full max-w-full overflow-hidden rounded-xl border border-blue-200/70 bg-blue-50/25 shadow-sm dark:border-blue-800/55 dark:bg-blue-950/15">
      <CollapsibleTrigger className="group flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-blue-500/5 overflow-hidden">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{qset.name}</span>
        <Badge variant="outline" className="border-blue-200/80 bg-blue-50/50 font-mono text-[10px] text-blue-700 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300">{qset.quantities.length}</Badge>
        <ChevronRight className="size-3.5 shrink-0 text-blue-600/70 transition-transform group-data-[state=open]:rotate-90 dark:text-blue-400/70" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="divide-y divide-blue-200/55 border-t border-blue-200/70 bg-blue-50/15 dark:divide-blue-900/35 dark:border-blue-800/55 dark:bg-blue-950/10">
          {qset.quantities.map((q: { name: string; value: number; type: number }, index: number) => {
            // Names render VERBATIM: the parse path already decoded them
            // (see the note on `parsePropertyValue`), and decoding a second
            // time collapses `\\` twice.
            const typeName = QUANTITY_TYPE_NAMES[q.type];
            return (
              <div key={`${q.name}-${index}`} className="flex flex-col gap-0.5 px-3 py-2 text-xs transition-colors hover:bg-blue-500/5">
                {/* Quantity name with type tooltip */}
                {typeName ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground font-medium cursor-help break-words">
                        {q.name}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[10px]">
                      {/* bg-primary tooltip: derive from primary-foreground so it
                          reads on the blue/purple surface and in dark mode (#1218) */}
                      <span className="text-primary-foreground/80">{typeName}</span>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-muted-foreground font-medium break-words">
                    {q.name}
                  </span>
                )}
                {/* Quantity value */}
                <span className="font-mono text-blue-700 dark:text-blue-400 select-all break-words">
                  {formatValue(q.value, q.type)}
                </span>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
