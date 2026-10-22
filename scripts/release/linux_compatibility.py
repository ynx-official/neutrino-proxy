"""Inspect shipped ELF files and optionally smoke-test them in CentOS 7 userspace.

Containers share the runner kernel. No result here certifies Linux 3.10 support.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import tempfile

from release import ROOT, parse_version, unpack_bundle, validate_linux_static, write_json


# Official Docker Library CentOS 7, pinned to its Linux AMD64 image manifest.
CENTOS7_IMAGE = "docker.io/library/centos:7@sha256:dead07b4d8ed7e29e98de0f4504d87e8880d4347859d839686a31da35a3b532f"


def inspect_elf(binary):
    """Check ELF headers/tables rather than searching arbitrary embedded resource bytes."""
    output = subprocess.check_output(
        ["readelf", "--wide", "--file-header", "--program-headers", "--dynamic", "--version-info", str(binary)],
        text=True, stderr=subprocess.STDOUT, env={**os.environ, "LC_ALL": "C"}, timeout=30)
    if (not re.search(r"Class:\s+ELF64", output)
            or not re.search(r"Machine:\s+Advanced Micro Devices X86-64", output)
            or not re.search(r"Type:\s+(EXEC|DYN)\b", output)):
        raise ValueError("Expected a Linux x86_64 ELF64 executable")
    interpreter = bool(re.search(r"^\s*INTERP\s", output, re.MULTILINE))
    needed = re.findall(r"\(NEEDED\).*?\[([^\]]+)\]", output)
    glibc = sorted(set(re.findall(r"GLIBC_[0-9.]+", output)))
    if interpreter or needed or glibc:
        raise ValueError(f"Linux output is not fully static: interpreter={interpreter}, needed={needed}, glibc={glibc}")
    return {"architecture": "x86_64", "interpreter": None, "needed_libraries": needed, "glibc_versions": glibc}


def inspect_archives(output, version):
    archives = []
    for module in ("server", "client"):
        archive = output / f"neutrino-proxy-{module}-{version}-linux-x64-musl-static.zip"
        with tempfile.TemporaryDirectory(prefix="np-elf-") as folder:
            destination = Path(folder).resolve()
            if destination.parent != Path(tempfile.gettempdir()).resolve():
                raise ValueError("Unexpected ELF inspection directory")
            unpack_bundle(archive, destination)
            binary = destination / archive.stem / f"neutrino-proxy-{module}"
            evidence = inspect_elf(binary)
            archives.append({"name": archive.name, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                             "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(), **evidence})
    report = {"version": version, "linkage": "static-musl", "elf_inspection": "passed", "archives": archives,
              "runtime": {"centos7_container": "skipped_by_request" if os.environ.get("SKIP_TESTS") == "true" else "not_run",
                          "centos7_image": CENTOS7_IMAGE, "runner_kernel": platform.release(),
                          "kernel_3_10": "not_verified", "tls_and_full_proxy_matrix": "not_verified"}}
    write_json(output / "build-info/linux-musl-compatibility.json", report)
    print(json.dumps(report, indent=2))


def smoke_centos7(output, version):
    """Use host Python fixtures with only the shipped apps inside the legacy userspace."""
    from smoke import smoke_client, smoke_server

    report = validate_linux_static(output, version, require_runtime=False)
    libc = subprocess.check_output(["docker", "run", "--rm", "--platform", "linux/amd64", CENTOS7_IMAGE,
                                    "getconf", "GNU_LIBC_VERSION"], text=True, timeout=180).strip()
    if libc != "glibc 2.17":
        raise ValueError(f"Unexpected CentOS 7 userspace: {libc}")
    os.environ["NP_SMOKE_CONTAINER_IMAGE"] = CENTOS7_IMAGE
    try:
        for module, smoke in (("server", smoke_server), ("client", smoke_client)):
            smoke(output / f"neutrino-proxy-{module}-{version}-linux-x64-musl-static.zip")
        report["runtime"].update(centos7_container="passed", container_glibc=libc)
    except Exception:
        report["runtime"]["centos7_container"] = "failed"
        raise
    finally:
        os.environ.pop("NP_SMOKE_CONTAINER_IMAGE", None)
        write_json(output / "build-info/linux-musl-compatibility.json", report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--mode", choices=("inspect", "smoke"), required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "release-assets")
    args = parser.parse_args()
    version = parse_version(args.tag)
    if args.mode == "inspect":
        inspect_archives(args.output, version)
    else:
        smoke_centos7(args.output, version)


if __name__ == "__main__":
    main()
