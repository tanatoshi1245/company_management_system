import type { PiiFinding } from '../../../../shared/ai/pii';
import '../../../styles/ai.css';

/** 入力に社名・個人情報が入っていたときの知らせ。block（保存できない）は赤、warn（確かめてもらう）は黄 */
export function PiiNotice({ findings }: { findings: PiiFinding[] }) {
  if (!findings.length) return null;
  const blocks = findings.filter((f) => f.level === 'block');
  const warns = findings.filter((f) => f.level === 'warn');
  return (
    <div className="ai-pii">
      {blocks.length ? (
        <div className="notice error" role="alert">
          <div>
            <b>このままでは実行できません</b>
            <ul>
              {blocks.map((f) => (
                <li key={f.message}>{f.message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {warns.length ? (
        <div className="notice warn" role="status">
          <div>
            <b>確かめてください</b>
            <ul>
              {warns.map((f) => (
                <li key={f.message}>{f.message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
