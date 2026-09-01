/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
}

/**
 * Groups adjacent actions into one continuous control.
 *
 * The component intentionally accepts inputs as well as buttons, matching the
 * shadcn Button Group composition used by the hierarchy search field.
 */
const ButtonGroup = React.forwardRef<HTMLDivElement, ButtonGroupProps>(
  ({ className, orientation = 'horizontal', ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      className={cn(
        'flex items-stretch',
        orientation === 'horizontal'
          ? 'flex-row [&>*:first-child]:rounded-l-xl [&>*:first-child]:rounded-r-none [&>*:last-child]:rounded-l-none [&>*:last-child]:rounded-r-xl [&>*:not(:first-child)]:border-l-0'
          : 'flex-col [&>*:first-child]:rounded-b-none [&>*:first-child]:rounded-t-xl [&>*:last-child]:rounded-b-xl [&>*:last-child]:rounded-t-none [&>*:not(:first-child)]:border-t-0',
        className,
      )}
      {...props}
    />
  ),
);
ButtonGroup.displayName = 'ButtonGroup';

export { ButtonGroup };
