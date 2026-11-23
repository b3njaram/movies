"""Chromium end-to-end smoke test: install service worker, download, disconnect, play.
Runs against a temporary loopback fixture and never needs production credentials.
Requires Playwright Chromium and FFmpeg on the test runner.
"""
import http.server
from pathlib import Path
import shutil
import hashlib
import re
import time
import subprocess
import tempfile
import threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


def webm_sample(destination):
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
        '-i', 'testsrc2=size=160x90:rate=10:duration=2',
        '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8',
        '-b:v', '250k', '-pix_fmt', 'yuv420p', str(destination),
    ], check=True, timeout=25)


def main():
    with tempfile.TemporaryDirectory(prefix='sh-offline-e2e-') as tmp:
        site = Path(tmp)
        for file in ('offline.html', 'offline-store.js', 'sw.js',
                     'offline-range.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'):
            shutil.copy(ROOT / 'frontend' / 'public' / file, site / file)
        (site / 'index.html').write_text('''<!doctype html><html><head><title>StreamHub test</title></head>
            <body><h1>Test shell</h1><script>
            navigator.serviceWorker.register('/sw.js');
            </script></body></html>''')
        clip = site / 'sample.webm'
        webm_sample(clip)
        source = clip.read_bytes()
        ranges = []

        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(site), **kwargs)

            def do_GET(self):
                if self.path.startswith('/api/local-media/stream/1'):
                    requested = self.headers.get('Range', '')
                    matched = re.fullmatch(r'bytes=(\d+)-', requested)
                    start = int(matched.group(1)) if matched and self.headers.get('If-Range') == '"sample-v1"' else 0
                    if start >= len(source):
                        self.send_error(416, 'Invalid Range')
                        return
                    ranges.append(start)
                    self.send_response(206 if start else 200)
                    self.send_header('Content-Type', 'video/webm')
                    self.send_header('ETag', '"sample-v1"')
                    self.send_header('Accept-Ranges', 'bytes')
                    if start:
                        self.send_header('Content-Range', f'bytes {start}-{len(source)-1}/{len(source)}')
                    self.send_header('Content-Length', str(len(source)-start))
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    try:
                        for pos in range(start, len(source), 2048):
                            self.wfile.write(source[pos:pos+2048])
                            self.wfile.flush()
                            time.sleep(0.008)
                    except (ConnectionResetError, BrokenPipeError):
                        pass
                    return
                if self.path.startswith('/api/local-media/stream/2'):
                    self.send_error(401, 'No access')
                    return
                super().do_GET()

            def log_message(self, *_):
                pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as p:
                kwargs = {'headless': True, 'args': ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']}
                if shutil.which('chromium'):
                    kwargs['executable_path'] = shutil.which('chromium')
                browser = p.chromium.launch(**kwargs)
                context = browser.new_context()
                page = context.new_page()
                origin = f'http://127.0.0.1:{server.server_port}'
                page.goto(origin)
                page.evaluate('''async () => {
                    await navigator.serviceWorker.ready;
                    if (!navigator.serviceWorker.controller) await new Promise(resolve =>
                        navigator.serviceWorker.addEventListener('controllerchange', resolve, {once: true}));
                }''')
                # Interrupt a transfer after a few chunks; the partial must survive.
                interrupted = page.evaluate('''async () => {
                    const mod=await import('/offline-store.js');const controller=new AbortController();
                    let stopped=false;
                    try {await mod.downloadOfflineVideo({src:'/api/local-media/stream/1',title:'End to end movie',
                      profileName:'Test profile',profileId:1,signal:controller.signal,
                      onProgress:({downloaded})=>{if(downloaded>=2048){controller.abort();stopped=true;}}});}
                    catch(e){if(!stopped)throw e;}
                    return await mod.listOfflinePending();
                }''')
                assert len(interrupted) == 1 and interrupted[0]['bytes'] > 0, interrupted
                # Reopen the page and resume from the saved byte position.
                page.reload()
                assert page.evaluate("() => document.createElement('video').canPlayType('video/webm; codecs=vp8') !== ''")
                item = page.evaluate('''async () => {
                    const mod = await import('/offline-store.js');
                    return mod.downloadOfflineVideo({src:'/api/local-media/stream/1',title:'End to end movie',
                        profileName:'Test profile',profileId:1});
                }''')
                assert any(offset > 0 for offset in ranges), ranges
                complete = page.evaluate('''async id=>{
                    const mod=await import('/offline-store.js');
                    const blob=await mod.offlineVideoFile(id);
                    const sha=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
                    return Array.from(new Uint8Array(sha),v=>v.toString(16).padStart(2,'0')).join('');
                }''',item['id'])
                assert complete == hashlib.sha256(source).hexdigest(), 'Resumed video bytes differ from server file.'
                assert page.evaluate('''async () => (await (await import('/offline-store.js')).listOfflinePending()).length''') == 0
                # Enforce explicit device quota settings in OPFS.
                assert page.evaluate('''async () => {
                    const m=await import('/offline-store.js');
                    await m.setOfflineBudget(5);return (await m.offlineStorageSummary()).budgetGb;
                }''') == 5
                assert item['bytes'] == len(source), item
                assert len(item['id']) == 36
                rejected = page.evaluate('''async () => {
                    const mod = await import('/offline-store.js');
                    try {await mod.downloadOfflineVideo({src:'/api/local-media/stream/2',title:'Should reject'});
                      return false;} catch {return true;}
                }''')
                assert rejected, 'Unauthorized responses must not become offline files.'
                page.goto(origin + '/offline.html')
                expect(page.get_by_text('End to end movie')).to_be_visible(timeout=10000)
                context.set_offline(True)
                page.goto(origin + '/offline.html')
                expect(page.get_by_text('End to end movie')).to_be_visible(timeout=10000)
                page.get_by_role('button', name='Play offline').click()
                try:
                    page.wait_for_function("document.querySelector('video').readyState >= 1", timeout=12000)
                except Exception:
                    state = page.evaluate('''() => {
                        const v=document.querySelector('video');
                        return {notice:document.getElementById('notice').textContent,
                          visible:!document.getElementById('player').hidden,
                          url:v.currentSrc,readyState:v.readyState,networkState:v.networkState,
                          error:v.error?.message||null,mediaErrorCode:v.error?.code||null,
                          videoType:v.getAttribute('type')};
                    }''')
                    raise AssertionError(f'Offline player did not load video metadata: {state}')

                assert page.locator('video').evaluate('el => el.currentSrc.startsWith("blob:")')
                print('PASS: interrupted download resumed with exact verified bytes, storage budget, airplane-mode reload, video playback')
                browser.close()
        finally:
            server.shutdown()
            thread.join(timeout=5)


if __name__ == '__main__':
    main()
