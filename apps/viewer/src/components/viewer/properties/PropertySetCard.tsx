/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Property set display component with edit support.
 */

import { useState, useEffect } from 'react';
import { Sparkles, PenLine, Building2, ChevronRight } from 'lucide-react';
import { PropertyEditor, type PropertyEditScope } from '../PropertyEditor';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { parsePropertyValue } from './encodingUtils';
import type { PropertySet } from './encodingUtils';
import { PropertyValueType } from '@ifc-lite/data';
import type { ProjectUnits } from '@ifc-lite/parser';
import { resolveMeasureDisplay, formatConverted } from '@/lib/units/display';

export interface PropertySetCardProps {
  pset: PropertySet;
  modelId?: string;
  entityId?: number;
  enableEditing?: boolean;
  /** Whether this property set is inherited from the type entity */
  isTypeProperty?: boolean;
  typeEditScope?: PropertyEditScope;
  /** `"PsetName:PropName"` of a row to transiently highlight + scroll to
   *  (the bSDD "jump to added property" flow, issue #1107). */
  focusedPropKey?: string | null;
  /** The file's declared units, for rendering a unit suffix next to measure
   *  values (issue #1573). */
  projectUnits: ProjectUnits;
  /** Per-unit-type display-unit overrides (issue #1573 proposal 2) when a
   *  property's measure type maps to an overridden unit kind, its value
   *  renders CONVERTED into that unit instead of the file's raw value.
   *  Omitted (or empty) keeps the existing unconverted-file-unit display. */
  unitDisplayOverrides?: Record<string, string>;
}

export function PropertySetCard({ pset, modelId, entityId, enableEditing, isTypeProperty, typeEditScope, focusedPropKey, projectUnits, unitDisplayOverrides }: PropertySetCardProps) {
  // Check if any property in this set is mutated
  const hasMutations = pset.properties.some(p => p.isMutated);
  const isNewPset = pset.isNewPset;

  // Row identity for the bSDD focus flow (issue #1107). The entityId is part of
  // the key so an occurrence pset and an inherited type pset of the SAME name
  // don't collide — only the card the property was actually added to matches.
  const keyFor = (propName: string) => `${entityId ?? ''}:${pset.name}:${propName}`;
  const containsFocused = focusedPropKey != null && pset.properties.some(p => keyFor(p.name) === focusedPropKey);

  // Self-control the collapse so a focused row can't hide inside a pset the user
  // previously collapsed — force it open when this card holds the focus target.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (containsFocused) setOpen(true);
  }, [containsFocused]);

  // Dynamic styling based on mutation state and source
  const borderClass = isNewPset
    ? 'border-amber-400/45 dark:border-amber-500/35'
    : hasMutations
    ? 'border-purple-300/55 dark:border-purple-500/35'
    : isTypeProperty
    ? 'border-indigo-200/70 dark:border-indigo-800/55'
    : 'border-border';

  const bgClass = isNewPset
    ? 'bg-amber-50/30 dark:bg-amber-950/20'
    : hasMutations
    ? 'bg-purple-50/20 dark:bg-purple-950/10'
    : isTypeProperty
    ? 'bg-indigo-50/20 dark:bg-indigo-950/10'
    : 'bg-card';

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={`${borderClass} ${bgClass} w-full max-w-full overflow-hidden rounded-xl border shadow-sm`}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 overflow-hidden">
        {isNewPset && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            </TooltipTrigger>
            <TooltipContent>New property set (not in original model)</TooltipContent>
          </Tooltip>
        )}
        {hasMutations && !isNewPset && (
          <Tooltip>
            <TooltipTrigger asChild>
              <PenLine className="h-3.5 w-3.5 text-purple-500 shrink-0" />
            </TooltipTrigger>
            <TooltipContent>Has modified properties</TooltipContent>
          </Tooltip>
        )}
        {isTypeProperty && !isNewPset && !hasMutations && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Building2 className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
            </TooltipTrigger>
            <TooltipContent>Inherited from type — edits apply to all instances of this type</TooltipContent>
          </Tooltip>
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{pset.name}</span>
        <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">{pset.properties.length}</Badge>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="divide-y divide-border/60 border-t border-border/60 bg-muted/[0.18]">
          {pset.properties.map((prop: { name: string; value: unknown; isMutated?: boolean; type?: number; dataType?: string }) => {
            const parsed = parsePropertyValue(prop.value);
            // Names render VERBATIM: the parse path already decoded them (see
            // the note on `parsePropertyValue`), and decoding a second time
            // collapses `\\` twice.
            const isMutated = prop.isMutated;
            const propKey = keyFor(prop.name);
            const isFocused = focusedPropKey != null && focusedPropKey === propKey;
            const disp = resolveMeasureDisplay(prop.value, prop.dataType, projectUnits, unitDisplayOverrides ?? {});
            const unit = disp.unit;

            return (
              <div
                key={prop.name}
                data-prop-key={propKey}
                className={`flex items-start justify-between gap-2 px-3 py-2 text-xs group/prop transition-colors ${
                  isFocused
                    ? 'bg-amber-100/70 dark:bg-amber-900/40 ring-2 ring-inset ring-amber-400 dark:ring-amber-500 motion-safe:animate-pulse-subtle'
                    : isMutated
                    ? 'bg-purple-50/50 dark:bg-purple-950/30 hover:bg-purple-100/50 dark:hover:bg-purple-900/30'
                  : 'hover:bg-muted/50'
                }`}
              >
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  {/* Property name with type tooltip and mutation indicator */}
                  <div className="flex items-center gap-1.5">
                    {isMutated && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="secondary" className="h-4 px-1 text-[9px] bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700">
                            edited
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>This property has been modified</TooltipContent>
                      </Tooltip>
                    )}
                    {parsed.ifcType ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                      <span className={`font-medium cursor-help break-words ${isMutated ? 'text-purple-600 dark:text-purple-400' : 'text-muted-foreground'}`}>
                            {prop.name}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-[10px]">
                          {/* bg-primary tooltip: derive from primary-foreground so it
                              reads on the blue/purple surface and in dark mode (#1218) */}
                          <span className="text-primary-foreground/80">{parsed.ifcType}</span>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className={`font-medium break-words ${isMutated ? 'text-purple-600 dark:text-purple-400' : 'text-muted-foreground'}`}>
                        {prop.name}
                      </span>
                    )}
                  </div>
                  {/* Property value - use PropertyEditor if editing enabled */}
                  {enableEditing && modelId && entityId ? (
                    <PropertyEditor
                      modelId={modelId}
                      entityId={entityId}
                      psetName={pset.name}
                      propName={prop.name}
                      currentValue={prop.value}
                      currentType={prop.type as PropertyValueType | undefined}
                      editScope={typeEditScope}
                    />
                  ) : (
                    <span className={`font-mono select-all break-words ${isMutated ? 'text-purple-900 dark:text-purple-100 font-semibold' : 'text-foreground'}`}>
                      {disp.converted !== null ? formatConverted(disp.converted) : parsed.displayValue}
                      {unit && parsed.displayValue !== '\u2014' && (
                        <span className="ml-1 text-muted-foreground/70">{unit}</span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
