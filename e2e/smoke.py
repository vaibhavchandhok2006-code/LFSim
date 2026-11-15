# Browser smoke test against `npx vite preview --port 4173`: every tab renders, a Settings run and the Code-mode
# sample run, the crop box, a bad robot file is refused, no page errors. Screenshots go to /tmp/lfsim_*.png.
import asyncio, json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        cons = []; pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' else None)
        await pg.goto('http://localhost:4173/'); await pg.wait_for_timeout(3000)
        await pg.click('nav >> text=Track'); await pg.wait_for_timeout(300)
        print('crop group:', await pg.is_visible('text=Crop centre to the track\'s shape'))
        await pg.screenshot(path='/tmp/lfsim_track.png')
        # Settings mode run
        await pg.click('nav >> text=Brain'); await pg.click('text=Settings mode')
        print('inch select:', await pg.is_visible('text=Roll onto the junction'))
        await pg.screenshot(path='/tmp/lfsim_brain.png')
        await pg.click('nav >> text=Simulate'); await pg.click('button.play'); await pg.wait_for_timeout(8000)
        await pg.screenshot(path='/tmp/lfsim_run.png')
        print('status:', (await pg.inner_text('.panel-scroll'))[:300].replace('\n', ' | '))
        # Code mode sample
        await pg.click('nav >> text=Brain'); await pg.click('text=Code mode'); await pg.click('text=Load sample firmware')
        print('board select:', await pg.is_visible('text=Board'))
        await pg.click('nav >> text=Simulate'); await pg.click('button.play'); await pg.wait_for_timeout(15000)
        con = await pg.inner_text('.console')
        print('code console has Ready:', 'Ready' in con, 'Finish!:', 'Finish!' in con)
        # bad robot file
        bad = {"version": 1, "name": "bad", "wheelbase_mm": 120}
        await pg.click('nav >> text=Robot')
        async with pg.expect_file_chooser() as fc:
            await pg.click('text=Import robot')
        prof = json.loads(open('/tmp/default_profile.json').read()); prof['motor']['stallCurrent_A'] = 0
        open('/tmp/bad.robot.json', 'w').write(json.dumps(prof))
        await (await fc.value).set_files('/tmp/bad.robot.json'); await pg.wait_for_timeout(800)
        body = await pg.inner_text('body')
        print('bad robot refused:', 'out of range' in body)
        await pg.screenshot(path='/tmp/lfsim_bad_robot.png')
        print('PAGE ERRORS:', errs); print('CONSOLE ERRORS:', cons[:5])
        await b.close()
asyncio.run(main())
