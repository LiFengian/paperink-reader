import { createRoot } from "react-dom/client";
import { Component, useEffect } from "react";
import type { ReactNode } from "react";
import { Reader } from "../app/page";
import "../app/globals.css";

declare global {
  interface Window { paperinkBoot?: { ready: () => void; fail: (reason?: string) => void } }
}
class ReaderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { window.paperinkBoot?.fail("界面启动遇到异常，可返回文献库或修复阅读器资源。"); }
  render() { return this.state.failed ? null : this.props.children; }
}
function PersonalReader() {
  useEffect(() => { window.paperinkBoot?.ready(); }, []);
  return <Reader personal />;
}
createRoot(document.getElementById("root")!, {
  onUncaughtError: () => window.paperinkBoot?.fail("界面启动遇到异常，可返回文献库或修复阅读器资源。"),
}).render(<ReaderBoundary><PersonalReader /></ReaderBoundary>);
