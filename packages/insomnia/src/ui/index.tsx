
import {

  isDevelopment,
} from '../common/constants';
import { database } from '../common/database';
import * as models from '../models';

import { trackKeyboardModality } from './keyboard-modality';
import { renderApp } from './renderApp';

trackKeyboardModality();
renderApp();

// Export some useful things for dev
if (isDevelopment()) {
  // @ts-expect-error -- TSCONVERSION needs window augmentation
  window.models = models;
  // @ts-expect-error -- TSCONVERSION needs window augmentation
  window.db = database;
}
