import { join } from 'node:path';

// The packaged app and source runs never share user files or a Keychain identity.
export function storageIdentity(packaged: boolean, appData: string, testDirectory?: string) {
  const name = packaged ? 'Quillhaya' : 'Quillhaya Development';
  return { name, directory: testDirectory || join(appData, name) };
}
