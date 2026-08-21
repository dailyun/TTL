import assert from "node:assert/strict";
import test from "node:test";
import {
  isSupportedCaptureImageType,
  SUPPORTED_CAPTURE_IMAGE_TYPES
} from "../src/domain/attachments.js";

test("capture attachments allow common screenshot formats only", () => {
  assert.deepEqual(SUPPORTED_CAPTURE_IMAGE_TYPES, [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif"
  ]);
  assert.equal(isSupportedCaptureImageType("image/png"), true);
  assert.equal(isSupportedCaptureImageType("image/webp"), true);
  assert.equal(isSupportedCaptureImageType("image/svg+xml"), false);
  assert.equal(isSupportedCaptureImageType("text/plain"), false);
});
