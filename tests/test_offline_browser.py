"""Chromium end-to-end smoke test: install service worker, download, disconnect, play.
Runs against a temporary loopback fixture and never needs production credentials.
Requires Playwright Chromium and FFmpeg on the test runner.
"""
import http.server
from pathlib import Path
import shutil
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
        '-b:v', '280k', '-an', str(destination),
    ], check=True, timeout=25)


def main():
    with tempfile.TemporaryDirectory(prefix='sh-offline-e2e-') as tmp:
        site = Path(tmp)
        for file in ('offline.html', 'offline-store.js', 'sw.js',
                     'manifest.webmanifest', 'icon-192.png', 'icon-512.png'):
            shutil.copy(ROOT / 'frontend' / 'public' / file, site / file)
        (site / 'index.html').write_text('''<!doctype html><html><head><title>StreamHub test</title></head>
            <body><h1>Test shell</h1><script>
            navigator.serviceWorker.register('/sw.js');
            </script></body></html>''')
        clip = site / 'sample.webm'
        webm_sample(clip)
        source = clip.read_bytes()

        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(site), **kwargs)

            def do_GET(self):
                if self.path.startswith('/api/local-media/stream/1'):
                    self.send_response(200)
                    self.send_header('Content-Type', 'video/webm')
                    self.send_header('Content-Length', str(len(source)))
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    self.wfile.write(source)
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
                # Bound the wait so an activation failure cannot hang CI indefinitely.
                page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
                print('E2E: service worker activated', flush=True)
                item = page.evaluate('''async () => {
                    const mod = await import('/offline-store.js');
                    return mod.downloadOfflineVideo({src:'/api/local-media/stream/1',title:'End to end movie',
                        profileName:'Test profile',profileId:1});
                }''')
                assert item['bytes'] == len(source), item
                print('E2E: sample video downloaded', flush=True)
                assert len(item['id']) == 36
                rejected = page.evaluate('''async () => {
                    const mod = await import('/offline-store.js');
                    try {await mod.downloadOfflineVideo({src:'/api/local-media/stream/2',title:'Should reject'});
                      return false;} catch {return true;}
                }''')
                assert rejected, 'Unauthorized responses must not become offline files.'
                page.goto(origin + '/offline.html')
                expect(page.get_by_text('End to end movie')).to_be_visible(timeout=10000)
                print('E2E: online saved library loaded', flush=True)
                context.set_offline(True)
                page.goto(origin + '/offline.html')
                expect(page.get_by_text('End to end movie')).to_be_visible(timeout=10000)
                print('E2E: offline navigation succeeded', flush=True)
                page.get_by_role('button', name='Play offline').click()
                try:
                    page.wait_for_function("document.querySelector('video').readyState >= 1", timeout=15000)
                except Exception:
                    details = page.locator('video').evaluate('el => ({src:el.currentSrc,readyState:el.readyState,networkState:el.networkState,error:el.error?.message,code:el.error?.code,canWebM:el.canPlayType("video/webm")})')
                    raise AssertionError(f'Offline video did not load: {details}')
                assert page.locator('video').evaluate('el => el.currentSrc.startsWith("blob:")')
                print('PASS: offline install, authenticated-style download, rejection, airplane-mode reload, video playback')
                browser.close()
        finally:
            server.shutdown()
            thread.join(timeout=5)


if __name__ == '__main__':
    main()
