#!/usr/bin/env python3

import sys

from apksigcopier import do_copy


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("Usage: copy-apk-signature.py <signed.apk> <unsigned.apk> <output.apk>")
    do_copy(*sys.argv[1:])


if __name__ == "__main__":
    main()
