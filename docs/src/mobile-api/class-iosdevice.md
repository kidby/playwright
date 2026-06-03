# class: IosDevice
* since: v1.61
* langs: js

[IosDevice] represents a connected iOS device or simulator. Returned from [`method: Ios.devices`]. Each device wraps one Appium session.

## event: IosDevice.close
* since: v1.61

Emitted when the device session is closed.

## event: IosDevice.webView
* since: v1.61
- argument: <[IosWebView]>

Emitted when a new in-app WebView context is detected.

## event: IosDevice.webViewRemoved
* since: v1.61
- argument: <[string]>

Emitted when a WebView context disappears. The argument is the bundle ID.

## method: IosDevice.udid
* since: v1.61
- returns: <[string]>

The device UDID.

## method: IosDevice.name
* since: v1.61
- returns: <[string]>

The device display name (e.g. `iPhone 15`).

## method: IosDevice.osVersion
* since: v1.61
- returns: <[string]>

The iOS version (e.g. `17.5`).

## method: IosDevice.isSimulator
* since: v1.61
- returns: <[boolean]>

`true` for simulators, `false` for real devices.

## async method: IosDevice.tap
* since: v1.61

Taps an element identified by the selector.

### param: IosDevice.tap.selector
* since: v1.61
- `selector` <[IosSelector]>

iOS element selector (accessibility ID, predicate, class chain, xpath, or class name).

### option: IosDevice.tap.timeout
* since: v1.61
- `timeout` <[float]>

Maximum time to wait, in milliseconds. Defaults to `30000`.

## async method: IosDevice.fill
* since: v1.61

Fills text into an element identified by the selector.

### param: IosDevice.fill.selector
* since: v1.61
- `selector` <[IosSelector]>

### param: IosDevice.fill.text
* since: v1.61
- `text` <[string]>

### option: IosDevice.fill.timeout
* since: v1.61
- `timeout` <[float]>

## async method: IosDevice.screenshot
* since: v1.61
- returns: <[Buffer]>

Returns a PNG screenshot of the device screen.

### option: IosDevice.screenshot.path
* since: v1.61
- `path` <[path]>

Optional path on disk where the screenshot is also saved.

## async method: IosDevice.webViews
* since: v1.61
- returns: <[Array]<[IosWebView]>>

Returns the current list of in-app WebView descriptors. Does NOT attach a Playwright `Page` — that's a future PR.

## async method: IosDevice.executeScript
* since: v1.61
- returns: <[Serializable]>

Escape hatch for Appium's `mobile:` script commands (e.g. `mobile: setLocale`, `mobile: deepLink`). Forwards to the Appium server's `POST /session/:id/execute/sync` endpoint.

### param: IosDevice.executeScript.script
* since: v1.61
- `script` <[string]>

The Appium command name (e.g. `mobile: setLocale`).

### option: IosDevice.executeScript.args
* since: v1.61
- `args` <[any]>

Arguments forwarded with the script.

## async method: IosDevice.close
* since: v1.61

Closes the Appium session and tears down the underlying device connection.
