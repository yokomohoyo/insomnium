import { jest } from '@jest/globals';

import * as modalsOriginal from '../index';

const modals = jest.requireActual('../index') as typeof modalsOriginal;

modals.showError = jest.fn();
modals.showAlert = jest.fn();
modals.showPrompt = jest.fn();
modals.showModal = jest.fn();

// WARNING: changing this to `export default` will break the mock and be incredibly hard to debug. Ask me how I know.
module.exports = modals;
