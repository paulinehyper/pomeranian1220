// auto-launch.js
// cross-platform auto-launch setup for Electron
const AutoLaunch = require('auto-launch');
const path = require('path');

const appName = 'ScheduleWidget';
const appPath = process.platform === 'darwin'
  ? path.join(process.resourcesPath, 'app', 'main.js')
  : process.execPath;

const autoLauncher = new AutoLaunch({
  name: appName,
  path: appPath,
});

module.exports = autoLauncher;
