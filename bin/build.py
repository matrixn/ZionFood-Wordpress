#!/usr/bin/env python3
"""Build the installable plugin with an explicit release allowlist."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def version():
    source = (ROOT / 'zionfood.php').read_text(encoding='utf-8')
    header = re.search(r'^ \* Version: (\d+\.\d+\.\d+)$', source, re.M).group(1)
    assert f"const VERSION = '{header}';" in source, 'PHP version mismatch'
    assert json.loads((ROOT / 'package.json').read_text())['version'] == header, 'package version mismatch'
    assert json.loads((ROOT / 'package-lock.json').read_text())['packages']['']['version'] == header, 'lock version mismatch'
    assert f'Stable tag: {header}' in (ROOT / 'readme.txt').read_text(), 'WordPress stable tag mismatch'
    return header

def files():
    paths = [ROOT / x for x in ['zionfood.php', 'uninstall.php', 'readme.txt', 'README.md', 'LICENSE']]
    for folder, pattern in [('includes', '*.php'), ('languages', '*.json'), ('docs', '*.md')]:
        paths.extend(p for p in (ROOT / folder).glob(pattern) if p.is_file())
    paths.extend(ROOT / 'assets/dist' / name for name in [
        'admin.js', 'admin.css', 'public.js', 'public.css', 'blocks.js',
        'public.js.LEGAL.txt', 'LEAFLET-LICENSE',
    ])
    paths.append(ROOT / 'assets/images/zionfood.png')
    for p in paths:
        assert p.is_file() and p.is_relative_to(ROOT) and not p.is_symlink(), 'Unexpected release path'
        assert '.local' not in p.parts and 'node_modules' not in p.parts
    assert len(set(paths)) == len(paths), 'Duplicate release member'
    return sorted(paths)

def main():
    import os
    os.chdir(ROOT)
    npm = shutil.which('npm.cmd') or shutil.which('npm')
    assert npm, 'Node/npm is required for asset builds'
    if not (ROOT / 'node_modules/esbuild').exists():
        subprocess.run([npm, 'ci'], check=True)
    subprocess.run([npm, 'test'], check=True)
    subprocess.run([npm, 'run', 'format:check'], check=True)
    subprocess.run([npm, 'run', 'build'], check=True)
    for source in [ROOT / 'zionfood.php', ROOT / 'uninstall.php', *sorted((ROOT / 'includes').glob('*.php'))]:
        subprocess.run(['php', '-l', str(source)], check=True)
    release = version()
    selected = files()
    build = ROOT / 'build'
    build.mkdir(exist_ok=True)
    archive = build / f'zionfood-wordpress-{release}.zip'
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip())
    manifest = {'version':release,'source_commit':commit,'source_dirty':dirty,'files':{str(p.relative_to(ROOT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in selected}}
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        for p in selected:
            info = zipfile.ZipInfo('zionfood/' + p.relative_to(ROOT).as_posix(), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            target.writestr(info, p.read_bytes())
        target.writestr('zionfood/release-manifest.json', json.dumps(manifest, indent=2) + '\n')
    with zipfile.ZipFile(archive) as result:
        assert result.testzip() is None, 'ZIP CRC validation failed'
        assert 'zionfood/zionfood.php' in result.namelist()
        assert all(name.startswith('zionfood/') and '..' not in name for name in result.namelist())
        assert not any('/.local/' in name or '/node_modules/' in name or '/tests/' in name for name in result.namelist())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(digest + '  ' + archive.name + '\n', encoding='ascii')
    print(f'Built: {archive}\nSHA256: {digest}\nVerified {len(selected)+1} ZIP members; source commit {commit}.')

if __name__ == '__main__':
    main()
