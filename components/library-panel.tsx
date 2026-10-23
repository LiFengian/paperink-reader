"use client";

import { useMemo, useRef, useState } from "react";
import { BookOpen, Check, Folder, FolderInput, FolderOpen, FolderPlus, Inbox, Pencil, Plus, Trash2, X } from "lucide-react";
import { createLibraryFolder, deleteLibraryFolder, listLibraryOrganization, moveDocumentToFolder, renameLibraryFolder } from "../lib/local-store";
import type { LibraryOrganization, ReaderDocument } from "../lib/reader-types";

type Props = {
  documents: ReaderDocument[];
  organization: LibraryOrganization;
  currentId?: string;
  filter: string;
  disabled: boolean;
  onFilter: (id: string) => void;
  onOrganization: (organization: LibraryOrganization) => void;
  onImport: () => void;
  onOpen: (document: ReaderDocument) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onMessage: (message: string) => void;
};

export function LibraryPanel({ documents, organization, currentId, filter, disabled, onFilter, onOrganization, onImport, onOpen, onDelete, onClose, onMessage }: Props) {
  const { folders, assignments } = organization;
  const [editor, setEditor] = useState<{ id?: string; name: string } | null>(null);
  const [moving, setMoving] = useState<{ id: string; folderId: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const locked = disabled || working;
  const activeFolder = folders.find(folder => folder.id === filter);
  const folderIds = useMemo(() => new Set(folders.map(folder => folder.id)), [folders]);
  const membership = (id: string) => folderIds.has(assignments[id]) ? assignments[id] : "unfiled";
  const visible = documents.filter(item => filter === "all" || membership(item.id) === filter);
  const counts = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of documents) {
      const id = folderIds.has(assignments[item.id]) ? assignments[item.id] : "unfiled";
      totals.set(id, (totals.get(id) || 0) + 1);
    }
    return totals;
  }, [documents, assignments, folderIds]);

  async function perform(action: () => Promise<void>) {
    if (disabled || running.current) return;
    running.current = true; setWorking(true); setError("");
    try { await action(); }
    catch (reason) { setError((reason as Error).message || "文件夹操作失败，请重试。"); }
    finally { running.current = false; setWorking(false); }
  }
  async function saveFolder() {
    if (!editor) return;
    await perform(async () => {
      const folder = editor.id ? await renameLibraryFolder(editor.id, editor.name) : await createLibraryFolder(editor.name);
      onOrganization(await listLibraryOrganization()); onFilter(folder.id); setEditor(null);
    });
  }
  function removeFolder(id: string, name: string) {
    if (!window.confirm(`删除文件夹“${name}”吗？其中的文献、笔记和对话将移到“未分类”，内容会保留。`)) return;
    void perform(async () => {
      await deleteLibraryFolder(id); onOrganization(await listLibraryOrganization());
      if (filter === id) onFilter("unfiled");
      if (editor?.id === id) setEditor(null);
      setMoving(null); onMessage("文件夹已删除，内容已移到未分类。");
    });
  }
  function selectFolder(id: string) { onFilter(id); setMoving(null); setEditor(null); setError(""); }
  return <aside className="library-panel" aria-label="文献与对话分类">
    <div className="panel-heading"><div><span className="eyebrow">LIBRARY</span><h2>文献库</h2></div><button className="plain-icon compact" aria-label="关闭文献库" onClick={onClose}><X size={18} /></button></div>
    <button className="import-button" disabled={locked} onClick={onImport}><Plus size={18} />{activeFolder ? "导入 PDF 到此文件夹" : "导入 PDF 文献"}</button>
    <div className="library-folders-heading"><strong>文件夹</strong><button aria-label="新建文件夹" title="新建文件夹" disabled={locked} onClick={() => { setEditor({ name: "" }); setError(""); }}><FolderPlus size={17} /></button></div>
    <p className="library-folders-hint">文献、笔记与对话一起归类</p>
    {editor && <form className="folder-editor" onSubmit={event => { event.preventDefault(); void saveFolder(); }}>
      <label htmlFor="folder-name">{editor.id ? "重命名文件夹" : "新建文件夹"}</label>
      <input id="folder-name" autoFocus maxLength={60} value={editor.name} disabled={locked} placeholder="如：英语报道、科普阅读" onChange={event => setEditor({ ...editor, name: event.target.value })} onKeyDown={event => { if (event.key === "Escape" && !locked) { event.preventDefault(); setEditor(null); } }} />
      <div><button type="submit" disabled={locked || !editor.name.trim()}><Check size={13} />保存</button><button type="button" disabled={locked} onClick={() => setEditor(null)}>取消</button></div>
    </form>}
    {error && <p className="folder-error" role="alert">{error}</p>}
    <nav className="library-folders" aria-label="选择文件夹">
      <button className="folder-filter" aria-current={filter === "all" ? "true" : undefined} disabled={locked} onClick={() => selectFolder("all")}><BookOpen size={16} /><span>全部内容</span><small>{documents.length}</small></button>
      <button className="folder-filter" aria-current={filter === "unfiled" ? "true" : undefined} disabled={locked} onClick={() => selectFolder("unfiled")}><Inbox size={16} /><span>未分类</span><small>{counts.get("unfiled") || 0}</small></button>
      {folders.map(folder => <div className="folder-row" key={folder.id}>
        <button className="folder-filter" aria-current={filter === folder.id ? "true" : undefined} title={folder.name} disabled={locked} onClick={() => selectFolder(folder.id)}><Folder size={16} /><span>{folder.name}</span><small>{counts.get(folder.id) || 0}</small></button>
        <button className="folder-action" aria-label={`重命名文件夹 ${folder.name}`} title="重命名" disabled={locked} onClick={() => { setEditor({ id: folder.id, name: folder.name }); setError(""); }}><Pencil size={13} /></button>
        <button className="folder-action" aria-label={`删除文件夹 ${folder.name}`} title="删除文件夹，保留内容" disabled={locked} onClick={() => removeFolder(folder.id, folder.name)}><Trash2 size={13} /></button>
      </div>)}
    </nav>
    <div className="library-caption"><strong>{activeFolder?.name || (filter === "unfiled" ? "未分类" : "最近阅读")}</strong><span>{visible.length}</span></div>
    <div className="library-list">{visible.length ? visible.map(item => <div className={`library-item ${currentId === item.id ? "selected" : ""}`} key={item.id}>
      <div className="library-item-main">
        <button className="library-open" disabled={locked} onClick={() => onOpen(item)}><span className="book-thumb"><BookOpen size={21} /></span><span className="book-info"><strong title={item.name}>{item.name}</strong><small>{item.pages.length} 页 · {new Date(item.updatedAt).toLocaleDateString("zh-CN")}</small>{filter === "all" && <small className="book-folder">{folders.find(folder => folder.id === assignments[item.id])?.name || "未分类"}</small>}</span></button>
        <button className="move-document" title="移动文献及对话" aria-label={`移动 ${item.name}`} disabled={locked} onClick={() => { setMoving({ id: item.id, folderId: membership(item.id) }); setError(""); }}><FolderInput size={16} /></button>
        <button className="delete-small" title="删除文献" aria-label={`删除 ${item.name}`} disabled={locked} onClick={() => onDelete(item.id)}><Trash2 size={15} /></button>
      </div>
      {moving?.id === item.id && <form className="folder-move" onSubmit={event => { event.preventDefault(); void perform(async () => {
        await moveDocumentToFolder(item.id, moving.folderId === "unfiled" ? null : moving.folderId);
        onOrganization(await listLibraryOrganization()); setMoving(null); onMessage("文献、笔记和对话已一起移动。");
      }); }}>
        <label htmlFor="move-folder">移动文献及对话到</label><select id="move-folder" value={moving.folderId} disabled={locked} onChange={event => setMoving({ id: item.id, folderId: event.target.value })}><option value="unfiled">未分类</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
        <div><button type="submit" disabled={locked}>移动</button><button type="button" disabled={locked} onClick={() => setMoving(null)}>取消</button></div>
      </form>}
    </div>) : <div className="library-empty"><FolderOpen size={28} /><p>{filter === "all" ? "还没有阅读内容" : "这里还没有内容"}</p><small>{activeFolder ? "在这里导入 PDF，或从全部内容中移动文献过来。" : "导入 PDF 后，笔记与对话会自动保存在这台设备。"}</small></div>}</div>
    <div className="library-footer"><span>◈</span><p>文件夹与内容仅存于本机，可通过完整备份迁移。发送问题时，相关内容会交给 DeepSeek。</p></div>
  </aside>;
}
