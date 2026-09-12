# Android QR scanning

PsstPsst uses ZXing-C++ 3.0.2 through a versioned `patch-package` patch for
`expo-camera` 56.0.8. The official Maven Android reader is Apache-2.0 and has
barcode writers disabled. Version 3.0.2 uses Kotlin 2.2 metadata accepted by the
current Kotlin compiler; 3.1.1 requires a newer Kotlin toolchain.

`package.json` forces only Android's `expo-camera` to build from source. Without
this override, Expo SDK 56 can select a prebuilt AAR containing ML Kit and ignore
the patch. iOS and Electron continue to use their existing Expo implementations.

The patch keeps `CameraView.onBarcodeScanned` and `scanFromURLAsync`, so the
shared scanner and wallet payment screen keep their existing interfaces. It
removes Google's standalone scanner activity (`launchScanner` is unavailable)
and ML Kit's structured `extra` metadata, neither of which the app uses. Raw
decoded text, including Unicode and payment payloads, is preserved.

Live frames use a serial background executor, CameraX's latest-frame
backpressure, a 150 ms minimum interval, and a preferred 1280 x 720 analysis
resolution. ZXing reads the Y plane directly with its row stride and crop.
Frames close even after skipped or failed scans. Results return to the main
thread and are discarded when their camera session has been replaced or
destroyed. Image-library decoding also runs off the main thread.

## Verification

After `npm ci` and generating the Android project, connect an Android device or
start an emulator, then run:

```sh
cd android
./gradlew :expo-camera:connectedDebugAndroidTest
```

The instrumentation suite in `tests/android/qr-scanner/` runs the actual JNI
reader against generated dense, Unicode, rotated, inverted, and RGB565 images.
It also tests blank images, format filtering, padded/cropped Y planes, rotation
dimensions, and frame release. Test-only ZXing Java generates independent QR
fixtures; it is not an app runtime dependency.

Check release dependencies and the built APK:

```sh
(cd android && ./gradlew :app:dependencies --configuration releaseRuntimeClasspath --console=plain) > android-dependencies.txt
node scripts/check-android-dependencies.mjs android-dependencies.txt
(cd android && ./gradlew :app:assembleRelease)
python3 scripts/check-android-apk.py android/app/build/outputs/apk/release/app-release.apk
```

CI runs both guards. The APK must include ZXing-C++ for every packaged ABI,
its Apache license and bundled third-party notices, and must contain no ML Kit
libraries, models, class references, or scanner-download metadata. These checks are not a complete F-Droid or license audit.

On a physical device, also check autofocus, low light, tilted and dense payment
codes, repeated open/close, switching to the image picker, ordinary photo
capture, and responsiveness on a slower phone. Synthetic images and emulator
tests cannot establish real-camera recognition quality.

When upgrading Expo Camera, rebase the patch, review changes to CameraX and
barcode APIs, and rerun both native and APK checks. Keep the source-build
override and the upstream decoder's license. Do not reintroduce Google barcode
artifacts, including as `compileOnly` dependencies.
