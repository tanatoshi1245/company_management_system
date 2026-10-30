import { SELECTION_CARD_KEYS, SELECTION_CARD_LABEL } from '../../../../shared/labels';
import { SummaryPanel } from './SummaryPanel';

/**
 * 選考状況: 期間中に応募 / 興味あり返信した人の、今の選考ステータス別の人数（面接調整中 → 採用の 6 枚）。
 * データは現在のステータスだけ（履歴なし）なので通過人数のファネルではない。求人選択時は応募側だけ
 */
export function SelectionPanel({ selection, lead, jobLabel }: { selection: Record<string, number>; lead: string; jobLabel?: string | null }) {
  return (
    <SummaryPanel
      title="選考状況"
      help={`選択期間に応募した人と「興味あり」返信した人のうち、今の選考ステータスが各段階にある人数（現在値のみ。ステータスの履歴は無いので「通過した人数」ではない）。辞退・見送り・不採用・連絡前は出さない。${jobLabel ? '求人を選んでいるので応募経由だけ' : '応募とスカウトの両方'}`}
      lead={`${lead}${jobLabel ? `・求人: ${jobLabel}（応募経由のみ）` : ''}`}
      testId="summary-selection"
      cols="six"
      stats={SELECTION_CARD_KEYS.map((k) => ({ key: k, label: SELECTION_CARD_LABEL[k], value: selection[k] ?? 0, unit: '人' }))}
    />
  );
}
