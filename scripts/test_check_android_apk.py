import importlib.util
import io
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("check_android_apk", Path(__file__).with_name("check-android-apk.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class AndroidApkCheckTest(unittest.TestCase):
    def apk(self, extra=None, omitted=()):
        entries = {
            "lib/arm64-v8a/libzxingcpp_android.so": b"reader",
            "lib/x86_64/libzxingcpp_android.so": b"reader",
            "assets/zxing-cpp/LICENSE": b"Apache License\nVersion 2.0",
            "assets/zxing-cpp/NOTICE": b"Bundled libzueci (BSD-3-Clause)",
            "classes.dex": b"Lzxingcpp/BarcodeReader;",
        }
        entries.update(extra or {})
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for name, data in entries.items():
                if name not in omitted:
                    archive.writestr(name, data)
        buffer.seek(0)
        return buffer

    def test_accepts_reader_for_every_packaged_abi(self):
        self.assertEqual(checker.check_apk(self.apk()), ["arm64-v8a", "x86_64"])

    def test_rejects_proprietary_library_model_and_secondary_dex(self):
        for entry in (
            {"lib/arm64-v8a/libbarhopper_v3.so": b"binary"},
            {"assets/mlkit_barcode_models/model.tflite": b"model"},
            {"classes2.dex": b"Lcom/google/mlkit/vision/barcode/BarcodeScanning;"},
            {"AndroidManifest.xml": "com.google.mlkit.vision.DEPENDENCIES".encode("utf-16-le")},
        ):
            with self.subTest(entry=entry), self.assertRaisesRegex(ValueError, "ML Kit"):
                checker.check_apk(self.apk(entry))

    def test_rejects_missing_abi_and_license(self):
        with self.assertRaisesRegex(ValueError, "armeabi-v7a"):
            checker.check_apk(self.apk({"lib/armeabi-v7a/libhermes.so": b"engine"}))
        with self.assertRaisesRegex(ValueError, "license"):
            checker.check_apk(self.apk(omitted=("assets/zxing-cpp/LICENSE",)))
        with self.assertRaisesRegex(ValueError, "notices"):
            checker.check_apk(self.apk(omitted=("assets/zxing-cpp/NOTICE",)))


if __name__ == "__main__":
    unittest.main()
