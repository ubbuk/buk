// Pure (no server imports): shared by the API validation and the PIN screens. An approval PIN is 4 to 6 digits; PINs set
// when it was exactly 4 stay valid.
export const PIN_MIN = 4;
export const PIN_MAX = 6;
export const PIN_PATTERN = /^\d{4,6}$/;
export const PIN_FORMAT_ERROR = "PIN 4-6 оронтой тоо байх ёстой";

export const isValidPinFormat = (pin: string): boolean => PIN_PATTERN.test(pin);
