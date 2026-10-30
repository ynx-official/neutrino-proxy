"""Exercise reader-visible failure results without needing a Java application."""

from contextlib import redirect_stdout
import io
import unittest
from unittest.mock import patch

import lab_request


class ReaderRequestTests(unittest.TestCase):
    def test_timeout_does_not_count_as_an_echo(self):
        with patch("lab_request.socket.create_connection", side_effect=TimeoutError()):
            result = lab_request.send_one(12345, "hello", 1, 0)
        self.assertEqual(result["outcome"], "timeout")
        self.assertFalse(result["passed"])

    def test_mismatched_reply_does_not_count_as_success(self):
        with patch("lab_request.socket.create_connection") as connect:
            connect.return_value.__enter__.return_value.recv.return_value = b"wrong"
            result = lab_request.send_one(12345, "hello", 1, 0)
        self.assertEqual(result["outcome"], "mismatch")
        self.assertFalse(result["passed"])

    def test_failed_request_keeps_a_nonzero_cli_exit(self):
        session = {"ports": {"rejectedMapping": 12345}}
        output = io.StringIO()
        with patch("sys.argv", ["lab_request.py", "--session-file", "unused.json", "--route", "unreachable"]):
            with patch("lab_request.load_session", return_value=session):
                with patch("lab_request.send_one", return_value={"outcome": "timeout", "passed": False}):
                    with redirect_stdout(output), self.assertRaises(SystemExit) as result:
                        lab_request.main()
        self.assertEqual(result.exception.code, 2)
        self.assertIn('"timeout"', output.getvalue())


if __name__ == "__main__":
    unittest.main()
