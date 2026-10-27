"""Regression checks for the distributable files, independent of build tools."""

import importlib.util
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile


SPEC = importlib.util.spec_from_file_location("release", Path(__file__).with_name("release.py"))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
REPO = Path(__file__).resolve().parents[2]


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.out = self.root / "output"

    def test_tag_version_rejects_paths_and_shell_input(self):
        for tag in ("v2.1.0", "v2.1.0-rc.1"):
            self.assertEqual(release.parse_version(tag), tag[1:])
        for tag in ("2.1.0", "vtest", "v1.02.3", "v1.2.3-01", "v65536.0.0", "v1.2.3/evil", "v1.2.3;echo bad"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release.parse_version(tag)

    def test_prepare_updates_java_without_a_desktop_checkout(self):
        for name in ("pom.xml",
                     "neutrino-proxy-server/src/main/resources/app.yml",
                     "neutrino-proxy-client/src/main/resources/app.yml"):
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO / name, dest)
        release.prepare_versions(self.root, "2.1.0")
        self.assertFalse((self.root / "neutrino-proxy-client-app").exists())
        self.assertIn("<revision>2.1.0</revision>", (self.root / "pom.xml").read_text(encoding="utf-8"))
        self.assertIn("version: 2.1.0", (self.root / "neutrino-proxy-server/src/main/resources/app.yml").read_text(encoding="utf-8"))

    def make_java(self, module="client", kind="jar", platform="any"):
        directory = self.root / f"neutrino-proxy-{module}"
        (directory / "target").mkdir(parents=True)
        resources = directory / "src/main/resources"
        resources.mkdir(parents=True)
        (resources / "app-copy.yml").write_text("license-key: ${LICENSE_KEY:}\n", encoding="utf-8")
        (directory / "target/classes").mkdir()
        (directory / "target/classes/app.yml").write_text(
            "neutrino:\n  proxy:\n    protocol:\n      max-frame-length: 2097152\n"
            "    tunnel:\n      license-key: ${LICENSE_KEY:}\n", encoding="utf-8")
        (self.root / "LICENSE").write_text("MIT", encoding="utf-8")
        suffix = ".jar" if kind == "jar" else ".exe" if platform == "windows-x64" else ""
        binary = directory / "target" / (directory.name + suffix)
        if kind == "jar":
            with zipfile.ZipFile(binary, "w") as jar:
                jar.writestr("META-INF/MANIFEST.MF", "Main-Class: example.Main\n")
        else:
            binary.write_bytes(b"test native executable")
        return release.package_java(self.root, self.out, module, kind, platform, "2.1.0")

    def test_jar_package_contains_config_license_and_portable_launchers(self):
        archive = self.make_java()
        with zipfile.ZipFile(archive) as bundle:
            names = bundle.namelist()
            base = "neutrino-proxy-client-2.1.0-jdk21"
            for name in ("neutrino-proxy-client.jar", "app.yml", "LICENSE", "start.sh", "start.cmd"):
                self.assertIn(f"{base}/{name}", names)
            unix = bundle.read(f"{base}/start.sh").decode()
            windows = bundle.read(f"{base}/start.cmd").decode()
            self.assertIn('"$@"', unix)
            self.assertIn("%*", windows)
            self.assertNotIn("/Users/", unix)
            self.assertNotIn("../../", windows)
            self.assertEqual(bundle.getinfo(f"{base}/start.sh").external_attr >> 16 & 0o777, 0o755)
            self.assertNotIn(b"\r", bundle.read(f"{base}/start.sh"))

    def test_distribution_config_preserves_protocol_defaults(self):
        archive = self.make_java()
        with zipfile.ZipFile(archive) as bundle:
            config = bundle.read("neutrino-proxy-client-2.1.0-jdk21/app.yml").decode()
            self.assertIn("max-frame-length: 2097152", config)
            self.assertIn("${LICENSE_KEY:}", config)

    @unittest.skipUnless(shutil.which("sh"), "POSIX shell not available")
    def test_launcher_works_outside_install_directory_with_spaces(self):
        archive = self.make_java(kind="native", platform="linux-x64")
        folder = self.root / "install with spaces"
        release.unpack_bundle(archive, folder)
        home = next(folder.iterdir())
        binary = home / "neutrino-proxy-client"
        (home / "location-marker").write_text("correct-directory\n", encoding="utf-8")
        binary.write_text('#!/bin/sh\ncat ./location-marker\nprintf "%s\\n" "$@"\n', encoding="utf-8")
        binary.chmod(0o755)
        output = subprocess.check_output(["sh", str(home / "start.sh"), "argument with spaces"], cwd=self.root, text=True)
        self.assertEqual(output.splitlines(), ["correct-directory", "argument with spaces"])

    def test_missing_binary_fails_instead_of_creating_empty_release_asset(self):
        with self.assertRaises(FileNotFoundError):
            release.package_java(self.root, self.out, "server", "native", "linux-x64", "2.1.0")

    def test_musl_archive_has_an_explicit_name_and_unix_launcher(self):
        archive = self.make_java(kind="native", platform="linux-x64-musl-static")
        self.assertEqual(archive.name, "neutrino-proxy-client-2.1.0-linux-x64-musl-static.zip")
        with zipfile.ZipFile(archive) as bundle:
            home = "neutrino-proxy-client-2.1.0-linux-x64-musl-static"
            self.assertIn(home + "/start.sh", bundle.namelist())
            self.assertNotIn(home + "/start.cmd", bundle.namelist())

    def test_manifest_requires_all_eight_java_assets_and_hashes_file_contents(self):
        self.out.mkdir()
        expected = release.expected_assets("2.1.0")
        self.assertEqual(len(expected), 8)
        self.assertTrue(all(name.startswith(("neutrino-proxy-server-", "neutrino-proxy-client-")) for name in expected))
        self.assertFalse(any("client-app" in name or "desktop" in name for name in expected))
        for name in expected[:-1]:
            (self.out / name).write_bytes(b"package")
        with self.assertRaises(ValueError):
            release.assemble(self.out, "2.1.0", "a" * 40, "https://example.invalid/run")
        (self.out / expected[-1]).write_bytes(b"package")
        # Even a release that skips runtime tests must supply static-link evidence.
        with self.assertRaises(FileNotFoundError):
            release.assemble(self.out, "2.1.0", "a" * 40, "https://example.invalid/run")
        self.static_report()
        release.assemble(self.out, "2.1.0", "a" * 40, "https://example.invalid/run")
        manifest = json.loads((self.out / "release-manifest.json").read_text())
        self.assertEqual(len(manifest["assets"]), 8)
        self.assertNotIn("desktop_signing", manifest)
        self.assertEqual(manifest["assets"][0]["sha256"], __import__("hashlib").sha256(b"package").hexdigest())
        self.assertIn("release-manifest.json", (self.out / "SHA256SUMS").read_text())
        (self.out / "unexpected.zip").write_bytes(b"extra")
        with self.assertRaises(ValueError):
            release.assemble(self.out, "2.1.0", "a" * 40, "https://example.invalid/run")

    def static_report(self):
        archives = []
        for module in ("server", "client"):
            name = f"neutrino-proxy-{module}-2.1.0-linux-x64-musl-static.zip"
            archives.append({"name": name, "sha256": hashlib.sha256((self.out / name).read_bytes()).hexdigest(),
                             "binary_sha256": "b" * 64, "architecture": "x86_64", "interpreter": None,
                             "needed_libraries": [], "glibc_versions": []})
        release.write_json(self.out / "build-info/linux-musl-compatibility.json", {
            "version": "2.1.0", "linkage": "static-musl", "elf_inspection": "passed", "archives": archives,
            "runtime": {"centos7_container": "passed", "kernel_3_10": "not_verified"},
        })

    def test_static_evidence_must_match_the_published_archives(self):
        self.out.mkdir()
        for name in release.expected_assets("2.1.0"):
            (self.out / name).write_bytes(b"package")
        self.static_report()
        (self.out / "neutrino-proxy-client-2.1.0-linux-x64-musl-static.zip").write_bytes(b"replaced")
        with self.assertRaisesRegex(ValueError, "Static archive checksum"):
            release.assemble(self.out, "2.1.0", "a" * 40, "https://example.invalid/run")

    def test_unpack_rejects_archive_path_traversal(self):
        archive = self.root / "bad.zip"
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("../outside", "bad")
        with self.assertRaises(ValueError):
            release.unpack_bundle(archive, self.root / "unpack")


if __name__ == "__main__":
    unittest.main()
