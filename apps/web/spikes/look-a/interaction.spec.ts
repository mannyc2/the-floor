import { test, expect } from '@playwright/test';
test('renders actual scene and switches technique through the controls',async({page})=>{
  page.on('console',message=>console.log(`browser:${message.type()}`,message.text()));
  await page.goto('/');await page.waitForFunction(()=>window.look?.ready||window.look?.error);
  expect(await page.evaluate(()=>window.look.error)).toBeNull();
  expect(await page.evaluate(()=>window.look.rendererString)).toContain('SwiftShader');
  await page.locator('#technique').selectOption('B');await page.getByRole('button',{name:'Render',exact:true}).click();
  await page.waitForFunction(()=>window.look?.ready);expect(await page.evaluate(()=>window.look.config.technique)).toBe('B');
  await page.locator('#stage').screenshot({path:'work/spikes/look/interaction.png'});
});
