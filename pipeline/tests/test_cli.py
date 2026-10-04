import contextlib
import io
import unittest
from unittest import mock

from .. import run
from .helpers import workdir


class Cli(unittest.TestCase):
    def call(self, argv, env=None):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), mock.patch.dict("os.environ", env or {}, clear=False):
            code = run.main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_list_needs_no_data_folder_and_shows_what_each_source_says(self):
        code, out, _ = self.call(["--list"])
        self.assertEqual(code, 0)
        self.assertIn("For GP data, updates are once every 2 hours", out)
        self.assertIn("Updated every minute", out)

    def test_a_contact_address_is_required(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            code, _, err = self.call(["--data", "x"])
        self.assertEqual(code, 1)
        self.assertIn("contact address", err)
        self.assertEqual(self.call(["--data", "x", "--contact", "not set"])[0], 1)

    def test_unknown_feed_ids_are_refused(self):
        code, _, err = self.call(["--data", "x", "--contact", "a@b.c", "--only", "quakes,nonsense"])
        self.assertEqual(code, 1)
        self.assertIn("nonsense", err)

    def test_the_exit_code_tells_a_scheduler_when_a_human_is_needed(self):
        for halted, want in (({}, 0), ({"satellites": "HTTP 403"}, 2)):
            with self.subTest(halted=halted), mock.patch.object(run, "Runner") as R:
                R.return_value.run.return_value = {"ok": [], "unchanged": [], "failed": {"quakes": "x"}, "halted": halted, "skipped": []}
                self.assertEqual(self.call(["--data", "x", "--contact", "a@b.c"])[0], want)

    def test_only_and_force_are_passed_to_the_runner(self):
        with mock.patch.object(run, "Runner") as R:
            R.return_value.run.return_value = {"ok": [], "unchanged": [], "failed": {}, "halted": {}, "skipped": []}
            self.call(["--data", "d", "--baseline", "b", "--contact", "a@b.c", "--only", "kp,quakes", "--force"])
            R.return_value.run.assert_called_once_with(only={"kp", "quakes"}, force=True)
            self.assertEqual(R.call_args[0][:3], ("d", "b", "a@b.c"))


if __name__ == "__main__":
    unittest.main()
