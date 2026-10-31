import React, { FunctionComponent, ReactNode } from 'react';
import styled from 'styled-components';

// what makes an element that's clicked a button for the keyboard too: in the
// tab order, named a button, and pressed with Enter or Space as with a click
export const pressable = (onPress?: (event: React.SyntheticEvent) => void) => onPress ? {
  role: 'button',
  tabIndex: 0,
  onClick: onPress,
  onKeyDown: (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPress(event);
    }
  },
} : {};

export interface SidebarItemProps {
  children: ReactNode;
  gridLayout?: boolean;
  onClick?: () => void;
}

const StyledBlockItem = styled.div`
  padding: var(--padding-xs) var(--padding-md) var(--padding-xs) 0;
  margin: 0;
  display: flex;
  align-items: center;
  font-size: var(--font-size-md);
  line-height: var(--font-size-md);
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  &:hover {
    background-color: var(--hl-xxs);
    cursor: default;
  }
  &:last-child {
    margin-bottom: var(--padding-md);
  }
  span {
    margin: 0 0 0 var(--padding-xs);
  }
  div {
    display: inline;
    margin: 0;
  }
  div:nth-child(1) {
    padding-left: var(--padding-xs);
  }
  div.tooltip {
    padding: 0;
  }
`;

const StyledGridItem = styled.li`
  padding: 0 0 0 var(--padding-sm);
  margin: 0;
  display: flex;
  align-items: center;
  white-space: nowrap;
  font-size: var(--font-size-md);
  line-height: var(--font-size-sm);
  &:first-child {
    margin-top: var(--padding-xxs);
  }
  span {
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    padding: 4px var(--padding-sm) var(--padding-xs) 0px;
    margin-left: var(--padding-xs);
  }
  a {
    color: var(--hl-xl);
  }
  div:nth-child(1) {
    text-align: right;
    svg {
      padding-left: var(--padding-sm);
    }
  }
  &:hover {
    background-color: var(--hl-xxs);
    cursor: default;
  }
  &:last-child {
    margin-bottom: var(--padding-md);
  }
`;

export const SidebarItem: FunctionComponent<SidebarItemProps> = ({ children, gridLayout, onClick }) => {
  if (gridLayout) {
    return <StyledGridItem {...pressable(onClick)}>{children}</StyledGridItem>;
  } else {
    return <StyledBlockItem {...pressable(onClick)}>{children}</StyledBlockItem>;
  }
};
