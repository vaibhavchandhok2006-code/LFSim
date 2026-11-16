# Phase 0 acceptance: the command line gives the same numbers as the website.
# Needs `npm run build` and `npx vite preview --port 4173`. For each case the website runs a while, is stopped, and its
# CSV and project file are downloaded; the command line then runs the same project and the CSVs are compared row by row.
import asyncio, json, subprocess, sys, os
from playwright.async_api import async_playwright

CASES = [
    ('settings-left-hand', 'Settings mode', {'algorithm': 'left-hand'}),
    ('code-sample', 'Code mode', None),
]

async def run_case(pg, name, mode, settings):
    await pg.goto('http://localhost:4173/'); await pg.wait_for_timeout(2500)
    await pg.click('nav >> text=Brain'); await pg.click(f'text={mode}')
    if mode == 'Code mode': await pg.click('text=Load sample firmware')
    elif settings:
        await pg.select_option('select >> nth=0', settings['algorithm'])
    await pg.click('nav >> text=Simulate'); await pg.click('button.play'); await pg.wait_for_timeout(9000)
    await pg.click('text=Stop'); await pg.wait_for_timeout(500)
    await pg.click('summary:has-text("Export")')
    async with pg.expect_download() as d: await pg.click('text=Data log (CSV)')
    web_csv = f'/tmp/{name}_web.csv'; await (await d.value).save_as(web_csv)
    async with pg.expect_download() as d: await pg.click('text=Save project')
    proj = f'/tmp/{name}.lfsim.json'; await (await d.value).save_as(proj)
    cli_csv = f'/tmp/{name}_cli.csv'
    subprocess.run(['npx', 'tsx', 'lab/src/cli.ts', 'run', '--project', proj, '--seconds', '30', '--keep-going', '--csv', cli_csv], check=True, capture_output=True)
    web = open(web_csv).read().strip().split('\n'); cli = open(cli_csv).read().strip().split('\n')
    n = len(web) - 1  # the website's last row is the moment Stop was pressed (an extra end-of-run record)
    same = web[:n] == cli[:n]
    diff = next((i for i in range(n) if web[i] != cli[i]), None)
    print(f'{name}: website rows {len(web)-1}, compared {n-1} data rows, identical: {same}' + ('' if same else f'; first difference at line {diff}:\n  web {web[diff]}\n  cli {cli[diff]}'))
    return same

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ok = True
        for name, mode, settings in CASES:
            ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
            pg = await ctx.new_page()
            ok = await run_case(pg, name, mode, settings) and ok
            await ctx.close()
        await b.close()
        sys.exit(0 if ok else 1)
asyncio.run(main())
