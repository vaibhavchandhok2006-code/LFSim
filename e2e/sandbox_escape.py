import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':1440,'height':900})
        ext = []
        ctx.on('request', lambda r: ext.append(r.url) if not r.url.startswith(('http://localhost', 'blob:', 'data:')) else None)
        pg = await ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:4173/'); await pg.wait_for_timeout(2500)
        await pg.click('nav >> text=Brain'); await pg.click('text=Code mode'); await pg.click('text=Load sample firmware')
        tas = await pg.query_selector_all('textarea')
        await tas[-1].fill(open('/tmp/escape_fw.js').read())
        await pg.click('nav >> text=Simulate'); await pg.click('button.play')
        await pg.wait_for_timeout(5000)
        print('CONSOLE:', (await pg.inner_text('.console'))[:900].replace('\n',' | '))
        print('EXTERNAL REQUESTS:', ext)
        print('PAGE ERRORS:', errs)
        await b.close()
asyncio.run(main())
