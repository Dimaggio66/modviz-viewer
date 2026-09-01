/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  ChevronRight,
  Layers,
  Eye,
  EyeOff,
  FileBox,
  RefreshCw,
  X,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TreeNode } from './types';
import { isSpatialContainer } from './types';
import { IFC_ICON_CODEPOINTS, IFC_ICON_DEFAULT } from './ifc-icons';

/**
 * Resolve the Material Symbols code point for a given IFC type string.
 * Falls back to the generic product icon for unmapped classes.
 */
function getIfcIconCodepoint(ifcType: string | undefined): string {
  if (!ifcType) return IFC_ICON_DEFAULT;
  return IFC_ICON_CODEPOINTS[ifcType] ?? IFC_ICON_DEFAULT;
}

/** Lucide fallback icons for non-IFC node types */
const NODE_TYPE_ICONS: Record<string, React.ElementType> = {
  'unified-storey': Layers,
  'model-header': FileBox,
};

export interface HierarchyNodeProps {
  node: TreeNode;
  virtualRow: { size: number; start: number };
  isSelected: boolean;
  nodeHidden: boolean;
  isMultiModel: boolean;
  modelsCount: number;
  modelVisible?: boolean;
  onNodeClick: (node: TreeNode, e: React.MouseEvent) => void;
  onToggleExpand: (nodeId: string) => void;
  onVisibilityToggle: (node: TreeNode) => void;
  onModelVisibilityToggle: (modelId: string, e: React.MouseEvent) => void;
  onRemoveModel: (modelId: string, e: React.MouseEvent) => void;
  onSyncSourceModel?: (modelId: string, e: React.MouseEvent) => void;
  onModelHeaderClick: (modelId: string, nodeId: string, hasChildren: boolean) => void;
  sourceBacked?: boolean;
  sourceSyncing?: boolean;
  /** The parent already communicates the IFC class, so child rows can stay clean. */
  compactMetadata?: boolean;
}

