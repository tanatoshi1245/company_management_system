import { JobResultSchema, type JobInput, type JobResult } from '../../../shared/ai/job';

/**
 * ③ の見本（サンプルデータのとき。セッションを立ち上げない）。数値は見本で、実際の集計ではない。
 * 実在の社名・個人名を書かない（差し込みは {{企業名}}）
 */
export function jobSample(input: JobInput): JobResult {
  const position = input.positionName || 'ポジション';
  const occupation = input.occupations[0] ?? '職種';
  const review = input.purpose === 'review';
  return JobResultSchema.parse({
    ok: true,
    summary: `【見本】${input.industry}・${occupation}で「閲覧 → 応募」の率が上位の求人は、タイトルに職種と条件を入れ、仕事内容を「1 日の流れ」が分かる粒度で書いています。${review ? '添削ではタイトルと応募条件の書き分けを優先して直しました。' : 'この構成に沿って求人票を作りました。'}`,
    basis: { scope: `【見本】${input.industry}・${occupation}の求人。直近 6 か月に 100 回以上閲覧`, companies: 18, samples: 42, topRatePct: 4.8, overallRatePct: 1.9, caveat: 'サンプルデータの見本です。実際の集計ではありません。' },
    traits: [
      { title: 'タイトルに職種と条件', body: '上位の求人は、タイトルに職種名と、年収・リモート可否・言語のどれか 1〜2 つを入れています。' },
      { title: '仕事内容は具体的に', body: '担当する業務・相手・使う道具を箇条書きで書き、入社後の姿が浮かぶ粒度にしています。' },
      { title: '必須と歓迎を分ける', body: '応募条件を「必須」「歓迎」に分け、必須は 3〜4 点にしぼっています。' },
      { title: '言語の使い方を書く', body: '英語・日本語を、どの場面でどの程度使うかまで書いています。' },
    ],
    review: review
      ? [
          { part: 'タイトル', severity: 'high', issue: 'タイトルが職種名だけで、ほかの求人と見分けがつきません。', suggestion: '年収の幅か、働き方（リモート可など）を 1 つ添えます。' },
          { part: '応募条件', severity: 'high', issue: '必須と歓迎が混ざっていて、応募してよいかを判断しにくい書き方です。', suggestion: '「必須」を 3〜4 点にしぼり、残りを「歓迎」に移します。' },
          { part: '仕事内容', severity: 'mid', issue: '業務の説明が抽象的で、担当の範囲が分かりません。', suggestion: '担当する業務を箇条書きにし、相手と道具を書きます。' },
        ]
      : [],
    draft: {
      title: `${position}${input.salary ? `（${input.salary}）` : ''}${input.location ? `／${input.location}` : ''}`,
      description: `【お任せしたいこと】\n{{企業名}} の ${position} として、次の業務を担当していただきます。\n・（担当業務 1）\n・（担当業務 2）\n・（担当業務 3）\n\n【働き方】\n・勤務地: ${input.location || '（勤務地）'}\n・言語: ${input.language || '（英語・日本語を使う場面と程度）'}\n\n【このポジションの魅力】\n・（魅力 1）\n・（魅力 2）`,
      requirements: `【必須】\n・（必須の経験 1）\n・（必須の経験 2）\n・${input.language || '（言語の条件）'}\n\n【歓迎】\n・（歓迎の経験 1）\n・（歓迎の経験 2）`,
      rationale: '上位の求人に共通する「タイトルに条件」「仕事内容を箇条書きで具体的に」「必須と歓迎の書き分け」を取り入れました。',
    },
  });
}
