import { ReportResultSchema, type ReportInput, type ReportResult } from '../../../shared/ai/report';
import { addMonths } from '../../../shared/calendar/periods';

/** 期間の月（2〜6 個。1 か月だけの期間は、前の月を足して推移を描けるようにする） */
function sampleMonths(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = to; m >= from && out.length < 6; m = addMonths(m, -1)) out.unshift(m);
  if (out.length < 2) out.unshift(addMonths(out[0] ?? to, -1));
  return out;
}

/**
 * ① の見本（サンプルデータのとき。セッションを立ち上げない）。すべての layout を 1 枚ずつ含む 9 枚。
 * 数値は固定の見本で、実際の集計ではない。企業名は書かない（表紙は画面が差し込む）
 */
export function reportSample(input: ReportInput): ReportResult {
  const months = sampleMonths(input.from, input.to);
  const sent = [180, 210, 240, 260, 300, 320].slice(-months.length);
  const apps = [14, 16, 15, 19, 22, 24].slice(-months.length);
  const period = input.from === input.to ? input.to : `${input.from}〜${input.to}`;
  return ReportResultSchema.parse({
    ok: true,
    summary: `【見本】${period} の利用状況の見本です。スカウトの送信は増えていますが、返信率は業界の中央値を下回っています。文面の見直しと、閲覧の多い求人の条件の整理をご提案します。`,
    slides: [
      { layout: 'cover', title: 'ご利用状況のご報告とご提案', subtitle: `${period}${input.account ? `（${input.account}）` : ''}` },
      {
        layout: 'summary',
        kicker: 'このレポートの要約',
        lead: 'スカウトの量は伸びており、次は返信率の改善が成果につながります。',
        points: [
          { label: '良い点', text: 'スカウトの送信数は、期間を通して増えています。' },
          { label: '課題', text: '興味あり返信率が、同じ業界の中央値を下回っています。' },
          { label: 'ご提案', text: 'スカウトの件名と冒頭の見直しと、求人の応募条件の整理を行います。' },
        ],
      },
      {
        layout: 'kpi',
        kicker: '主要な数値',
        lead: '送信と応募は増え、返信率だけが伸び悩んでいます。',
        cards: [
          { label: 'スカウト送信', value: '1,510', unit: '通', note: '前の期間より増加', tone: 'good' },
          { label: '興味あり返信率', value: '4.2', unit: '%', note: '業界の中央値 5.1%', tone: 'warn' },
          { label: '求人閲覧', value: '3,480', unit: '回', note: '', tone: 'neutral' },
          { label: '応募', value: '110', unit: '件', note: '前の期間より増加', tone: 'good' },
        ],
        comment: '数値は見本です。',
      },
      {
        layout: 'trend',
        kicker: 'スカウト送信と応募の推移',
        lead: 'スカウトの送信数は、月を追って増えています。',
        unit: '件',
        series: [
          { name: 'スカウト送信', points: months.map((x, i) => ({ x, y: sent[i] ?? 0 })) },
          { name: '応募', points: months.map((x, i) => ({ x, y: apps[i] ?? 0 })) },
        ],
        comment: '数値は見本です。',
      },
      {
        layout: 'bars',
        kicker: '業界との比較',
        lead: '返信率は業界の中央値を下回り、応募は上回っています。',
        unit: '',
        valueLabel: '貴社',
        compareLabel: '業界の中央値',
        items: [
          { label: '興味あり返信率（%）', value: 4.2, compare: 5.1 },
          { label: '応募 / 求人（件）', value: 3.6, compare: 2.8 },
          { label: '閲覧 / 求人（回）', value: 116, compare: 98 },
        ],
        comment: '数値は見本です。',
      },
      {
        layout: 'table',
        kicker: '求人ごとの実績',
        lead: '閲覧の多い求人ほど、応募の率に差が出ています。',
        columns: ['求人', '閲覧', '応募', '応募の率'],
        rows: [
          ['求人 A（営業）', '1,240', '52', '4.2%'],
          ['求人 B（エンジニア）', '980', '21', '2.1%'],
          ['求人 C（事務）', '620', '25', '4.0%'],
        ],
        comment: '数値は見本です。',
      },
      {
        layout: 'findings',
        kicker: '分かったこと',
        lead: '量は確保できており、文面と条件の伝え方に伸びしろがあります。',
        items: [
          { title: 'スカウトの量は十分です', body: '送信数は月を追って増えており、枠も計画どおりに使えています。', tone: 'good' },
          { title: '返信率が伸びていません', body: '送信が増えた月も返信率は横ばいで、文面の見直しの効果が出やすい状態です。', tone: 'warn' },
          { title: '求人 B の応募の率が低めです', body: '閲覧は多い一方で応募が少なく、応募条件の書き方に見直しの余地があります。', tone: 'bad' },
        ],
      },
      {
        layout: 'proposal',
        kicker: 'ご提案',
        lead: 'スカウトの文面と求人の条件を見直し、返信と応募を増やします。',
        actions: [
          { title: 'スカウトの件名と冒頭を見直します', body: '件名に職種と条件を入れ、冒頭で「なぜあなたに送ったか」を伝える形に直します。', effect: '' },
          { title: '求人 B の応募条件を整理します', body: '必須と歓迎を分け、必須を 3〜4 点にしぼります。', effect: '' },
          { title: '返信のあった層へ送信を寄せます', body: '興味あり返信の多い属性を確かめ、検索条件に反映します。', effect: '' },
        ],
      },
      {
        layout: 'next',
        kicker: '次の一歩',
        lead: '今月中に文面を直し、来月の数値で効果を確かめます。',
        steps: [
          { when: '今週', what: 'スカウトの文面の案をお送りします。' },
          { when: '今月中', what: '求人 B の応募条件を直して掲載し直します。' },
          { when: '来月', what: '返信率と応募の率を、今月と比べてご報告します。' },
        ],
      },
    ],
  });
}
