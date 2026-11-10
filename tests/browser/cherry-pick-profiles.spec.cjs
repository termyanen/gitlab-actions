const {test,expect}=require('@playwright/test');
const {bundleForTest}=require('../helpers/runtime.cjs');
const messages=require('../../_locales/en/messages.json');
const commitSource=bundleForTest('src/widgets/commit-actions/ui/cherry-pick.ts',{globalName:'Commit'});
const dialogSource=bundleForTest('src/widgets/cherry-pick-dialog/index.ts',{globalName:'Dialog'});
const sha='a'.repeat(40);
const cases=[
  ['legacy profile',{'team/repo':{}},['global/release']],
  ['project override',{'team/repo':{cherry_pick_branches:[' project/release ','project/release']}},['project/release']],
  ['empty override',{'team/repo':{cherry_pick_branches:[]}},['global/release']],
  ['blank override',{'team/repo':{cherry_pick_branches:[' ']}},['global/release']],
  ['other project',{'other/repo':{cherry_pick_branches:['other/release']}},['global/release']],
  ['exact before pattern',{'team':{cherry_pick_branches:['pattern/release']},'team/repo':{cherry_pick_branches:['exact/release']}},['exact/release']],
  ['existing pattern support',{'team':{cherry_pick_branches:['pattern/release']}},['pattern/release']],
];
for(const mode of ['list','detail','legacy-detail']) for(const [name,profiles,expected] of cases) {
  test(`cherry-pick ${mode} uses ${name}`,async({page})=>{
    const requests=[];
    await page.route('https://gitlab.example.test/**',route=>{
      requests.push(route.request().url());
      return route.fulfill({contentType:'text/html',body:`<html><body><div class="detail-page-header"><h1 class="commit-title">Fixture commit</h1></div><div class="commit"><div class="commit-sha-group"><span data-clipboard-text="${sha}">${sha}</span></div></div></body></html>`});
    });
    await page.goto(`https://gitlab.example.test/team/repo/${mode==='legacy-detail'?'':'-/' }${mode==='list'?'commits/main':'commit/'+sha}`);
    await page.evaluate(({profiles,messages})=>{
      window.chrome={runtime:{id:'fixture'},i18n:{getMessage:key=>messages[key]?.message||key},storage:{sync:{get:(defaults,callback)=>callback({...defaults,cherry_pick_branches:['global/release'],projectProfiles:profiles})}}};
    },{profiles,messages});
    await page.addScriptTag({content:dialogSource+'\n'+commitSource+'\nCommit.startCommitCherryPick(Dialog.createCherryPickDialog);'});
    await page.locator(mode==='list'?'.gl-cherry-pick-btn':'.gl-cherry-pick-detail-btn').click();
    await expect(page.locator('.gl-cherry-pick-branch-name')).toHaveText(expected);
    await page.locator('.gl-cherry-pick-input').fill('one-off/release');
    await page.locator('.gl-cherry-pick-add-btn').click();
    await expect(page.locator('.gl-cherry-pick-branch-name')).toHaveText([...expected,'one-off/release']);
    await page.locator('.gl-cherry-pick-close').click();
    await expect(page.locator('.gl-cherry-pick-overlay')).toHaveCount(0);
    expect(requests).toHaveLength(1);
  });
}
