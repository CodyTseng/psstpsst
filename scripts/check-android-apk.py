"""Verify that a release APK or AAB ships ZXing-C++ and excludes ML Kit binaries."""

import re
import sys
import zipfile


def check_apk(path, *, bundle=False):
    with zipfile.ZipFile(path) as apk:
        entries = {}
        for name in apk.namelist():
            normalized = name
            if bundle and name.startswith("base/"):
                normalized = name.removeprefix("base/")
                if normalized.startswith(("dex/", "manifest/")):
                    normalized = normalized.split("/", 1)[1]
            entries[normalized] = name
        names = set(entries)
        forbidden = [name for name in apk.namelist() if re.search(r"mlkit|barhopper", name, re.I)]
        for name in names:
            if re.fullmatch(r"classes\d*\.dex", name) or name == "AndroidManifest.xml":
                data = apk.read(entries[name])
                for marker in ("com/google/mlkit", "com.google.mlkit", "com/google/android/gms/internal/mlkit"):
                    if marker.encode() in data or marker.encode("utf-16-le") in data:
                        forbidden.append(f"{name}: {marker}")
        if forbidden:
            raise ValueError("APK contains ML Kit artifacts: " + ", ".join(forbidden))

        abis = {name.split("/")[1] for name in names if re.fullmatch(r"lib/[^/]+/[^/]+\.so", name)}
        if not abis:
            raise ValueError("APK contains no native libraries")
        for abi in sorted(abis):
            if f"lib/{abi}/libzxingcpp_android.so" not in names:
                raise ValueError(f"APK is missing the ZXing-C++ reader for {abi}")
        for filename, marker in (("LICENSE", b"Apache License"), ("NOTICE", b"libzueci")):
            license_path = f"assets/zxing-cpp/{filename}"
            if license_path not in names or marker not in apk.read(entries[license_path]):
                raise ValueError(f"APK is missing the ZXing-C++ license or notices: {filename}")
    return sorted(abis)


if __name__ == "__main__":
    try:
        abis = check_apk(sys.argv[1], bundle=sys.argv[1].endswith(".aab"))
    except (IndexError, OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"Android package check failed: {error}", file=sys.stderr)
        sys.exit(1)
    print(f"Android package scanner check passed ({', '.join(abis)}).")
