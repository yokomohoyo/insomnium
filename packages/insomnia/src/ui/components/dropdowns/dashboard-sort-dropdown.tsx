import React, { FC } from 'react';

import { DASHBOARD_SORT_ORDERS, DashboardSortOrder } from '../../../common/constants';
import { t } from '../../../common/i18n';
import { Dropdown, DropdownButton, DropdownItem, ItemContent } from '../base/dropdown';

// a sort order's name, in the app's language
const sortOrderName = (order: DashboardSortOrder) => ({
  'name-asc': t('Name Ascending (A-Z)'),
  'name-desc': t('Name Descending (Z-A)'),
  'created-asc': t('Oldest First'),
  'created-desc': t('Newest First'),
  'modified-desc': t('Last Modified'),
})[order];

interface DashboardSortDropdownProps {
  value: DashboardSortOrder;
  onSelect: (value: DashboardSortOrder) => void;
}

export const DashboardSortDropdown: FC<DashboardSortDropdownProps> = ({ onSelect, value }) => {
  return (
    <Dropdown
      aria-label={t('Dashboard Sort Dropdown')}
      className="margin-left"
      triggerButton={
        <DropdownButton
          aria-label={t('Sort')}
          variant='outlined'
          removePaddings={false}
          disableHoverBehavior={false}
        >
          <i className="fa fa-sort" />
        </DropdownButton>
      }
    >
      {DASHBOARD_SORT_ORDERS.map(order => (
        <DropdownItem
          key={order}
          aria-label={sortOrderName(order)}
        >
          <ItemContent
            label={sortOrderName(order)}
            isSelected={order === value}
            onClick={() => onSelect(order)}
          />
        </DropdownItem>
      ))}
    </Dropdown>
  );
};
