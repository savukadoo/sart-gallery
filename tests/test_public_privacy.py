"""Adversarial checks for the public source/export boundary."""
from pathlib import Path
import json,sys,tempfile,unittest
import subprocess

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from public_files import public_files,TOP_LEVEL
from check_public_privacy import check_privacy
from check_repository import check_repository

class PublicPrivacyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        for folder in ('app','mobile','companion','tools','tests','vendor','LICENSES','design','.local'):
            (self.root/folder).mkdir()
        for name in TOP_LEVEL:
            (self.root/name).write_text('Public project file.\n')

    def test_private_diagnostics_and_live_hardware_scripts_are_not_exported(self):
        for name in ('.local/profile.key','tools/discover_frame.py','tests/tv-private.mjs'):
            (self.root/name).write_text('Private fixture.\n')
        names=[p.relative_to(self.root).as_posix() for p in public_files(self.root)]
        self.assertNotIn('.local/profile.key',names)
        self.assertNotIn('tools/discover_frame.py',names)
        self.assertNotIn('tests/tv-private.mjs',names)
        self.assertTrue(check_privacy(self.root)['passed'])

    def test_configured_addresses_are_rejected_in_code_as_well_as_documentation(self):
        address='10.99.88.77'
        (self.root/'.local/developer-targets.json').write_text(json.dumps({'defaultTv':address}))
        (self.root/'app/example.js').write_text('const host='+json.dumps(address)+';')
        with self.assertRaisesRegex(RuntimeError,'configured device/computer address'):
            check_privacy(self.root)

    def test_binary_home_paths_and_private_key_files_block_export(self):
        binary=self.root/'app/example.wasm';binary.write_bytes(b'\0asm'+str(Path.home()).encode()+b'/build/file.c')
        with self.assertRaisesRegex(RuntimeError,'personal home-directory path'):
            check_privacy(self.root)
        binary.unlink();(self.root/'app/profile.key').write_text('Private fixture.')
        with self.assertRaisesRegex(RuntimeError,'Private file'):
            check_privacy(self.root)

    def test_documentation_identifiers_are_rejected_but_reserved_examples_are_allowed(self):
        doc=self.root/'README.md'
        for value in ('DUID: DEMONSTRATION-ID-123456','Serial number: DEMONSTRATION-1234','MAC: 02:11:22:33:44:55'):
            doc.write_text(value)
            with self.assertRaises(RuntimeError):check_privacy(self.root)
        doc.write_text('Example TV 192.0.2.10; preview http://127.0.0.1:8767/.')
        self.assertTrue(check_privacy(self.root)['passed'])

    def test_github_files_are_included_and_privacy_checked(self):
        folder=self.root/'.github/workflows';folder.mkdir(parents=True)
        workflow=folder/'ci.yml';workflow.write_text('name: CI\n')
        self.assertIn(workflow,public_files(self.root))
        workflow.write_text('host: 192.168.99.88\n')
        with self.assertRaisesRegex(RuntimeError,'private network address'):
            check_privacy(self.root)

    def test_symlink_cannot_export_outside_the_public_tree(self):
        (self.root/'app/linked.txt').symlink_to(self.root/'.local')
        # A file symlink must also be rejected before content is read.
        target=self.root/'.local/private.txt';target.write_text('Private fixture.')
        (self.root/'app/private.txt').symlink_to(target)
        with self.assertRaisesRegex(RuntimeError,'Symlink'):
            public_files(self.root)

    def test_force_added_private_file_is_rejected_by_git_boundary(self):
        subprocess.run(['git','init','--quiet',str(self.root)],check=True)
        private=self.root/'.local/installation.txt';private.write_text('Private fixture.')
        subprocess.run(['git','add','--force','.local/installation.txt'],cwd=self.root,check=True)
        with self.assertRaisesRegex(RuntimeError,'outside the public boundary'):
            check_repository(self.root,tracked=True)

    def test_credentials_are_rejected_without_echoing_their_content(self):
        file=self.root/'app/fixture.txt'
        for prefix in ('OPENSSH ','EC ','ENCRYPTED ',''):
            file.write_text('-----BEGIN '+prefix+'PRIVATE KEY-----')
            with self.assertRaisesRegex(RuntimeError,'embedded private key'):
                check_privacy(self.root)
        for prefix in ('ghp_','github_pat_'):
            file.write_text(prefix+'a'*40)
            with self.assertRaisesRegex(RuntimeError,'embedded GitHub access token'):
                check_privacy(self.root)

    def test_dependency_updates_cannot_leave_the_hash_lock_stale(self):
        (self.root/'requirements.txt').write_text('ExamplePackage==2.0\n')
        (self.root/'requirements.lock').write_text('ExamplePackage==1.0\n')
        with self.assertRaisesRegex(RuntimeError,'lockfile disagree'):
            check_repository(self.root)
