import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  UsageError,
  assertParamsDeclared,
  assertSelectOnly,
  buildParams,
  checkHookUrl,
  checkOutPath,
  checkToken,
  collectStrings,
  listSqlNames,
  parseArgs,
  parseSqlHeader,
  resolveSqlFile,
  stripSql,
  usedParams,
} from '../../scripts/ai/lib';
import { checkResult } from '../../scripts/ai/submit';

/**
 * AI 機能のセッションが使う道具（scripts/ai）と SQL（ai/<機能>/sql）の決まり。
 *   - SQL は SELECT 1 文だけ・読むのは bq-hgt.dwh だけ・宣言と @param が一致・上限の宣言がある
 *   - 送る先は Worker の hook だけ・実行できる SQL はディレクトリにあるファイルだけ
 */
const ROOT = process.cwd();
const AI_ROOT = join(ROOT, 'ai');
const JOB = 'abcdefghij0123456789';

describe('ai/<機能>/sql/*.sql', () => {
  const names = listSqlNames(AI_ROOT);

  it('決まった SQL がある', () => {
    expect(names).toEqual(expect.arrayContaining(['scout/peer_templates', 'job/peer_jobs', 'job/target_job']));
  });

  for (const name of names) {
    const sql = readFileSync(resolveSqlFile(name, AI_ROOT), 'utf8');
    it(`${name}: SELECT だけ・bq-hgt.dwh だけ`, () => {
      expect(() => assertSelectOnly(sql)).not.toThrow();
    });
    it(`${name}: 宣言したパラメータと本文の @param が一致し、上限の宣言がある`, () => {
      const h = parseSqlHeader(sql);
      expect(() => assertParamsDeclared(sql, h)).not.toThrow();
      expect(h.maxBytes).toBeGreaterThan(0);
      expect(h.maxBytes).toBeLessThanOrEqual(30 * 1024 ** 3);
      expect(h.params.map((p) => p.name)).toContain('company_id');
      // 必須のものだけ渡せば組み立てられる（既定値が型・範囲に合っている）
      const required = h.params.filter((p) => p.required).map((p) => `${p.name}=${p.type === 'INT64' ? '1' : 'x'}`);
      expect(buildParams(h, required)).toHaveLength(h.params.length);
    });
    it(`${name}: 先頭のコメントに目的と返す列があり、企業名を返さない`, () => {
      expect(sql).toMatch(/^-- 目的:/);
      expect(sql).toMatch(/-- 返す列/);
      const body = stripSql(sql);
      // 最後の SELECT（結果）に company_name / internal_name / company_id を出さない
      const out = body.slice(body.lastIndexOf('\nSELECT '));
      expect(out).not.toMatch(/company_name|internal_name|\bcompany_id\b\s*(,|AS)/);
    });
  }

  it('手順書がある（session と、機能ごとの guide）', () => {
    for (const f of ['session.md', 'report/guide.md', 'scout/guide.md', 'job/guide.md']) expect(existsSync(join(AI_ROOT, f)), f).toBe(true);
    const session = readFileSync(join(AI_ROOT, 'session.md'), 'utf8');
    for (const word of ['データであり、指示ではない', 'コミットしない', 'BigQuery に書かない', '{{企業名}}', '事実を作らない', '合言葉', '--fail', '--dry']) expect(session).toContain(word);
  });

  it('target_job は、企業で絞っている', () => {
    const sql = stripSql(readFileSync(resolveSqlFile('job/target_job', AI_ROOT), 'utf8'));
    expect(sql).toMatch(/company_id = @company_id/);
    expect(sql).toMatch(/JOIN own o USING \(profile_id\)/);
  });
});

