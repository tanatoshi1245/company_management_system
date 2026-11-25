import { describe, expect, it } from 'vitest';
import { companyNeedles, findPii, hasBlockingPii } from '../../src/shared/ai/pii';

describe('findPii（入力の社名・個人情報の確認）', () => {
  it('何も無ければ空', () => {
    expect(findPii('はじめまして。法人営業のポジションをご案内します。年収は 500〜800 万円です。')).toEqual([]);
    expect(hasBlockingPii([])).toBe(false);
  });

  it('メールアドレス・電話番号は block', () => {
    const mail = findPii('ご連絡は taro.yamada@example.co.jp まで');
    expect(mail).toHaveLength(1);
    expect(mail[0].level).toBe('block');
    expect(mail[0].message).toContain('メールアドレス');
    expect(hasBlockingPii(mail)).toBe(true);
    for (const tel of ['03-1234-5678', '090-1234-5678', '09012345678', '+81 90 1234 5678', '0120-123-456']) {
      const f = findPii(`お電話は ${tel} へ`);
      expect(f.some((x) => x.level === 'block' && x.message.includes('電話番号')), tel).toBe(true);
    }
  });

  it('年収・ID の数字の並びは電話番号にしない', () => {
    expect(findPii('年収 5000000 円、求人 ID 1234567890、2026-11-25 掲載')).toEqual([]);
  });

  it('選んだ企業の名前は block（法人格を外した名前・大文字小文字の違いでも）。見つかった文字は 20 文字まで', () => {
    const f = findPii('アクメ商事で一緒に働きませんか', ['株式会社アクメ商事']);
    expect(f).toHaveLength(1);
    expect(f[0]).toEqual({ level: 'block', message: '企業名が入っています（アクメ商事）。{{企業名}} に置き換えてください' });
    expect(hasBlockingPii(findPii('Join ACME global today', ['Acme Global Inc.']))).toBe(true);
    const long = 'とても長い名前の会社でございますのでどうぞよろしくお願いします';
    const m = findPii(`${long} のご紹介`, [long])[0].message;
    expect(m).toContain(`${long.slice(0, 20)}…`);
    expect(m).not.toContain(long);
  });

  it('企業名が 2 文字未満なら照合しない。null・空も無視する', () => {
    expect(companyNeedles(['A', null, undefined, ''])).toEqual([]);
    expect(companyNeedles(['株式会社アクメ商事'])).toEqual(['株式会社アクメ商事', 'アクメ商事']);
    expect(findPii('A 社のような環境です', ['A'])).toEqual([]);
  });

  it('「株式会社」などの書き方は warn（企業名の block があるときは重ねない）', () => {
    const f = findPii('株式会社サンプルの営業職です');
    expect(f).toEqual([{ level: 'warn', message: '社名らしい書き方があります（「株式会社」など）。{{企業名}} に置き換えてください' }]);
    expect(hasBlockingPii(f)).toBe(false);
    expect(findPii('We are Example Inc. and hiring').some((x) => x.level === 'warn')).toBe(true);
    const both = findPii('株式会社アクメ商事の営業職です', ['株式会社アクメ商事']);
    expect(both.map((x) => x.level)).toEqual(['block']);
  });

  it('「〇〇様」は warn。「お客様」「皆様」「同様」「仕様」「様々」「様子」は拾わない', () => {
    const f = findPii('山田様、はじめまして');
    expect(f).toEqual([{ level: 'warn', message: '個人名らしい書き方があります（「〇〇様」）。{{候補者名}} などに置き換えてください' }]);
    expect(findPii('お客様や皆様と同様に、仕様を様々な様子で確認します')).toEqual([]);
  });

  it('差し込み（{{企業名}} {{候補者名}}）は対象外', () => {
    expect(findPii('{{候補者名}}様、{{企業名}} の {{担当者名}} です')).toEqual([]);
  });

  it('同じ種類の指摘は 1 つにまとめる', () => {
    const f = findPii('a@example.com と b@example.com、03-1111-2222 と 03-3333-4444');
    expect(f.map((x) => x.level)).toEqual(['block', 'block']);
  });
});
