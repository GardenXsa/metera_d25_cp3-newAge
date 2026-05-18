import subprocess
import json
import os
import unittest

class TestNexusEngine(unittest.TestCase):
    def setUp(self):
        engine_exe = os.path.join('engine', 'meterea_engine.exe')
        if not os.path.exists(engine_exe):
            engine_exe = os.path.join('engine', 'meterea_engine')
        
        self.assertTrue(os.path.exists(engine_exe), f"Engine executable not found at {engine_exe}")

        self.process = subprocess.Popen(
            [engine_exe],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8'
        )
        # Initial init command
        init_command = {'command': 'init'}
        self.process.stdin.write(f"{json.dumps(init_command)}
")
        self.process.stdin.flush()
        try:
            self.process.stdout.readline() # Consume init response
        except (IOError, ValueError):
            # Process might have closed, which is fine for a quick setup
            pass


    def tearDown(self):
        if self.process:
            try:
                self.process.terminate()
                self.process.wait()
            except ProcessLookupError:
                pass # Process already finished

    def send_command(self, command, params={}):
        full_command = {'command': command, **params}
        self.process.stdin.write(f"{json.dumps(full_command)}
")
        self.process.stdin.flush()
        response_line = self.process.stdout.readline()
        return json.loads(response_line)

    def test_placeholder(self):
        self.assertTrue(True)

if __name__ == '__main__':
    unittest.main()