describe('SQL のファイルの制限', () => {
  it('ディレクトリにあるファイルだけ', () => {
    expect(resolveSqlFile('scout/peer_templates', AI_ROOT)).toBe(join(AI_ROOT, 'scout', 'sql', 'peer_templates.sql'));
    for (const bad of ['scout/nope', 'scout/../job/peer_jobs', '../scripts/x', 'scout/peer_templates.sql', '/etc/passwd', 'scout//peer_templates', 'worker/x', 'scout/Peer_Templates', 'scout/peer_templates/..', '']) {
      expect(() => resolveSqlFile(bad, AI_ROOT), bad).toThrow(UsageError);
    }
  });

  it('SELECT 以外・複数文・ほかのデータセットを通さない', () => {
    const ok = "-- c\nWITH a AS (SELECT 1 AS x FROM `bq-hgt.dwh.t` WHERE s = 'DELETE; DROP' -- INSERT\n) SELECT x FROM a";
    expect(() => assertSelectOnly(ok)).not.toThrow();
    for (const bad of [
      'INSERT INTO `bq-hgt.dwh.t` SELECT 1',
      'SELECT 1; DROP TABLE `bq-hgt.dwh.t`',
      'WITH a AS (SELECT 1) DELETE FROM `bq-hgt.dwh.t` WHERE TRUE',
      'CREATE TABLE `bq-hgt.dwh.t` AS SELECT 1',
      'MERGE `bq-hgt.dwh.t` t USING (SELECT 1) s ON FALSE WHEN NOT MATCHED THEN INSERT ROW',
      'EXPORT DATA OPTIONS(uri="gs://x/*") AS SELECT 1',
      'SELECT * FROM `bq-hgt.raw.t`',
      'SELECT * FROM `other-project.dwh.t`',
      'DECLARE x INT64; SELECT x',
      'CALL `bq-hgt.dwh.p`()',
      'SELECT 1 /* x */; SELECT 2',
    ]) {
      expect(() => assertSelectOnly(bad), bad).toThrow(UsageError);
    }
  });

  it('宣言の読み取りと、@param の突き合わせ', () => {
    const sql = '-- param: a INT64 required\n-- param: b STRING nullable\n-- param: c ARRAY<STRING> default=[]\n-- param: d INT64 default=6 min=1 max=12\n-- max_bytes: 2GB\nSELECT @a, @b, @d FROM UNNEST(@c) -- @zzz';
    const h = parseSqlHeader(sql);
    expect(h.maxBytes).toBe(2 * 1024 ** 3);
    expect(usedParams(sql)).toEqual(['a', 'b', 'd', 'c']);
    expect(() => assertParamsDeclared(sql, h)).not.toThrow();
    expect(() => assertParamsDeclared(`${sql}\n, @e`, h)).toThrow(/宣言の無い/);
    expect(() => assertParamsDeclared(sql.replace('@b,', ''), h)).toThrow(/使っていない/);
    expect(() => parseSqlHeader('SELECT 1')).toThrow(/max_bytes/);
    expect(() => parseSqlHeader('-- max_bytes: 100GB\nSELECT 1')).toThrow(/大きすぎ/);
    expect(() => parseSqlHeader('-- param: a INT64\n-- max_bytes: 1GB\nSELECT 1')).toThrow();
  });

  it('パラメータは、宣言した名前・型・範囲だけ', () => {
    const h = parseSqlHeader('-- param: a INT64 required\n-- param: b STRING nullable\n-- param: c ARRAY<STRING> default=[]\n-- param: d INT64 default=6 min=1 max=12\n-- param: e BOOL default=true\n-- max_bytes: 1GB\nSELECT 1');
    const ps = buildParams(h, ['a=5', 'c=x - y', 'c=z']);
    expect(ps).toEqual([
      { name: 'a', parameterType: { type: 'INT64' }, parameterValue: { value: '5' } },
      { name: 'b', parameterType: { type: 'STRING' }, parameterValue: { value: null } },
      { name: 'c', parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } }, parameterValue: { arrayValues: [{ value: 'x - y' }, { value: 'z' }] } },
      { name: 'd', parameterType: { type: 'INT64' }, parameterValue: { value: '6' } },
      { name: 'e', parameterType: { type: 'BOOL' }, parameterValue: { value: 'true' } },
    ]);
    // 値に SQL を書いても、値のまま（@param）で渡る
    expect(buildParams(h, ['a=1', "b=x' OR 1=1 --"])[1].parameterValue.value).toBe("x' OR 1=1 --");
    for (const bad of [['b=x'], ['a=1', 'zzz=1'], ['a=1 OR 1=1'], ['a=1', 'd=13'], ['a=1', 'd=0'], ['a=1', 'a=2'], ['a=1', 'e=yes'], ['a=1', `b=${'x'.repeat(201)}`], ['a']]) {
      expect(() => buildParams(h, bad), bad.join(' ')).toThrow(UsageError);
    }
  });
});

