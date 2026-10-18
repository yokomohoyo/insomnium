import { describe, expect, it } from '@jest/globals';
import path from 'path';

import { pluginFolders } from '../index';

describe('pluginFolders()', () => {
  it('keeps the drive letter of a Windows folder', () => {
    expect(pluginFolders('C:\\plugins;D:\\more plugins;', ';', 'C:\\Users\\me')).toEqual(['C:\\plugins', 'D:\\more plugins']);
  });

  it('splits on : elsewhere, and on lines anywhere', () => {
    expect(pluginFolders('/opt/plugins:/srv/plugins\n/home/me/dev-plugin\n\n', ':', '/home/me')).toEqual(['/opt/plugins', '/srv/plugins', '/home/me/dev-plugin']);
  });

  it('reads ~ as the home folder', () => {
    expect(pluginFolders('~/plugins: ~ ', ':', '/home/me')).toEqual([path.join('/home/me', '/plugins'), path.join('/home/me', '')]);
  });

  it('has none for an empty setting', () => {
    expect(pluginFolders('', ':', '/home/me')).toEqual([]);
  });
});
