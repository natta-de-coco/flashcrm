import asyncio, pathlib
from playwright.async_api import async_playwright
S=pathlib.Path('/tmp/browser/widget/shots'); S.mkdir(parents=True,exist_ok=True)
import os
HOST=os.environ.get('WIDGET_HOST','file://'+str(pathlib.Path(__file__).parent/'widget_host.html'))
async def run(pw,label,w,h):
    ctx=await pw.chromium.launch(headless=True)
    c=await ctx.new_context(viewport={'width':w,'height':h},has_touch=True)
    p=await c.new_page()
    errs=[];p.on('pageerror',lambda e:errs.append(str(e)))
    await p.goto(HOST); await p.wait_for_timeout(1500)
    btn=p.locator('.flasw-btn')
    b=await btn.bounding_box()
    # click-through on the wrapper area (not on button)
    await p.mouse.click(w//2,h//2)
    clicks=await p.evaluate('window.__clicks')
    await btn.click(); await p.wait_for_timeout(600)
    b2=await btn.bounding_box(); panel=await p.locator('.flasw-panel').bounding_box()
    await p.screenshot(path=str(S/f'{label}.png'))
    print(label, 'launcher-closed',b, 'launcher-open',b2,'panel',panel,'host-clicks',clicks,'errors',errs)
    assert clicks==1, 'widget blocked host page clicks'
    assert abs((b2['x']+b2['width'])-(panel['x']+panel['width']))<6, 'launcher not aligned to panel right edge'
    assert panel['y']+panel['height'] <= h+1 and panel['x']>=0, 'panel overflows viewport'
    await ctx.close()
async def main():
    async with async_playwright() as pw:
        for label,w,h in [('mobile',390,844),('ipad',820,1180),('desktop',1440,900)]:
            await run(pw,label,w,h)
    print('widget OK')
asyncio.run(main())
