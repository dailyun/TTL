export const SUPPORTED_CAPTURE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
] as const;

export function isSupportedCaptureImageType(value: string): boolean {
  return SUPPORTED_CAPTURE_IMAGE_TYPES.includes(
    value as (typeof SUPPORTED_CAPTURE_IMAGE_TYPES)[number]
  );
}
