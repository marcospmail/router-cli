import { describe, test, expect } from 'bun:test';
import { isListedOnline, isDebugPortMissing, NO_DEBUG_PORT_ERROR, TIMEOUT_ERROR_PREFIX } from './adb-wifi.js';

const TARGET = '192.168.15.12:5555';

describe('isListedOnline', () => {
  test('true when the target is listed as device', () => {
    const out = `List of devices attached\n${TARGET}\tdevice\n192.168.15.15:5555\tdevice`;
    expect(isListedOnline(out, TARGET)).toBe(true);
  });

  test('false when the target is offline', () => {
    expect(isListedOnline(`List of devices attached\n${TARGET}\toffline`, TARGET)).toBe(false);
  });

  test('false when only another device or port is listed', () => {
    const out = 'List of devices attached\n192.168.15.15:5555\tdevice\n192.168.15.12:41234\tdevice';
    expect(isListedOnline(out, TARGET)).toBe(false);
  });

  test('false when a longer IP shares the prefix', () => {
    expect(isListedOnline('List of devices attached\n192.168.15.120:5555\tdevice', TARGET)).toBe(false);
  });

  test('false when nothing is attached', () => {
    expect(isListedOnline('List of devices attached\n', TARGET)).toBe(false);
  });
});

describe('isDebugPortMissing', () => {
  test('true when the scan found no port', () => {
    expect(isDebugPortMissing(NO_DEBUG_PORT_ERROR)).toBe(true);
  });

  // The full port scan outlasts the per-device timeout, so a timeout is how
  // "wireless debugging is off" usually shows up.
  test('true when the connect attempt timed out', () => {
    expect(isDebugPortMissing(`${TIMEOUT_ERROR_PREFIX} ADB connect 192.168.15.15 (30000ms)`)).toBe(true);
  });

  test('false for other errors', () => {
    expect(isDebugPortMissing('Failed to connect to 192.168.15.15:5555 after tcpip switch')).toBe(false);
  });
});
