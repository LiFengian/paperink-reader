"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, RefreshCw, Settings2, X } from "lucide-react";
import { getPersonalKey, setPersonalKey, getAiSettings, setAiSettings, DEFAULT_AI_SETTINGS } from "../lib/ai-client";
import type { AiSettings } from "../lib/ai-client";
import { createLibraryBackup, importLibraryBackup, shareBackup } from "../lib/library-backup";
import { saveDocument } from "../lib/local-store";
import type { ReaderDocument } from "../lib/reader-types";
import { version } from "../package.json";

export function PersonalControls({ personal, current, disabled, onRestored, isWriting, onUpdating }: { personal: boolean; current: ReaderDocument | null; disabled: boolean; onRestored: () => Promise<void>; isWriting?: () => boolean; onUpdating?: (updating: boolean) => void }) {
  const [open, setOpen] = useState(false), [key, setKey] = useState("");
  const [ai, setAi] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [working, setWorking] = useState(false), [notice, setNotice] = useState("");
  const [backup, setBackup] = useState<Blob | null>(null);
  const [offline, setOffline] = useState("正在准备离线资源…");
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [waitingVersion, setWaitingVersion] = useState("");
  const [dismissed, setDismissed] = useState<ServiceWorker | null>(null);
  const [checking, setChecking] = useState(false), [updating, setUpdating] = useState(false);
  const [updateNotice, setUpdateNotice] = useState("");
  const [storage, setStorage] = useState("尚未申请持久保存");
  const restoreInput = useRef<HTMLInputElement>(null);
  const checkUpdate = useRef<(manual?: boolean) => Promise<void>>(async () => {});
  const updatingRef = useRef(false);

  useEffect(() => {
    if (!personal) return;
    if (!window.isSecureContext || !("serviceWorker" in navigator)) { setOffline("离线准备失败：请使用 Safari 打开 HTTPS 地址。"); return; }
    let cancelled = false, registration: ServiceWorkerRegistration | undefined, inFlight = false, lastCheck = 0;
    const update = () => { if (cancelled) return; if (registration?.active) setOffline("离线资源已就绪"); setWaiting(registration?.waiting ?? null); };
    const changed = () => update();
    const check = async (manual = false) => {
      if (cancelled || !registration || inFlight || (!manual && Date.now() - lastCheck < 30_000)) return;
      if (!navigator.onLine) { if (manual) setNotice("当前离线，联网后会自动检查新版本。"); return; }
      inFlight = true; lastCheck = Date.now(); if (manual) setChecking(true);
      try {
        await registration.update(); update();
        if (manual && !cancelled) setNotice(registration.waiting ? "新版本已准备好，可以保存笔记后更新。" : registration.installing ? "正在下载新版本，准备好后会提醒。" : "当前已是最新版本。");
      } catch { if (manual && !cancelled) setNotice("暂时无法检查更新，联网后会自动重试。"); }
      finally { inFlight = false; if (manual && !cancelled) setChecking(false); }
    };
    checkUpdate.current = check;
    const resume = () => { if (document.visibilityState === "visible") void check(); };
    const found = () => {
      const worker = registration?.installing;
      worker?.addEventListener("statechange", () => {
        if (cancelled) return;
        update();
        if (worker.state === "redundant" && !registration?.active) setOffline("离线下载未完成，请联网后重新打开。");
      });
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    window.addEventListener("online", resume); window.addEventListener("pageshow", resume); document.addEventListener("visibilitychange", resume);
    const interval = window.setInterval(resume, 5 * 60_000);
    void navigator.serviceWorker.register(new URL("./sw.js", document.baseURI).href, { scope: new URL("./", document.baseURI).href, updateViaCache: "none" })
      .then(async value => { registration = value; if (cancelled) return; value.addEventListener("updatefound", found); found(); update(); void check(); await navigator.serviceWorker.ready; update(); })
      .catch(() => { if (!cancelled) setOffline("离线下载未完成，请联网后重新打开。"); });
    void navigator.storage?.persisted?.().then(value => { if (!cancelled && value) setStorage("已启用持久保存"); });
    return () => { cancelled = true; checkUpdate.current = async () => {}; window.clearInterval(interval); window.removeEventListener("online", resume); window.removeEventListener("pageshow", resume); document.removeEventListener("visibilitychange", resume); navigator.serviceWorker.removeEventListener("controllerchange", changed); registration?.removeEventListener("updatefound", found); };
  }, [personal]);

  useEffect(() => {
    setWaitingVersion(""); if (!waiting) return;
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => channel.port1.close(), 2000);
    channel.port1.onmessage = event => {
      if (typeof event.data?.version === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(event.data.version)) setWaitingVersion(event.data.version);
      window.clearTimeout(timer); channel.port1.close();
    };
    try { waiting.postMessage({ type: "GET_VERSION" }, [channel.port2]); } catch { channel.port1.close(); }
    return () => { window.clearTimeout(timer); channel.port1.close(); channel.port2.close(); };
  }, [waiting]);

  function show() {
    setNotice(""); setOpen(true);
    if (personal) { try { setKey(getPersonalKey()); setAi(getAiSettings()); } catch { setNotice("无法读取本机 Key，请检查浏览器存储设置。"); } }
  }
  async function makeBackup() {
    setWorking(true); setNotice("正在整理原始 PDF、可编辑笔记和聊天记录…"); setBackup(null);
    try { setBackup(await createLibraryBackup(current)); setNotice("备份已生成，请点击“保存或分享备份”，存到“文件”或微信。"); }
    catch (error) { setNotice((error as Error).message || "备份失败。"); }
    finally { setWorking(false); }
  }
  async function restore(file: File) {
    setWorking(true); setNotice("正在验证并恢复备份…");
    try {
      if (current) await saveDocument(current);
      const count = await importLibraryBackup(file);
      await onRestored(); setBackup(null); setNotice(`已恢复 ${count} 份文献。现有文献保留，恢复内容另存为副本。`);
    } catch (error) { setNotice((error as Error).message || "恢复失败，现有文献已保留。"); }
    finally { setWorking(false); if (restoreInput.current) restoreInput.current.value = ""; }
  }
  async function updateApp() {
    if (!waiting || disabled || working || updatingRef.current) return;
    if (isWriting?.()) { const text = "请先收起便签或完成当前笔画，再更新阅读器。"; setNotice(text); setUpdateNotice(text); return; }
    setUpdateNotice("");
    updatingRef.current = true; setUpdating(true); setWorking(true); onUpdating?.(true);
    const unlock = () => { updatingRef.current = false; setUpdating(false); setWorking(false); onUpdating?.(false); };
    try {
      if (current) await saveDocument(current);
      const registration = await navigator.serviceWorker.getRegistration();
      const next = registration?.waiting;
      if (!next) { setWaiting(null); unlock(); setNotice("当前版本已就绪；新版本下载完成后可更新。"); return; }
      const reload = () => { window.clearTimeout(timeout); window.location.reload(); };
      const timeout = window.setTimeout(() => { navigator.serviceWorker.removeEventListener("controllerchange", reload); unlock(); setNotice("笔记已保存，更新暂未完成，请再试一次。"); }, 15_000);
      navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
      next.postMessage({ type: "ACTIVATE_UPDATE" });
    } catch { unlock(); const text = "当前笔记保存失败，请先备份再更新。"; setNotice(text); setUpdateNotice(text); }
  }
  async function persist() {
    const result = await navigator.storage?.persist?.().catch(() => false);
    setStorage(result ? "已启用持久保存" : "系统暂未批准；请添加到主屏幕并定期备份");
  }

  return <>
    <button className="header-button subtle personal-controls-trigger" aria-label={personal ? "离线与备份" : "完整备份"} disabled={disabled} onClick={show}><Settings2 size={17} /><span>{personal ? "离线与备份" : "完整备份"}</span></button>
    {personal && <span className={`offline-pill ${offline === "离线资源已就绪" ? "ready" : ""}`} role="status" title={offline}>{offline === "离线资源已就绪" ? "离线就绪" : offline.startsWith("正在") ? "离线准备中" : "离线未就绪"}</span>}
    {personal && waiting && <button className="reader-update-badge" aria-label="查看新版更新" onClick={show}><RefreshCw size={13} />新版本</button>}
    {personal && waiting && dismissed !== waiting && !open && createPortal(<aside className="reader-update-banner" role="status" aria-label="墨读版本更新提醒"><div><strong>{waitingVersion ? `墨读 ${waitingVersion} 已准备好` : "墨读有新版本可用"}</strong><p>更新前会先保存本机笔记。</p></div><div className="reader-update-actions"><button className="reader-update-now" disabled={disabled || working} onClick={() => void updateApp()}>保存并更新</button><button className="reader-update-later" disabled={working} onClick={() => setDismissed(waiting)}>稍后更新</button></div>{updateNotice && <p className="reader-update-notice">{updateNotice}</p>}</aside>, window.document.body)}
    {updating && createPortal(<div className="reader-update-saving" role="status">正在保存笔记并更新墨读…</div>, window.document.body)}
    {open && <div className="modal-backdrop" onClick={() => { if (!working) setOpen(false); }}><section className="help-modal personal-modal" role="dialog" aria-modal="true" aria-labelledby="personal-title" onClick={event => event.stopPropagation()}>
      <button className="modal-close" aria-label="关闭离线与备份" disabled={working} onClick={() => setOpen(false)}><X size={20} /></button>
      <span className="eyebrow">墨读 {version}</span><h2 id="personal-title">{personal ? "离线与备份" : "完整备份与迁移"}</h2>
      {personal && <>
        <div className="personal-section"><h3>离线阅读</h3><p className="offline-state" role="status">{offline}</p><p>Safari → 分享 → 添加到主屏幕。首次下载完成后，从主屏幕打开即可离线阅读、写画和导出。AI 提问需要网络连接。</p>
          <button className="personal-action secondary" disabled={working || checking} onClick={() => void checkUpdate.current(true)}>{checking ? "正在检查…" : "检查新版本"}</button>
          {waiting && <button className="personal-action" disabled={working} onClick={() => void updateApp()}>保存笔记并更新阅读器</button>}
          <p className="storage-state">{storage}</p><button className="personal-action secondary" onClick={() => void persist()} disabled={working}>申请持久保存</button>
        </div>
        <div className="personal-section"><h3>DeepSeek 设置</h3><p>Key 只保存在这台设备，不包含在备份中。发送问题时，全文文字、定位原文和标记截图会交给 DeepSeek。</p>
          <label htmlFor="ai-model">模型</label><select id="ai-model" value={ai.model} disabled={working} onChange={event => { const next = { ...ai, model: event.target.value as AiSettings["model"] }; try { setAiSettings(next); setAi(next); } catch { setNotice("设置保存失败。"); } }}><option value="deepseek-flash">Flash · 兼顾速度与费用</option><option value="deepseek-v4-pro">Pro · 深度解读</option></select>
          <label htmlFor="ai-effort">思考深度</label><select id="ai-effort" value={ai.effort} disabled={working} onChange={event => { const next = { ...ai, effort: event.target.value as AiSettings["effort"] }; try { setAiSettings(next); setAi(next); } catch { setNotice("设置保存失败。"); } }}><option value="high">深度思考（默认）</option><option value="max">更深入思考</option><option value="none">快速回答</option></select>
          <p>Pro 费用更高；含图片时先由 Flash 转写，再交给 Pro。更深入思考会增加等待和 API 用量。</p>
          <label htmlFor="personal-api-key">DeepSeek API Key</label><input id="personal-api-key" type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="粘贴你的 API Key" disabled={working} />
          <div className="personal-actions"><button className="personal-action" disabled={working || !key.trim()} onClick={() => { try { setPersonalKey(key); setNotice("Key 已保存到这台设备。"); } catch { setNotice("Key 保存失败，请检查浏览器存储设置。"); } }}>保存 Key</button>
          <button className="personal-action secondary" disabled={working} onClick={() => { try { setPersonalKey(""); setKey(""); setNotice("本机 Key 已移除。"); } catch { setNotice("无法移除 Key，请检查存储设置。"); } }}>移除 Key</button></div>
        </div>
      </>}
      <div className="personal-section"><h3>完整文献库备份</h3><p>包含原始 PDF、可编辑笔迹、图片、页面调整和聊天记录。可用于迁入离线版，也可换设备恢复；恢复时保留现有文献。</p>
        <div className="personal-actions"><button className="personal-action" disabled={working} onClick={() => void makeBackup()}>生成完整备份</button><button className="personal-action secondary" disabled={working} onClick={() => restoreInput.current?.click()}>恢复备份</button></div>
        {backup && <button className="personal-action save-backup" onClick={() => void shareBackup(backup).catch(() => setNotice("保存失败，请重新尝试。"))}><Download size={16} />保存或分享备份</button>}
        <input className="hidden-input" ref={restoreInput} aria-label="恢复完整备份" type="file" accept=".paperink,application/octet-stream" onChange={event => { const file = event.target.files?.[0]; if (file) void restore(file); }} />
      </div>
      {notice && <p className="personal-notice" role="status">{notice}</p>}
      <div className="help-note">建议把完整备份保存到“文件”。清除网站数据、删除主屏幕版本或系统清理存储，可能移除本机文献及离线资源。</div>
    </section></div>}
  </>;
}
