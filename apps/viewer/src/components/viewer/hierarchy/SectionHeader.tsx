/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Badge } from '@/components/ui/badge';

export interface SectionHeaderProps {
  icon: React.ElementType;
  title: string;
  count?: number;
}

export function SectionHeader({ icon: IconComponent, title, count }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border/70 bg-muted/30 px-3 py-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-background text-muted-foreground shadow-sm">
        <IconComponent className="h-3.5 w-3.5" />
      </span>
      <span className="text-[11px] font-semibold tracking-tight text-foreground">
        {title}
      </span>
      {count !== undefined && (
        <Badge variant="secondary" className="ml-auto h-5 rounded-md px-1.5 font-mono text-[10px] text-muted-foreground">
          {count.toLocaleString()}
        </Badge>
      )}
    </div>
  );
}
