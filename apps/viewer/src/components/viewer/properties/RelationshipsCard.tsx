/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Relationships display component for IFC element structural relationships.
 */

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Link2, Focus, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { EntityRelationships } from '@ifc-lite/parser';

interface RelationshipsCardProps {
  relationships: EntityRelationships;
  onSelectEntity?: (entityId: number) => void;
  /** Isolate + select all member objects of a group/zone in 3D (#1075). */
  onIsolateGroupMembers?: (groupId: number) => void;
}

export function RelationshipsCard({ relationships, onSelectEntity, onIsolateGroupMembers }: RelationshipsCardProps) {
  const { voids, fills, groups, connections } = relationships;
  const totalCount = voids.length + fills.length + groups.length + connections.length;

  if (totalCount === 0) return null;

  return (
    <Collapsible defaultOpen className="w-full max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <CollapsibleTrigger className="group flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 overflow-hidden">
        <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          Relationships
        </span>
        <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">{totalCount}</Badge>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="divide-y divide-border/60 border-t border-border/60 bg-muted/[0.18]">
          {voids.length > 0 && (
            <div className="px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Openings ({voids.length})
              </div>
              {voids.map((item) => (
                <RelItem key={item.id} item={item} onSelect={onSelectEntity} />
              ))}
            </div>
          )}
          {fills.length > 0 && (
            <div className="px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Fills ({fills.length})
              </div>
              {fills.map((item) => (
                <RelItem key={item.id} item={item} onSelect={onSelectEntity} />
              ))}
            </div>
          )}
          {groups.length > 0 && (
            <div className="px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Groups &amp; Zones ({groups.length})
              </div>
              {groups.map((item) => (
                <GroupItem
                  key={item.id}
                  item={item}
                  onSelect={onSelectEntity}
                  onIsolateMembers={onIsolateGroupMembers}
                />
              ))}
            </div>
          )}
          {connections.length > 0 && (
            <div className="px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Connections ({connections.length})
              </div>
              {connections.map((item) => (
                <RelItem key={item.id} item={item} onSelect={onSelectEntity} />
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RelItem({ item, onSelect }: {
  item: { id: number; name?: string; type: string };
  onSelect?: (id: number) => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-2 rounded-md py-1 text-left text-xs transition-colors hover:bg-accent hover:text-primary"
      onClick={() => onSelect?.(item.id)}
      type="button"
    >
      <span className="font-mono text-[10px] text-muted-foreground">#{item.id}</span>
      <span className="truncate text-foreground">{item.name || item.type}</span>
      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{item.type}</span>
    </button>
  );
}

/** A group/zone row (IfcZone / IfcGroup / IfcSystem): click the name to inspect
 *  the group's own attributes; click the focus button to isolate + select all of
 *  its member objects (e.g. every space in a dwelling) in the 3D view (#1075). */
function GroupItem({ item, onSelect, onIsolateMembers }: {
  item: { id: number; name?: string; type: string };
  onSelect?: (id: number) => void;
  onIsolateMembers?: (id: number) => void;
}) {
  return (
    <div className="group/rel flex items-center gap-2 rounded-md py-1 transition-colors hover:bg-accent">
      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs transition-colors hover:text-primary"
        onClick={() => onSelect?.(item.id)}
        type="button"
        title="Show this group's attributes"
      >
        <span className="font-mono text-[10px] text-muted-foreground">#{item.id}</span>
        <span className="truncate text-foreground">{item.name || `Group #${item.id}`}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{item.type}</span>
      </button>
      {onIsolateMembers && (
        <button
          className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-primary"
          onClick={() => onIsolateMembers(item.id)}
          type="button"
          title="Isolate this group's members in 3D"
        >
          <Focus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
