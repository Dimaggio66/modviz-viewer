/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Material display component for IFC element materials.
 * Handles all IFC material types: direct, layer sets, profile sets,
 * constituent sets, and material lists.
 */

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Layers, ChevronRight } from 'lucide-react';
import type { MaterialInfo } from '@ifc-lite/parser';

const TYPE_LABELS: Record<string, string> = {
  Material: 'Material',
  MaterialLayerSet: 'Layer Set',
  MaterialProfileSet: 'Profile Set',
  MaterialConstituentSet: 'Constituent Set',
  MaterialList: 'Material List',
};

export function MaterialCard({ material }: { material: MaterialInfo }) {
  const typeLabel = TYPE_LABELS[material.type] || material.type;
  const displayName = material.name || typeLabel;

  return (
    <Collapsible defaultOpen className="w-full max-w-full overflow-hidden rounded-xl border border-amber-200/70 bg-amber-50/25 shadow-sm dark:border-amber-800/55 dark:bg-amber-950/15">
      <CollapsibleTrigger className="group flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-amber-500/5 overflow-hidden">
        <Layers className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {displayName}
        </span>
        <Badge variant="outline" className="border-amber-200/80 bg-amber-50/50 font-mono text-[10px] text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
          {typeLabel}
        </Badge>
        <ChevronRight className="size-3.5 shrink-0 text-amber-600/70 transition-transform group-data-[state=open]:rotate-90 dark:text-amber-400/70" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="divide-y divide-amber-200/55 border-t border-amber-200/70 bg-amber-50/15 dark:divide-amber-900/35 dark:border-amber-800/55 dark:bg-amber-950/10">
          {/* Direct material */}
          {material.type === 'Material' && (
            <>
              {material.name && (
                <MaterialRow label="Name" value={material.name} />
              )}
              {material.description && (
                <MaterialRow label="Description" value={material.description} />
              )}
            </>
          )}

          {/* Layer Set */}
          {material.type === 'MaterialLayerSet' && material.layers && (
            <>
              {material.name && <MaterialRow label="Set Name" value={material.name} />}
              {material.layers.map((layer, i) => (
                <div key={i} className="px-3 py-2 text-xs transition-colors hover:bg-amber-500/5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-amber-700 dark:text-amber-400">
                      Layer {i + 1}
                    </span>
                    {layer.thickness !== undefined && (
                      <Badge variant="outline" className="border-amber-200/80 bg-amber-50/50 px-1.5 font-mono text-[10px] text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
                        {formatThickness(layer.thickness)}
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-[minmax(60px,auto)_1fr] gap-x-2 gap-y-0.5 ml-2">
                    {layer.materialName && (
                      <>
                        <span className="text-muted-foreground">Material</span>
                        <span className="font-mono text-amber-700 dark:text-amber-400 break-words">{layer.materialName}</span>
                      </>
                    )}
                    {layer.name && (
                      <>
                        <span className="text-muted-foreground">Name</span>
                        <span className="font-mono text-amber-700 dark:text-amber-400 break-words">{layer.name}</span>
                      </>
                    )}
                    {layer.category && (
                      <>
                        <span className="text-muted-foreground">Category</span>
                        <span className="font-mono text-amber-700 dark:text-amber-400 break-words">{layer.category}</span>
                      </>
                    )}
                    {layer.isVentilated && (
                      <>
                        <span className="text-muted-foreground">Ventilated</span>
                        <span className="font-mono text-amber-700 dark:text-amber-400">Yes</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Profile Set */}
          {material.type === 'MaterialProfileSet' && material.profiles && (
            <>
              {material.name && <MaterialRow label="Set Name" value={material.name} />}
              {material.profiles.map((profile, i) => (
                <div key={i} className="px-3 py-2 text-xs transition-colors hover:bg-amber-500/5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-amber-700 dark:text-amber-400">
                      Profile {i + 1}
                    </span>
                  </div>
                  <div className="grid grid-cols-[minmax(60px,auto)_1fr] gap-x-2 gap-y-0.5 ml-2">
                    {profile.materialName && (
                      <>
                        <span className="text-muted-foreground">Material</span>
                        <span className="font-mono text-amber-700 dark:text-amber-400 break-words">{profile.materialName}</span>
                      </>
                    )}
                    {profile.name && (
                      <>
                        <span className="text-muted-foreground">Name</span>
                        <span className="font-mono text-amber-700 dark:text-amber-400 break-words">{profile.name}</span>
                      </>
                    )}
                    {profile.category && (
                      <>
                        <span className="text-muted-foreground">Category</span>
                        <span className="font-mono text-amber-700 dark:text-amber-400 break-words">{profile.category}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Constituent Set */}
          {material.type === 'MaterialConstituentSet' && material.constituents && (
            <>
              {material.name && <MaterialRow label="Set Name" value={material.name} />}
              {material.constituents.map((constituent, i) => (
                <div key={i} className="px-3 py-2 text-xs transition-colors hover:bg-amber-500/5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-amber-700 dark:text-amber-400">
                      {constituent.name || `Constituent ${i + 1}`}
                    </span>
                    {constituent.fraction !== undefined && (
                      <Badge variant="outline" className="border-amber-200/80 bg-amber-50/50 px-1.5 font-mono text-[10px] text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
                        {(constituent.fraction * 100).toFixed(1)}%
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-[minmax(60px,auto)_1fr] gap-x-2 gap-y-0.5 ml-2">
                    {constituent.materialName && (
                      <>
                        <span className="text-muted-foreground">Material</span>
                        <span className="font-mono text-amber-700 dark:text-amber-400 break-words">{constituent.materialName}</span>
                      </>
                    )}
                    {constituent.category && (
                      <>
                        <span className="text-muted-foreground">Category</span>
                        <span className="font-mono text-amber-700 dark:text-amber-400 break-words">{constituent.category}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Material List */}
          {material.type === 'MaterialList' && material.materials && (
            <>
              {material.materials.map((m, i) => (
                <MaterialRow key={i} label={`Material ${i + 1}`} value={m.name} />
              ))}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MaterialRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 text-xs transition-colors hover:bg-amber-500/5">
      <span className="text-muted-foreground font-medium">{label}</span>
      <span className="font-mono text-amber-700 dark:text-amber-400 select-all break-words">{value}</span>
    </div>
  );
}

function formatThickness(thickness: number): string {
  if (thickness <= 0) return `${thickness.toFixed(1)} m`;
  if (thickness >= 1) {
    return `${thickness.toFixed(1)} m`;
  }
  // Show in mm for sub-meter thicknesses
  const mm = thickness * 1000;
  return `${mm.toFixed(1)} mm`;
}
