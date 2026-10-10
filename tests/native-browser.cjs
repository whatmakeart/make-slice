const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const {unzipSync,strFromU8}=require('fflate');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],env:process.env});
try{
 const page=await browser.newPage({viewport:{width:1536,height:1080},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Native DOM tools expose the same project operations used by the application.
 await page.addInitScript(()=>{window.__tools={};document.modelContext={registerTool(t){window.__tools[t.name]=t;}};});
 await page.goto(pathToFileURL(path.resolve('dist/index.html')).href);
 await page.waitForFunction(()=>window.__tools?.read_slice_project?.execute({}).model==='Jimmy.stl'&&!window.__tools.read_slice_project.execute({}).pending);
 assert.equal(await page.getByRole('heading',{name:'MakeSlice',exact:true}).count(),1);
 const shell=await page.evaluate(()=>({header:document.querySelector('.app-header').getBoundingClientRect().height,outer:document.documentElement.scrollHeight,viewport:innerHeight}));assert.ok(shell.header<=52);assert.equal(shell.outer,shell.viewport);
 await page.getByText('Material & tooling',{exact:true}).click();await page.getByText('Advanced / production',{exact:true}).click();
 assert.equal(await page.locator('.viewport-error').count(),0);
 await page.evaluate(()=>window.__tools.configure_slices.execute({mode:'finger_box',targetWidth:100,xSliceCount:4,ySliceCount:4,fingerBox:{bracing:{enabled:true,maxUnsupportedSpan:45,lightningHoles:true}}}));
 // The initial Jimmy model is not a Z extrusion; switch to a known source via mesh import.
 await page.getByLabel('Import STL or OBJ file').setInputFiles('.sites-runtime/validation/concave-t.obj');
 await page.waitForFunction(()=>window.__tools.read_slice_project.execute({}).model==='concave-t.obj'&&!window.__tools.read_slice_project.execute({}).pending);
 assert.equal(await page.locator('.error-banner').count(),0);
 await page.getByRole('switch',{name:'X-Ray bracing view'}).click();
 await page.getByRole('button',{name:'Open parts inspector'}).click();
 await page.locator('.part-chips button').first().click();
 await page.getByRole('combobox',{name:'Active thickness slot'}).click();
 await page.getByRole('option',{name:'T3 · 6 mm',exact:true}).click();
 await page.getByRole('button',{name:'Apply T3 to selected'}).click();
 await page.waitForFunction(()=>!window.__tools.read_slice_project.execute({}).pending&&Object.values(window.__tools.read_slice_project.execute({}).settings.partThickness).includes('T3'));
 assert.equal(await page.locator('.error-banner').count(),0);
 await page.getByRole('button',{name:'Add scrap sheet'}).click();
 await page.waitForFunction(()=>!window.__tools.read_slice_project.execute({}).pending);
 await page.evaluate(()=>{document.querySelector('.main-workspace').scrollTop=0;document.querySelector('.parameters-scroll-area').scrollTop=0;});
 await page.waitForTimeout(200);
 await page.screenshot({path:'.sites-runtime/validation/workspace-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Close parts inspector'}).click();
 const canvas=page.locator('.assembly-canvas canvas');

 const pick=await canvas.evaluate(c=>new Promise(resolve=>requestAnimationFrame(()=>{const copy=document.createElement('canvas');copy.width=c.width;copy.height=c.height;const ctx=copy.getContext('2d');ctx.drawImage(c,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;let best=null,score=Infinity;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(pixels[i]>pixels[i+1]*1.08&&pixels[i+1]>pixels[i+2]*1.1){const d=Math.hypot(x-c.width/2,y-c.height/2);if(d<score){score=d;best={x:x*c.clientWidth/c.width,y:y*c.clientHeight/c.height};}}}resolve(best);}))); 
 assert.ok(pick,'No rendered stock pixels were visible');await canvas.click({position:pick});assert.ok((await page.locator('.part-list-heading').innerText()).includes('Selected'));
 await page.getByRole('button',{name:'Close parts inspector'}).click();await page.getByRole('button',{name:'Export sheets',exact:true}).click();
 const objDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Assembly OBJ',exact:true}).click();const o=await objDownload;await o.saveAs('.sites-runtime/validation/browser-assembly.obj');assert.ok(fs.statSync('.sites-runtime/validation/browser-assembly.obj').size>1000);
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Sequence',exact:true}).click();
 const videoDownload=page.waitForEvent('download',{timeout:60000});await page.locator('.sequence-control').getByRole('button',{name:'Download assembly video'}).click();const v=await videoDownload;const videoPath='.sites-runtime/validation/'+v.suggestedFilename();await v.saveAs(videoPath);assert.ok(fs.statSync(videoPath).size>5000);console.log('RECORDED',path.basename(videoPath),fs.statSync(videoPath).size);
 await page.getByRole('combobox',{name:'Sample model'}).click();await page.getByRole('option',{name:'Letter S shell',exact:true}).click();
 await page.waitForFunction(()=>window.__tools.read_slice_project.execute({}).model==='Letter S shell'&&!window.__tools.read_slice_project.execute({}).pending);
 assert.equal(await page.locator('.error-banner').count(),0);assert.equal(await page.locator('.viewport-error').count(),0);
 await page.getByRole('switch',{name:'X-Ray bracing view'}).click();await page.waitForTimeout(300);await canvas.screenshot({path:'.sites-runtime/validation/curved-viewport.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.sites-runtime/validation/workspace-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'Mobile viewport overflows horizontally');
 const switchBox=await page.getByRole('switch',{name:'X-Ray bracing view'}).boundingBox(),panelBox=await page.locator('.assembly-panel').boundingBox();assert.ok(switchBox.x+switchBox.width<=panelBox.x+panelBox.width,'X-ray switch is clipped on mobile');
 const videoButtonBox=await page.getByRole('button',{name:'Download assembly video'}).boundingBox();assert.ok(videoButtonBox.y+videoButtonBox.height<=panelBox.y+panelBox.height,'Video download button is clipped below the player');
 await page.getByRole('button',{name:'2D Sheets',exact:true}).click();
 const sheetBox=await page.locator('.sheet-panel').boundingBox();for(const name of ['DXF','SVG']){const b=await page.locator('.sheet-downloads').getByRole('button',{name,exact:true}).boundingBox();assert.ok(b.y+b.height<=sheetBox.y+sheetBox.height,'Sheet download is clipped on mobile: '+name);}
 await page.evaluate(()=>window.__tools.configure_slices.execute({mode:'stacked',alignmentPins:false,laserKerf:1,targetWidth:80}));
 await page.getByLabel('Import STL or OBJ file').setInputFiles('.sites-runtime/validation/tiny-bore.obj');
 await page.waitForFunction(()=>window.__tools.read_slice_project.execute({}).model==='tiny-bore.obj'&&!window.__tools.read_slice_project.execute({}).pending);
 const boreIssues=await page.evaluate(()=>window.__tools.read_slice_project.execute({}).issues);assert.ok(boreIssues.some(i=>i.code==='vanishing-holes'));assert.ok(boreIssues.filter(i=>i.code==='vanishing-holes').every(i=>i.severity==='warning'));
 await page.getByRole('button',{name:'Export sheets'}).click();
 assert.equal(await page.getByRole('button',{name:'Download all sheets · ZIP'}).isEnabled(),true,'Vanished-hole warnings should allow package download');
 const warningZip=page.waitForEvent('download');await page.getByRole('button',{name:'Download all sheets · ZIP'}).click();const z=await warningZip;await z.saveAs('.sites-runtime/validation/warning-package.zip');assert.ok(fs.statSync('.sites-runtime/validation/warning-package.zip').size>1000);
 const warningFiles=unzipSync(fs.readFileSync('.sites-runtime/validation/warning-package.zip'));assert.ok(strFromU8(warningFiles['tiny-bore_sheet_01.dxf']).includes('LWPOLYLINE'));assert.ok(strFromU8(warningFiles['tiny-bore_README.txt']).includes('WARNING: A hole is smaller than the kerf and disappeared.'));
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.setViewportSize({width:1536,height:1080});
 await page.getByRole('button',{name:'3D Assembly',exact:true}).click();
 await page.evaluate(()=>window.__tools.configure_slices.execute({mode:'finger_box',materialThickness:3,laserKerf:.15,targetWidth:220,fingerBox:{curveHandling:'facets',extrusionAxis:'auto',shellConstruction:'auto',bracing:{enabled:false}}}));
 await page.getByLabel('Import STL or OBJ file').setInputFiles('tests/fixtures/box-hole-test-double.stl');
 await page.waitForFunction(()=>window.__tools.read_slice_project.execute({}).model==='box-hole-test-double.stl'&&!window.__tools.read_slice_project.execute({}).pending);
 assert.equal(await page.locator('.error-banner').count(),0);assert.equal(await page.locator('.viewport-error').count(),0);
 await page.getByRole('combobox',{name:'Active thickness slot'}).click();await page.getByRole('option',{name:'T1 · 3 mm',exact:true}).click();
 await page.getByRole('combobox',{name:'T1 material'}).click();await page.getByRole('option',{name:'Baltic Birch Plywood',exact:true}).click();
 await page.waitForFunction(()=>!window.__tools.read_slice_project.execute({}).pending&&window.__tools.read_slice_project.execute({}).settings.materialPresets.find(m=>m.id==='T1').family==='plywood');
 assert.equal(await page.locator('.error-banner').count(),0);assert.ok((await page.locator('.construction-readout').innerText()).includes('8 inner tunnel walls'));
 const sidebar=await page.locator('.parameters').boundingBox();for(const label of ['Shell construction','Box extrusion direction']){const b=await page.getByRole('combobox',{name:label}).boundingBox();assert.ok(b.x+b.width<=sidebar.x+sidebar.width,'Sidebar control is clipped: '+label);}
 await page.locator('.material-slot[open]').screenshot({path:'.sites-runtime/validation/materials-panel.png'});
 await page.evaluate(()=>{document.querySelector('.parameters-scroll-area').scrollTop=0;document.querySelector('.main-workspace').scrollTop=0;});await page.waitForTimeout(300);
 await page.screenshot({path:'.sites-runtime/validation/holes-workspace.png',fullPage:true});
 await page.getByRole('button',{name:'Export sheets',exact:true}).click();
 const manualDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Exploded manual',exact:true}).click();const manual=await manualDownload;await manual.saveAs('.sites-runtime/validation/browser-manual.svg');const manualText=fs.readFileSync('.sites-runtime/validation/browser-manual.svg','utf8');assert.ok(manualText.includes('id="exploded-assembly"')&&manualText.includes('id="parts-inventory"')&&manualText.includes('Plywood'));
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'3D Assembly',exact:true}).click();
 await page.getByLabel('Import STL or OBJ file').setInputFiles('tests/fixtures/box-hole-test-double-with-curves.stl');
 await page.waitForFunction(()=>window.__tools.read_slice_project.execute({}).model==='box-hole-test-double-with-curves.stl'&&!window.__tools.read_slice_project.execute({}).pending);
 assert.equal(await page.locator('.error-banner').count(),0);assert.equal(await page.locator('.viewport-error').count(),0);assert.ok((await page.locator('.construction-readout').innerText()).includes('Faceted surface shell'));
 await page.waitForTimeout(300);await canvas.screenshot({path:'.sites-runtime/validation/surface-viewport.png'});
 for(const width of [1024,768,375]){await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'3D Assembly',exact:true}).click();assert.equal(await page.locator('.sheet-panel').isVisible(),false);const shape=await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,vw:innerWidth,vh:innerHeight}));assert.ok(shape.w<=shape.vw);assert.ok(shape.h<=shape.vh);await page.getByRole('button',{name:'Tune settings',exact:true}).click();assert.equal(await page.getByRole('dialog',{name:'Fabrication parameters'}).isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'Fabrication parameters'}).isVisible(),false);await page.getByRole('button',{name:'2D Sheets',exact:true}).click();assert.equal(await canvas.isVisible(),false);await page.screenshot({path:'.sites-runtime/validation/makeslice-'+width+'.png',fullPage:true});}
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS: native file:// page, WebGL preview, OBJ import, 3D stock rebuild, x-ray, scrap assignment, actual MediaRecorder download, and mobile layout.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
