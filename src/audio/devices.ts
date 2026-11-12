const BUILTIN =
  /built-?in|inbyggd|\bintern|macbook|imac|mikrofonmatris|microphone array|realtek|conexant|cirrus|\bintel\b|webcam|camera|kamera|\bcam\b|logitech|\blogi\b|brio|facetime|iphone|\bphone|telefon|mobil|ipad|continuity|airpods|bluetooth|hands-?free|headset|headphone|buds|beats|jabra|plantronics|\bpoly\b|bose|virtual|blackhole|loopback|soundflower|zoom ?audio|teams|stereo ?mix|vb-audio|voicemeeter|\bobs\b|\bndi\b|elgato|hdmi|display|monitor of|steam|krisp|nvidia/i;
const KNOWN =
  /usb|interface|focusrite|scarlett|clarett|behringer|umc|u-?phoria|presonus|audiobox|steinberg|\bur\d|motu|universal audio|apollo|\bvolt\b|\brme\b|babyface|fireface|\bssl\b|audient|\bevo\b|\bid\d|zoom [a-z]{1,3}-?\d|tascam|roland|rubix|m-audio|m-track|komplete|native instruments|arturia|minifuse|audiofuse|line ?6|helix|irig|apogee|\bduet\b|antelope|mackie|onyx|yamaha|\bag0\d|soundcraft|lexicon|mixer|line in|analogue?|instrument/i;
/** Browsers prefix the system default device with "Default - ". */
export const stripDef = (l: string | undefined) =>
  (l || '').replace(/^(default|standard|communications|kommunikation(er)?)\s*-\s*/i, '');
/** A device label without the prefix and the usb id, for messages. */
export const nice = (l: string | undefined) =>
  stripDef(l).replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '') || 'microphone';
/**
 * Pick the input to use: the remembered one, or else the best-looking sound card (the system default is
 * often the laptop microphone). Returns null when nothing better than the current input is found.
 */
export function chooseInput(ins: MediaDeviceInfo[], remembered: string | null, curLabel: string) {
  if (remembered === '@default') return null; // the user asked to follow the computer's own setting
  ins = ins.filter(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  let hit: MediaDeviceInfo | null | undefined = remembered ? ins.find(d => d.label === remembered) : null;
  if (!hit) {
    const ext = ins.filter(d => d.label && !BUILTIN.test(d.label));
    hit = ext.find(d => KNOWN.test(d.label)) || ext.find(d => !/mic|mikrofon/i.test(d.label)) || ext[0];
  }
  if (!hit || stripDef(hit.label) === stripDef(curLabel)) return null;
  return hit;
}
