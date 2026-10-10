import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM, VirtualConsole } from "jsdom";
import { unzipSync } from "fflate";

const html = readFileSync("dist/index.html", "utf8");
assert.ok(!/<(?:script|link)\b[^>]*(?:src|href)=["'](?!data:)/i.test(html), "Standalone page depends on an external file");
assert.ok(!html.includes("file:///ROOT"), "Build-machine file URL leaked into the download");
assert.ok(html.includes('type="image/png" href="data:image/png;base64,'+readFileSync("assets/whatmakeart-logo.png").toString("base64")),"Favicon embeds the supplied What Make Art mark");

for (const scenario of ["inline-worker", "blocked-workers"]) {
  const errors = [], workers = [], downloads = [], blobs = new Map(), tools = new Map();
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", e => errors.push(e));
  let id = 0;
  const dom = new JSDOM(html, {
    url: "file:///download/slice-lab/index.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window,"innerWidth",{value:1440,writable:true,configurable:true});
      window.document.modelContext={registerTool(tool){tools.set(tool.name,tool);}};
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.HTMLCanvasElement.prototype.getContext = () => null;
      for (const method of ["setPointerCapture", "releasePointerCapture", "scrollIntoView"]) window.HTMLElement.prototype[method] = () => {};
      window.HTMLElement.prototype.hasPointerCapture = () => false;
      window.Blob = Blob;
      window.TextDecoder = TextDecoder;
      window.structuredClone = structuredClone;
      window.TextEncoder = TextEncoder;
      window.URL.createObjectURL = blob => {const url = `blob:file:///download/${++id}`; blobs.set(url, blob); return url;};
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, blob: blobs.get(this.href) }); };
      window.Worker = class {
        onmessage = null; onerror = null; closed = false; scope = null;
        constructor(url) {
          if (scenario === "blocked-workers") throw new window.DOMException("Blocked by browser policy", "SecurityError");
          assert.ok(String(url).startsWith("blob:"), "The production wrapper did not create an inline Blob worker");
          workers.push(this);
          blobs.get(String(url)).text().then(code => {
            if(this.closed) return;
            this.scope = {
              URL: { revokeObjectURL() {} }, location: { href: url }, onmessage: null,
              postMessage: (message, options) => {
                const data = structuredClone(message, options);
                window.setTimeout(() => {if(!this.closed) this.onmessage?.({data});}, 0);
              },
            };
            try {runInNewContext(code, {self:this.scope, performance, TextDecoder, TextEncoder, structuredClone, atob, btoa, console}, {timeout:10000});}
            catch(error) {errors.push(error); this.onerror?.({message:error.message, preventDefault(){}});}
          });
        }
        addEventListener() {}
        postMessage(message, transfer) {
          const data = structuredClone(message, {transfer});
          window.setTimeout(() => {if(!this.closed) this.scope.onmessage({data});}, 0);
        }
        terminate() {this.closed = true;}
      };
    },
  });
  const document = dom.window.document;
  async function waitFor(check) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {if(check()) return; await new Promise(resolve => setTimeout(resolve, 20));}
    throw new Error(`${scenario}: ${document.querySelector(".error-banner")?.textContent || "Timed out"}; ${errors.map(e=>e.message).join("; ")}; ${document.body.textContent.slice(0,180)}`);
  }
  await waitFor(() => {const current=tools.get("read_slice_project")?.execute({});return current?.model==="Jimmy.stl"&&!current?.pending;});
  assert.equal(document.querySelector(".error-banner"), null);
  assert.ok(document.querySelectorAll(".sheet-part").length > 0);
  if(scenario === "inline-worker") assert.equal(workers.length, 1);
  assert.equal(document.querySelector('.app-footer a[href*="github.com"]')?.href,"https://github.com/whatmakeart/make-slice");
  document.querySelectorAll(".parameter-group summary")[2].click();
  document.querySelector(".calibration-button").click();
  const calibration=unzipSync(new Uint8Array(await downloads.at(-1).blob.arrayBuffer()));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(calibration["calibration-settings.json"])).finishedSlotsMm,Array.from({length:11},(_,i)=>(35+i)/10));
  assert.match(new TextDecoder().decode(calibration[Object.keys(calibration).find(f=>f.endsWith(".svg"))]),/stroke-width="0.1763889"/);
  assert.equal(tools.get("read_slice_project").execute({}).pending,false);
  const mesh = readFileSync(".sites-runtime/validation/cube-binary.stl");
  const input = document.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", {value:[{name:"offline-cube.stl",size:mesh.length,arrayBuffer:async()=>mesh.buffer.slice(mesh.byteOffset,mesh.byteOffset+mesh.byteLength)}]});
  input.dispatchEvent(new dom.window.Event("change", {bubbles:true}));
  await waitFor(() => document.querySelector(".header-project h2")?.textContent === "offline-cube.stl" && document.querySelector(".check-ok")?.textContent.includes("Ready to export"));
  await tools.get("configure_slices").execute({mode:"stacked",targetWidth:100,materialThickness:4,alignmentPinType:"material",alignmentPins:true,pinDiameter:6,pinCount:2});
  await waitFor(()=>tools.get("read_slice_project").execute({}).partCount===27);
  assert.equal(tools.get("read_slice_project").execute({}).settings.alignmentPinType,"material");
  const svg = [...document.querySelectorAll("button")].find(button => button.textContent === "SVG");
  svg.click();
  assert.ok(downloads.at(-1)?.filename.endsWith(".svg"));
  assert.match(await downloads.at(-1).blob.text(), /<svg.*width="900mm"/);
  const exportButton = [...document.querySelectorAll("button")].find(button => button.textContent.includes("Export sheets"));
  exportButton.click();
  await waitFor(() => [...document.querySelectorAll("button")].some(button => button.textContent.includes("Download all sheets")));
  [...document.querySelectorAll("button")].find(button => button.textContent.includes("Download package · ZIP")).click();
  const bundle = unzipSync(new Uint8Array(await downloads.at(-1).blob.arrayBuffer()));
  assert.ok(bundle["offline-cube_sheet_01.dxf"] && bundle["offline-cube_sheet_01.svg"] && bundle["offline-cube_assembly.csv"] && bundle["offline-cube_Assembly_Guide.pdf"]);
  [...document.querySelectorAll("button")].find(button=>button.textContent==="Close").click();
  const bedWidth=[...document.querySelectorAll(".parameters label")].find(label=>label.firstElementChild?.textContent==="Width")?.querySelector("input");
  assert.ok(bedWidth);
  const setValue=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value").set;
  setValue.call(bedWidth,"40");bedWidth.dispatchEvent(new dom.window.Event("input",{bubbles:true}));bedWidth.dispatchEvent(new dom.window.Event("change",{bubbles:true}));bedWidth.dispatchEvent(new dom.window.FocusEvent("focusout",{bubbles:true}));
  await waitFor(()=>document.querySelector(".error-banner")?.textContent.includes("do not fit"));
  const dxf=[...document.querySelectorAll("button")].find(button=>button.textContent==="Unplaced DXF")||[...document.querySelectorAll("button")].find(button=>button.textContent==="DXF");
  assert.equal(dxf.disabled,false);dxf.click();
  assert.ok(downloads.at(-1).filename.endsWith("_unplaced-parts.dxf"));
  assert.ok((await downloads.at(-1).blob.text()).includes("LWPOLYLINE"));
  assert.equal([...document.querySelectorAll("button")].find(button=>button.textContent==="SVG").disabled,true);
  assert.equal(errors.length, 0, errors.map(e=>e.message).join("\n"));
  for (const worker of workers) worker.terminate();
  dom.window.close();
  console.log(`PASS: standalone file:// page, ${scenario}, Jimmy, kerf-test ZIP, repository link, STL import, SVG and top-action laser ZIP export.`);
}
