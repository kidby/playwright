# class: Ios
* since: v1.61
* langs: js

Playwright has **experimental** support for native iOS automation via Appium 2 (XCUITest driver). Provides a top-level `_ios` handle that mirrors the existing `_android` shape but talks to an Appium server instead of ADB.

*Requirements*
* macOS host with Xcode + iOS Simulator, or a real iOS device with WebDriverAgent installed.
* [Appium 2](https://appium.io) running with the `xcuitest` driver installed.
* For real devices, the device UDID(s) must be supplied to [`method: Ios.devices`].

*Known limitations*
* WebView descriptors are returned, but attaching a full Playwright `Page` to an in-app WebView is a future PR. Use `device.executeScript('mobile: setContext', [...])` for now.
* Real-device enumeration requires explicit UDIDs (no ADB-equivalent auto-discovery).

*How to run*

```js
const { _ios: ios } = require('playwright');

(async () => {
  // Connect to booted iOS Simulators (macOS) or supplied real devices.
  const [device] = await ios.devices({
    capabilities: {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:deviceName': 'iPhone 15',
      'appium:platformVersion': '17.5',
      'appium:app': '/path/to/app.app',
    },
  });
  console.log(`UDID: ${device.udid()}, OS: ${device.osVersion()}`);

  await device.tap({ accessibilityId: 'login-button' });
  await device.fill({ accessibilityId: 'email' }, 'user@example.com');
  await device.screenshot({ path: 'screen.png' });
  await device.close();
})();
```

## async method: Ios.devices
* since: v1.61
- returns: <[Array]<[IosDevice]>>

Returns the list of iOS devices that match the provided options. On macOS with no `udids` argument, returns booted iOS Simulators discovered via `xcrun simctl list -j devices`. With `udids`, returns one device per UDID using a single Appium session per device.

### option: Ios.devices.serverUrl
* since: v1.61
- `serverUrl` <[string]>

Appium server URL. Defaults to the URL provided via the project's `appium.serverUrl` config option, or `http://127.0.0.1:4723`.

### option: Ios.devices.capabilities
* since: v1.61
- `capabilities` <[Object]>

W3C Appium capabilities forwarded to the server when creating a session.

### option: Ios.devices.udids
* since: v1.61
- `udids` <[Array]<[string]>>

Explicit list of iOS device UDIDs (real devices or simulators). When omitted on macOS, simulators are auto-discovered via `xcrun simctl`.
