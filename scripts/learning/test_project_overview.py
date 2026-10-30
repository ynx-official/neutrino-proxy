"""Verify the lab's isolation and byte-stream assertions without starting Java."""

import os
from contextlib import redirect_stdout
import io
import socket
import unittest
from unittest.mock import patch

from project_overview import local_environment, main, read_exact


class LabBoundariesTest(unittest.TestCase):
    def test_inherited_database_and_proxy_targets_are_replaced(self):
        with patch.dict(os.environ, {"DB_TYPE": "mysql", "DB_URL": "jdbc:mysql://invalid/test",
                                     "SERVER_IP": "invalid.example", "LICENSE_KEY": "inherited-test-value"}):
            env = local_environment(18080, 19000)
        self.assertEqual(env["DB_TYPE"], "h2")
        self.assertEqual(env["DB_URL"], "jdbc:h2:file:./data/learning;MODE=MySQL;AUTO_SERVER=FALSE")
        self.assertEqual(env["SERVER_IP"], "127.0.0.1")
        self.assertEqual(env["LICENSE_KEY"], "")
        self.assertEqual(env["SSL_ENABLE"], "false")

    def test_tcp_reads_accumulate_fragments(self):
        class Fragments:
            def __init__(self):
                self.parts = iter([b"ab", b"c", b"def"])

            def recv(self, size):
                return next(self.parts)

        self.assertEqual(read_exact(Fragments(), 6), b"abcdef")

    def test_truncated_stream_does_not_count_as_success(self):
        left, right = socket.socketpair()
        with left, right:
            left.sendall(b"ab")
            left.shutdown(socket.SHUT_WR)
            with self.assertRaises(EOFError):
                read_exact(right, 3)

    def test_failed_lab_assertion_keeps_a_nonzero_exit(self):
        output = io.StringIO()
        with patch("sys.argv", ["project_overview.py"]), redirect_stdout(output):
            with patch("project_overview.run", return_value={"checks": [{"passed": False}]}):
                with self.assertRaises(SystemExit) as result:
                    main()
        self.assertEqual(result.exception.code, 1)
        self.assertIn('"passed": false', output.getvalue())


if __name__ == "__main__":
    unittest.main()