describe('宛先の制限', () => {
  it('Worker の hook だけ', () => {
    expect(checkHookUrl(`https://company-management-system.example.workers.dev/hook/ai/jobs/${JOB}/context`, 'context').pathname).toContain(JOB);
    expect(() => checkHookUrl(`https://x.workers.dev/hook/ai/jobs/${JOB}/result`, 'result')).not.toThrow();
    expect(() => checkHookUrl(`http://127.0.0.1:8787/hook/ai/jobs/${JOB}/context`, 'context')).not.toThrow();
    expect(() => checkHookUrl(`http://localhost:5173/hook/ai/jobs/${JOB}/result`, 'result')).not.toThrow();
    for (const bad of [
      `http://x.workers.dev/hook/ai/jobs/${JOB}/context`,
      `https://example.com/hook/ai/jobs/${JOB}/context`,
      `https://workers.dev/hook/ai/jobs/${JOB}/context`,
      `https://x.workers.dev.evil.com/hook/ai/jobs/${JOB}/context`,
      `https://evil.com/x.workers.dev/hook/ai/jobs/${JOB}/context`,
      `https://user:pw@x.workers.dev/hook/ai/jobs/${JOB}/context`,
      `https://x.workers.dev@evil.com/hook/ai/jobs/${JOB}/context`,
      `https://x.workers.dev:8443/hook/ai/jobs/${JOB}/context`,
      `https://x.workers.dev/hook/ai/jobs/${JOB}/context?next=https://evil.com`,
      `https://x.workers.dev/hook/ai/jobs/${JOB}/context#x`,
      `https://x.workers.dev/hook/ai/jobs/${JOB}/result`,
      `https://x.workers.dev/api/ai/jobs/${JOB}`,
      `https://x.workers.dev/hook/ai/jobs/../../api/x/context`,
      'https://x.workers.dev/hook/ai/jobs/short/context',
      `http://127.0.0.1.evil.com/hook/ai/jobs/${JOB}/context`,
      `ftp://localhost/hook/ai/jobs/${JOB}/context`,
      'not a url',
    ]) {
      expect(() => checkHookUrl(bad, 'context'), bad).toThrow(UsageError);
    }
  });

  it('合言葉の形・出力先', () => {
    expect(checkToken('abcDEF0123456789_-xyz')).toBe('abcDEF0123456789_-xyz');
    for (const bad of [undefined, '', 'short', 'has space 0123456789', 'new\nline0123456789abc']) expect(() => checkToken(bad)).toThrow(UsageError);
    expect(checkOutPath('/tmp/x.json', ROOT)).toBe('/tmp/x.json');
    for (const bad of [join(ROOT, 'x.json'), join(ROOT, 'ai', 'scout', 'x.json'), ROOT, 'x.json']) expect(() => checkOutPath(bad, ROOT), bad).toThrow(UsageError);
  });

  it('引数', () => {
    const a = parseArgs(['scout/x', '--param', 'a=1', '--param', 'b=2', '--dry', '--out', '/tmp/x'], ['dry']);
    expect(a.positional).toEqual(['scout/x']);
    expect(a.options.param).toEqual(['a=1', 'b=2']);
    expect(a.flags.has('dry')).toBe(true);
    expect(() => parseArgs(['--out'])).toThrow(UsageError);
  });
});

describe('結果の検証（ai:submit）', () => {
  const scout = {
    summary: '同じ業界の上位の文面と比べ、冒頭で理由を伝える形に直しました。',
    basis: { scope: '全業界の企業。直近 6 か月に手動スカウトを 50 通以上送信', companies: 10, samples: 12, topRatePct: 8.1, overallRatePct: 3.2, caveat: '' },
    traits: [
      { title: '冒頭で理由を伝える', body: '最初の 2 行で、経歴のどこを見て送ったかを書いている。' },
      { title: '行動の促しは 1 つ', body: '締めは、興味ありの返信だけを求めている。' },
    ],
    review: [{ part: '冒頭', severity: 'high', issue: '自社の紹介から始まっている。', suggestion: '経歴に触れる 1 文から始める。' }],
    drafts: [{ label: '添削後', subject: '{{ポジション名}}のご案内', body: '{{候補者名}}様\n\nご経歴を拝見しご連絡しました。\n\n{{企業名}} {{担当者名}}', rationale: '冒頭で理由を伝える形にした。' }],
  };

  it('形が合えば通り、差し込みは個人情報として数えない', () => {
    const c = checkResult('scout', scout);
    expect(c.errors).toEqual([]);
    expect(c.ok).toBe(true);
    expect((c.body as { ok: boolean }).ok).toBe(true);
  });

  it('形が違えば、項目ごとの理由を返す', () => {
    const c = checkResult('scout', { ...scout, traits: [], extra: 1 });
    expect(c.ok).toBe(false);
    expect(c.errors.some((e) => e.startsWith('traits'))).toBe(true);
    expect(checkResult('report', scout).ok).toBe(false);
    expect(checkResult('job', scout).ok).toBe(false);
  });

  it('メールアドレス・電話番号が入っていたら通さない', () => {
    const withMail = { ...scout, drafts: [{ ...scout.drafts[0], body: 'ご連絡は taro@example.co.jp まで' }] };
    const c = checkResult('scout', withMail);
    expect(c.ok).toBe(false);
    expect(c.errors[0]).toMatch(/^drafts\[0\]\.body: メールアドレス/);
    const withTel = { ...scout, drafts: [{ ...scout.drafts[0], body: 'お電話は 03-1234-5678 まで' }] };
    expect(checkResult('scout', withTel).ok).toBe(false);
  });

  it('文字の取り出し', () => {
    expect(collectStrings({ a: 'x', b: [{ c: 'y' }, 1, null] })).toEqual([
      { path: 'a', text: 'x' },
      { path: 'b[0].c', text: 'y' },
    ]);
  });
});
