import { describe, expect, it } from 'vitest';
import { chooseInput, nice, stripDef } from '../src/audio/devices.js';

const dev = (label: string, deviceId = label): MediaDeviceInfo =>
  ({ label, deviceId, kind: 'audioinput', groupId: '' }) as MediaDeviceInfo;

describe('choosing the input', () => {
  const ins = [dev('default', 'default'), dev('MacBook Pro Microphone'), dev('Scarlett 2i2 USB')];

  it('prefers a sound card over the built-in microphone', () => {
    expect(chooseInput(ins, null, 'Default - MacBook Pro Microphone')?.label).toBe('Scarlett 2i2 USB');
  });

  it('uses the remembered input when it is there', () => {
    expect(chooseInput(ins, 'MacBook Pro Microphone', 'Scarlett 2i2 USB')?.label).toBe(
      'MacBook Pro Microphone'
    );
  });

  it('keeps the current input when it is already the best', () => {
    expect(chooseInput(ins, null, 'Scarlett 2i2 USB')).toBeNull();
  });

  it('follows the computer default when the user asked for it', () => {
    expect(chooseInput(ins, '@default', 'MacBook Pro Microphone')).toBeNull();
  });

  it('gives up when there is only a built-in microphone', () => {
    expect(chooseInput([dev('MacBook Pro Microphone')], null, '')).toBeNull();
  });
});

describe('device labels', () => {
  it('strips the "Default - " prefix and the usb id', () => {
    expect(stripDef('Default - Scarlett')).toBe('Scarlett');
    expect(nice('Scarlett 2i2 (1235:8200)')).toBe('Scarlett 2i2');
    expect(nice('')).toBe('microphone');
  });
});