export function HierarchyNode({
  node,
  virtualRow,
  isSelected,
  nodeHidden,
  isMultiModel,
  modelsCount,
  modelVisible,
  onNodeClick,
  onToggleExpand,
  onVisibilityToggle,
  onModelVisibilityToggle,
  onRemoveModel,
  onSyncSourceModel,
  onModelHeaderClick,
  sourceBacked = false,
  sourceSyncing = false,
  compactMetadata = false,
}: HierarchyNodeProps) {
  const resolvedType = node.ifcType || node.type;
  // Use Lucide icon for non-IFC structural nodes, Material Symbols for IFC classes
  const LucideIcon = NODE_TYPE_ICONS[node.type];
  const iconCodepoint = getIfcIconCodepoint(resolvedType);

  // Spatial containers, storeys, spaces, and grouping headers get the emphasized
  // label treatment; element rows stay lighter.
  const primaryNameClass =
    isSpatialContainer(node.type) ||
    node.type === 'IfcBuildingStorey' ||
    node.type === 'IfcSpace' ||
    node.type === 'IfcSpatialZone' ||
    node.type === 'unified-storey' ||
    node.type === 'type-group' ||
    node.type === 'material-group' ||
    node.type === 'group'
      ? 'font-medium text-zinc-900 dark:text-zinc-100'
      : 'text-muted-foreground';
  const strikeWhenHidden = nodeHidden && 'line-through decoration-muted-foreground/60';

  // Model header nodes (for visibility control and expansion)
  if (node.type === 'model-header' && node.id.startsWith('model-')) {
    const modelId = node.modelIds[0];

    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: `${virtualRow.size}px`,
          transform: `translateY(${virtualRow.start}px)`,
        }}
      >
        <div
          className={cn(
            'mx-1 mt-0.5 flex h-[calc(100%-0.25rem)] items-center gap-1 rounded-lg border border-transparent px-2 py-1.5 transition-colors group',
            'hover:bg-accent/70',
            !modelVisible && 'opacity-50',
            node.hasChildren && 'cursor-pointer'
          )}
          style={{ paddingLeft: '8px' }}
          onClick={() => onModelHeaderClick(modelId, node.id, node.hasChildren)}
        >
          {/* Expand/collapse chevron */}
          {node.hasChildren ? (
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 text-zinc-400 transition-transform shrink-0',
                node.isExpanded && 'rotate-90'
              )}
            />
          ) : (
            <div className="w-3.5" />
          )}

          <FileBox className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="flex-1 text-sm truncate ml-1.5 text-zinc-900 dark:text-zinc-100">
            {node.name}
          </span>

          {node.elementCount !== undefined && (
            <Badge variant="secondary" className="h-5 rounded-md px-1.5 font-mono text-[10px] text-muted-foreground">
              {node.elementCount.toLocaleString()}
            </Badge>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onModelVisibilityToggle(modelId, e);
                }}
                aria-label={modelVisible ? `Hide model ${node.name}` : `Show model ${node.name}`}
                className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {modelVisible ? (
                  <Eye className="h-3.5 w-3.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{modelVisible ? 'Hide model' : 'Show model'}</p>
            </TooltipContent>
          </Tooltip>

          {sourceBacked && onSyncSourceModel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSyncSourceModel(modelId, e);
                  }}
                  aria-label={`Sync model ${node.name} from source`}
                  className={cn(
                    'p-0.5 opacity-0 group-hover:opacity-100 transition-opacity',
                    sourceSyncing && 'opacity-100',
                  )}
                  disabled={sourceSyncing}
                >
                  <RefreshCw
                    className={cn(
                      'h-3.5 w-3.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100',
                      sourceSyncing && 'animate-spin',
                    )}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">
                  {sourceSyncing ? 'Syncing model…' : 'Sync from source'}
                </p>
              </TooltipContent>
            </Tooltip>
          )}

          {modelsCount > 1 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveModel(modelId, e);
                  }}
                  aria-label={`Remove model ${node.name}`}
                  className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3.5 w-3.5 text-zinc-400 hover:text-red-500" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Remove model</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    );
  }

  // Regular node rendering (spatial hierarchy nodes and elements)
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`,
      }}
    >
      <div
        className={cn(
          'mx-1 mt-0.5 flex h-[calc(100%-0.25rem)] items-center gap-1 rounded-lg border border-transparent px-2 py-1.5 transition-colors group hierarchy-item',
          // No selection styling for spatial containers in multi-model mode
          isMultiModel && isSpatialContainer(node.type)
            ? 'cursor-default'
            : cn(
                'cursor-pointer',
                isSelected ? 'border-primary/30 bg-primary/10 font-medium text-foreground shadow-sm selected' : 'hover:bg-accent/70'
              ),
          nodeHidden && 'opacity-50 grayscale'
        )}
        style={{
          paddingLeft: `${node.depth * 14 + 8}px`,
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button') === null) {
            onNodeClick(node, e);
          }
        }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button') === null) {
            e.preventDefault();
          }
        }}
      >
        {/* Expand/Collapse */}
        {node.hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            aria-label={node.isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            aria-expanded={node.isExpanded}
            className="mr-1 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-200',
                node.isExpanded && 'rotate-90'
              )}
            />
          </button>
        ) : (
          <div className="w-5" />
        )}

        {/* Visibility Toggle - hide for spatial containers (Project/Site/Building) in multi-model mode */}
        {!(isMultiModel && isSpatialContainer(node.type)) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onVisibilityToggle(node);
                }}
                aria-label={node.isVisible ? `Hide ${node.name}` : `Show ${node.name}`}
                className={cn(
                  'mr-1 rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100',
                  nodeHidden && 'opacity-100'
                )}
              >
                {node.isVisible ? (
                  <Eye className="h-3 w-3" />
                ) : (
                  <EyeOff className="h-3 w-3" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                {node.isVisible ? 'Hide' : 'Show'}
              </p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Type Icon */}
        <Tooltip>
          <TooltipTrigger asChild>
            {LucideIcon ? (
              <LucideIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <span
                className="material-symbols-outlined shrink-0 leading-none text-muted-foreground"
                style={{ fontSize: '14px' }}
                aria-hidden="true"
              >
                {iconCodepoint}
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{resolvedType}</p>
          </TooltipContent>
        </Tooltip>

        {/* Name (+ optional muted LongName for spatial nodes carrying an ISO
            19650 code in Name and the descriptive label in LongName, #1634) */}
        {node.secondaryName ? (
          <span
            className="flex-1 min-w-0 flex items-baseline text-sm ml-1.5"
            title={`${node.name} - ${node.secondaryName}`}
          >
            <span className={cn('shrink-0 max-w-[55%] truncate', primaryNameClass, strikeWhenHidden)}>
              {node.name}
            </span>
            <span className={cn('truncate min-w-0 ml-1.5 font-normal text-muted-foreground', strikeWhenHidden)}>
              {node.secondaryName}
            </span>
          </span>
        ) : (
          <span className={cn('flex-1 text-sm truncate ml-1.5', primaryNameClass, strikeWhenHidden)}>
            {node.name}
          </span>
        )}

        {!compactMetadata && node.ifcType && (node.type === 'element' || node.type === 'group-member') && (
          <span className="max-w-[90px] truncate font-mono text-[10px] text-muted-foreground">
            {node.ifcType}
          </span>
        )}

        {/* Storey Elevation */}
        {node.storeyElevation !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className="h-5 rounded-md border-emerald-200 bg-emerald-50 px-1.5 font-mono text-[10px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                {node.storeyElevation >= 0 ? '+' : ''}{node.storeyElevation.toFixed(2)}m
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Elevation: {node.storeyElevation >= 0 ? '+' : ''}{node.storeyElevation.toFixed(2)}m</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Element Count */}
        {node.elementCount !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="h-5 rounded-md px-1.5 font-mono text-[10px] text-muted-foreground">
                {node.elementCount.toLocaleString()}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{node.elementCount.toLocaleString()} {node.elementCount === 1 ? 'element' : 'elements'}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
