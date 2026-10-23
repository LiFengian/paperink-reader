import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import ts from "typescript";

const executable = process.env.PAPERINK_TEST_BROWSER || [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].find(path => existsSync(path));

for (const seedVersion of [1, 3]) test(`real IndexedDB v${seedVersion} upgrade: incremental edits, folders, rollback, restore and deletion`, { skip: !executable, timeout: 30_000 }, async t => {
  const source = await readFile(new URL("../lib/local-store.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/store.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/store.js" ? javascript : "<!doctype html><title>Local storage regression</title>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = await mkdtemp(join(tmpdir(), "paperink-storage-test-"));
  const browser = spawn(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let socket;
  t.after(async () => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: 99999, method: "Browser.close" }));
    socket?.close(); browser.kill(); await new Promise(resolve => server.close(resolve));
    await delay(200);
    if (dirname(resolve(profile)) !== resolve(tmpdir()) || !profile.includes("paperink-storage-test-")) throw Error("Unexpected test profile path");
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  });
  let port;
  for (let index = 0; index < 100; index++) {
    try { port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; }
    catch { await delay(50); }
  }
  assert.ok(port, "test browser started");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data), task = pending.get(message.id);
    if (!task) return; pending.delete(message.id);
    if (message.error) task.reject(Error(message.error.message)); else task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await send("Page.enable"); await send("Runtime.enable");
  const origin = `http://127.0.0.1:${server.address().port}`;
  await send("Page.navigate", { url: origin });
  for (let index = 0; index < 100; index++) { if (await evaluate(`location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`)) break; await delay(20); }
  const result = await evaluate(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || Error('aborted')); });
    const requestValue = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const open = indexedDB.open('paperink-local-v1', ${seedVersion});
    open.onupgradeneeded = () => {
      const db=open.result; db.createObjectStore('documents', {keyPath:'id'}); db.createObjectStore('pdfs');
      if (${seedVersion} >= 3) {
        db.createObjectStore('document-meta',{keyPath:'id'});
        db.createObjectStore('page-meta',{keyPath:['documentId','id']}).createIndex('documentId','documentId');
        db.createObjectStore('mark-deltas',{keyPath:['documentId','pageId','id']}).createIndex('documentId','documentId');
        db.createObjectStore('chat-deltas');
        db.createObjectStore('note-images',{keyPath:['documentId','pageId','noteId','id']}).createIndex('documentId','documentId');
      }
    };
    const legacyDb = await requestValue(open);
    const stroke = {id:'ink-a', type:'stroke', tool:'pen', color:'#123456', width:2.5, points:[{x:10,y:20},{x:100,y:20}]};
    const original = {id:'legacy', name:'legacy.pdf', createdAt:1, updatedAt:1, currentPage:0, pages:[{id:'page-a',sourcePage:1,width:612,height:792,marks:[stroke]},{id:'blank',sourcePage:null,width:612,height:792,marks:[]}],chat:[{id:'chat-a',role:'user',content:'Remember this note',createdAt:1}]};
    const tx = legacyDb.transaction(['documents','pdfs'],'readwrite'), finished = done(tx);
    tx.objectStore('documents').put(original); tx.objectStore('pdfs').put(new Blob(['%PDF-1.4 legacy bytes']), original.id); await finished; legacyDb.close();
    const store = await import('/store.js');
    let current = (await store.listDocuments())[0];
    check(JSON.stringify(current) === JSON.stringify(original), 'v1 upgrade changed notes');
    check((await store.getPdf(current.id)).size === 21, 'v1 upgrade lost original PDF');
    const writes = [], nativePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) { writes.push({store:this.name, id:value?.id, chars:JSON.stringify(value).length}); return nativePut.call(this,value,...args); };
    const kept = current.pages[0].marks[0];
    const extra = {...kept,id:'ink-b',points:[{x:200,y:20},{x:300,y:20}]};
    current = {...current,updatedAt:2,pages:[{...current.pages[0],marks:[kept,extra]},current.pages[1]]};
    await store.saveDocument(current);
    check(!writes.some(item => item.store === 'documents' || item.store === 'chat-deltas'), 'stroke save rewrote whole document or chat');
    check(writes.filter(item => item.store === 'mark-deltas').length === 1, 'unchanged legacy stroke was rewritten');
    const listed = await store.listDocuments(); check(listed[0] === current,'library refresh broke unchanged object identity');
    writes.length = 0; await store.saveDocument(current); check(writes.length === 0,'unchanged document was saved again');
    const moved = {...extra,points:extra.points.map(point=>({x:point.x+25,y:point.y+30}))};
    const first = {...current,updatedAt:3,pages:[{...current.pages[0],marks:[kept,moved]},current.pages[1]]};
    const second = {...first,updatedAt:4,pages:[first.pages[0]],chat:[...first.chat,{id:'reply',role:'assistant',content:'Saved response',createdAt:4}]};
    await Promise.all([store.saveDocument(first),store.saveDocument(second)]);
    check((await store.getDocument('legacy')).updatedAt === 4,'queued saves completed out of order');
    const bad = {...second,updatedAt:5,chat:[...second.chat,()=>{}]};
    let rejected = false; try { await store.saveDocument(bad); } catch { rejected = true; }
    check(rejected && (await store.getDocument('legacy')).updatedAt === 4,'failed transaction partially changed document');
    current = {...second,updatedAt:6,pages:[{...second.pages[0],marks:[kept]},original.pages[1]],currentPage:1};
    await store.saveDocument(current);
    const image = {id:'photo',src:'data:image/png;base64,'+'A'.repeat(100000),width:200,height:100,name:'photo.png'};
    const note = {id:'note',type:'note',x:100,y:100,width:28,height:28,text:'Image note',strokes:[],noteWidth:480,noteHeight:320,images:[image]};
    current = {...current,updatedAt:7,pages:[{...current.pages[0],marks:[kept,note]},current.pages[1]]};
    await store.saveDocument(current);
    writes.length=0;
    const resized = {...note,x:86,y:86,width:56,height:56,text:'Resized note with retained photo'};
    current = {...current,updatedAt:8,pages:[{...current.pages[0],marks:[kept,resized]},current.pages[1]]};
    await store.saveDocument(current);
    check(!writes.some(item=>item.store==='note-images'),'resize or text edit rewrote unchanged image bytes');
    check(writes.filter(item=>item.store==='mark-deltas').every(item=>item.chars<2000),'note metadata still contains the large photo');
    const noImage={...resized,images:[]};
    await store.saveDocument({...current,updatedAt:9,pages:[{...current.pages[0],marks:[kept,noImage]},current.pages[1]]});
    await store.saveDocument(current); // Undo image deletion restores the image record.
    // Folder operations must not rewrite or roll back a live document snapshot.
    let organization=await store.listLibraryOrganization();
    check(!organization.folders.length && !Object.keys(organization.assignments).length,'upgrade assigned existing content to a folder');
    const english=await store.createLibraryFolder('  英语报道  '), science=await store.createLibraryFolder('科普阅读');
    let folderRejected=false; try{await store.createLibraryFolder('英语报道')}catch{folderRejected=true}
    check(folderRejected,'duplicate folder accepted');
    folderRejected=false; try{await store.renameLibraryFolder(science.id,'英语报道')}catch{folderRejected=true}
    check(folderRejected,'rename overwrote another folder');
    await store.renameLibraryFolder(science.id,'科普期刊');
    const documentBefore=await store.getDocument('legacy'), pdfBefore=await (await store.getPdf('legacy')).text();
    writes.length=0;
    await store.moveDocumentToFolder('legacy',english.id);
    check(!writes.some(item=>!['library-folders','document-folders'].includes(item.store)),'moving rewrote document content');
    check((await store.getDocument('legacy'))===documentBefore && await (await store.getPdf('legacy')).text()===pdfBefore,'moving changed document, chat or PDF bytes');
    folderRejected=false;try{await store.moveDocumentToFolder('legacy','missing-folder')}catch{folderRejected=true}
    check(folderRejected && (await store.listLibraryOrganization()).assignments.legacy===english.id,'invalid move changed existing membership');
    folderRejected=false;try{await store.moveDocumentToFolder('missing-document',english.id)}catch{folderRejected=true}
    check(folderRejected && !(await store.listLibraryOrganization()).assignments['missing-document'],'missing document acquired a folder');
    await store.deleteLibraryFolder(english.id);
    current={...current,updatedAt:10};await store.saveDocument(current);
    check(!(await store.listLibraryOrganization()).assignments.legacy && (await store.getDocument('legacy')).pages[0].marks[1].images[0].src===image.src,'late autosave reattached deleted folder or deletion lost notes');
    await store.moveDocumentToFolder('legacy',science.id);
    await store.saveDocument(current);
    check((await store.listLibraryOrganization()).assignments.legacy===science.id,'document save undid folder move');
    // A PDF import either saves all its bytes + page metadata + folder, or nothing.
    const fresh = {...original,id:'new-import',pages:original.pages.map(page=>({...page,marks:[]})),chat:[]};
    const freshPdf = new Blob(['%PDF new import'], {type:'application/pdf'});
    const nativeAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(...args) {
      if(this.name==='page-meta')throw new DOMException('Simulated quota failure','QuotaExceededError');
      return nativeAdd.apply(this,args);
    };
    let importRejected = false;
    try { await store.saveImportedPdf(fresh,freshPdf,science.id); } catch { importRejected = true; }
    IDBObjectStore.prototype.add = nativeAdd;
    check(importRejected && !(await store.getPdf(fresh.id)) && !(await store.getDocument(fresh.id)), 'failed PDF import left orphan bytes or metadata');
    await store.saveImportedPdf(fresh,freshPdf,science.id);
    check((await store.getPdf(fresh.id)).size===freshPdf.size && (await store.getDocument(fresh.id)).pages.length===2,'fresh PDF import lost bytes or pages');
    importRejected=false;
    try { await store.saveImportedPdf({...fresh,name:'Must not overwrite'},new Blob(['wrong bytes'])); } catch { importRejected=true; }
    check(importRejected && (await store.getDocument(fresh.id)).name===fresh.name && (await store.getPdf(fresh.id)).size===freshPdf.size,'asynchronous import collision changed existing PDF');
    check((await store.listLibraryOrganization()).assignments[fresh.id]===science.id,'import ignored selected folder');
    const invalidImport={...fresh,id:'bad-folder-import'};
    importRejected=false;try{await store.saveImportedPdf(invalidImport,freshPdf,'missing-folder')}catch{importRejected=true}
    check(importRejected && !(await store.getPdf(invalidImport.id)) && !(await store.getDocument(invalidImport.id)),'invalid import folder left partial document');
    await store.deleteDocument(fresh.id);
    check(!(await store.listLibraryOrganization()).assignments[fresh.id],'document deletion left folder membership');
    // Restore is atomic: collision on the second entry must roll back the first.
    const restored = {...original,id:'restore-a',pages:[{...original.pages[0],marks:[resized]},original.pages[1]]}, collision = {...original,id:'legacy'};
    const restoredFolder={id:'restored-folder',name:'科普期刊',createdAt:50};
    rejected = false;
    try { await store.restoreDocuments([{document:restored,pdf:new Blob(['PDF']),folderId:restoredFolder.id},{document:collision,pdf:new Blob(['PDF'])}],[restoredFolder]); } catch { rejected = true; }
    check(rejected && !(await store.getDocument('restore-a')),'restore failure left a partial import');
    check(!(await store.listLibraryOrganization()).folders.some(folder=>folder.id===restoredFolder.id),'failed restore left folder records');
    await store.restoreDocuments([{document:restored,pdf:new Blob(['restored PDF']),folderId:restoredFolder.id}],[restoredFolder]);
    organization=await store.listLibraryOrganization();
    check(organization.assignments[restored.id]===restoredFolder.id && organization.folders.find(folder=>folder.id===restoredFolder.id).name==='科普期刊（恢复 1）','restore lost classification or existing same-name folder');
    check((await store.getDocument('restore-a')).pages.length === 2,'successful restore lost pages');
    IDBObjectStore.prototype.put = nativePut;
    return {expected:current, image: image.src, writes:writes.length, organization};
  })()`);
  // A fresh JS realm clears all module caches, then reconstructs persisted deltas.
  await send("Page.reload");
  await delay(150);
  const persisted = await evaluate("(async()=>{const store=await import('/store.js');return store.getDocument('legacy')})()");
  assert.deepEqual(persisted, result.expected, "reload retains normalized photos, note size, text and other page edits");
  const persistedFolders = await evaluate("(async()=>{const store=await import('/store.js');return store.listLibraryOrganization()})()");
  assert.deepEqual(persistedFolders, result.organization, "reload retains folders and document/chat classification");
  const reloaded = await evaluate(`(async () => {
    const store = await import('/store.js'), document = await store.getDocument('legacy');
    const restored=await store.getDocument('restore-a');
    await store.saveDocument({...restored,pages:[{...restored.pages[0],marks:[{...restored.pages[0].marks[0],text:'Edited restored note'}]},restored.pages[1]]});
    await store.deleteDocument('legacy');
    if (await store.getDocument('legacy') || await store.getPdf('legacy')) throw Error('deleted document is still readable');
    const db = await new Promise((resolve,reject)=>{const request=indexedDB.open('paperink-local-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    const counts = await Promise.all(['page-meta','mark-deltas','note-images'].map(name=>new Promise((resolve,reject)=>{const request=db.transaction(name).objectStore(name).index('documentId').count('legacy');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})));
    db.close();
    if ((await store.listLibraryOrganization()).assignments.legacy) throw Error('document deletion retained folder membership');
    if (counts.some(Boolean)) throw Error('deletion left orphaned page or stroke deltas');
    return (await store.listDocuments()).map(item=>item.id);
  })()`);
  assert.deepEqual(reloaded, ["restore-a"]);
  await send("Page.reload"); await delay(150);
  const restoredImage = await evaluate("(async()=>{const store=await import('/store.js');return (await store.getDocument('restore-a')).pages[0].marks[0].images[0].src})()");
  assert.equal(restoredImage, result.image, "restored photos remain available after their note is edited and reopened");
});
