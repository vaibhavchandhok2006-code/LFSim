# Browser check of the angled-photo import against `npx vite preview --port 4173`: load an angled photo, mark the
# mat's corners by dragging the handles, and check the track is rebuilt top-down. Usage: python3 e2e/photo_import.py <photo.png> x1,y1,...,x4,y4
import asyncio, sys
from playwright.async_api import async_playwright

async def main(photo, corners):
    c = [float(v) for v in corners.split(',')]
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await (await b.new_context(viewport={'width': 1440, 'height': 900})).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:4173/'); await pg.wait_for_timeout(2500)
        await pg.click('nav >> text=Track')
        async with pg.expect_file_chooser() as fc:
            await pg.click('text=Load image')
        await (await fc.value).set_files(photo); await pg.wait_for_timeout(2500)
        await pg.click('text=Mark the mat’s corners'); await pg.wait_for_timeout(1500)
        svg = await pg.query_selector('.corner-editor svg')
        box = await svg.bounding_box()
        # the svg viewBox has a 30-unit margin around a 1000-wide image
        vbw = 1060
        scale = box['width'] / vbw
        img_h_units = (box['height'] / scale) - 60
        handles = await pg.query_selector_all('.corner-editor .handle circle')
        for i in range(4):
            hb = await handles[i].bounding_box()
            sx, sy = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
            tx = box['x'] + (30 + c[2 * i] / 100 * 1000) * scale
            ty = box['y'] + (30 + c[2 * i + 1] / 100 * img_h_units) * scale
            await pg.mouse.move(sx, sy); await pg.mouse.down(); await pg.mouse.move(tx, ty, steps=8); await pg.mouse.up()
            await pg.wait_for_timeout(1800)
        await pg.wait_for_timeout(2000)
        body = await pg.inner_text('.panel-scroll')
        print('perspective message:', 'Perspective corrected' in body)
        print('start square found:', 'Start square found' in body, '| finish found:', 'Finish square found' in body)
        await pg.screenshot(path='/tmp/lfsim_photo_import.png')
        print('PAGE ERRORS:', errs)
        await b.close()
asyncio.run(main(sys.argv[1], sys.argv[2]))
