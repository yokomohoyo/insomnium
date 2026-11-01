import { library } from '@fortawesome/fontawesome-svg-core';
import { faGithub } from '@fortawesome/free-brands-svg-icons';
import {
  faAdd, faArrowRightToFile, faCancel, faCaretDown, faCheck, faChildren, faCircle, faClipboard, faClockFour,
  faCode, faCodeBranch, faCodeFork, faCog, faCookieBite, faCopy, faEdit, faExchange, faFile, faFileText, faFilter,
  faFlask, faFolderBlank, faFolderOpen, faGlobe, faHeart, faHistory, faLaptop, faMagicWandSparkles, faNavicon,
  faPlay, faPlug, faPlusCircle, faProjectDiagram, faSearch, faSync, faTerminal, faThumbTack, faTimes, faTrash,
  faUnsorted, faWrench,
} from '@fortawesome/free-solid-svg-icons';
import {
  FontAwesomeIcon,
  FontAwesomeIconProps,
} from '@fortawesome/react-fontawesome';
import React from 'react';

// The icons the app shows with <Icon>, not every one there is: the three
// whole sets were 1.5 MB of the 4.3 MB a window loads at start.
// __tests__/icon.test.ts says which one a new <Icon> needs added.
library.add(
  faAdd, faArrowRightToFile, faCancel, faCaretDown, faCheck, faChildren, faCircle, faClipboard, faClockFour,
  faCode, faCodeBranch, faCodeFork, faCog, faCookieBite, faCopy, faEdit, faExchange, faFile, faFileText, faFilter,
  faFlask, faFolderBlank, faFolderOpen, faGlobe, faHeart, faHistory, faLaptop, faMagicWandSparkles, faNavicon,
  faPlay, faPlug, faPlusCircle, faProjectDiagram, faSearch, faSync, faTerminal, faThumbTack, faTimes, faTrash,
  faUnsorted, faWrench,
  faGithub,
);

export const Icon = (props: FontAwesomeIconProps) => (
  <FontAwesomeIcon {...props} />
);
