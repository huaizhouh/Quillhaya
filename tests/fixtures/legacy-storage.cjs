// Reproduce the previous app's Keychain namespace using only isolated test data.
const { app, BrowserWindow } = require('electron');
if (!process.env.TWA_TEST_USER_DATA) throw new Error('An isolated test directory is required.');
// Playwright injects a mock Keychain into source launches; packaged apps use the
// native Keychain. Remove test-only switches before any encryption initialization.
app.commandLine.removeSwitch('use-mock-keychain');
app.commandLine.removeSwitch('password-store');
app.setName('TOEFL Writing Assistant');
app.setPath('userData', process.env.TWA_TEST_USER_DATA);
app.whenReady().then(() => {
  new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
});
