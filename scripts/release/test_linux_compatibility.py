"""Reject incompatible ELF outputs before publishing a Linux static package."""

from pathlib import Path
import unittest
from unittest.mock import patch

from linux_compatibility import inspect_elf


class LinuxCompatibilityTests(unittest.TestCase):
    def inspect(self, output):
        with patch("linux_compatibility.subprocess.check_output", return_value=output):
            return inspect_elf(Path("fixture"))

    def test_fully_static_x64_elf_is_accepted(self):
        result = self.inspect("Class: ELF64\nType: EXEC\nMachine: Advanced Micro Devices X86-64\n")
        self.assertEqual(result["architecture"], "x86_64")
        self.assertEqual(result["needed_libraries"], [])

    def test_dynamic_loader_shared_library_or_glibc_versions_are_rejected(self):
        header = "Class: ELF64\nType: EXEC\nMachine: Advanced Micro Devices X86-64\n"
        for incompatible in ("  INTERP 0x0\n", " 0x1 (NEEDED) Shared library: [libc.so.6]\n",
                             " Name: GLIBC_2.34\n"):
            with self.subTest(incompatible=incompatible), self.assertRaisesRegex(ValueError, "not fully static"):
                self.inspect(header + incompatible)

    def test_wrong_architecture_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "x86_64"):
            self.inspect("Class: ELF64\nMachine: AArch64\n")


if __name__ == "__main__":
    unittest.main()
