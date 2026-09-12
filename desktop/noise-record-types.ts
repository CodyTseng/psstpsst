/** Secure application records accepted by both Noise sealing directions. */
export function validNoiseRecordType(type: number): boolean {
  return (
    [0x10, 0x11, 0x12, 0x13, 0x14, 0x20, 0x21, 0x7e, 0x7f].includes(type) ||
    (type >= 0x30 && type <= 0x36)
  );
}
