export function AiResponseStatus({ status, partial, error, onStop, onDismiss, onQuickRetry }: { status: string; partial: string; error: string; onStop: () => void; onDismiss: () => void; onQuickRetry: () => void }) {
  if (!status && !partial && !error) return null;
  return <div className="ai-response-status">
    {partial && <div className="chat-message assistant"><span className="assistant-avatar">✦</span><div className="message-body"><small>{status ? "正在接收回答" : "回答未完成"}</small><p className="ai-partial-answer">{partial}</p></div></div>}
    {status && <div className="ai-request-progress" role="status"><span>{status}</span><button type="button" onClick={onStop}>停止本次提问</button></div>}
    {error && <div className="ai-request-error" role="alert"><span>{error}</span>{/思考用完|只返回了思考/.test(error) && <button type="button" title="本次关闭深度思考，不修改默认设置" onClick={onQuickRetry}>快速回答重试</button>}<button type="button" aria-label="关闭 AI 错误提示" onClick={onDismiss}>关闭</button></div>}
  </div>;
}
