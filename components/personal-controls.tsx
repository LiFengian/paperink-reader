"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Settings2, X } from "lucide-react";
import { getPersonalKey, setPersonalKey } from "../lib/ai-client";
import { createLibraryBackup, importLibraryBackup, shareBackup } from "../lib/library-backup";
import { saveDocument } from "../lib/local-store";
import type { ReaderDocument } from "../lib/reader-types";
import { version } from "../package.json";

export function PersonalControls({ personal, current, disabled, onRestored }: { personal: boolean; current: ReaderDocument | null; disabled: boolean; onRestored: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [key, setKey] = useState("");
  const [working, setWorking] = useState(false), [notice, setNotice] = useState("");
  const [backup, setBackup] = useState<Blob | null>(null);
  const [offline, setOffline] = useState("正在准备离线资源…");
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [storage, setStorage] = useState("尚未申请持久保存");
  const restoreInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!personal) return;
    if (!window.isSecureContext || !("serviceWorker" in navigator)) { setOffline("离线准备失败：请使用 Safari 打开 HTTPS 地址。"); return; }
    let cancelled = false, registration: ServiceWorkerRegistration | undefined;
    const update = () => { if (cancelled) return; if (registration?.active) setOffline("离线资源已就绪"); setWaiting(registration?.waiting ?? null); };
    const changed = () => update();
    const found = () => {
      const worker = registration?.installing;
      worker?.addEventListener("statechange", () => {
        if (cancelled) return;
        update();
        if (worker.state === "redundant" && !registration?.active) setOffline("离线下载未完成，请联网后重新打开。");
      });
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    void navigator.serviceWorker.register(new URL("./sw.js", document.baseURI).href, { scope: new URL("./", document.baseURI).href, updateViaCache: "none" })
      .then(async value => { registration = value; if (cancelled) return; value.addEventListener("updatefound", found); found(); update(); await navigator.serviceWorker.ready; update(); })
      .catch(() => { if (!cancelled) setOffline("离线下载未完成，请联网后重新打开。"); });
    void navigator.storage?.persisted?.().then(value => { if (!cancelled && value) setStorage("已启用持久保存"); });
    return () => { cancelled = true; navigator.serviceWorker.removeEventListener("controllerchange", changed); registration?.removeEventListener("updatefound", found); };
  }, [personal]);

  function show() {
    setNotice(""); setOpen(true);
    if (personal) { try { setKey(getPersonalKey()); } catch { setNotice("无法读取本机 Key，请检查浏览器存储设置。"); } }
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
    if (!waiting) return;
    setWorking(true);
    try {
      if (current) await saveDocument(current);
      const registration = await navigator.serviceWorker.getRegistration();
      const next = registration?.waiting;
      if (!next) { setWaiting(null); setWorking(false); setNotice("当前版本已就绪；新版本下载完成后可更新。"); return; }
      navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
      next.postMessage({ type: "ACTIVATE_UPDATE" });
    } catch { setWorking(false); setNotice("当前笔记保存失败，请先备份再更新。"); }
  }
  async function persist() {
    const result = await navigator.storage?.persist?.().catch(() => false);
    setStorage(result ? "已启用持久保存" : "系统暂未批准；请添加到主屏幕并定期备份");
  }

  return <>
    <button className="header-button subtle personal-controls-trigger" aria-label={personal ? "离线与备份" : "完整备份"} disabled={disabled} onClick={show}><Settings2 size={17} /><span>{personal ? "离线与备份" : "完整备份"}</span></button>
    {personal && <span className={`offline-pill ${offline === "离线资源已就绪" ? "ready" : ""}`} role="status" title={offline}>{offline === "离线资源已就绪" ? "离线就绪" : offline.startsWith("正在") ? "离线准备中" : "离线未就绪"}</span>}
    {open && <div className="modal-backdrop" onClick={() => { if (!working) setOpen(false); }}><section className="help-modal personal-modal" role="dialog" aria-modal="true" aria-labelledby="personal-title" onClick={event => event.stopPropagation()}>
      <button className="modal-close" aria-label="关闭离线与备份" disabled={working} onClick={() => setOpen(false)}><X size={20} /></button>
      <span className="eyebrow">墨读 {version}</span><h2 id="personal-title">{personal ? "离线与备份" : "完整备份与迁移"}</h2>
      {personal && <>
        <div className="personal-section"><h3>离线阅读</h3><p className="offline-state" role="status">{offline}</p><p>Safari → 分享 → 添加到主屏幕。首次下载完成后，从主屏幕打开即可离线阅读、写画和导出。AI 提问需要网络连接。</p>
          {waiting && <button className="personal-action" disabled={working} onClick={() => void updateApp()}>保存笔记并更新阅读器</button>}
          <p className="storage-state">{storage}</p><button className="personal-action secondary" onClick={() => void persist()} disabled={working}>申请持久保存</button>
        </div>
        <div className="personal-section"><h3>DeepSeek 设置</h3><p>Key 只保存在这台设备，不包含在备份中。问题、定位原文和标记截图直接发给 DeepSeek。</p>
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
