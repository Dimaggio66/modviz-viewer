/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Model metadata panel - displays file info, schema version, entity counts,
 * coordinate system info, and project information.
 */

import { useMemo, type ReactNode } from 'react';
import {
  Layers,
  FileText,
  Tag,
  FileBox,
  Clock,
  HardDrive,
  Hash,
  Database,
  Building2,
  Ruler,
  BookMarked,
  ChevronRight,
  Globe2,
  type LucideIcon,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { PropertySetCard } from './PropertySetCard';
import { GeoreferencingPanel } from './GeoreferencingPanel';
import type { PropertySet } from './encodingUtils';
import type { FederatedModel } from '@/store/types';
import {
  extractGeoreferencingOnDemand,
  extractLengthUnitScale,
  extractProjectUnits,
  extractClassificationSystemsOnDemand,
  ProjectUnits,
  type IfcDataStore,
} from '@ifc-lite/parser';
import { useViewerStore } from '@/store';

type MetadataSectionProps = {
  title: string;
  icon: LucideIcon;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
};

/** A compact disclosure section keeps the inspector scannable on narrow screens. */
function MetadataSection({ title, icon: Icon, summary, defaultOpen = true, children }: MetadataSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b border-border/70">
      <CollapsibleTrigger className="group flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/50 text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">
            {title}
          </span>
        </span>
        {summary && <span className="min-w-0 max-w-[42%] truncate text-right text-[11px] text-muted-foreground">{summary}</span>}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border/60 bg-muted/[0.18]">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MetadataRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 border-b border-border/40 px-3 py-2 transition-colors last:border-b-0 hover:bg-muted/50">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 max-w-[62%] truncate text-right text-xs font-medium tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function OverviewMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/70 px-2.5 py-2 shadow-sm">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <Icon className="size-3" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/** Model metadata panel - displays file info, schema version, entity counts, etc. */
export function ModelMetadataPanel({ model }: { model: FederatedModel }) {
  const dataStore = model.ifcDataStore;
  const unitDisplayOverrides = useViewerStore((s) => s.unitDisplayOverrides);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (timestamp: number): string => new Date(timestamp).toLocaleString();

  const projectData = useMemo(() => {
    if (!dataStore?.spatialHierarchy?.project) return null;
    const project = dataStore.spatialHierarchy.project;
    const projectId = project.expressId;
    const properties: PropertySet[] = [];

    if (dataStore.properties) {
      for (const pset of dataStore.properties.getForEntity(projectId)) {
        properties.push({
          name: pset.name,
          properties: pset.properties.map((p) => ({ name: p.name, value: p.value })),
        });
      }
    }

    return {
      name: dataStore.entities.getName(projectId),
      globalId: dataStore.entities.getGlobalId(projectId),
      description: dataStore.entities.getDescription(projectId),
      properties,
    };
  }, [dataStore]);

  const stats = useMemo(() => {
    if (!dataStore?.spatialHierarchy) return { storeys: 0, elementsWithGeometry: 0 };
    const storeys = dataStore.spatialHierarchy.byStorey.size;
    let elementsWithGeometry = 0;
    for (const elements of dataStore.spatialHierarchy.byStorey.values()) {
      elementsWithGeometry += (elements as number[]).length;
    }
    return { storeys, elementsWithGeometry };
  }, [dataStore]);

  const georef = useMemo(() => {
    if (!dataStore) return null;
    const info = extractGeoreferencingOnDemand(dataStore as IfcDataStore);
    return info?.hasGeoreference ? info : null;
  }, [dataStore]);

  const unitInfo = useMemo(() => {
    if (!dataStore?.source?.length || !dataStore?.entityIndex) return null;
    const scale = extractLengthUnitScale(dataStore.source, dataStore.entityIndex);
    let unitName = 'Meters';
    if (Math.abs(scale - 0.001) < 0.0001) unitName = 'Millimeters';
    else if (Math.abs(scale - 0.01) < 0.001) unitName = 'Centimeters';
    else if (Math.abs(scale - 0.0254) < 0.001) unitName = 'Inches';
    else if (Math.abs(scale - 0.3048) < 0.01) unitName = 'Feet';
    return { scale, unitName };
  }, [dataStore]);

  const projectUnits = useMemo(() => {
    if (!dataStore?.source?.length || !dataStore?.entityIndex) return ProjectUnits.empty();
    return extractProjectUnits(dataStore.source, dataStore.entityIndex);
  }, [dataStore]);

  const classificationSystems = useMemo(() => {
    if (!dataStore) return [];
    return extractClassificationSystemsOnDemand(dataStore as IfcDataStore);
  }, [dataStore]);

  const entityCount = dataStore?.entityCount?.toLocaleString() ?? 'N/A';

  return (
    <div className="model-metadata-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit] bg-card text-card-foreground">
      <div className="border-b border-border bg-card px-3 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary shadow-sm">
            <FileBox className="size-5" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px] uppercase text-primary">
                {model.schemaVersion}
              </Badge>
              <span className="truncate text-[11px] text-muted-foreground">IFC model</span>
            </div>
            <h3 className="mt-1 truncate text-sm font-semibold text-foreground" title={model.name}>
              {model.name}
            </h3>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <OverviewMetric icon={Database} label="Entities" value={entityCount} />
          <OverviewMetric icon={HardDrive} label="File size" value={formatFileSize(model.fileSize)} />
          <OverviewMetric icon={Layers} label="Storeys" value={stats.storeys.toLocaleString()} />
          <OverviewMetric icon={Building2} label="Geometry" value={stats.elementsWithGeometry.toLocaleString()} />
        </div>
      </div>

      {/* `min-h-0` keeps the ScrollArea viewport constrained when a model has a map. */}
      <ScrollArea className="flex-1 min-h-0">
        <MetadataSection icon={HardDrive} title="Model details" summary={formatFileSize(model.fileSize)}>
          <MetadataRow icon={HardDrive} label="File size" value={formatFileSize(model.fileSize)} />
          <MetadataRow icon={Clock} label="Loaded at" value={formatDate(model.loadedAt)} />
          {dataStore?.parseTime != null && <MetadataRow icon={Clock} label="Parse time" value={`${dataStore.parseTime.toFixed(0)} ms`} />}
          {unitInfo && <MetadataRow icon={Ruler} label="Length unit" value={`${unitInfo.unitName} (${unitInfo.scale})`} />}
          <MetadataRow icon={Hash} label="Max Express ID" value={model.maxExpressId.toLocaleString()} />
        </MetadataSection>

        {projectData && (
          <MetadataSection icon={Tag} title="Project information" summary={projectData.name || 'IFC project'}>
            {projectData.name && <MetadataRow icon={Tag} label="Name" value={projectData.name} />}
            {projectData.description && <MetadataRow icon={FileText} label="Description" value={projectData.description} />}
            {projectData.globalId && <MetadataRow icon={Hash} label="GlobalId" value={<code className="font-mono text-[10px]">{projectData.globalId}</code>} />}
            {projectData.properties.length > 0 && (
              <div className="space-y-2 border-t border-border/60 p-3">
                {projectData.properties.map((pset) => (
                  <PropertySetCard key={pset.name} pset={pset} projectUnits={projectUnits} unitDisplayOverrides={unitDisplayOverrides} />
                ))}
              </div>
            )}
          </MetadataSection>
        )}

        <MetadataSection
          icon={BookMarked}
          title="Classification systems"
          summary={classificationSystems.length === 0 ? 'None' : `${classificationSystems.length} system${classificationSystems.length === 1 ? '' : 's'}`}
          defaultOpen={classificationSystems.length > 0}
        >
          {classificationSystems.length === 0 ? (
            <div className="flex items-center gap-2.5 px-3 py-3 text-xs text-muted-foreground">
              <BookMarked className="size-3.5" />
              No classification systems found in this model.
            </div>
          ) : (
            classificationSystems.map((system) => (
              <div key={system} className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/50">
                <BookMarked className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate font-mono">{system}</span>
              </div>
            ))
          )}
        </MetadataSection>

        <MetadataSection icon={Globe2} title="Location & coordinates" summary={georef?.projectedCRS?.name || (georef ? 'Georeferenced' : 'No location')}>
          <GeoreferencingPanel
            georef={georef}
            modelId={model.id}
            enableEditing
            schemaVersion={model.schemaVersion}
            coordinateInfo={model.geometryResult?.coordinateInfo}
            geometryResult={model.geometryResult}
            lengthUnitScale={unitInfo?.scale}
          />
        </MetadataSection>
      </ScrollArea>
    </div>
  );
}
