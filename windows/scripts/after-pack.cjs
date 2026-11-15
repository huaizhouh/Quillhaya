const { unlink } = require('node:fs/promises');
const { join } = require('node:path');

// A local Electron distribution contains its welcome application. Only Quillhaya
// belongs in the final resources directory.
module.exports = async ({ appOutDir }) => {
  await unlink(join(appOutDir, 'resources', 'default_app.asar')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
};
