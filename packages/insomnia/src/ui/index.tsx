
import {

  isDevelopment,
} from '../common/constants';
import { database } from '../common/database';
import * as models from '../models';

// asks before a Google ID token goes to another audience's host
import './gcp-audience';
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
