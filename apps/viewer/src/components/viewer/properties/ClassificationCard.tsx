/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Classification display component for IFC element classifications.
 */

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tag, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ClassificationInfo } from '@ifc-lite/parser';

export function ClassificationCard({ classification }: { classification: ClassificationInfo }) {
  const displayName = classification.identification || classification.name || 'Unknown';
  const systemName = classification.system;

  return (
    <Collapsible defaultOpen className="w-full max-w-full overflow-hidden rounded-xl border border-emerald-200/70 bg-emerald-50/25 shadow-sm dark:border-emerald-800/55 dark:bg-emerald-950/15">
      <CollapsibleTrigger className="group flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-emerald-500/5 overflow-hidden">
        <Tag className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {systemName || 'Classification'}
        </span>
        <Badge variant="outline" className="max-w-[40%] truncate border-emerald-200/80 bg-emerald-50/50 font-mono text-[10px] text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          {displayName}
        </Badge>
        <ChevronRight className="size-3.5 shrink-0 text-emerald-600/70 transition-transform group-data-[state=open]:rotate-90 dark:text-emerald-400/70" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="divide-y divide-emerald-200/55 border-t border-emerald-200/70 bg-emerald-50/15 dark:divide-emerald-900/35 dark:border-emerald-800/55 dark:bg-emerald-950/10">
          {classification.identification && (
            <div className="flex flex-col gap-0.5 px-3 py-2 text-xs transition-colors hover:bg-emerald-500/5">
              <span className="text-muted-foreground font-medium">Identification</span>
              <span className="font-mono text-emerald-700 dark:text-emerald-400 select-all break-words">{classification.identification}</span>
            </div>
          )}
          {classification.name && (
            <div className="flex flex-col gap-0.5 px-3 py-2 text-xs transition-colors hover:bg-emerald-500/5">
              <span className="text-muted-foreground font-medium">Name</span>
              <span className="font-mono text-emerald-700 dark:text-emerald-400 select-all break-words">{classification.name}</span>
            </div>
          )}
          {classification.system && (
            <div className="flex flex-col gap-0.5 px-3 py-2 text-xs transition-colors hover:bg-emerald-500/5">
              <span className="text-muted-foreground font-medium">System</span>
              <span className="font-mono text-emerald-700 dark:text-emerald-400 select-all break-words">{classification.system}</span>
            </div>
          )}
          {classification.location && (
            <div className="flex flex-col gap-0.5 px-3 py-2 text-xs transition-colors hover:bg-emerald-500/5">
              <span className="text-muted-foreground font-medium">Location</span>
              <span className="font-mono text-emerald-700 dark:text-emerald-400 select-all break-words">{classification.location}</span>
            </div>
          )}
          {classification.path && classification.path.length > 0 && (
            <div className="flex flex-col gap-0.5 px-3 py-2 text-xs transition-colors hover:bg-emerald-500/5">
              <span className="text-muted-foreground font-medium">Path</span>
              <span className="font-mono text-emerald-700 dark:text-emerald-400 select-all break-words">{classification.path.join(' > ')}</span>
            </div>
          )}
          {classification.description && (
            <div className="flex flex-col gap-0.5 px-3 py-2 text-xs transition-colors hover:bg-emerald-500/5">
              <span className="text-muted-foreground font-medium">Description</span>
              <span className="font-mono text-emerald-700 dark:text-emerald-400 select-all break-words">{classification.description}</span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
